# Spore Anthem Studio

A standalone rebuild of the **anthem editor** from *Spore* (2008): the City Planner's Music tab in the Civilization stage, where you pick a beat, write a melody for your nation's anthem, and layer ambience.

It isn't a remake. It runs **Spore's own Pure Data music patches**, plays **Spore's own sounds**, and draws **Spore's own interface** from its layout files and textures. Everything is read from your installed copy of the game.

## Credits

This is a tribute. The anthem editor is a small corner of a very big game, and it was made with a lot of care.

- **Brian Eno** designed Spore's generative music and supplied the sound sources the anthem editor plays.
- **Kent Jolly**, Spore's Audio Director, built Spore's procedural music system with Eno and Aaron McLeran.
- **Aaron McLeran** worked on procedural music and co-designed the Civilization-stage user theme generation.
- **Cyril Saint Girons**, audio engineer, co-designed the anthem editor and presented the official anthem tutorial.
- **Justin Graham**, lead audio engineer, and the rest of Spore's audio team: sound designers, engineers, producers and contributors.
- **Miller Puckette** created Pure Data, the open-source music language all of Spore's audio runs on (in EA's modified form).
- **Will Wright**, **Maxis** and **Electronic Arts** made Spore.

Tools and references this project relies on:
- **SporeModder FX** (Eric Mor / emd4600 and the Spore modding community, GPLv3): its source documents the `.spui` UI layout format and designer class names. Reference copies are in `tools/reference/smfx/`.
- **vgmstream** (vgmstream contributors): decodes EA's audio formats. Included in `tools/vgmstream/` with its license (`COPYING`).

All music, sounds, artwork, fonts and text belong to **Electronic Arts / Maxis**. This project is for **personal use only**. Don't publish `original_assets/` or `upscale/`; `.gitignore` already keeps them out of git.

## What it's written in

- **The app:** JavaScript (ES modules), HTML and CSS, running in the browser. There's no framework and no build step. Sound uses the Web Audio API.
- **The extraction tools:** Python 3, plus vgmstream for EA's audio codecs. `tools/spore/` reads Spore's `.package` archives, `.spui` layouts, property lists and RW4 textures.
- **The music logic:** Spore's own Pure Data patches, run by the interpreter in `app/engine/`.

## Running it

Requirements: Windows, Python 3, a browser, and Spore installed (any edition: Steam, EA App/Origin or disc). This repository contains **no game files**. Everything is extracted from your own copy on first run.

Double-click **`start.bat`**. The first time, it extracts the assets it needs from your Spore install (a few minutes, about 1 GB), then opens http://127.0.0.1:8765/app/. Press **Start the music**; browsers only allow sound after a click.

### Finding your Spore install

`tools/spore/locate.py` checks, in order:
1. the `SPORE_DIR` environment variable, if set;
2. the folder remembered from last time (`tools/local_settings.json`);
3. the registry key every Spore edition writes: `HKLM\SOFTWARE\WOW6432Node\Electronic Arts\SPORE` (`installloc`);
4. if none of those works, a **Browse for folder** dialog.

A folder only counts if it contains `Data\Spore_Audio1.package`. You can pick either the Spore folder or its `Data` folder.

### Setup step by step

`start.bat` runs `python tools/setup.py`, which finds Spore, downloads vgmstream (official release r2117) if it's missing, and runs:

```
python tools/build_audio_archive.py   # Pd patches, instruments, sounds -> original_assets/
python tools/build_ui_archive.py      # Music tab layouts, textures, icons, fonts, 15 languages
python tools/build_app_data.py        # app/data/*.json (patches, sample map, tuning, UI map)
```

## Tests

```
python -m unittest discover -s tests -v   # archive, layout and property parsers, install finder
node --test tests/engine.test.mjs         # Pd engine semantics on small hand-written patches
node tools/test_engine.mjs 30             # (needs your extracted data) runs the real patch headless
```

The tests use synthetic data only, so they also run on GitHub Actions, where no game is installed. CI also fails the build if extracted game content is ever committed.

## What's in here

```
app/                      the program (plain HTML/JS, no build step)
  tribute.html            "The Anthem Makers": people, talks, interviews, videos
  engine/pdparse.js       Pure Data patch parser
  engine/runtime.js       control-rate Pd runtime (scheduler, messaging, abstractions)
  engine/vanilla.js       Pd's standard objects
  engine/ea.js            EA's own Pd objects (dplay, group, gfparam, coll, gate, function...)
  engine/webaudio.js      sample-accurate playback, instrument envelopes, mix buses
  engine/engine.js        drives the patch through the game's parameters, like the City Planner does
  ui/spui.js              renders Spore .spui layouts (anchoring, 8-state buttons, 9-slice, tooltips)
  ui/melody.js            the note editor inside the Anthem box
  ui/generator.js         "Generate new anthem" / "Randomize your music"
original_assets/          full archive, kept regardless of what the app uses
  raw/                    untouched game resources (Pd patches, EA audio, layouts, PNG sheets, fonts, text)
  decoded/                editable versions (WAV, layout JSON, individual sprites, strings JSON)
  manifest_audio.json     every resource's original name, key, package and file paths
  manifest_ui.json
upscale/                  put edited or upscaled replacements here
tools/                    extraction and build scripts, vgmstream, reference sources
```

## Upscaling or editing art and sound

The UI draws every sprite from the original texture sheets by UV coordinates, so a sheet at any resolution works as long as the layout stays the same.

1. Upscale a sheet from `original_assets/raw/ui/png/` (for example 4×). The individual sprites in `original_assets/decoded/ui/sprites/` show what each part of a sheet is.
2. Save it under the **same file name** in `upscale/ui/sheets/`.
3. Run `python tools/build_app_data.py`.

Audio works the same way: put a WAV with the same name as one in `original_assets/decoded/audio/samples/` into `upscale/audio/`, then rebuild.

## How faithful is it?

**Taken directly from the game, running as the game runs it:**
- All music logic is Spore's `5293d931` city-music patch (with the 1.05 `PatchData` version taking precedence) and the 38 abstractions it uses, executed object by object. That covers the drum slice shuffling, 32-step clock, downbeat-synced melody, ambience shuffle players, the 10-second fade-in and the melody start rules.
- The sounds are the game's own samples, decoded bit-exact (checked against vgmstream).
- Instruments use the game's sampler definitions: key and velocity zones, root notes, attack, hold, decay, sustain and release.
- The beat, ambience and instrument tables, their gains and fade times, and each instrument's octave offset come from the patch itself.
- The interface layout, art, tooltips and dialog text come from the game's `.spui` layouts, texture sheets and string tables. The page background is the doodle tile from Spore's stage loading screens (`d4d9fbe5`).
- The melody rules come from the game's tuning file `playercitymusic`: C-major rows from MIDI 60 to 84, at most 16 notes, sixteenth to whole-note lengths, the three note colours, note-count weights, and the scale-degree transition table.

**Inferred, because EA's native code isn't available:**
- EA's custom Pd objects (`dplay`, `group`, `gate`, `coll`, `function`...) were reimplemented from how Spore's patches use them. For example, `gate` taking data on its left inlet was confirmed by `onebang`/`enobang`, which only work that way. Sustain is read as dB of attenuation, confirmed by the looping `enoLOOPEDpad`.
- The generator uses the tuning file's tables with an assumed rhythm distribution. The game's generator code sits inside the DRM-wrapped executable, which this project deliberately doesn't touch.
- The note editor is drawn by game code. It uses the game's own note widget (layout `f1839789`) and its tuning colours, with spacing and length boxes matched to in-game screenshots. Which length gets which colour is a guess (see `app/ui/melody.js`).
- Velocity scales gain linearly. The release curve is exponential (about −43 dB at the release time).

**Not recoverable from your game data:** `reversing5`–`reversing7` (listed by the patch but never shipped), five unused "old instruments", and the streamed tail of `Piano_1`–`6` (only 2-second heads ship; they aren't used by the anthem).
