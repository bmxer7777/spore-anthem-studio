"""Tests for the extraction tools. No Spore files needed: everything is synthetic."""
import json
import os
import struct
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))

from spore import locate
from spore.dbpf import Package, fnv, refpack_decompress
from spore.prop import parse as parse_prop
from spore.spui import parse as parse_spui


def make_spore(root):
    os.makedirs(os.path.join(root, 'Data'))
    open(os.path.join(root, 'Data', 'Spore_Audio1.package'), 'wb').close()
    return root


class LocateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = make_spore(os.path.join(self.tmp.name, 'Spore'))
        self.settings = os.path.join(self.tmp.name, 'settings.json')

    def tearDown(self):
        self.tmp.cleanup()

    def test_normalize_accepts_root_or_data_folder(self):
        self.assertEqual(locate.normalize(self.root), self.root)
        self.assertEqual(locate.normalize(os.path.join(self.root, 'Data')), self.root)
        self.assertEqual(locate.normalize('"%s"' % self.root), self.root)

    def test_normalize_rejects_other_folders(self):
        self.assertIsNone(locate.normalize(self.tmp.name))
        self.assertIsNone(locate.normalize(os.path.join(self.tmp.name, 'nope')))
        self.assertIsNone(locate.normalize(''))

    def test_registry_installloc(self):
        reg = {'installloc': self.root}
        found = locate.from_registry(lambda key, name: reg.get(name))
        self.assertEqual(found, self.root)

    def test_registry_datadir_fallback_and_stale_key(self):
        reg = {'installloc': os.path.join(self.tmp.name, 'uninstalled'), 'datadir': os.path.join(self.root, 'Data')}
        self.assertEqual(locate.from_registry(lambda key, name: reg.get(name)), self.root)
        self.assertIsNone(locate.from_registry(lambda key, name: None))

    def test_env_overrides_registry(self):
        other = make_spore(os.path.join(self.tmp.name, 'Other'))
        found = locate.find_spore(False, env={'SPORE_DIR': other},
                                  read_value=lambda k, n: self.root, settings=self.settings)
        self.assertEqual(found, other)

    def test_registry_result_is_remembered(self):
        found = locate.find_spore(False, env={}, read_value=lambda k, n: self.root if n == 'installloc' else None,
                                  settings=self.settings)
        self.assertEqual(found, self.root)
        self.assertEqual(json.load(open(self.settings))['spore_dir'], self.root)
        # next run: registry gone, remembered folder still used
        self.assertEqual(locate.find_spore(False, env={}, read_value=lambda k, n: None, settings=self.settings), self.root)

    def test_not_found_without_prompt(self):
        self.assertIsNone(locate.find_spore(False, env={}, read_value=lambda k, n: None, settings=self.settings))


def write_dbpf(path, entries):
    """Minimal DBPF 3.0 writer: entries = [(type, group, instance, bytes)] (stored uncompressed)."""
    body = bytearray(b'\0' * 96)
    index = bytearray(struct.pack('<I', 0))
    for t, g, i, data in entries:
        off = len(body)
        body += data
        index += struct.pack('<IIIIIIIHH', t, g, 0, i, off, len(data) | 0x80000000, len(data), 0, 1)
    idx_off = len(body)
    body += index
    struct.pack_into('<4sI', body, 0, b'DBPF', 3)
    struct.pack_into('<I', body, 0x24, len(entries))
    struct.pack_into('<I', body, 0x2C, len(index))
    struct.pack_into('<I', body, 0x40, idx_off)
    with open(path, 'wb') as f:
        f.write(body)


class ArchiveTests(unittest.TestCase):
    def test_fnv_is_spore_hash(self):
        # values seen in Spore's own data
        self.assertEqual(fnv('playercitymusic'), 0xC60360D0)
        self.assertEqual(fnv('PlayerCityMusic'), fnv('playercitymusic'))

    def test_dbpf_roundtrip(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'x.package')
            write_dbpf(p, [(0x617715D9, 0x021407EE, fnv('guitar'), b'#N canvas 0 0 10 10 12;\n'),
                           (0x2F7D0004, 0x31A44893, 7, b'\x89PNG')])
            with Package(p) as pk:
                self.assertEqual(len(pk.entries), 2)
                e = pk.entries[0]
                self.assertEqual((e.type, e.group, e.instance), (0x617715D9, 0x021407EE, fnv('guitar')))
                self.assertEqual(pk.read(e), b'#N canvas 0 0 10 10 12;\n')
                self.assertEqual(pk.read(pk.entries[1]), b'\x89PNG')

    def test_refpack_literals_and_backreference(self):
        stream = bytes([0x10, 0xFB, 0x00, 0x00, 0x08,   # header: uncompressed size 8
                        0xE0, *b'abcd',                  # 4 literal bytes
                        0x04, 0x03,                      # copy 4 bytes from 4 back
                        0xFC])                           # end
        self.assertEqual(refpack_decompress(stream), b'abcdabcd')

    def test_prop_keys_are_little_endian(self):
        key = struct.pack('<III', 0xBCF5B0BB, 0, 0)
        blob = struct.pack('>IIHHII', 1, 0xE0ABFD7C, 0x20, 0x30, 1, 12) + key
        (k, t, v), = parse_prop(blob)
        self.assertEqual(t, 'key')
        self.assertEqual(v, ['00000000!bcf5b0bb.00000000'])

    def test_prop_scalars_are_big_endian(self):
        blob = struct.pack('>IIHHI', 1, 0x81279214, 0x0A, 0, 16)
        self.assertEqual(parse_prop(blob), [(0x81279214, 'u32', 16)])


class SpuiTests(unittest.TestCase):
    def test_minimal_layout(self):
        b = struct.pack('<IhHHHH', 0xE3FE3FB8, 3, 0, 0, 0, 1)
        b += struct.pack('<I', 0x4EC1B8D8)                         # one Window
        b += struct.pack('<HhH', 0x5FF5, 0, 1 | 0x8000)            # element 0, 1 property, root
        b += struct.pack('<IhH4f', 0xEEC1B005, 16, 1, 1, 2, 30, 40)  # Area
        b += struct.pack('<Hh', 0x5FF5, -1) + struct.pack('<I', 0x1C01C047)
        d = parse_spui(b)
        self.assertTrue(d['end_ok'])
        el = d['elements'][0]
        self.assertTrue(el['root'])
        self.assertEqual(el['props']['0xeec1b005']['value'], [[1.0, 2.0, 30.0, 40.0]])


if __name__ == '__main__':
    unittest.main()
