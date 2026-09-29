"""Package archived assets for the app (app/data/*.json).

The app reads audio/images straight out of original_assets/ (served from the project
root), so nothing is duplicated. Upscaled or edited replacements placed in
upscale/ are picked up automatically (see manifest 'override' fields).
"""
import glob
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from spore.dbpf import fnv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'app', 'data')
RAW = os.path.join(ROOT, 'original_assets', 'raw')
DEC = os.path.join(ROOT, 'original_assets', 'decoded')


def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, '/')


def override(relpath):
    """Edited/upscaled replacement, if one has been dropped into upscale/."""
    return relpath if os.path.exists(os.path.join(ROOT, relpath)) else None


def snr_info(path):
    d = open(path, 'rb').read(16)
    codec, chcfg = d[0], d[1]
    rate = int.from_bytes(d[2:4], 'big')
    w = int.from_bytes(d[4:8], 'big')
    frames = w & 0x1FFFFFFF
    loop = bool(w & 0x20000000)
    kind = w >> 30
    loop_start = int.from_bytes(d[8:12], 'big') if loop else None
    return {'codec': codec, 'channels': (chcfg >> 2) + 1, 'rate': rate, 'frames': frames,
            'loopStart': loop_start, 'prefetchOnly': kind == 2}


def main():
    os.makedirs(OUT, exist_ok=True)

    # Patches: PatchData (the 1.05 patch) overrides the base game.
    patches = {}
    for pk in ('Spore_Audio1', 'Spore_Audio2', 'PatchData'):
        for fn in glob.glob(os.path.join(RAW, 'audio', 'pd', pk + '_*.pd')):
            inst = os.path.basename(fn)[len(pk) + 1:][:8]
            patches[inst] = open(fn, 'rb').read().decode('latin1')
    json.dump(patches, open(os.path.join(OUT, 'patches.json'), 'w'))

    # Samples: hash -> file + format info.
    samples = {}
    for fn in glob.glob(os.path.join(RAW, 'audio', 'samples', '*.snr')):
        b = os.path.basename(fn)[:-4]
        inst = b[:8]
        wav = os.path.join(DEC, 'audio', 'samples', b + '.wav')
        info = snr_info(fn)
        ov = override('upscale/audio/' + b + '.wav')
        info.update({'name': b[9:], 'url': ov or rel(wav)})
        samples[inst] = info
    json.dump(samples, open(os.path.join(OUT, 'samples.json'), 'w'), indent=0)

    # Instruments: sampler zones. sus = attenuation in dB (0 = full level).
    instruments = {}
    for fn in glob.glob(os.path.join(DEC, 'audio', 'instruments', '*.txt')):
        name = os.path.basename(fn)[:-4]
        zones = []
        for line in open(fn, encoding='latin1').read().splitlines():
            p = line.split()
            if len(p) < 9 or line.startswith('#') or not p[8].startswith('0x'):
                continue
            k, v = int(p[6], 16), int(p[7], 16)
            zones.append({'attack': float(p[0]), 'hold': float(p[1]), 'decay': float(p[2]),
                          'sustainDb': float(p[3]), 'release': float(p[4]), 'root': float(p[5]),
                          'lokey': k & 0xFF, 'hikey': k >> 8, 'lovel': v & 0xFF, 'hivel': v >> 8,
                          'sample': p[8][2:].lower().zfill(8)})
        instruments['%08x' % fnv(name)] = {'name': name, 'zones': zones}
    json.dump(instruments, open(os.path.join(OUT, 'instruments.json'), 'w'), indent=0)

    # Anthem editor tuning (Spore_Audio1 prop 'playercitymusic'). Names are our reading of
    # each value; raw ids are kept alongside.
    from spore.dbpf import Library, T_PROP
    from spore.prop import parse
    lib = Library(['Spore_Audio1', 'PatchData'])
    e = lib.find(fnv('playercitymusic'), T_PROP)
    raw = {('%08x' % k): v for k, t, v in parse(lib.read(e))}
    # Row order of the melody tables as listed in SporeApp.exe's data (degree 0..6).
    trans_ids = ['b37fbb0f', 'b37fbb0c', 'b37fbb0d', 'b37fbb0a', 'b37fbb0b', 'b37fbb08', 'b37fbb09']
    flag_ids = ['07c80906', '07c80905', '07c80904', '07c80903', '07c80902', '07c80901', '07c80900']
    argb = lambda v: '#%06x' % (v & 0xFFFFFF)
    tuning = {
        'source': 'Spore_Audio1.package, property list "playercitymusic" (instance %08x)' % fnv('playercitymusic'),
        'scale': raw['24adc124'],
        'transitions': [raw[k] for k in trans_ids],
        'degreeFlags': [raw[k] for k in flag_ids],
        'noteCountWeights': raw['2aa962c3'],
        'maxNotes': raw['81279214'],
        'minDuration': raw['5f8dca10'],
        'maxDuration': raw['6679061f'],
        'basePitch': raw['6fa7fdac'],
        'minPitch': raw['ddd19567'],
        'maxPitch': raw['d861c661'],
        'defaultTempo': raw['7f7bb0f6'],
        'colors': {'a': argb(raw['a62de8c7']), 'b': argb(raw['bbe3fda9']), 'c': argb(raw['e801bd27'])},
        'raw': raw,
    }
    json.dump(tuning, open(os.path.join(OUT, 'tuning.json'), 'w'), indent=1)

    # UI assets: layouts, sheets (with upscale override paths), fonts, strings.
    ui_man = json.load(open(os.path.join(ROOT, 'original_assets', 'manifest_ui.json')))
    ui = {
        'layouts': {k: 'original_assets/' + v['decoded'] for k, v in ui_man['layouts'].items()},
        'sheets': {k: {'url': 'original_assets/' + v['raw'], 'size': v['size'],
                       'override': override('upscale/ui/sheets/' + os.path.basename(v['raw']))}
                   for k, v in ui_man['sheets'].items()},
        'fonts': {f['name']: 'original_assets/' + f['raw'] for f in ui_man['fonts']},
        'locales': sorted(ui_man['locale']),
        'icons': {kind: [override('upscale/ui/icons/' + os.path.basename(i['raw'])) or 'original_assets/' + i['raw'] for i in lst]
                  for kind, lst in ui_man.get('icons', {}).items()},
        'images': {k: override('upscale/ui/sheets/' + os.path.basename(v['raw'])) or 'original_assets/' + v['raw']
                   for k, v in ui_man.get('extra_images', {}).items()},
    }
    json.dump(ui, open(os.path.join(OUT, 'ui.json'), 'w'), indent=1)

    missing = [z['sample'] for i in instruments.values() for z in i['zones'] if z['sample'] not in samples]
    print('patches', len(patches), 'samples', len(samples), 'instruments', len(instruments),
          'instrument zones missing samples', len(missing))


if __name__ == '__main__':
    main()
