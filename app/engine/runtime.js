// A control-rate Pure Data runtime faithful to Pd 0.39-era semantics (the version
// EA forked for Spore): depth-first synchronous message passing, fan-out in
// connection order, trigger right-to-left, logical-time scheduler with
// same-time events run in the order they were scheduled.
import { parsePatch, COMMA, SEMI } from './pdparse.js';

export function fnv(name) {
  let h = 0x811c9dc5;
  const s = name.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h, 0x1000193) >>> 0;
    h = (h ^ (s.charCodeAt(i) & 0xff)) >>> 0;
  }
  return h;
}
export const hex8 = n => (n >>> 0).toString(16).padStart(8, '0');

const MAX_DEPTH = 1000;

// ---------------------------------------------------------------- scheduler
class Scheduler {
  constructor() { this.now = 0; this.q = []; this.seq = 0; }
  add(time, fn) {
    const ev = { time, seq: this.seq++, fn, dead: false };
    // binary insert keeping (time, seq) order
    let lo = 0, hi = this.q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const m = this.q[mid];
      if (m.time < time || (m.time === time && m.seq < ev.seq)) lo = mid + 1; else hi = mid;
    }
    this.q.splice(lo, 0, ev);
    return ev;
  }
  advance(target) {
    while (this.q.length && this.q[0].time <= target) {
      const ev = this.q.shift();
      if (ev.dead) continue;
      this.now = ev.time;
      ev.fn();
    }
    this.now = Math.max(this.now, target);
  }
}

// A Pd "clock": one pending callback that can be (re)set or unset.
export class Clock {
  constructor(rt, fn) { this.rt = rt; this.fn = fn; this.ev = null; }
  delay(ms) { this.unset(); this.ev = this.rt.sched.add(this.rt.sched.now + Math.max(0, ms), () => { this.ev = null; this.fn(); }); }
  unset() { if (this.ev) { this.ev.dead = true; this.ev = null; } }
  get pending() { return !!this.ev; }
}

// ---------------------------------------------------------------- objects
export class PdObject {
  constructor(canvas, args) {
    this.canvas = canvas;
    this.rt = canvas.rt;
    this.args = args;
    this.outs = [];   // outs[n] = [[obj, inlet], ...]
    this.nIn = 1;
  }
  setIO(nIn, nOut) { this.nIn = nIn; while (this.outs.length < nOut) this.outs.push([]); }
  // Deliver a message to inlet i.
  receive(i, sel, args) {
    const rt = this.rt;
    if (++rt.depth > MAX_DEPTH) { rt.depth--; rt.error('stack overflow', this); return; }
    if (rt.tracer) rt.tracer(this, i, sel, args);
    try {
      if (i === 0) this.inlet0(sel, args);
      else this.inletN(i, sel, args);
    } finally { rt.depth--; }
  }
  out(n, sel, args = []) {
    const conns = this.outs[n];
    if (!conns) return;
    for (const [o, i] of conns) o.receive(i, sel, args);
  }
  outBang(n) { this.out(n, 'bang', []); }
  outFloat(n, f) { this.out(n, 'float', [f]); }
  outSymbol(n, s) { this.out(n, 'symbol', [s]); }
  outList(n, list) { outAtoms(this, n, list); }
  // Left inlet default: dispatch by selector to methods named m_<sel>.
  inlet0(sel, args) {
    const m = this['m_' + sel];
    if (m) return m.call(this, ...args);
    if (sel === 'list') return this.defaultList(args);
    if (sel === 'float' && this.m_list) return this.m_list(...args);
    if (this.m_anything) return this.m_anything(sel, args);
    this.rt.error(`${this.constructor.cls || this.constructor.name}: no method for '${sel}'`, this);
  }
  // Pd's default list handling: spread over inlets right-to-left, then the first to the left.
  defaultList(args) {
    if (args.length === 0) return this.m_bang ? this.m_bang() : undefined;
    if (args.length === 1) {
      const a = args[0];
      if (typeof a === 'number') return this.inlet0('float', [a]);
      return this.inlet0('symbol', [a]);
    }
    const n = Math.min(args.length, this.nIn);
    for (let k = n - 1; k >= 1; k--) {
      const a = args[k];
      this.inletN(k, typeof a === 'number' ? 'float' : 'symbol', [a]);
    }
    const a = args[0];
    this.inlet0(typeof a === 'number' ? 'float' : 'symbol', [a]);
  }
  inletN(i, sel, args) {
    const m = this['in' + i];
    if (m) return m.call(this, sel, args);
    this.rt.error(`inlet ${i}: no method for '${sel}'`, this);
  }
  loadbang() {}
  destroy() {}
}

// Output an atom list as the right Pd message type.
export function outAtoms(obj, n, list) {
  if (list.length === 0) return obj.out(n, 'bang', []);
  if (typeof list[0] === 'number') {
    if (list.length === 1) return obj.out(n, 'float', list);
    return obj.out(n, 'list', list);
  }
  if (list.length === 1) return obj.out(n, 'symbol', list);
  return obj.out(n, 'list', list);  // Pd: list starting with symbol stays a list
}

// Convert (sel,args) to a flat atom list, like Pd's "list" view of a message.
export function msgToList(sel, args) {
  if (sel === 'bang') return [];
  if (sel === 'float' || sel === 'list' || sel === 'symbol') return args.slice();
  return [sel, ...args];
}

// Send an atom list (as produced by a message box) to a target object's inlet.
export function sendAtoms(target, inlet, atoms) {
  if (atoms.length === 0) return target.receive(inlet, 'bang', []);
  const a0 = atoms[0];
  if (typeof a0 === 'number') {
    if (atoms.length === 1) return target.receive(inlet, 'float', atoms);
    return target.receive(inlet, 'list', atoms);
  }
  return target.receive(inlet, a0, atoms.slice(1));
}

// ---------------------------------------------------------------- canvas
let dollarZero = 1000;

export class Canvas {
  constructor(rt, parsed, args, parent, name) {
    this.rt = rt;
    this.parent = parent;
    this.args = args;       // $1..$n of the enclosing abstraction
    this.dollar0 = parent && !parsed.isAbstractionRoot ? parent.dollar0 : ++dollarZero;
    this.name = name;
    this.objects = [];
    this.inlets = [];
    this.outlets = [];
    this.parsed = parsed;
  }
  subst(a) {
    // Creation-time $n substitution for object arguments.
    if (a && typeof a === 'object' && 'dollar' in a) {
      const s = a.dollar.replace(/\$(\d+)/g, (_, d) => {
        const k = +d;
        if (k === 0) return String(this.dollar0);
        const v = this.args[k - 1];
        return v === undefined ? '0' : String(v);
      });
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : s;
    }
    return a;
  }
  build() {
    const p = this.parsed;
    for (const it of p.items) this.objects.push(this.rt.create(this, it));
    for (const [a, ao, b, bi] of p.conns) {
      const src = this.objects[a], dst = this.objects[b];
      if (!src || !dst) continue;
      if (!src.outs[ao]) { this.rt.warn(`connect: outlet ${ao} missing on ${src.constructor.cls}`, src); continue; }
      if (bi >= dst.nIn && !(dst instanceof BrokenObject)) { this.rt.warn(`connect: inlet ${bi} missing on ${dst.constructor.cls}`, dst); continue; }
      src.outs[ao].push([dst, bi]);
    }
  }
  // Pd 0.39 canvas_loadbang: recurse into every sub-canvas first (in order), then own objects.
  loadbang() {
    for (const o of this.objects) if (o.inner) o.inner.loadbang();
    for (const o of this.objects) if (!o.inner) o.loadbang();
  }
}

// Subpatch or abstraction instance: an object that owns a canvas.
export class CanvasObject extends PdObject {
  constructor(canvas, args, inner) {
    super(canvas, args);
    this.inner = inner;
    // inlets/outlets ordered by x position (Pd semantics)
    const ins = inner.objects.filter(o => o.isInlet).sort((a, b) => a.x - b.x || a.order - b.order);
    const outs = inner.objects.filter(o => o.isOutlet).sort((a, b) => a.x - b.x || a.order - b.order);
    this.inletObjs = ins;
    this.setIO(Math.max(1, ins.length), outs.length);
    outs.forEach((o, k) => { o.owner = this; o.index = k; });
    if (!ins.length) this.nIn = 0;
  }
  receive(i, sel, args) {
    if (this.rt.tracer) this.rt.tracer(this, i, sel, args);
    const inl = this.inletObjs[i];
    if (inl) inl.out(0, sel, args);
  }
}
CanvasObject.cls = 'pd';

export class BrokenObject extends PdObject {
  constructor(canvas, args, cls) { super(canvas, args); this.cls = cls; this.setIO(64, 64); }
  receive() {}
}

// ---------------------------------------------------------------- runtime
export class Runtime {
  constructor({ patches, classes, backend, log }) {
    this.patches = patches;       // hex instance -> patch text
    this.classes = classes;       // name -> class
    this.backend = backend;
    this.sched = new Scheduler();
    this.receivers = new Map();   // name -> Set(obj)
    this.tables = new Map();      // name -> Float64Array
    this.colls = new Map();       // name -> coll store (shared by named colls)
    this.values = new Map();
    this.groups = new Map();      // EA sound groups: name -> [sample names]
    this.gparams = new Map();     // gfparam name -> Set(obj)
    this.gvalues = new Map();
    this.depth = 0;
    this.log = log || ((lvl, msg) => (lvl === 'error' ? console.error : console.log)('[pd]', msg));
    this.errors = [];
    this.missing = new Set();
    this.parsedCache = new Map();
    this.gameListeners = new Set();
    this.randomSeed = 1489853723; // Pd's initial random_nextseed
  }
  get now() { return this.sched.now; }
  error(msg, obj) { const m = `${msg}${obj ? ' [' + (obj.constructor.cls || obj.cls || '') + ']' : ''}`; this.errors.push(m); this.log('error', m); }
  warn(msg) { this.log('warn', msg); }

  nextRandomSeed() {
    // x_misc.c random_new: static random_nextseed = nextseed * 435898247 + 938284287
    this.randomSeed = (Math.imul(this.randomSeed, 435898247) + 938284287) >>> 0;
    return this.randomSeed;
  }

  bind(name, obj) { if (!this.receivers.has(name)) this.receivers.set(name, new Set()); this.receivers.get(name).add(obj); }
  unbind(name, obj) { const s = this.receivers.get(name); if (s) s.delete(obj); }
  send(name, sel, args) {
    const s = this.receivers.get(String(name));
    if (!s || !s.size) return false;
    for (const o of [...s]) o.onReceive(sel, args);
    return true;
  }

  parsed(hex) {
    if (!this.parsedCache.has(hex)) {
      const text = this.patches[hex];
      this.parsedCache.set(hex, text ? parsePatch(text) : null);
    }
    return this.parsedCache.get(hex);
  }

  create(canvas, it) {
    if (it.kind === 'text') { const o = new PdObject(canvas, []); o.setIO(0, 0); o.nIn = 0; return o; }
    if (it.kind === 'msg') { const C = this.classes.__msg; const o = new C(canvas, it.atoms); o.x = it.x; return o; }
    if (it.kind === 'floatatom' || it.kind === 'symbolatom') {
      const C = this.classes['__' + it.kind]; const o = new C(canvas, it.args); o.x = it.x; return o;
    }
    if (it.kind === 'sub') {
      if (it.cls === 'graph') {
        // graph holding arrays: register them as tables
        for (const arr of (it.canvas.arrays || [])) this.defineTable(canvas.subst(arr.name), arr.size, arr.data);
        const o = new PdObject(canvas, []); o.setIO(0, 0); o.nIn = 0; return o;
      }
      const inner = new Canvas(this, it.canvas, canvas.args, canvas, it.args[0]);
      inner.dollar0 = canvas.dollar0;
      inner.build();
      for (const arr of (it.canvas.arrays || [])) this.defineTable(canvas.subst(arr.name), arr.size, arr.data);
      const o = new CanvasObject(canvas, it.args, inner);
      o.x = it.x;
      return o;
    }
    // #X obj
    const args = it.args.map(a => canvas.subst(a));
    const cls = it.cls;
    let o;
    const C = this.classes[cls];
    if (C) {
      try {
        o = new C(canvas, args, it);
      } catch (e) {
        this.error(`${cls}: creation failed: ${e.message}`);
        o = new BrokenObject(canvas, args, cls);
      }
    } else {
      const hex = hex8(fnv(cls));
      const p = this.parsed(hex);
      if (p) {
        p.isAbstractionRoot = true;
        const inner = new Canvas(this, p, args, canvas, cls);
        inner.build();
        o = new CanvasObject(canvas, args, inner);
        o.abstraction = cls;
      } else {
        if (!this.missing.has(cls)) { this.missing.add(cls); this.warn(`couldn't create: ${cls}`); }
        o = new BrokenObject(canvas, args, cls);
      }
    }
    o.x = it.x;
    o.order = canvas.objects.length;
    return o;
  }

  defineTable(name, size, data) {
    const t = new Float64Array(Math.max(1, size | 0));
    if (data) for (const { start, values } of data) values.forEach((v, k) => { if (start + k < t.length) t[start + k] = v; });
    this.tables.set(String(name), t);
    return t;
  }

  // Load and start a top-level patch by hex instance id.
  open(hex, args = []) {
    const p = this.parsed(hex);
    if (!p) throw new Error('patch not found: ' + hex);
    p.isAbstractionRoot = true;
    const c = new Canvas(this, p, args, null, hex);
    c.build();
    c.loadbang();
    return c;
  }

  // ---- EA game interface
  setGameParam(name, value) {
    this.gvalues.set(name, value);
    const s = this.gparams.get(name);
    if (s) for (const o of [...s]) o.fire(value);
  }
  sendToGame(name, value) { for (const f of this.gameListeners) f(name, value, this.now); }
  onGame(f) { this.gameListeners.add(f); return () => this.gameListeners.delete(f); }
}
