"""Phase 1 (UI): the City Planner "Music" tab.

original_assets/raw/ui/        spui layouts, texture sheets (PNG), fonts, locale tables — game bytes
original_assets/decoded/ui/    layouts as JSON, every sprite cut out of its sheet (for upscaling),
                               localized strings as JSON
original_assets/manifest_ui.json
"""
import glob
import io
import json
import os
import re
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from spore.dbpf import Library, Package, spore_dir, T_PNG, T_SPUI
from spore.spui import parse, Designer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, 'original_assets', 'raw', 'ui')
DEC = os.path.join(ROOT, 'original_assets', 'decoded', 'ui')

LAYOUTS = {
    0x6C4E59FB: 'music_tab',            # City Planner > Music: beat / anthem / ambience panels
    0x3D96118D: 'city_planner_frame',   # animated frame around planner tabs
    0xF1839789: 'music_tab_button',     # small single-button layout that uses the music text table
    0x43DD7F6B: 'menu_shared',          # large shared layout that also references music tooltips
}
# Extra art used by the app that no Music-tab layout references directly.
EXTRA_IMAGES = {
    0xD4D9FBE5: 'loading_pattern',   # doodle tile from the stage loading screens (group 011c0bde)
}
MUSIC_TEXT_TABLE = 0xC047E881
GUIDE_TEXT_TABLE = 0xEB177F74          # in-game guide page describing the anthem feature
T_FONT = 0x027C5CEF


def font_name(data):
    try:
        n = struct.unpack_from('>H', data, 4)[0]
        for i in range(n):
            tag, _, off, ln = struct.unpack_from('>4sIII', data, 12 + 16 * i)
            if tag == b'name':
                _, cnt, so = struct.unpack_from('>HHH', data, off)
                best = None
                for j in range(cnt):
                    pid, eid, lid, nid, l, o = struct.unpack_from('>HHHHHH', data, off + 6 + 12 * j)
                    if nid == 4:
                        raw = data[off + so + o: off + so + o + l]
                        best = raw.decode('utf-16-be' if pid in (0, 3) else 'latin1', 'ignore')
                        if pid == 3:
                            return best
                return best
    except Exception:
        pass
    return None


def main():
    from PIL import Image
    lib = Library(['Spore_Graphics', 'PatchData'])
    designer = Designer()
    manifest = {'layouts': {}, 'sheets': {}, 'sprites': [], 'fonts': [], 'locale': {}}
    for d in ('spui', 'png', 'fonts', 'locale'):
        os.makedirs(os.path.join(RAW, d), exist_ok=True)
    for d in ('layouts', 'sprites', 'locale'):
        os.makedirs(os.path.join(DEC, d), exist_ok=True)

    sheets = {}
    for inst, name in LAYOUTS.items():
        e = lib.find(inst, T_SPUI)
        data = lib.read(e)
        with open(os.path.join(RAW, 'spui', '%08x_%s.spui' % (inst, name)), 'wb') as f:
            f.write(data)
        layout = parse(data, designer)
        with open(os.path.join(DEC, 'layouts', '%s.json' % name), 'w') as f:
            json.dump(layout, f)
        manifest['layouts'][name] = {'key': e.key(), 'package': e.package,
                                     'raw': 'raw/ui/spui/%08x_%s.spui' % (inst, name),
                                     'decoded': 'decoded/ui/layouts/%s.json' % name,
                                     'elements': len(layout['elements'])}
        # Sheets + every sprite (Image Atlas element = sheet index + UV rect).
        for a in layout['atlases'] + layout['images']:
            key = int(a['instance'], 16)
            if key not in sheets:
                pe = lib.find(key, T_PNG)
                png = lib.read(pe)
                fn = '%s_%s.png' % (a['group'], a['instance'])
                with open(os.path.join(RAW, 'png', fn), 'wb') as f:
                    f.write(png)
                sheets[key] = Image.open(io.BytesIO(png)).convert('RGBA')
                manifest['sheets'][a['instance']] = {'raw': 'raw/ui/png/' + fn, 'key': pe.key(),
                                                     'size': list(sheets[key].size)}
        base_list = layout['atlases']
        for el in layout['elements']:
            if el['class'] != 'Image Atlas' or 'Atlas' not in el['props']:
                continue
            ai = el['props']['Atlas']['value'][0]
            if ai < 0 or ai >= len(base_list):
                continue
            inst_hex = base_list[ai]['instance']
            img = sheets[int(inst_hex, 16)]
            u1, v1, u2, v2 = el['props']['UV Coordinates']['value'][0]
            w, h = img.size
            box = (max(0, round(u1 * w)), max(0, round(v1 * h)), min(w, round(u2 * w)), min(h, round(v2 * h)))
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            fn = '%s_%s_%d_%d_%d_%d.png' % (name, inst_hex, *box)
            path = os.path.join(DEC, 'sprites', fn)
            if not os.path.exists(path):
                img.crop(box).save(path)
            if not any(sp['file'].endswith(fn) for sp in manifest['sprites']):
                manifest['sprites'].append({'file': 'decoded/ui/sprites/' + fn, 'sheet': inst_hex,
                                            'box_px': list(box), 'uv': [u1, v1, u2, v2]})

    # Beat / instrument / ambience button icons, listed in the tuning file "playercitymusic"
    from spore.dbpf import fnv
    from spore.prop import parse as parse_prop
    alib = Library(['Spore_Audio1', 'PatchData'])
    tune = {('%08x' % k): v for k, t, v in parse_prop(alib.read(alib.find(fnv('playercitymusic'), 0x00B1B104)))}
    manifest['icons'] = {}
    os.makedirs(os.path.join(RAW, 'icons'), exist_ok=True)
    for kind, pid in (('beats', 'e0abfd7c'), ('instruments', 'eea41e91'), ('ambience', 'affacd19')):
        manifest['icons'][kind] = []
        for n, key in enumerate(tune[pid], 1):
            inst = int(key.split('!')[1].split('.')[0], 16)
            e = lib.find(inst, T_PNG)
            fn = '%s_%02d_%08x.png' % (kind, n, inst)
            with open(os.path.join(RAW, 'icons', fn), 'wb') as f:
                f.write(lib.read(e))
            manifest['icons'][kind].append({'raw': 'raw/ui/icons/' + fn, 'key': e.key()})

    manifest['extra_images'] = {}
    for inst, nm in EXTRA_IMAGES.items():
        e = lib.find(inst, T_PNG)
        fn = '%08x_%08x.png' % (e.group, inst)
        with open(os.path.join(RAW, 'png', fn), 'wb') as f:
            f.write(lib.read(e))
        manifest['extra_images'][nm] = {'raw': 'raw/ui/png/' + fn, 'key': e.key()}

    for pk in lib.packages.values():
        for e in pk.entries:
            if e.type == T_FONT:
                data = pk.read(e)
                nm = font_name(data) or '%08x' % e.instance
                fn = '%08x_%s.ttf' % (e.instance, ''.join(c if c.isalnum() else '_' for c in nm))
                with open(os.path.join(RAW, 'fonts', fn), 'wb') as f:
                    f.write(data)
                manifest['fonts'].append({'name': nm, 'raw': 'raw/ui/fonts/' + fn, 'key': e.key(), 'package': pk.name})

    # every string table referenced by the layouts (captions, tooltips)
    tables = {MUSIC_TEXT_TABLE, GUIDE_TEXT_TABLE}
    for name in LAYOUTS.values():
        txt = open(os.path.join(DEC, 'layouts', '%s.json' % name)).read()
        tables.update(int(t, 16) for t in re.findall(r'"table": "([0-9a-f]{8})"', txt))
    manifest['text_tables'] = sorted('%08x' % t for t in tables)

    for loc_dir in sorted(glob.glob(os.path.join(spore_dir(), 'Data', 'Locale', '*'))):
        lang = os.path.basename(loc_dir)
        pk = Package(os.path.join(loc_dir, 'Text.package'))
        strings = {}
        for e in pk.entries:
            if e.instance in tables:
                data = pk.read(e)
                with open(os.path.join(RAW, 'locale', '%s_%08x.locale' % (lang, e.instance)), 'wb') as f:
                    f.write(data)
                for line in data.decode('utf-8-sig', 'ignore').splitlines():
                    if line.startswith('0x'):
                        k, _, v = line.partition(' ')
                        strings['%08x:%s' % (e.instance, k[2:].lower().zfill(8))] = v.strip()
        with open(os.path.join(DEC, 'locale', '%s.json' % lang), 'w', encoding='utf-8') as f:
            json.dump(strings, f, ensure_ascii=False, indent=1)
        manifest['locale'][lang] = len(strings)

    with open(os.path.join(ROOT, 'original_assets', 'manifest_ui.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('layouts', len(manifest['layouts']), 'sheets', len(manifest['sheets']),
          'sprites', len(manifest['sprites']), 'fonts', [x['name'] for x in manifest['fonts']],
          'languages', manifest['locale'])


if __name__ == '__main__':
    main()
