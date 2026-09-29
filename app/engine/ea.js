// EA's native Pd objects in Spore ("EAPd"). Their C++ source isn't available;
// behaviour is inferred from how Spore's own patches use them. Every inference is
// noted so it can be revisited.
import { PdObject, outAtoms, msgToList } from './runtime.js';

const isNum = a => typeof a === 'number';
const num = (a, d = 0) => (isNum(a) ? a : d);
const C = {};
const def = (names, cls) => { for (const n of names.split(' ')) C[n] = cls; cls.cls = names.split(' ')[0]; };

// ------------------------------------------------------------ game <-> patch bridge
// gfparam <name>: global game parameter; outputs whenever the game sets it.
class GFParam extends PdObject {
  constructor(c, a) {
    super(c, a); this.name = String(a[0] ?? ''); this.setIO(1, 1);
    if (!this.rt.gparams.has(this.name)) this.rt.gparams.set(this.name, new Set());
    this.rt.gparams.get(this.name).add(this);
  }
  fire(v) { this.outFloat(0, v); }
  m_bang() { if (this.rt.gvalues.has(this.name)) this.fire(this.rt.gvalues.get(this.name)); }
}
def('gfparam', GFParam);

// fparam <name>: parameter of this sound instance (set by the game when it plays the patch).
// All fparams of the running instance share one namespace here (one instance at a time).
class FParam extends GFParam {
  constructor(c, a) { super(c, ['@' + String(a[0] ?? '')]); }
}
def('fparam', FParam);

// sparam: symbol-valued instance parameter (unused by the anthem tree)
class SParam extends GFParam {
  constructor(c, a) { super(c, ['@' + String(a[0] ?? '')]); }
  fire(v) { this.outSymbol(0, String(v)); }
}
def('sparam', SParam);

// sendgame <name>: float -> game (UI highlights, tempo readout...)
class SendGame extends PdObject {
  constructor(c, a) { super(c, a); this.name = String(a[0] ?? ''); this.setIO(1, 0); }
  m_float(f) { this.rt.sendToGame(this.name, f); }
  m_bang() { this.rt.sendToGame(this.name, 0); }
  m_list(...a) { this.rt.sendToGame(this.name, a[0]); }
}
def('sendgame', SendGame);

class ThisInstance extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(1, 1); }
  m_bang() { this.outFloat(0, this.canvas.dollar0); }
}
def('thisinstance', ThisInstance);

// ------------------------------------------------------------ sound groups
// group <name> <sample> <sample> ... : declares a named list of samples (global).
class Group extends PdObject {
  constructor(c, a) {
    super(c, a); this.setIO(1, 0);
    const name = String(a[0] ?? '');
    this.rt.groups.set(name, a.slice(1).map(String));
  }
  inlet0() {}
}
def('group', Group);

// groupsize: symbol (group name) -> number of members
class GroupSize extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(1, 1); }
  m_symbol(s) { const g = this.rt.groups.get(String(s)); this.outFloat(0, g ? g.length : 0); }
  m_anything(sel) { this.m_symbol(sel); }
  m_list(...a) { if (a.length) this.m_symbol(a[0]); }
}
def('groupsize', GroupSize);

// dplay [sound] [voices] [flags]: EA's sample/instrument player voice.
// Messages seen in Spore's patches: use, start, startselect n [..], stop, gain, pitch,
// lowpass, hipass, fadeout, fadein, send <bus>, is3d, pan*, notenumber, notevelocity,
// noteduration, ringmod*, timeinvariantpitch.
// Outlet: bang when a voice finishes ("outlet bang when done" in Spore's own patch).
class DPlay extends PdObject {
  constructor(c, a) {
    super(c, a); this.setIO(1, 1);
    this.sound = null; this.maxVoices = 1; this.flags = new Set();
    for (const x of a) {
      if (isNum(x)) this.maxVoices = Math.max(1, x);
      else if (['setnext', 'steal', 'poly'].includes(x)) this.flags.add(x);
      else if (this.sound === null) this.sound = String(x);
    }
    this.p = { gain: 1, pitch: 1, lowpass: 0, hipass: 0, fadeout: 0, fadein: 0, bus: 'master',
               is3d: 0, note: 60, velocity: 100, duration: 0 };
    this.voices = [];
  }
  get backend() { return this.rt.backend; }
  m_use(s) { this.sound = String(s); }
  m_start(...a) { this.play(this.pick(null), a); }
  m_startselect(n, ...rest) { this.play(this.pick(num(n)), rest); }
  m_stop() { const t = this.rt.now; for (const v of this.voices) this.backend.stop(v, t, this.p.fadeout); this.voices = []; }
  m_gain(g) { this.p.gain = num(g, 1); for (const v of this.voices) this.backend.setGain(v, this.rt.now, this.voiceGain()); }
  m_pitch(p) { this.p.pitch = num(p, 1); for (const v of this.voices) this.backend.setRate(v, this.rt.now, this.p.pitch); }
  m_lowpass(f) { this.p.lowpass = num(f); for (const v of this.voices) this.backend.setFilter(v, this.rt.now, this.p); }
  m_hipass(f) { this.p.hipass = num(f); for (const v of this.voices) this.backend.setFilter(v, this.rt.now, this.p); }
  m_fadeout(s) { this.p.fadeout = num(s); }
  m_fadein(s) { this.p.fadein = num(s); }
  m_send(bus) { this.p.bus = String(bus); }
  m_is3d(f) { this.p.is3d = num(f); }
  m_notenumber(n) { this.p.note = num(n, 60); }
  m_notevelocity(v) { this.p.velocity = num(v, 100); }
  m_noteduration(d) { this.p.duration = num(d); }
  m_pan() {} m_pansize() {} m_panangle() {} m_ringmodfreq() {} m_ringmodwetmix() {} m_timeinvariantpitch() {}
  m_set(s) { if (s !== undefined) this.sound = String(s); }
  m_bang() { this.m_start(); }
  m_float(f) { this.m_startselect(f); }
  voiceGain() { return this.p.gain; }
  pick(index) {
    const name = this.sound;
    if (name === null) return null;
    const g = this.rt.groups.get(name);
    if (g) {
      if (!g.length) return null;
      const k = index === null ? Math.floor(this.rt.backend.random() * g.length) : Math.trunc(index);
      if (k < 0 || k >= g.length) { this.rt.warn(`dplay: ${name}: index ${k} out of range`); return null; }
      return g[k];
    }
    return name;
  }
  play(sample, extra) {
    const t = this.rt.now;
    if (sample === null) return;
    // voice limit: steal the oldest
    while (this.voices.length >= this.maxVoices) {
      const old = this.voices.shift();
      this.backend.stop(old, t, this.p.fadeout);
    }
    const v = this.backend.start({
      time: t, name: sample, params: { ...this.p }, gain: this.voiceGain(), extra,
      onEnd: (endTime) => {
        const i = this.voices.indexOf(v);
        if (i >= 0) this.voices.splice(i, 1);
        this.rt.sched.add(Math.max(this.rt.now, endTime), () => this.outBang(0));
      },
    });
    if (v) this.voices.push(v);
  }
}
def('dplay', DPlay);

// "play" (non-d version) appears in other game patches with the same message set.
class Play extends DPlay {}
def('play', Play);

// mixer <bus>: controls a mix bus (gain / filters). Only dev harnesses use it in the anthem.
class Mixer extends PdObject {
  constructor(c, a) { super(c, a); this.bus = String(a[0] ?? 'master'); this.setIO(1, 0); }
  m_gain(g) { this.rt.backend.busGain(this.bus, this.rt.now, num(g, 1)); }
  m_anything() {}
  m_start() {} m_is3d() {}
}
def('mixer', Mixer);

// ------------------------------------------------------------ Max-style utilities
// gate [n] [init]: EAPd's gate takes DATA on the left inlet and the open/close
// outlet number on the right (the reverse of Max). Verified against onebang/enobang,
// which only work with this ordering.
class Gate extends PdObject {
  constructor(c, a) { super(c, a); this.n = Math.max(1, num(a[0], 1)); this.open = num(a[1]); this.setIO(2, this.n); }
  inlet0(sel, args) { const k = Math.trunc(this.open); if (k >= 1 && k <= this.n) this.out(k - 1, sel, args); }
  in1(sel, args) { if (sel === 'float') this.open = args[0]; }
}
def('gate', Gate);

// coll [name] ...: Max-style keyed storage. Data embedded in the patch as "#C list key ...".
// A symbolic first argument makes a named, shared coll (read by collread).
function makeStore() { return new Map(); }
class Coll extends PdObject {
  constructor(c, a, item) {
    super(c, a); this.setIO(1, 4);
    const named = a.length && !isNum(a[0]);
    this.name = named ? String(a[0]) : null;
    if (this.name && this.rt.colls.has(this.name)) this.store = this.rt.colls.get(this.name);
    else { this.store = makeStore(); if (this.name) this.rt.colls.set(this.name, this.store); }
    if (item && item.coll) for (const row of item.coll) if (row.length) this.store.set(keyOf(row[0]), row.slice(1));
    this.cursor = null;
  }
  emit(key) {
    const v = this.store.get(keyOf(key));
    if (v === undefined) return;
    this.cursor = keyOf(key);
    if (isNum(key)) this.outFloat(1, key); else this.outSymbol(2, key);
    if (!v.length) return this.outBang(0);
    if (isNum(v[0])) return outAtoms(this, 0, v);
    if (v.length === 1) return this.outSymbol(0, v[0]);
    return this.out(0, v[0], v.slice(1));
  }
  m_float(f) { this.emit(Math.trunc(f)); }
  m_symbol(s) { this.emit(s); }
  m_list(...a) { if (a.length) this.emit(isNum(a[0]) ? Math.trunc(a[0]) : a[0]); }
  m_bang() { if (this.cursor !== null) this.emit(this.cursor); }
  m_clear() { this.store.clear(); }
  m_store(k, ...v) { this.store.set(keyOf(k), v); }
  m_insert(k, ...v) { this.store.set(keyOf(k), v); }
  m_remove(k) { this.store.delete(keyOf(k)); }
  m_delete(k) { this.store.delete(keyOf(k)); }
  m_length() { this.outFloat(0, this.store.size); }
  m_nth(k, i) { const v = this.store.get(keyOf(k)); if (v && i >= 1 && i <= v.length) { const x = v[i - 1]; isNum(x) ? this.outFloat(0, x) : this.outSymbol(0, x); } }
  m_goto(k) { this.cursor = keyOf(k); }
  m_next() { this.step(1); }
  m_prev() { this.step(-1); }
  step(d) {
    const keys = [...this.store.keys()];
    if (!keys.length) return;
    let i = keys.indexOf(this.cursor);
    i = i < 0 ? 0 : (i + d + keys.length) % keys.length;
    this.emit(keys[i]);
  }
  m_dump() { for (const k of [...this.store.keys()]) this.emit(k); this.outBang(3); }
  m_anything(sel, args) { if (!args.length && this.store.has(sel)) this.emit(sel); }
}
const keyOf = k => (isNum(k) ? Math.trunc(k) : String(k));
def('coll', Coll);

// collread <name>: reads a named coll. "length k" -> number of items stored at k;
// "nth k i" -> i-th item (1-based) at k. (From scaletomidi's use.)
class CollRead extends PdObject {
  constructor(c, a) { super(c, a); this.name = String(a[0] ?? ''); this.setIO(1, 1); }
  get store() { return this.rt.colls.get(this.name); }
  m_length(k) { const s = this.store; if (!s) return; const v = s.get(keyOf(k)); if (v) this.outFloat(0, v.length); }
  m_nth(k, i) { const s = this.store; if (!s) return; const v = s.get(keyOf(k)); if (v && i >= 1 && i <= v.length) { const x = v[i - 1]; isNum(x) ? this.outFloat(0, x) : this.outSymbol(0, x); } }
  m_float(k) { const s = this.store; if (!s) return; const v = s.get(keyOf(k)); if (v) outAtoms(this, 0, v); }
}
def('collread', CollRead);

// function w h c1 _ c2 _ domain lo hi _ y0 [x y]... : breakpoint function (Max-like).
// Args after the 6 display fields: domain (x from 0..domain), output range lo..hi,
// a reserved 0, the normalized y at x=0, then normalized (x, y) breakpoints.
// float x in -> interpolated y out.
class Func extends PdObject {
  constructor(c, a) {
    super(c, a); this.setIO(1, 2);
    const v = a.map(x => num(x));
    this.domain = v[6] || 1; this.lo = v[7]; this.hi = v[8];
    const pts = [[0, v[10] ?? 0]];
    for (let k = 11; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
    pts.sort((p, q) => p[0] - q[0]);
    this.pts = pts;
  }
  m_float(x) {
    const xn = x / this.domain;
    const p = this.pts;
    let y;
    if (xn <= p[0][0]) y = p[0][1];
    else if (xn >= p[p.length - 1][0]) y = p[p.length - 1][1];
    else {
      for (let k = 1; k < p.length; k++) {
        if (xn <= p[k][0]) {
          const [x0, y0] = p[k - 1], [x1, y1] = p[k];
          y = x1 === x0 ? y1 : y0 + (y1 - y0) * (xn - x0) / (x1 - x0);
          break;
        }
      }
    }
    this.outFloat(0, this.lo + y * (this.hi - this.lo));
  }
  m_list(x) { this.m_float(num(x)); }
  m_bang() {}
}
def('function', Func);

// frandom: float random in [0,1) (or [0,n)).
class FRandom extends PdObject {
  constructor(c, a) { super(c, a); this.range = num(a[0], 1); this.setIO(2, 1); }
  m_bang() { this.outFloat(0, this.rt.backend.random() * this.range); }
  in1(s, a) { if (s === 'float') this.range = a[0]; }
}
def('frandom', FRandom);

// randweighted w1 w2 ...: bang -> index chosen with probability proportional to weight.
class RandWeighted extends PdObject {
  constructor(c, a) { super(c, a); this.w = a.map(x => num(x)); this.setIO(2, 1); }
  m_bang() {
    const tot = this.w.reduce((s, x) => s + Math.max(0, x), 0);
    if (tot <= 0) return this.outFloat(0, 0);
    let r = this.rt.backend.random() * tot;
    for (let k = 0; k < this.w.length; k++) { r -= Math.max(0, this.w[k]); if (r < 0) return this.outFloat(0, k); }
    this.outFloat(0, this.w.length - 1);
  }
  m_list(...a) { this.w = a.map(x => num(x)); }
  in1(sel, args) { this.w = msgToList(sel, args).map(x => num(x)); }
}
def('randweighted', RandWeighted);

export const eaClasses = C;
