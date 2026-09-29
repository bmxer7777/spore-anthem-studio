"""List every object class used by the city-music patch tree (natives vs. abstractions)."""
import collections
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from pdscan import parse_canvases
from spore.dbpf import fnv

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def patch_files():
    files = {}
    for fn in glob.glob(os.path.join(ROOT, 'original_assets/raw/audio/pd/*.pd')):
        b = os.path.basename(fn)
        parts = b.split('_')
        inst = parts[2] if parts[0] == 'Spore' else parts[1]
        files.setdefault(inst[:8], []).append(fn)
    return files


def best(fns):
    patched = [f for f in fns if os.path.basename(f).startswith('PatchData')]
    return patched[0] if patched else sorted(fns)[-1]


def main():
    man = json.load(open(os.path.join(ROOT, 'original_assets/manifest_audio.json')))
    files = patch_files()
    c = collections.Counter()
    for h in man['patches_in_city_music_tree']:
        for cv in parse_canvases(open(best(files[h]), 'rb').read().decode('latin1')):
            for k, t in cv['objs']:
                if k == 'obj':
                    c[(t.split() or ['?'])[0].replace(chr(92), '')] += 1
    isab = lambda x: '%08x' % fnv(x) in files
    print('NATIVE/VANILLA:', sorted((k, n) for k, n in c.items() if not isab(k)))
    print('ABSTRACTIONS:', sorted(k for k in c if isab(k)))


if __name__ == '__main__':
    main()
