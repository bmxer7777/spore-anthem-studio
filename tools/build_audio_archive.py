"""Phase 1 (audio): copy every anthem-related audio resource out of the Spore
install, byte-exact, then decode it into editable formats.

original_assets/raw/audio/...      untouched game bytes (decompressed from RefPack)
original_assets/decoded/audio/...  WAV / SFZ / text
original_assets/manifest_audio.json
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from spore.xas import decode_snr, write_wav
from spore.dbpf import (Library, fnv, T_SNR, T_PD, T_EAPD, T_INSTRUMENT,
                        T_SOUNDPROP, T_PROP)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RAW = os.path.join(ROOT, 'original_assets', 'raw', 'audio')
DEC = os.path.join(ROOT, 'original_assets', 'decoded', 'audio')
VGM = os.path.join(ROOT, 'tools', 'vgmstream', 'vgmstream-cli.exe')

AUDIO_PACKAGES = ('Spore_Audio1', 'Spore_Audio2', 'PatchData')
# Every Pd patch that talks to the civ city-music game parameters. The first one is
# the one the game runs (PatchData overrides Spore_Audio2); others are dev/test harnesses.
CITY_ROOTS = [0x5293D931, 0xA92A6E63, 0xEE7BB303, 0xFB86348A, 0xFB86348B,
              0xB05A4F0B, 0x518565DD, 0xF0C4ED8D]

# Types copied wholesale because they are small and define the whole audio system.
SYSTEM_TYPES = {T_PD: 'pd', T_EAPD: 'eapd', T_INSTRUMENT: 'instrument.txt',
                T_SOUNDPROP: 'soundprop', T_PROP: 'prop', 0x0497925E: 'prop_0497925e',
                0x02C9EFF2: 'bus', 0x029E333B: 'bus.txt', 0x2B7DF427: 'markers.txt',
                0x2081B4F5: 'txt', 0x0330A65E: 'xml', 0x03F51892: 'prop_03f51892',
                0x042C9CBB: 'bin_042c9cbb', 0x05BAD11C: 'bin_05bad11c', 0x01EEF63A: 'bin_01eef63a'}


def pd_text(lib, inst):
    e = lib.find(inst, T_PD)
    return lib.read(e).decode('latin1') if e else None


def main():
    lib = Library()
    names = {}  # hash -> readable name, learned from patches

    # 1. Collect every token that appears in any Pd patch so we can name hashed resources.
    pd_entries = [e for pk in AUDIO_PACKAGES for e in lib.packages[pk].entries if e.type == T_PD]
    tokens = set()
    for e in pd_entries:
        tokens.update(re.findall(r'[A-Za-z0-9_\-+\'.]+', lib.read(e).decode('latin1')))
    for t in tokens:
        names.setdefault(fnv(t), t)

    # 2. Closure of city-music patches -> abstractions used -> referenced sounds.
    seen, stack = set(), list(CITY_ROOTS)
    while stack:
        h = stack.pop()
        if h in seen:
            continue
        seen.add(h)
        txt = pd_text(lib, h)
        if not txt:
            continue
        for m in re.finditer(r'#X obj -?\d+ -?\d+ ([^\s;,]+)', txt):
            cls = m.group(1).replace('\\', '')
            if lib.find(fnv(cls), T_PD):
                stack.append(fnv(cls))
    city_tokens = set()
    for h in seen:
        city_tokens.update(re.findall(r'[A-Za-z0-9_\-+\'.]+', pd_text(lib, h) or ''))

    wanted_samples = {}  # instance -> reason
    instruments = {}
    for t in city_tokens:
        h = fnv(t)
        if lib.find(h, T_SNR):
            wanted_samples[h] = t
        ie = lib.find(h, T_INSTRUMENT)
        if ie:
            instruments[t] = ie
    for iname, ie in instruments.items():
        for line in lib.read(ie).decode('latin1').splitlines():
            parts = line.split()
            if len(parts) >= 9 and parts[8].startswith('0x'):
                sid = int(parts[8], 16)
                wanted_samples.setdefault(sid, '%s/%s' % (iname, parts[8]))

    manifest = {'source': 'Spore (2008), Maxis / Electronic Arts', 'spore_dir': lib.packages['PatchData'].path,
                'patches_in_city_music_tree': sorted('%08x' % h for h in seen),
                'resources': []}

    def rec(e, raw_rel, dec_rel=None, name=None, role=None):
        manifest['resources'].append({
            'name': name or names.get(e.instance), 'key': e.key(), 'package': e.package,
            'type': '%08x' % e.type, 'raw': raw_rel, 'decoded': dec_rel, 'role': role})

    # 3. System resources: every version (base + patch) kept.
    for pk in AUDIO_PACKAGES:
        for e in lib.packages[pk].entries:
            ext = SYSTEM_TYPES.get(e.type)
            if not ext or (e.type == T_PROP and pk == 'PatchData'):
                continue  # PatchData's generic props are game data, not audio
            nm = names.get(e.instance)
            base = '%s_%08x%s' % (pk, e.instance, ('_' + nm) if nm else '')
            base = re.sub(r'[^A-Za-z0-9_\-+.]', '_', base)
            rel = os.path.join(ext.split('.')[0].split('_')[0], base + '.' + ext.split('.')[-1])
            d = lib.read(e)
            os.makedirs(os.path.join(RAW, os.path.dirname(rel)), exist_ok=True)
            with open(os.path.join(RAW, rel), 'wb') as f:
                f.write(d)
            role = 'city_music_patch' if (e.type == T_PD and e.instance in seen) else None
            rec(e, 'raw/audio/' + rel.replace(os.sep, '/'), name=nm, role=role)

    # 4. Samples: raw .snr + decoded .wav via vgmstream.
    snr_dir = os.path.join(RAW, 'samples')
    wav_dir = os.path.join(DEC, 'samples')
    os.makedirs(snr_dir, exist_ok=True)
    os.makedirs(wav_dir, exist_ok=True)
    todo = []
    for h, why in sorted(wanted_samples.items()):
        e = lib.find(h, T_SNR)
        nm = names.get(h) or why.replace('/', '__')
        base = re.sub(r'[^A-Za-z0-9_\-+.]', '_', '%08x_%s' % (h, nm))
        snr = os.path.join(snr_dir, base + '.snr')
        with open(snr, 'wb') as f:
            f.write(lib.read(e))
        wav = os.path.join(wav_dir, base + '.wav')
        todo.append((snr, wav))
        rec(e, 'raw/audio/samples/%s.snr' % base, 'decoded/audio/samples/%s.wav' % base, name=nm, role='sample')
    failed = []
    for snr, wav in todo:
        r = subprocess.run([VGM, '-o', wav, snr], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(wav):
            # vgmstream can't open 'gigasample' stubs (prefetch only); decode what exists.
            try:
                with open(snr, 'rb') as f:
                    a, rate, _ = decode_snr(f.read())
                write_wav(wav, a, rate)
                failed.append((os.path.basename(snr), 'prefetch-only stub: decoded %d frames; streamed remainder not shipped' % len(a)))
            except Exception as ex:
                failed.append((os.path.basename(snr), str(ex)))

    # 5. Instruments -> readable copies (SFZ generated later by the app build step).
    idir = os.path.join(DEC, 'instruments')
    os.makedirs(idir, exist_ok=True)
    for iname, ie in instruments.items():
        with open(os.path.join(idir, iname + '.txt'), 'wb') as f:
            f.write(lib.read(ie))

    manifest['missing_in_game_data'] = sorted(t for t in city_tokens if re.fullmatch(r'reversing\d+', t) and not lib.find(fnv(t), T_SNR))
    manifest['decode_failures'] = failed
    with open(os.path.join(ROOT, 'original_assets', 'manifest_audio.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('patches in city tree:', len(seen))
    print('samples:', len(todo), 'decode failures:', len(failed))
    print('instruments:', len(instruments))
    print('resources in manifest:', len(manifest['resources']))
    for x in failed[:10]:
        print('  FAIL', x)


if __name__ == '__main__':
    main()
