# Spore Anthem Studio

Write your nation's anthem outside the game.

This is a standalone version of the **anthem editor** from *Spore* (2008): the Music tab in the City Planner, where you pick a beat, draw a melody and layer ambient sounds. It isn't a remake. It runs **Spore's own music program, sounds and interface**, read straight from your installed copy of the game.

It's also a tribute to the people who made that small, lovely corner of Spore. Open **"The anthem makers"** inside the app to meet them.

---

## What you need

| | |
|---|---|
| **Spore** | Installed on this PC, any edition: Steam, EA App / Origin, or the original disc. Galactic Adventures isn't needed. **This project contains no game files. It won't work without Spore.** |
| **Windows** | Windows 10 or 11. |
| **Python 3.8+** | Free from [python.org](https://www.python.org/downloads/). During install, tick **"Add python.exe to PATH"**. |
| **Pillow** | A Python image library. Install it once (step 2 below). |
| **A browser** | Chrome, Edge or Firefox. |
| **Disk space** | About **2.5 GB** for the sounds and art extracted from your game. |
| **Internet** | Only the first time (to download the audio decoder), and for the videos and photos on the tribute page. |

## Getting started

1. **Download this project.** Click the green **Code** button on this page, then **Download ZIP**, and unzip it anywhere. Or, if you use git:
   ```
   git clone https://github.com/bmxer7777/spore-anthem-studio.git
   ```
2. **Install Pillow** (once). Open a terminal in the project folder and run:
   ```
   python -m pip install -r requirements.txt
   ```
3. **Double-click `start.bat`.**

The first time, it finds your Spore install and extracts the music, sounds and artwork (a few minutes). After that it starts in seconds. Your browser opens at `http://127.0.0.1:8765/app/`. Click **Start the music**; browsers only allow sound after a click.

Keep the black `start.bat` window open while you use the studio, and close it when you're done.

## Using the studio

| Part | What it does |
|---|---|
| **Beat** (green) | Pick one of 10 drum loops. Click it again to turn the beat off. |
| **Anthem** (blue) | Pick one of 10 instruments for your melody. |
| **Melody box** | **Drag** a note up or down to change its pitch. **Scroll** over a note to make it shorter or longer (a sixteenth up to a whole note). **Click** an empty spot to play the anthem. |
| **＋ / －** notes | Add a note (up to 16) or remove the selected note. |
| **Dice** in the melody box | Generate a new melody. |
| **Loop** button | Keep playing your anthem over and over. |
| **Ambience** (purple) | Layer up to 4 background sounds. |
| **Volume wedges** | Drag to set the volume of the beat, melody and ambience. |
| **Bottom row** | Undo, redo, **Save**, **Load** and **Randomize everything**. |

Your saved anthems stay in this browser. To back one up or share it, open **Load** and use **Export current…** / **Import file…** (`.anthem.json` files).

## Troubleshooting

**"Python 3 is needed but wasn't found"**
Install Python from [python.org](https://www.python.org/downloads/) with **"Add python.exe to PATH"** ticked, then run `start.bat` again.

**"Missing the Pillow image library"**
Run `python -m pip install -r requirements.txt` in the project folder.

**It asks me to pick my Spore folder**
Spore normally registers where it's installed, and the studio finds it from that. If it can't, choose the folder that contains Spore's `Data` folder, for example `...\steamapps\common\Spore`. Choosing the `Data` folder itself also works. It remembers your choice.

**I moved or reinstalled Spore**
Delete `tools\local_settings.json`, then run `start.bat`.

**I want to extract everything again**
Delete the `app\data` folder, then run `start.bat`.

**No sound**
Click **Start the music** first, and check the browser tab isn't muted. The first time you choose a beat or ambience, give it a moment to load.

**Port 8765 is already in use**
Something else is using that port. Run `python tools\serve.py 8766` and open `http://127.0.0.1:8766/app/` instead.

## Credits

Spore's anthem editor was made by **Brian Eno**, **Kent Jolly**, **Aaron McLeran**, **Cyril Saint Girons**, **Justin Graham** and Spore's audio team at **Maxis**, on **Miller Puckette**'s Pure Data, in a game by **Will Wright**. The tribute page in the app (`app/tribute.html`) has their stories, talks, interviews and the official anthem tutorial video.

This project is built on the work of:
- **[SporeModder FX](https://github.com/Spore-Community/SporeModder-FX)** (Eric Mor and the Spore modding community), which documented Spore's UI layout format;
- **[vgmstream](https://github.com/vgmstream/vgmstream)**, which decodes EA's audio formats.

## License

The code in this repository is under the **MIT License** (see [`LICENSE`](LICENSE)).

Spore's music, sounds, artwork, fonts and text belong to **Electronic Arts**. They are **not** in this repository and are never uploaded anywhere. The tools copy them from your own game into your own project folder, for your personal use. Please don't share the extracted `original_assets` folder. `tools/reference/smfx/` is GPLv3 (from SporeModder FX), and vgmstream has its own license.

This is a fan project. It is not affiliated with or endorsed by Electronic Arts or Maxis.

---

<details>
<summary><b>For developers: how it works, tests, and editing the art</b></summary>

### How it works

- **The app** is plain JavaScript, HTML and CSS: no framework and no build step. Sound runs on the Web Audio API.
- **The music logic** is Spore's own Pure Data patch (`5293d931`, the city-music patch) and the 38 helper patches it uses. They run unmodified in a control-rate Pd interpreter (`app/engine/`), with EA's custom Pd objects (`dplay`, `group`, `gate`, `coll`, `function`, `gfparam`...) reimplemented from how Spore's patches use them. The app talks to the patch through the same game parameters the City Planner uses.
- **The interface** is drawn from the game's `.spui` layout files, texture sheets, icons and string tables (`app/ui/spui.js`).
- **The editor's rules** come from Spore's tuning file `playercitymusic`: two octaves of C major (MIDI 60–84), up to 16 notes, sixteenth-to-whole lengths, the note colours, and the scale-degree transition table the melody generator walks.
- **The extraction tools** are Python (`tools/`). They read Spore's `.package` archives, layouts, property lists and RW4 textures, and use vgmstream for audio.

### What's exact and what's inferred

**Exact:** the music logic (it's the game's own patch), the samples (decoded bit-exact), the instrument definitions, the beat, ambience and instrument tables, the interface art and layout, and the editor's tuning data.

**Inferred:** the behaviour of EA's native Pd objects (reconstructed from their use), the melody generator's rhythm choices, the note editor's drawing (it's done in game code; matched to screenshots), and the colour-per-length mapping. The game's executable is DRM-wrapped, and this project deliberately doesn't touch it.

**Missing from the game itself:** `reversing5`–`7` (listed by the patch but never shipped) and five unused "old instruments".

### Project layout

```
app/                      the studio (index.html) and the tribute page (tribute.html)
  engine/                 Pd parser and runtime, vanilla + EA objects, Web Audio backend
  ui/                     .spui renderer, melody editor, generator, app controller
tools/                    extraction: locate.py (finds Spore), setup.py, build_*.py, serve.py
  spore/                  readers for .package, .spui, property lists, RW4, EA-XAS audio
tests/                    unit tests (synthetic data only)
original_assets/          (created on first run, not in git) raw + decoded game assets, manifests
upscale/                  (optional, not in git) your edited or upscaled replacements
```

### How Spore is found

`tools/spore/locate.py` checks, in order: the `SPORE_DIR` environment variable, the folder remembered in `tools/local_settings.json`, then Spore's registry key (`HKLM\SOFTWARE\WOW6432Node\Electronic Arts\SPORE`, value `installloc`). If none of those works, it opens a folder picker. A folder only counts if it contains `Data\Spore_Audio1.package`.

### Running the steps yourself

```
python tools/setup.py                 # everything below, plus finding Spore and getting vgmstream
python tools/build_audio_archive.py   # Pd patches, instruments, sounds -> original_assets/
python tools/build_ui_archive.py      # layouts, textures, icons, fonts, 15 languages
python tools/build_app_data.py        # app/data/*.json for the studio
python tools/serve.py 8765            # local server (no caching)
```

### Tests

```
python -m unittest discover -s tests -v   # archive/layout/property parsers, install finder
node --test tests/engine.test.mjs         # Pd engine semantics on small hand-written patches
node tools/test_engine.mjs 30             # runs the real patch headless (needs extracted data)
```

GitHub Actions runs the first two on Windows and Linux. It also fails the build if extracted game content is ever committed.

### Upscaling or editing the art and sounds

Every sprite is cut from the original texture sheets by UV coordinates, so a sheet at any resolution drops in:

1. Upscale a sheet from `original_assets/raw/ui/png/` (or an icon from `original_assets/raw/ui/icons/`).
2. Save it with the **same file name** in `upscale/ui/sheets/` (icons: `upscale/ui/icons/`).
3. Run `python tools/build_app_data.py`.

Sounds work the same way. Put a WAV named like one in `original_assets/decoded/audio/samples/` into `upscale/audio/`, then rebuild.

</details>
