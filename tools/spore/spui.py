"""Parser for Spore .spui UI layouts -> plain JSON.

Binary layout learned from SporeModder FX (GPLv3, Eric Mor / Spore Community,
https://github.com/Spore-Community/SporeModder-FX, src/sporemodder/file/spui/).
Class and property names come from its SporeUIDesignerProjectCommon/Custom.xml.
This is an independent reimplementation for reading only.
"""
import os
import re
import struct
import xml.etree.ElementTree as ET

MAGIC = 0xE3FE3FB8
MAGIC_END = 0x1C01C047
ROOT_FLAG = 0x8000

REF_DIR = os.path.join(os.path.dirname(__file__), '..', 'reference', 'smfx')


def _proxy(s):
    if not s:
        return None
    m = re.search(r'0x([0-9a-fA-F]+)', s)
    return int(m.group(1), 16) if m else None


def _own_props(node):
    for ch in node:
        if ch.tag == 'Property':
            yield ch
        elif ch.tag not in ('Class', 'Struct'):
            yield from _own_props(ch)


class Designer:
    def __init__(self):
        self.classes = {}      # name -> dict(proxy, base, props{id:(name,type,enum)})
        self.by_proxy = {}
        self.enums = {}
        for fn in ('SporeUIDesignerProjectCommon.xml', 'SporeUIDesignerProjectCustom.xml'):
            path = os.path.join(REF_DIR, fn)
            if not os.path.exists(path):
                continue
            root = ET.parse(path).getroot()
            for en in root.iter('Enum'):
                self.enums[en.get('name')] = {int(v.get('value'), 0): v.get('name') for v in en.iter('EnumVal') if v.get('value')}
            for tag in ('Class', 'Struct'):
                for c in root.iter(tag):
                    name = c.get('name')
                    info = self.classes.setdefault(name, {'proxy': None, 'base': None, 'props': {}, 'struct': tag == 'Struct'})
                    p = _proxy(c.get('proxy'))
                    if p is not None:
                        info['proxy'] = p
                        self.by_proxy[p] = name
                    if c.get('base'):
                        info['base'] = c.get('base')
                    for prop in _own_props(c):
                        pid = _proxy(prop.get('proxy'))
                        if pid is not None:
                            info['props'][pid] = (prop.get('name'), prop.get('type'), prop.get('enum'))

    def prop(self, cls, pid):
        seen = set()
        while cls and cls not in seen:
            seen.add(cls)
            c = self.classes.get(cls)
            if not c:
                break
            if pid in c['props']:
                return c['props'][pid]
            cls = c['base']
        return None


class R:
    def __init__(self, b):
        self.b, self.p = b, 0

    def u(self, fmt):
        v = struct.unpack_from('<' + fmt, self.b, self.p)
        self.p += struct.calcsize('<' + fmt)
        return v if len(v) > 1 else v[0]


def read_values(r, t, n):
    if t == 2:
        v = [bool(x) for x in r.b[r.p:r.p + n]]; r.p += n; return v
    if t == 3:
        v = list(struct.unpack_from('<%db' % n, r.b, r.p)); r.p += n; return v
    if t == 7:
        v = list(r.b[r.p:r.p + n]); r.p += n; return v
    fmts = {4: 'h', 5: 'i', 6: 'q', 8: 'H', 9: 'I', 10: 'Q', 11: 'f', 12: 'd'}
    if t in fmts:
        v = list(struct.unpack_from('<%d%s' % (n, fmts[t]), r.b, r.p)); r.p += n * struct.calcsize(fmts[t]); return v
    if t == 15:
        return [list(r.u('ii')) for _ in range(n)]
    if t == 16:
        return [list(r.u('ffff')) for _ in range(n)]
    if t == 17:
        return [list(r.u('ff')) for _ in range(n)]
    if t == 18:
        out = []
        for _ in range(n):
            ln = r.u('h')
            if ln == -1:
                table, inst = r.u('II')
                out.append({'table': '%08x' % table, 'id': '%08x' % inst})
            else:
                out.append({'text': r.b[r.p:r.p + 2 * ln].decode('utf-16-le')}); r.p += 2 * ln
        return out
    if t == 19:
        v = list(struct.unpack_from('<%dh' % n, r.b, r.p)); r.p += 2 * n; return v
    raise ValueError('unknown SPUI property type %d at 0x%x' % (t, r.p))


def read_props(r, count, designer, cls):
    props = {}
    for _ in range(count):
        pid = r.u('I')
        t = r.u('h')
        n = r.u('H')
        info = designer.prop(cls, pid) if designer else None
        key = info[0] if info else '0x%08x' % pid
        if t == 20:
            r.u('I')  # unknown
            struct_cls = info[1].split('[')[0] if info else None
            items = []
            for _ in range(n):
                c = r.u('h')
                items.append(read_props(r, c, designer, struct_cls))
            props[key] = items
        else:
            v = read_values(r, t, n)
            if info and info[2] and designer.enums.get(info[2]) and t in (5, 7, 9):
                v = [designer.enums[info[2]].get(x, x) for x in v]
            props[key] = {'type': t, 'value': v}
    return props


def parse(data, designer=None):
    r = R(data)
    if r.u('I') != MAGIC:
        raise ValueError('not a SPUI file')
    version = r.u('h')
    counts = r.u('HHHH')
    key = lambda: dict(zip(('instance', 'type', 'group'), ('%08x' % x for x in r.u('III'))))
    images = [key() for _ in range(counts[0])]
    atlases = [key() for _ in range(counts[1])]
    hitmasks = []
    for _ in range(counts[2]):
        if version >= 3 and r.u('B'):
            w, h, ln = r.u('iii')
            rle = list(r.u('%dH' % ln)) if ln else []
            hitmasks.append({'width': w, 'height': h, 'rle': rle})
        else:
            hitmasks.append({'file': key()})
    proxies = list(struct.unpack_from('<%dI' % counts[3], r.b, r.p))
    r.p += 4 * counts[3]
    elements = [{'index': i, 'class_proxy': '%08x' % p,
                 'class': designer.by_proxy.get(p, '?') if designer else '?', 'root': False, 'props': {}}
                for i, p in enumerate(proxies)]
    other = counts[0] + counts[1] + counts[2]
    magic = r.u('H')
    while True:
        idx = r.u('h')
        if idx == -1:
            break
        if magic != 0x5FF5:
            raise ValueError('bad class magic at 0x%x' % r.p)
        idx -= other
        cnt = r.u('H')
        el = elements[idx]
        el['root'] = bool(cnt & ROOT_FLAG)
        el['props'] = read_props(r, cnt & ~ROOT_FLAG, designer, el['class'])
        magic = r.u('H')
    end = r.u('I')
    return {'version': version, 'images': images, 'atlases': atlases, 'hitmasks': hitmasks,
            'reference_base': other, 'elements': elements, 'end_ok': end == MAGIC_END}
