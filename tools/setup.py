"""One-step setup for a fresh clone: find Spore, get vgmstream, extract and build.

usage: python tools/setup.py
"""
import os
import subprocess
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from spore.locate import find_spore

VGM_RELEASE = 'r2117'
VGM_URL = f'https://github.com/vgmstream/vgmstream/releases/download/{VGM_RELEASE}/vgmstream-win64.zip'
VGM_DIR = os.path.join(HERE, 'vgmstream')


def ensure_vgmstream():
    exe = os.path.join(VGM_DIR, 'vgmstream-cli.exe')
    if os.path.exists(exe):
        return
    if sys.platform != 'win32':
        raise SystemExit('Put a vgmstream-cli build in tools/vgmstream/ (see https://github.com/vgmstream/vgmstream).')
    print(f'Downloading vgmstream {VGM_RELEASE} (official GitHub release)...')
    zpath = os.path.join(HERE, 'vgmstream-win64.zip')
    urllib.request.urlretrieve(VGM_URL, zpath)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(VGM_DIR)
    os.remove(zpath)


def run(script):
    print(f'\n== {script}')
    subprocess.run([sys.executable, os.path.join(HERE, script)], check=True)


def main():
    spore = find_spore()
    if not spore:
        raise SystemExit('Spore install not found; setup cancelled.')
    print('Spore:', spore)
    ensure_vgmstream()
    for s in ('build_audio_archive.py', 'build_ui_archive.py', 'build_app_data.py'):
        run(s)
    print('\nDone. Start the app with start.bat (or: python tools/serve.py).')


if __name__ == '__main__':
    main()
