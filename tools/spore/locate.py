"""Find the Spore install folder.

Order (first valid wins):
  1. SPORE_DIR environment variable (explicit override)
  2. the folder remembered from a previous run (tools/local_settings.json)
  3. the registry key every edition writes (Steam, EA App/Origin, retail disc):
       HKLM\\SOFTWARE\\WOW6432Node\\Electronic Arts\\SPORE  installloc / datadir
  4. ask: a "browse for folder" dialog (or a typed path when no GUI is available)

A folder counts as Spore when Data\\Spore_Audio1.package exists. The user may pick
either the Spore folder or its Data folder.
"""
import json
import os
import sys

SETTINGS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'local_settings.json')
MARKER = os.path.join('Data', 'Spore_Audio1.package')
REG_KEYS = [r'SOFTWARE\WOW6432Node\Electronic Arts\SPORE', r'SOFTWARE\Electronic Arts\SPORE']


def normalize(path):
    """Return the Spore root for a Spore folder or its Data folder, else None."""
    if not path:
        return None
    path = os.path.abspath(os.path.expanduser(str(path).strip().strip('"')))
    for cand in (path, os.path.dirname(path)):
        if os.path.isfile(os.path.join(cand, MARKER)):
            return cand
    return None


def from_registry(read_value=None):
    """Spore's own registry entry. `read_value(key, name)` can be injected for tests."""
    if read_value is None:
        if sys.platform != 'win32':
            return None
        import winreg

        def read_value(key, name):
            try:
                with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key) as k:
                    return winreg.QueryValueEx(k, name)[0]
            except OSError:
                return None
    for key in REG_KEYS:
        for name in ('installloc', 'datadir'):
            found = normalize(read_value(key, name))
            if found:
                return found
    return None


def remembered(settings=SETTINGS):
    try:
        with open(settings) as f:
            return normalize(json.load(f).get('spore_dir'))
    except (OSError, ValueError):
        return None


def remember(path, settings=SETTINGS):
    data = {}
    try:
        with open(settings) as f:
            data = json.load(f)
    except (OSError, ValueError):
        pass
    data['spore_dir'] = path
    with open(settings, 'w') as f:
        json.dump(data, f, indent=1)


def ask():
    """Browse dialog; typed path if there's no GUI."""
    try:
        import tkinter
        from tkinter import filedialog, messagebox
        root = tkinter.Tk()
        root.withdraw()
        while True:
            p = filedialog.askdirectory(title='Select your Spore folder (the one containing "Data")')
            if not p:
                return None
            found = normalize(p)
            if found:
                return found
            messagebox.showerror('Not a Spore folder', 'Couldn\'t find Data\\Spore_Audio1.package there.\nPick the Spore install folder.')
    except Exception:
        if not sys.stdin or not sys.stdin.isatty():
            return None
        while True:
            p = input('Path to your Spore folder (blank to cancel): ')
            if not p:
                return None
            found = normalize(p)
            if found:
                return found
            print('  no Data\\Spore_Audio1.package there, try again')


def find_spore(interactive=True, env=None, read_value=None, settings=SETTINGS):
    env = os.environ if env is None else env
    for source, get in (('SPORE_DIR', lambda: normalize(env.get('SPORE_DIR'))),
                        ('remembered', lambda: remembered(settings)),
                        ('registry', lambda: from_registry(read_value))):
        found = get()
        if found:
            if source == 'registry':
                remember(found, settings)
            return found
    if interactive:
        found = ask()
        if found:
            remember(found, settings)
            return found
    return None


if __name__ == '__main__':
    print(find_spore() or 'Spore not found')
