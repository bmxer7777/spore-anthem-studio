import { createRuntime, AnthemEngine } from '../engine/engine.js';
import { WebAudioBackend } from '../engine/webaudio.js';
import { fnv, hex8 } from '../engine/runtime.js';
import { parsePatch } from '../engine/pdparse.js';
import { SheetStore, SpuiLayout } from './spui.js';
import { MelodyEditor } from './melody.js';
import { generateMelody, randomizeAll } from './generator.js';

const ROOT = '../';   // project root (serves original_assets/, upscale/)
const STORE_KEY = 'spore-anthem-studio/songs';
const PREF_KEY = 'spore-anthem-studio/prefs';

// Music tab element indices / control IDs (from the decoded layout 6c4e59fb)
const IDX = {
  root: 348,
  beatPanel: 75, instPanel: 135, ambiPanel: 310,
  beatVol: 73, melodyVol: 191, ambiVol: 308,
  melodyBox: 184, melodyArea: 143, generate: 151, autoplay: 163, autoplayIcon: 167,
  addNote: 175, removeNote: 183,
  randomize: 314, undo: 322, redo: 330, load: 338, save: 346,
};

const fetchJSON = p => fetch(p).then(r => { if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); });
const safeGet = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };

class App {
  async init() {
    const [patches, samples, instruments, tuning, ui] = await Promise.all(
      ['patches', 'samples', 'instruments', 'tuning', 'ui'].map(n => fetchJSON(`data/${n}.json`)));
    this.tuning = tuning; this.ui = ui;
    this.prefs = { lang: 'en-us', zoom: 0, ...(safeGet(PREF_KEY) || {}) };
    await this.loadLocale(this.prefs.lang);
    this.loadFonts(ui.fonts);

    this.backend = new WebAudioBackend({ resolveUrl: s => ROOT + s.url });
    const { rt } = createRuntime({ patches, samples, instruments, backend: this.backend,
      log: (lvl, m) => { if (lvl === 'error') console.warn('[pd]', m); } });
    this.rt = rt;
    this.engine = new AnthemEngine(rt);
    this.catalog = this.readCatalog(patches);

    this.sheets = new SheetStore(ui, ROOT);
    await this.sheets.load();
    // Page background: the doodle tile from Spore's stage loading screens.
    if (ui.images && ui.images.loading_pattern)
      document.getElementById('backdrop').style.setProperty('--pattern', `url(${new URL(ROOT + ui.images.loading_pattern, location.href).href})`);
    this.noteSprites = await this.loadNoteSprites();
    this.buildUI();

    this.state = this.defaultState();
    this.history = [JSON.stringify(this.state)];
    this.future = [];
    document.getElementById('start').addEventListener('click', () => this.start(), { once: true });
    document.getElementById('loading').hidden = true;
    document.getElementById('start').hidden = false;
  }

  // The game's note widget (layout f1839789): a 12x18 note button with 8 state images.
  async loadNoteSprites() {
    const data = await fetchJSON(ROOT + this.ui.layouts.music_tab_button);
    const L = new SpuiLayout(data, { sheets: this.sheets, text: () => '' });
    const btn = data.elements.find(e => e.class === 'Button');
    const dr = L.drawable(btn.props.ButtonDrawable.value[0]);
    const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = src; });
    const imgs = await Promise.all(dr.imgs.map(c => (c ? load(c.url) : null)));
    return { normal: imgs[0], hover: imgs[2], checked: imgs[4], checkedHover: imgs[6], w: 12, h: 18 };
  }

  // Beat / instrument / ambience tables straight from the game's patch (coll data).
  readCatalog(patches) {
    const p = parsePatch(patches['5293d931']);
    const out = { beats: [], instruments: [], ambience: [] };
    const walk = c => {
      for (const it of c.items) {
        if (it.canvas) walk(it.canvas);
        if (it.cls === 'coll' && it.coll) {
          const first = String(it.coll[0][1]);
          const rows = it.coll.map(r => r.slice(1).map(String));
          if (first === 'astonish') out.beats = rows.filter(r => r[0] !== 'stereotester').map(r => ({ name: r[0], bpm: +r[1] }));
          if (first === 'reversing') out.ambience = rows.map(r => ({ name: r[0] }));
          if (first === 'cpbassguitar') out.instruments = rows.map(r => ({ name: r[0] }));
        }
      }
    };
    walk(p);
    return out;
  }

  async loadLocale(lang) {
    this.strings = await fetchJSON(`${ROOT}original_assets/decoded/ui/locale/${lang}.json`).catch(() => ({}));
  }
  text(table, id) { return this.strings[`${table}:${id}`] || ''; }

  loadFonts(fonts) {
    const f = fonts['Palatino Sans EA Bold'];
    if (f) {
      const ff = new FontFace('SporeUI', `url(${ROOT}${f})`);
      ff.load().then(x => document.fonts.add(x)).catch(() => {});
    }
  }

  defaultState() {
    return { beat: 1, instrument: 3, ambience: [3], volumes: { beat: 100, melody: 100, ambience: 100 },
             notes: generateMelody(this.tuning), autoplay: true, name: '', description: '' };
  }

  // ---------------------------------------------------------------- UI
  buildUI() {
    const stage = document.getElementById('tab');
    stage.innerHTML = '';
    const make = (data) => new SpuiLayout(data, { sheets: this.sheets, text: (t, i) => this.text(t, i),
      onTooltip: (s, node, show) => this.tooltip(s, node, show) });
    const doRender = data => {
      const L = make(data);
      L.render(IDX.root, stage, 300, 600);
      return L;
    };
    this._layoutPromise = (this._layoutPromise || fetchJSON(ROOT + this.ui.layouts.music_tab))
      .then(data => { this.L = doRender(data); this.wire(); return data; });
    this._dialogPromise = (this._dialogPromise || fetchJSON(ROOT + this.ui.layouts.city_planner_frame))
      .then(data => { this.dialogData = data; return data; });
    this.applyZoom();
    return this._layoutPromise;
  }

  tooltip(s, node, show) {
    const tip = document.getElementById('tooltip');
    if (!show) { tip.hidden = true; return; }
    tip.textContent = s;
    tip.hidden = false;
    const r = node.getBoundingClientRect();
    tip.style.left = Math.round(r.left + r.width / 2) + 'px';
    tip.style.top = Math.round(r.bottom + 8) + 'px';
  }

  applyZoom() {
    const stage = document.getElementById('stage');
    const z = this.prefs.zoom || Math.max(1, Math.min(2.5, (window.innerHeight - 40) / 640));
    stage.style.setProperty('--zoom', z);
  }

  wire() {
    const L = this.L;
    const W = i => L.byIndex(i);
    // choice buttons: ControlID 1..n directly inside their panel
    const buttonsIn = panelIdx => {
      const panel = W(panelIdx).node;
      return L.widgets.filter(w => w.e.class === 'Button' && w.node.parentElement === panel && w.cid >= 1 && w.cid <= 20)
        .sort((a, b) => a.cid - b.cid);
    };
    this.beatButtons = buttonsIn(IDX.beatPanel);
    this.instButtons = buttonsIn(IDX.instPanel);
    this.ambiButtons = buttonsIn(IDX.ambiPanel);
    // Icons: the game fills each orb's inner icon button (ControlID 05bfe9d0) from the
    // icon lists in "playercitymusic".
    const icons = this.ui.icons || {};
    const setIcons = (buttons, list) => buttons.forEach((b, k) => {
      const inner = [...b.node.children].find(n => n.dataset.cid === '5bfe9d0');
      if (!inner || !list || !list[k]) return;
      inner.classList.add('orb-icon');
      inner.style.backgroundImage = `url(${ROOT}${list[k]})`;
      b.icon = inner;
    });
    setIcons(this.beatButtons, icons.beats);
    setIcons(this.instButtons, icons.instruments);
    setIcons(this.ambiButtons, icons.ambience);

    this.beatButtons.forEach(b => {
      b.name = this.catalog.beats[b.cid - 1]?.name;
      b.node.title = '';
      b.onClick = () => this.edit(s => ({ ...s, beat: s.beat === b.cid ? 0 : b.cid }));
    });
    this.instButtons.forEach(b => { b.onClick = () => this.edit(s => ({ ...s, instrument: b.cid })); });
    this.ambiButtons.forEach(b => {
      b.onClick = () => this.edit(s => {
        const has = s.ambience.includes(b.cid);
        if (has) return { ...s, ambience: s.ambience.filter(x => x !== b.cid) };
        if (s.ambience.length >= 4) return s;               // "Pick up to 4 ambience layers"
        return { ...s, ambience: [...s.ambience, b.cid] };
      });
    });

    const vol = (i, key) => { const w = W(i); w.onChange = v => this.edit(s => ({ ...s, volumes: { ...s.volumes, [key]: v } }), 'volume'); };
    vol(IDX.beatVol, 'beat'); vol(IDX.melodyVol, 'melody'); vol(IDX.ambiVol, 'ambience');

    // melody box
    const area = W(IDX.melodyArea);
    area.node.classList.add('melody-host');
    this.melody = new MelodyEditor(area.node, this.tuning, this.noteSprites, {
      onChange: (notes, phase) => this.edit(s => ({ ...s, notes: notes.map(n => ({ ...n })) }), phase === 'drag' ? 'drag' : undefined),
      onPreview: i => { this.pushMelody(); this.engine.playNote(i); },
      onPlay: () => this.play(),
      onSelect: i => { this.selectedNote = i; },
    });
    area.onClick = () => this.play();
    W(IDX.generate).onClick = () => this.edit(s => ({ ...s, notes: generateMelody(this.tuning) }));
    W(IDX.autoplay).onClick = (ev, w) => this.edit(s => ({ ...s, autoplay: w.checked }));
    W(IDX.addNote).onClick = () => this.edit(s => {
      if (s.notes.length >= this.tuning.maxNotes) return s;
      const last = s.notes[s.notes.length - 1] || { pitch: this.tuning.basePitch, duration: 1 };
      return { ...s, notes: [...s.notes, { pitch: last.pitch, duration: 1 }] };
    });
    W(IDX.removeNote).onClick = () => this.edit(s => {
      if (s.notes.length <= 1) return s;
      const k = this.selectedNote >= 0 && this.selectedNote < s.notes.length ? this.selectedNote : s.notes.length - 1;
      this.selectedNote = -1;
      return { ...s, notes: s.notes.filter((_, i) => i !== k) };
    });
    W(IDX.randomize).onClick = () => this.edit(s => randomizeAll(this.tuning, s));
    W(IDX.undo).onClick = () => this.undo();
    W(IDX.redo).onClick = () => this.redo();
    W(IDX.save).onClick = () => this.openSave();
    W(IDX.load).onClick = () => this.openLoad();
    this.autoIcon = W(IDX.autoplayIcon);
    this.renderState();
  }

  // ---------------------------------------------------------------- state
  edit(fn, kind) {
    const prev = this.state;
    const next = fn(prev);
    if (next === prev) { this.renderState(); return; }   // e.g. a 5th ambience: undo the button's own toggle
    this.state = next;
    if (kind !== 'drag') {
      const snap = JSON.stringify(next);
      if (kind === 'volume' && this.lastKind === 'volume') this.history[this.history.length - 1] = snap;
      else this.history.push(snap);
      if (this.history.length > 200) this.history.shift();
      this.future = [];
    }
    this.lastKind = kind;
    this.renderState();
    this.sync(prev, next);
  }
  undo() {
    if (this.history.length < 2) return;
    this.future.push(this.history.pop());
    const prev = this.state; this.state = JSON.parse(this.history[this.history.length - 1]);
    this.renderState(); this.sync(prev, this.state);
  }
  redo() {
    if (!this.future.length) return;
    const snap = this.future.pop(); this.history.push(snap);
    const prev = this.state; this.state = JSON.parse(snap);
    this.renderState(); this.sync(prev, this.state);
  }

  renderState() {
    const s = this.state;
    if (!this.L) return;
    for (const b of this.beatButtons) { b.checked = b.cid === s.beat; b.update(); }
    for (const b of this.instButtons) { b.checked = b.cid === s.instrument; b.update(); }
    for (const b of this.ambiButtons) { b.checked = s.ambience.includes(b.cid); b.update(); }
    const W = i => this.L.byIndex(i);
    W(IDX.beatVol).set(s.volumes.beat); W(IDX.melodyVol).set(s.volumes.melody); W(IDX.ambiVol).set(s.volumes.ambience);
    const ap = W(IDX.autoplay); ap.checked = !!s.autoplay; ap.update();
    this.melody.set(s.notes);
    document.getElementById('undo-count').textContent = '';
  }

  // Push the difference between two states into the engine, the way the game does.
  sync(prev, next) {
    if (!this.started) return;
    const e = this.engine;
    if (!prev || prev.volumes.beat !== next.volumes.beat || prev.volumes.melody !== next.volumes.melody || prev.volumes.ambience !== next.volumes.ambience)
      e.setVolumes({ rhythm: next.volumes.beat / 100, melody: next.volumes.melody / 100, ambience: next.volumes.ambience / 100 });
    if (!prev || prev.beat !== next.beat) { this.preloadBeat(next.beat); e.setBeat(next.beat); }
    if (!prev || prev.instrument !== next.instrument) { this.preloadInstrument(next.instrument); e.setInstrument(next.instrument); }
    // ambience slots 1..4
    this.slots = this.slots || [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const id = this.slots[k];
      if (id && !next.ambience.includes(id)) { e.stopAmbience(k + 1); this.slots[k] = 0; }
    }
    for (const id of next.ambience) {
      if (this.slots.includes(id)) continue;
      const k = this.slots.indexOf(0);
      if (k < 0) break;
      this.slots[k] = id;
      this.preloadAmbience(id);
      e.startAmbience(k + 1, id);
    }
    if (!prev || JSON.stringify(prev.notes) !== JSON.stringify(next.notes)) this.pushMelody();
    if (!prev || prev.autoplay !== next.autoplay) { e.setLoop(next.autoplay ? 1 : 0); if (next.autoplay) e.playMelody(0); }
  }
  pushMelody() { this.engine.setMelody(this.state.notes); }
  play() { this.pushMelody(); this.engine.playMelody(0); }

  // ---------------------------------------------------------------- loading hints
  sampleIdsForGroup(name) {
    const g = this.rt.groups.get(name) || [];
    return g.map(n => hex8(fnv(n))).filter(h => this.backend.bank.samples[h]);
  }
  preloadBeat(id) { const b = this.catalog.beats[id - 1]; if (b) this.backend.preload(this.sampleIdsForGroup(b.name)); }
  preloadAmbience(id) { const a = this.catalog.ambience[id - 1]; if (a) this.backend.preload(this.sampleIdsForGroup(a.name)); }
  preloadInstrument(id) {
    const i = this.catalog.instruments[id - 1]; if (!i) return;
    const inst = this.backend.bank.instruments[hex8(fnv(i.name))];
    if (inst) this.backend.preload(inst.zones.map(z => z.sample));
  }

  // ---------------------------------------------------------------- start / engine feedback
  async start() {
    document.getElementById('splash').classList.add('gone');
    this.engine.open();
    await this.backend.boot();
    this.started = true;
    this.engine.on((name, v) => {
      if (name === 'city_music_melody_active_note') this.melody.setActive(v - 1);
      if (name === 'city_music_rhythm_tempo') this.tempo = v;
    });
    this.sync(null, this.state);
    this.tick();
  }
  tick() {
    // autoplay icon: fraction of the current melody pass (16-frame pie from the game's art)
    if (this.autoIcon && this.autoIcon.setFrame) {
      const a = this.melody.active;
      const total = this.state.notes.length || 1;
      this.autoIcon.setFrame(a >= 0 ? Math.round(((a + 1) / total) * (this.autoIcon.frames - 1)) : 0);
    }
    requestAnimationFrame(() => this.tick());
  }

  // ---------------------------------------------------------------- save / load (game dialogs)
  songs() { return safeGet(STORE_KEY) || []; }
  openDialog(rootIdx, fill) {
    const host = document.getElementById('dialog');
    host.innerHTML = '';
    host.hidden = false;
    const L = new SpuiLayout(this.dialogData, { sheets: this.sheets, text: (t, i) => this.text(t, i), onTooltip: (s, n, sh) => this.tooltip(s, n, sh) });
    const frame = document.createElement('div');
    frame.className = 'dialog-frame';
    host.appendChild(frame);
    const w = L.render(rootIdx, frame, 900, 600);
    w.node.style.left = '0px'; w.node.style.top = '0px';
    frame.style.width = w.w + 'px'; frame.style.height = w.h + 'px';
    fill(L);
    return L;
  }
  closeDialog() { const host = document.getElementById('dialog'); host.hidden = true; host.innerHTML = ''; }
  openSave() {
    this.openDialog(114, L => {
      const name = L.byIndex(37), desc = L.byIndex(44);
      name.input.value = this.state.name || '';
      desc.input.value = this.state.description || '';
      L.byIndex(33).onClick = () => this.closeDialog();
      L.byIndex(20).onClick = () => {
        const nm = name.input.value.trim() || 'Untitled anthem';
        const s = { ...this.state, name: nm, description: desc.input.value };
        const all = this.songs().filter(x => x.name !== nm);
        all.unshift({ ...s, savedAt: Date.now() });
        safeSet(STORE_KEY, all);
        this.state = s;
        this.closeDialog();
      };
      setTimeout(() => name.input.focus(), 0);
    });
  }
  openLoad() {
    this.openDialog(207, L => {
      const grid = L.byIndex(123).node;
      grid.classList.add('song-list');
      const list = this.songs();
      let pick = null;
      if (!list.length) grid.innerHTML = '<div class="empty">No saved music yet.</div>';
      list.forEach(s => {
        const row = document.createElement('button');
        row.className = 'song';
        row.textContent = s.name;
        row.title = s.description || '';
        row.onclick = () => { grid.querySelectorAll('.song').forEach(x => x.classList.remove('sel')); row.classList.add('sel'); pick = s; };
        row.ondblclick = () => { pick = s; L.byIndex(165).onClick(); };
        grid.appendChild(row);
      });
      const combo = L.byIndex(122).node;
      combo.innerHTML = '';
      const io = document.createElement('div');
      io.className = 'file-io';
      io.innerHTML = '<button class="mini" data-a="import">Import file…</button><button class="mini" data-a="export">Export current…</button>';
      combo.appendChild(io);
      io.querySelector('[data-a=import]').onclick = () => this.importFile();
      io.querySelector('[data-a=export]').onclick = () => this.exportFile();
      L.byIndex(152).onClick = () => this.closeDialog();
      L.byIndex(165).onClick = () => {
        if (!pick) return;
        const { savedAt, ...s } = pick;
        this.edit(() => ({ ...this.defaultState(), ...s }));
        this.closeDialog();
      };
    });
  }
  exportFile() {
    const blob = new Blob([JSON.stringify({ format: 'spore-anthem-studio/1', ...this.state }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.state.name || 'anthem').replace(/[^\w\- ]+/g, '') + '.anthem.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  importFile() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        const { format, ...rest } = s;
        this.edit(() => ({ ...this.defaultState(), ...rest }));
        this.closeDialog();
      } catch (e) { alert('That file is not a saved anthem.'); }
    };
    inp.click();
  }
}

const app = new App();
window.app = app;
app.init().catch(e => {
  console.error(e);
  document.getElementById('loading').textContent = 'Could not load: ' + e.message;
});
window.addEventListener('resize', () => app.applyZoom && app.applyZoom());
