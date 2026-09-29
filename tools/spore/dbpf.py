"""Reader for Spore's DBPF 3.0 package archives (.package).

Resources are addressed by (type, group, instance). Names are FNV-1a (32-bit,
lowercased) hashes, so a resource called "guitar" has instance fnv("guitar").
"""
import os
import struct

_spore_dir = None


def spore_dir():
    """The Spore install folder, found once per run (see locate.py)."""
    global _spore_dir
    if _spore_dir is None:
        from .locate import find_spore
        _spore_dir = find_spore()
        if not _spore_dir:
            raise SystemExit('Spore install not found. Set SPORE_DIR or pick the folder when asked.')
    return _spore_dir


def data_dir():
    return os.path.join(spore_dir(), 'Data')


def fnv(name):
    h = 0x811C9DC5
    for c in name.lower().encode('latin1'):
        h = ((h * 0x1000193) & 0xFFFFFFFF) ^ c
    return h


class Entry:
    __slots__ = ('package', 'type', 'group', 'instance', 'offset', 'size', 'mem_size', 'compressed')

    def __init__(self, package, t, g, i, o, s, m, c):
        self.package, self.type, self.group, self.instance = package, t, g, i
        self.offset, self.size, self.mem_size, self.compressed = o, s, m, c

    def key(self):
        return '%08x!%08x.%08x' % (self.group, self.instance, self.type)


class Package:
    def __init__(self, path):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        self.f = open(path, 'rb')
        hdr = self.f.read(96)
        if hdr[:4] != b'DBPF':
            raise ValueError('not a DBPF file: %s' % path)
        count = struct.unpack_from('<I', hdr, 0x24)[0]
        size = struct.unpack_from('<I', hdr, 0x2C)[0]
        offset = struct.unpack_from('<I', hdr, 0x40)[0]
        self.f.seek(offset)
        d = self.f.read(size)
        flags = struct.unpack_from('<I', d, 0)[0]
        p = 4
        common = [None, None, None]
        for bit in range(3):
            if flags & (1 << bit):
                common[bit] = struct.unpack_from('<I', d, p)[0]
                p += 4
        self.entries = []
        for _ in range(count):
            t = common[0]
            if t is None:
                t = struct.unpack_from('<I', d, p)[0]; p += 4
            g = common[1]
            if g is None:
                g = struct.unpack_from('<I', d, p)[0]; p += 4
            if common[2] is None:
                p += 4
            i, o, s, m, c, _ = struct.unpack_from('<IIIIHH', d, p)
            p += 20
            self.entries.append(Entry(self.name, t, g, i, o, s & 0x7FFFFFFF, m, c == 0xFFFF))

    def close(self):
        self.f.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def read(self, e):
        self.f.seek(e.offset)
        d = self.f.read(e.size)
        return refpack_decompress(d) if e.compressed else d


def refpack_decompress(src):
    """EA RefPack / QFS decompression."""
    p = 2
    if src[0] & 0x80:
        p += 4
    else:
        p += 3
    if src[0] & 0x01:  # compressed size present
        p += 4 if src[0] & 0x80 else 3
    out = bytearray()
    n = len(src)
    while p < n:
        b0 = src[p]
        if b0 < 0x80:
            b1 = src[p + 1]; p += 2
            pl = b0 & 3
            out += src[p:p + pl]; p += pl
            cl = ((b0 & 0x1C) >> 2) + 3
            co = ((b0 & 0x60) << 3) + b1 + 1
        elif b0 < 0xC0:
            b1, b2 = src[p + 1], src[p + 2]; p += 3
            pl = b1 >> 6
            out += src[p:p + pl]; p += pl
            cl = (b0 & 0x3F) + 4
            co = ((b1 & 0x3F) << 8) + b2 + 1
        elif b0 < 0xE0:
            b1, b2, b3 = src[p + 1], src[p + 2], src[p + 3]; p += 4
            pl = b0 & 3
            out += src[p:p + pl]; p += pl
            cl = ((b0 & 0x0C) << 6) + b3 + 5
            co = ((b0 & 0x10) << 12) + (b1 << 8) + b2 + 1
        elif b0 < 0xFC:
            pl = ((b0 & 0x1F) << 2) + 4; p += 1
            out += src[p:p + pl]; p += pl
            continue
        else:
            pl = b0 & 3; p += 1
            out += src[p:p + pl]
            break
        s = len(out) - co
        if co >= cl:
            out += out[s:s + cl]
        else:
            for k in range(cl):
                out.append(out[s + k])
    return bytes(out)


# Load order matters: later packages override earlier ones (PatchData is the 1.05 patch).
PACKAGE_ORDER = ['Spore_Audio1', 'Spore_Audio2', 'Spore_Game', 'Spore_Content',
                 'Spore_Graphics', 'Spore_Pack_03', 'PatchData']


class Library:
    """All game packages, with patch-override resolution."""

    def __init__(self, packages=PACKAGE_ORDER, extra_paths=()):
        self.packages = {}
        self.by_instance = {}
        paths = [os.path.join(data_dir(), p + '.package') for p in packages] + list(extra_paths)
        for path in paths:
            pk = Package(path)
            self.packages[pk.name] = pk
            for e in pk.entries:
                self.by_instance.setdefault(e.instance, []).append(e)

    def find(self, instance, type_=None, group=None):
        """Latest (patched) entry for an instance, optionally filtered by type/group."""
        hits = [e for e in self.by_instance.get(instance, [])
                if (type_ is None or e.type == type_) and (group is None or e.group == group)]
        return hits[-1] if hits else None

    def all(self, instance, type_=None):
        return [e for e in self.by_instance.get(instance, []) if type_ is None or e.type == type_]

    def read(self, e):
        return self.packages[e.package].read(e)


# Resource types seen in the audio system
T_SNR = 0x01A527DB        # EA SNR/SNS audio (codec 4 = EA-XAS, 5 = EALayer3)
T_PD = 0x617715D9         # Pure Data patch, plain text
T_EAPD = 0x022D2C83       # compiled Pure Data patch (EA binary)
T_INSTRUMENT = 0x03055F61  # sampler instrument definition (text table)
T_SOUNDPROP = 0x02B9F662  # sound event property list
T_PROP = 0x00B1B104       # generic property list
T_PNG = 0x2F7D0004
T_SPUI = 0x250FE9A2       # UI layout
T_LOCALE = 0x02FAC0B6     # (group) locale text tables
