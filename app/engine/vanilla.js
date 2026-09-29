// Pd vanilla control objects (Pd 0.39 semantics), plus the GUI objects that
// Spore's patches contain (bng/tgl/sliders/atoms behave as their control logic).
import { PdObject, Clock, outAtoms, msgToList, sendAtoms } from './runtime.js';
import { COMMA, SEMI } from './pdparse.js';

const isNum = a => typeof a === 'number';
const num = (a, d = 0) => (isNum(a) ? a : d);
const nonEmpty = s => s !== undefined && s !== 'empty' && s !== '-' && s !== '';
const C = {};
const def = (names, cls) => { for (const n of names.split(' ')) C[n] = cls; cls.cls = names.split(' ')[0]; };

// ------------------------------------------------------------ patch plumbing
class Inlet extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(0, 1); this.nIn = 0; this.isInlet = true; }
  receive() {}
}
def('inlet', Inlet);

class Outlet extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(1, 0); this.isOutlet = true; }
  receive(i, sel, args) { if (this.owner) this.owner.out(this.index, sel, args); }
}
def('outlet', Outlet);

// ------------------------------------------------------------ message box
class Message extends PdObject {
  constructor(c, atoms) { super(c, atoms); this.atoms = atoms; this.setIO(1, 1); }
  inlet0(sel, args) {
    if (sel === 'set') { this.atoms = args.slice(); return; }
    if (sel === 'add') { this.atoms = this.atoms.concat([SEMI], args); return; }
    if (sel === 'add2') { this.atoms = this.atoms.concat(args); return; }
    if (sel === 'addcomma') { this.atoms = this.atoms.concat([COMMA]); return; }
    if (sel === 'addsemi') { this.atoms = this.atoms.concat([SEMI]); return; }
    const argv = (sel === 'bang') ? [] : (sel === 'float' || sel === 'symbol' || sel === 'list') ? args : args;
    this.eval(argv);
  }
  expand(a, argv) {
    if (a && typeof a === 'object' && 'dollar' in a) {
      const m = /^\$(\d+)$/.exec(a.dollar);
      if (m) {
        const k = +m[1];
        if (k === 0) return 0;
        if (k > argv.length) { this.rt.error(`$${k}: argument number out of range`, this); return 0; }
        return argv[k - 1];
      }
      return a.dollar.replace(/\$(\d+)/g, (_, d) => { const k = +d; return k === 0 ? '0' : String(argv[k - 1] ?? 0); });
    }
    return a;
  }
  eval(argv) {
    // binbuf_eval: messages separated by ',' go to the current target; ';' switches
    // the target to the receiver named by the next message's first atom.
    let target = null; // null = outlet
    let cur = [];
    let afterSemi = false;
    const flush = () => {
      if (!cur.length) return;
      if (afterSemi) {
        const name = cur[0];
        const rest = cur.slice(1);
        target = name;
        afterSemi = false;
        if (rest.length) this.dispatch(target, rest);
      } else this.dispatch(target, cur);
      cur = [];
    };
    for (const a of this.atoms) {
      if (a === COMMA) { flush(); continue; }
      if (a === SEMI) { flush(); afterSemi = true; target = undefined; continue; }
      cur.push(this.expand(a, argv));
    }
    flush();
  }
  dispatch(target, atoms) {
    if (target === null) return sendAtoms({ receive: (i, s, a) => this.out(0, s, a) }, 0, atoms);
    if (target === undefined) return;
    const a0 = atoms[0];
    const sel = isNum(a0) ? (atoms.length === 1 ? 'float' : 'list') : a0;
    const args = isNum(a0) ? atoms : atoms.slice(1);
    this.rt.send(target, sel, args);
  }
}
Message.cls = 'msg';
C.__msg = Message;

// ------------------------------------------------------------ send / receive
class Send extends PdObject {
  constructor(c, a) { super(c, a); this.name = a.length ? String(a[0]) : null; this.setIO(a.length ? 1 : 2, 0); }
  inlet0(sel, args) { if (this.name !== null) this.rt.send(this.name, sel, args); }
  in1(sel, args) { if (sel === 'symbol') this.name = String(args[0]); }
}
def('s send', Send);

class Receive extends PdObject {
  constructor(c, a) {
    super(c, a); this.setIO(0, 1); this.nIn = 0;
    this.name = a.length ? String(a[0]) : null;
    if (this.name !== null) this.rt.bind(this.name, this);
  }
  onReceive(sel, args) { this.out(0, sel, args); }
}
def('r receive', Receive);

class Forward extends PdObject {
  // EA/cyclone-style: "send <name>" sets the destination, anything else is forwarded.
  constructor(c, a) { super(c, a); this.name = a.length ? String(a[0]) : null; this.setIO(1, 0); }
  inlet0(sel, args) {
    if (sel === 'send') { this.name = String(args[0]); return; }
    if (this.name !== null) this.rt.send(this.name, sel, args);
  }
}
def('forward', Forward);

class Value extends PdObject {
  constructor(c, a) { super(c, a); this.name = String(a[0] ?? ''); this.setIO(1, 1); if (!this.rt.values.has(this.name)) this.rt.values.set(this.name, 0); }
  m_bang() { this.outFloat(0, this.rt.values.get(this.name)); }
  m_float(f) { this.rt.values.set(this.name, f); }
}
def('value v', Value);

// ------------------------------------------------------------ atoms & storage
class Bang extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(1, 1); }
  inlet0() { this.outBang(0); }
}
def('bang b', Bang);

class Float extends PdObject {
  constructor(c, a) { super(c, a); this.f = num(a[0]); this.setIO(2, 1); }
  m_bang() { this.outFloat(0, this.f); }
  m_float(f) { this.f = f; this.outFloat(0, f); }
  m_set(f) { this.f = num(f); }
  m_symbol() { this.rt.error('float: no method for symbol', this); }
  in1(sel, args) { if (sel === 'float') this.f = args[0]; }
}
def('f float', Float);

class Int extends PdObject {
  constructor(c, a) { super(c, a); this.f = Math.trunc(num(a[0])); this.setIO(2, 1); }
  m_bang() { this.outFloat(0, this.f); }
  m_float(f) { this.f = Math.trunc(f); this.outFloat(0, this.f); }
  in1(sel, args) { if (sel === 'float') this.f = Math.trunc(args[0]); }
}
def('i int', Int);

class Sym extends PdObject {
  constructor(c, a) { super(c, a); this.s = isNum(a[0]) ? 'float' : (a[0] ?? ''); this.setIO(2, 1); }
  m_bang() { this.outSymbol(0, this.s); }
  m_symbol(s) { this.s = s; this.outSymbol(0, s); }
  m_anything(sel) { this.s = sel; this.outSymbol(0, sel); }
  m_list(...a) { if (a.length && !isNum(a[0])) { this.s = a[0]; this.outSymbol(0, a[0]); } }
  in1(sel, args) { if (sel === 'symbol') this.s = args[0]; }
}
def('symbol', Sym);

class Loadbang extends PdObject {
  // EAPd's loadbang has an inlet (Spore's noteObject patches bang it to re-init).
  constructor(c, a) { super(c, a); this.setIO(1, 1); }
  inlet0() { this.outBang(0); }
  loadbang() { this.outBang(0); }
}
def('loadbang', Loadbang);

class Print extends PdObject {
  constructor(c, a) { super(c, a); this.name = a.length ? a.join(' ') : 'print'; this.setIO(1, 0); }
  inlet0(sel, args) { this.rt.log('print', `${this.name}: ${sel === 'float' || sel === 'list' ? '' : sel + ' '}${args.join(' ')}`.trim()); }
}
def('print', Print);

// ------------------------------------------------------------ arithmetic
function binop(name, fn, defaultRight = 0) {
  class Binop extends PdObject {
    constructor(c, a) { super(c, a); this.f1 = 0; this.f2 = num(a[0], defaultRight); this.setIO(2, 1); }
    m_bang() { this.outFloat(0, fn(this.f1, this.f2)); }
    m_float(f) { this.f1 = f; this.outFloat(0, fn(f, this.f2)); }
    m_list(...a) { if (a.length >= 2) { this.f2 = num(a[1]); } this.m_float(num(a[0])); }
    in1(sel, args) { if (sel === 'float') this.f2 = args[0]; }
  }
  def(name, Binop);
}
const toInt = x => Math.trunc(x);
binop('+', (a, b) => a + b);
binop('-', (a, b) => a - b);
binop('*', (a, b) => a * b);
binop('/', (a, b) => (b !== 0 ? a / b : 0));
binop('pow', (a, b) => (a > 0 ? Math.pow(a, b) : 0));
binop('max', (a, b) => Math.max(a, b));
binop('min', (a, b) => Math.min(a, b));
binop('==', (a, b) => +(a === b));
binop('!=', (a, b) => +(a !== b));
binop('>', (a, b) => +(a > b));
binop('<', (a, b) => +(a < b));
binop('>=', (a, b) => +(a >= b));
binop('<=', (a, b) => +(a <= b));
binop('&&', (a, b) => +(toInt(a) !== 0 && toInt(b) !== 0));
binop('||', (a, b) => +(toInt(a) !== 0 || toInt(b) !== 0));
binop('&', (a, b) => toInt(a) & toInt(b));
binop('|', (a, b) => toInt(a) | toInt(b));
binop('<<', (a, b) => toInt(a) << toInt(b));
binop('>>', (a, b) => toInt(a) >> toInt(b));
binop('%', (a, b) => { let n2 = toInt(b); if (n2 < 0) n2 = -n2; else if (!n2) n2 = 1; return toInt(a) % n2; });
binop('mod', (a, b) => { let n2 = toInt(b); if (n2 < 0) n2 = -n2; else if (!n2) n2 = 1; let r = toInt(a) % n2; if (r < 0) r += n2; return r; });
binop('div', (a, b) => { const n1 = toInt(a); let n2 = toInt(b); if (n2 < 0) n2 = -n2; else if (!n2) n2 = 1; let r; if (n1 < 0) r = -Math.trunc((-n1 - 1) / n2) - 1; else r = Math.trunc(n1 / n2); return r; });
binop('atan2', (a, b) => (a === 0 && b === 0 ? 0 : Math.atan2(a, b)));

function unop(name, fn) {
  class Unop extends PdObject {
    constructor(c, a) { super(c, a); this.f = 0; this.setIO(1, 1); }
    m_float(f) { this.f = f; this.outFloat(0, fn(f)); }
    m_bang() { this.outFloat(0, fn(this.f)); }
  }
  def(name, Unop);
}
unop('abs', Math.abs);
unop('sqrt', x => (x > 0 ? Math.sqrt(x) : 0));
unop('exp', x => Math.exp(Math.min(x, 87.3365)));
unop('log', x => (x > 0 ? Math.log(x) : -1000));
unop('sin', Math.sin);
unop('cos', Math.cos);
unop('tan', Math.tan);
unop('atan', Math.atan);
unop('mtof', m => (m <= -1500 ? 0 : 8.17579891564 * Math.exp(0.0577622650 * Math.min(m, 1499))));
unop('ftom', f => (f > 0 ? 17.3123405046 * Math.log(0.12231220585 * f) : -1500));
unop('dbtorms', f => (f <= 0 ? 0 : Math.exp(0.11512925465 * (Math.min(f, 485) - 100))));
unop('rmstodb', f => (f <= 0 ? 0 : Math.max(0, 100 + 8.6858896380 * Math.log(f))));
unop('wrap', x => x - Math.floor(x));

class Clip extends PdObject {
  constructor(c, a) { super(c, a); this.lo = num(a[0]); this.hi = num(a[1]); this.f = 0; this.setIO(3, 1); }
  m_float(f) { this.f = f; this.outFloat(0, f < this.lo ? this.lo : f > this.hi ? this.hi : f); }
  m_bang() { this.m_float(this.f); }
  m_list(...a) { if (a.length > 1) this.lo = num(a[1]); if (a.length > 2) this.hi = num(a[2]); this.m_float(num(a[0])); }
  in1(s, a) { if (s === 'float') this.lo = a[0]; }
  in2(s, a) { if (s === 'float') this.hi = a[0]; }
}
def('clip', Clip);

class Moses extends PdObject {
  constructor(c, a) { super(c, a); this.y = num(a[0]); this.setIO(2, 2); }
  m_float(f) { if (f < this.y) this.outFloat(0, f); else this.outFloat(1, f); }
  in1(s, a) { if (s === 'float') this.y = a[0]; }
}
def('moses', Moses);

class Change extends PdObject {
  constructor(c, a) { super(c, a); this.f = num(a[0]); this.setIO(1, 1); }
  m_float(f) { if (f !== this.f) { this.f = f; this.outFloat(0, f); } }
  m_bang() { this.outFloat(0, this.f); }
  m_set(f) { this.f = num(f); }
}
def('change', Change);

class Swap extends PdObject {
  constructor(c, a) { super(c, a); this.f1 = 0; this.f2 = num(a[0]); this.setIO(2, 2); }
  m_float(f) { this.f1 = f; this.m_bang(); }
  m_bang() { this.outFloat(1, this.f1); this.outFloat(0, this.f2); }
  m_list(...a) { if (a.length > 1) this.f2 = num(a[1]); this.m_float(num(a[0])); }
  in1(s, a) { if (s === 'float') this.f2 = a[0]; }
}
def('swap', Swap);

class Random extends PdObject {
  constructor(c, a) {
    super(c, a); this.range = num(a[0], 1); this.setIO(2, 1);
    this.state = this.rt.nextRandomSeed();
  }
  m_bang() {
    // x_misc.c random_bang
    let n = Math.trunc(this.range);
    if (n < 1) n = 1;
    this.state = (Math.imul(this.state, 472940017) + 832416023) >>> 0;
    let nval = Math.trunc(n * this.state * (1 / 4294967296));
    if (nval >= n) nval = n - 1;
    this.outFloat(0, nval);
  }
  m_float() { this.m_bang(); }
  m_seed(f) { this.state = num(f) >>> 0; }
  in1(s, a) { if (s === 'float') this.range = a[0]; }
}
def('random', Random);

// ------------------------------------------------------------ flow
class Trigger extends PdObject {
  constructor(c, a) {
    super(c, a);
    this.types = (a.length ? a : ['bang', 'bang']).map(t => {
      if (isNum(t)) return 'f';
      const k = String(t)[0];
      return { b: 'b', f: 'f', s: 's', l: 'l', a: 'a', p: 'p' }[k] || 'f';
    });
    this.setIO(1, this.types.length);
  }
  inlet0(sel, args) {
    for (let k = this.types.length - 1; k >= 0; k--) {
      const t = this.types[k];
      if (t === 'b') this.outBang(k);
      else if (t === 'a') this.out(k, sel, args);
      else if (t === 'f') {
        if (sel === 'float') this.outFloat(k, args[0]);
        else if (sel === 'bang') this.outFloat(k, 0);
        else if (sel === 'list') this.outFloat(k, num(args[0]));
        else { this.rt.error(`trigger: can only convert 's' to 'b' or 'a'`, this); }
      } else if (t === 's') {
        if (sel === 'symbol') this.outSymbol(k, args[0]);
        else if (sel === 'float') this.outSymbol(k, 'float');
        else if (sel === 'bang') this.outSymbol(k, 'symbol');
        else if (sel === 'list') this.outSymbol(k, isNum(args[0]) ? 'float' : args[0]);
        else this.outSymbol(k, sel);
      } else if (t === 'l') {
        this.out(k, 'list', msgToList(sel, args));
      }
    }
  }
}
def('t trigger', Trigger);

class Route extends PdObject {
  constructor(c, a) {
    super(c, a);
    this.keys = a.length ? a : [0];
    this.numeric = isNum(this.keys[0]);
    this.setIO(this.keys.length === 1 ? 2 : 1, this.keys.length + 1);
  }
  inlet0(sel, args) {
    const n = this.keys.length;
    if (this.numeric) {
      if (sel === 'float' || (sel === 'list' && isNum(args[0]))) {
        const f = args[0];
        for (let k = 0; k < n; k++) {
          if (this.keys[k] === f) {
            const rest = args.slice(1);
            if (sel === 'float' || !rest.length) return this.outBang(k);
            return outAtoms(this, k, rest);
          }
        }
      }
      return this.out(n, sel, args);
    }
    for (let k = 0; k < n; k++) {
      if (this.keys[k] === sel) {
        if (!args.length) return this.outBang(k);
        if (sel === 'list' || sel === 'float' || sel === 'symbol') return this.out(k, sel, args);
        if (isNum(args[0])) return outAtoms(this, k, args);
        return this.out(k, args[0], args.slice(1));
      }
    }
    // Pd route also matches list messages by their first symbol
    if (sel === 'list' && args.length && !isNum(args[0])) {
      for (let k = 0; k < n; k++) if (this.keys[k] === args[0]) {
        const rest = args.slice(1);
        if (!rest.length) return this.outBang(k);
        if (isNum(rest[0])) return outAtoms(this, k, rest);
        return this.out(k, rest[0], rest.slice(1));
      }
    }
    this.out(n, sel, args);
  }
  in1(s, a) { if (a.length) this.keys[0] = a[0]; }
}
def('route', Route);

class Select extends PdObject {
  constructor(c, a) {
    super(c, a);
    this.keys = a.length ? a : [0];
    this.numeric = isNum(this.keys[0]);
    this.setIO(this.keys.length === 1 ? 2 : 1, this.keys.length + 1);
  }
  m_float(f) {
    if (this.numeric) {
      for (let k = 0; k < this.keys.length; k++) if (this.keys[k] === f) return this.outBang(k);
    }
    this.outFloat(this.keys.length, f);
  }
  m_symbol(s) {
    if (!this.numeric) {
      for (let k = 0; k < this.keys.length; k++) if (this.keys[k] === s) return this.outBang(k);
    }
    this.outSymbol(this.keys.length, s);
  }
  m_list(...a) { if (a.length) (isNum(a[0]) ? this.m_float(a[0]) : this.m_symbol(a[0])); }
  m_anything(sel) { this.m_symbol(sel); }
  in1(s, a) { if (a.length) this.keys[0] = a[0]; }
}
def('sel select', Select);

class Spigot extends PdObject {
  constructor(c, a) { super(c, a); this.on = num(a[0]); this.setIO(2, 1); }
  inlet0(sel, args) { if (this.on) this.out(0, sel, args); }
  in1(s, a) { if (s === 'float') this.on = a[0]; }
}
def('spigot', Spigot);

class Pack extends PdObject {
  constructor(c, a) {
    super(c, a);
    const spec = a.length ? a : [0, 0];
    this.types = spec.map(t => (isNum(t) ? 'f' : (t === 's' || t === 'symbol') ? 's' : (t === 'f' || t === 'float') ? 'f' : 'f'));
    this.vals = spec.map(t => (isNum(t) ? t : (t === 's' || t === 'symbol') ? 'symbol' : 0));
    this.setIO(this.types.length, 1);
  }
  m_bang() { this.outList(0, this.vals.slice()); }
  m_float(f) { if (this.types[0] === 'f') this.vals[0] = f; else this.rt.error('pack: type mismatch', this); this.out(0, 'list', this.vals.slice()); }
  m_symbol(s) { if (this.types[0] === 's') this.vals[0] = s; this.out(0, 'list', this.vals.slice()); }
  m_list(...a) {
    // obj_list distributes; for pack this means set all then output
    for (let k = Math.min(a.length, this.types.length) - 1; k >= 1; k--) this.vals[k] = a[k];
    if (a.length) this.vals[0] = a[0];
    this.out(0, 'list', this.vals.slice());
  }
  m_anything(sel, args) { this.m_list(sel, ...args); }
  inletN(i, sel, args) { if (sel === 'float' || sel === 'symbol') this.vals[i] = args[0]; }
}
def('pack', Pack);

class Unpack extends PdObject {
  constructor(c, a) {
    super(c, a);
    const spec = a.length ? a : [0, 0];
    this.n = spec.length;
    this.setIO(1, this.n);
  }
  m_list(...a) {
    for (let k = Math.min(a.length, this.n) - 1; k >= 0; k--) {
      const v = a[k];
      if (isNum(v)) this.outFloat(k, v); else this.outSymbol(k, v);
    }
  }
  m_float(f) { this.m_list(f); }
  m_anything(sel, args) { this.m_list(sel, ...args); }
  m_symbol(s) { this.m_list(s); }
}
def('unpack', Unpack);

class Until extends PdObject {
  constructor(c, a) { super(c, a); this.setIO(2, 1); this.run = false; }
  m_bang() { this.run = true; let guard = 0; while (this.run && guard++ < 1e6) this.outBang(0); if (guard >= 1e6) this.rt.error('until: infinite loop', this); }
  m_float(f) { this.run = true; for (let k = 0; k < f && this.run; k++) this.outBang(0); }
  in1() { this.run = false; }
}
def('until', Until);

class List extends PdObject {
  constructor(c, a) {
    super(c, a);
    const kind = isNum(a[0]) || a[0] === undefined ? 'append' : a[0];
    this.kind = ['append', 'prepend', 'split', 'trim', 'length'].includes(kind) ? kind : 'append';
    const rest = isNum(a[0]) || a[0] === undefined ? a : a.slice(1);
    this.stored = rest;
    this.setIO(this.kind === 'trim' || this.kind === 'length' ? 1 : 2, this.kind === 'split' ? 3 : 1);
  }
  inlet0(sel, args) {
    const l = msgToList(sel, args);
    if (this.kind === 'append') return this.outL(l.concat(this.stored));
    if (this.kind === 'prepend') return this.outL(this.stored.concat(l));
    if (this.kind === 'length') return this.outFloat(0, l.length);
    if (this.kind === 'trim') { if (!l.length) return this.outBang(0); if (isNum(l[0])) return this.out(0, 'list', l); return this.out(0, l[0], l.slice(1)); }
    if (this.kind === 'split') {
      const n = Math.max(0, Math.trunc(num(this.stored[0])));
      if (l.length >= n) { if (l.length > n) this.outL(l.slice(n), 1); this.outL(l.slice(0, n), 0); }
      else this.outL(l, 2);
    }
  }
  outL(l, n = 0) { this.out(n, 'list', l); }
  in1(sel, args) { this.stored = msgToList(sel, args); }
}
def('list', List);

// ------------------------------------------------------------ time
class Delay extends PdObject {
  constructor(c, a) { super(c, a); this.ms = num(a[0]); this.setIO(2, 1); this.clock = new Clock(this.rt, () => this.outBang(0)); }
  m_bang() { this.clock.delay(this.ms); }
  m_float(f) { this.ms = Math.max(0, f); this.m_bang(); }
  m_stop() { this.clock.unset(); }
  in1(s, a) { if (s === 'float') this.ms = Math.max(0, a[0]); }
}
def('del delay', Delay);

class Metro extends PdObject {
  constructor(c, a) { super(c, a); this.ms = Math.max(1, num(a[0], 1)); this.setIO(2, 1); this.clock = new Clock(this.rt, () => this.tick()); }
  tick() { this.clock.delay(this.ms); this.outBang(0); }
  m_float(f) { if (f !== 0) this.tick(); else this.clock.unset(); }
  m_bang() { this.tick(); }
  m_stop() { this.clock.unset(); }
  in1(s, a) { if (s === 'float') this.ms = Math.max(1, a[0]); }
}
def('metro', Metro);

class Pipe extends PdObject {
  constructor(c, a) {
    super(c, a);
    const spec = a.length > 1 ? a.slice(0, -1) : [0];
    this.ms = num(a.length ? a[a.length - 1] : 0);
    this.vals = spec.map(t => (isNum(t) ? t : (t === 's' ? 'symbol' : 0)));
    this.pending = [];
    this.setIO(this.vals.length + 1, this.vals.length);
  }
  schedule() {
    const vals = this.vals.slice();
    const ev = this.rt.sched.add(this.rt.now + Math.max(0, this.ms), () => {
      this.pending = this.pending.filter(p => p !== ev);
      for (let k = vals.length - 1; k >= 0; k--) isNum(vals[k]) ? this.outFloat(k, vals[k]) : this.outSymbol(k, vals[k]);
    });
    this.pending.push(ev);
  }
  m_float(f) { this.vals[0] = f; this.schedule(); }
  m_symbol(s) { this.vals[0] = s; this.schedule(); }
  m_list(...a) {
    const n = this.vals.length;
    if (a.length > n) this.ms = num(a[n]);
    for (let k = 0; k < Math.min(a.length, n); k++) this.vals[k] = a[k];
    this.schedule();
  }
  m_bang() { this.schedule(); }
  m_flush() { for (const e of this.pending) { e.dead = true; e.fn(); } this.pending = []; }
  m_clear() { for (const e of this.pending) e.dead = true; this.pending = []; }
  inletN(i, sel, args) {
    if (i === this.vals.length) { if (sel === 'float') this.ms = args[0]; return; }
    if (sel === 'float' || sel === 'symbol') this.vals[i] = args[0];
  }
}
def('pipe', Pipe);

class Line extends PdObject {
  constructor(c, a) {
    super(c, a);
    this.cur = num(a[0]); this.grain = num(a[1], 20) > 0 ? num(a[1], 20) : 20;
    this.in1v = 0; this.got1 = false;
    this.target = this.cur; this.t0 = 0; this.t1 = 0; this.v0 = 0;
    this.setIO(3, 1);
    this.clock = new Clock(this.rt, () => this.tick());
  }
  tick() {
    const now = this.rt.now;
    if (now >= this.t1) { this.cur = this.target; this.outFloat(0, this.cur); return; }
    this.cur = this.v0 + (this.target - this.v0) * (now - this.t0) / (this.t1 - this.t0);
    this.outFloat(0, this.cur);
    const next = Math.min(this.grain, this.t1 - now);
    this.clock.delay(next);
  }
  m_float(f) {
    const now = this.rt.now;
    if (this.got1 && this.in1v > 0) {
      if (now > this.t1) { this.t0 = now; this.v0 = this.cur; }
      else { // interrupt: continue from current interpolated value
        this.v0 = this.t1 > this.t0 ? this.v0 + (this.target - this.v0) * (now - this.t0) / (this.t1 - this.t0) : this.cur;
        this.t0 = now;
      }
      this.cur = this.v0;
      this.t1 = now + this.in1v;
      this.target = f;
      this.tick();
    } else {
      this.clock.unset();
      this.target = this.cur = this.v0 = f;
      this.t1 = now;
      this.outFloat(0, f);
    }
    this.got1 = false; this.in1v = 0;
  }
  m_list(...a) { if (a.length > 1) { this.in1v = num(a[1]); this.got1 = true; } if (a.length > 2) this.grain = num(a[2]) || 20; this.m_float(num(a[0])); }
  m_stop() { this.clock.unset(); this.target = this.cur; }
  m_set(f) { this.clock.unset(); this.target = this.cur = num(f); }
  in1(s, a) { if (s === 'float') { this.in1v = a[0]; this.got1 = true; } }
  in2(s, a) { if (s === 'float') this.grain = a[0] > 0 ? a[0] : 20; }
}
def('line', Line);

class Timer extends PdObject {
  constructor(c, a) { super(c, a); this.t = this.rt.now; this.setIO(2, 1); }
  m_bang() { this.t = this.rt.now; }
  in1(s) { if (s === 'bang') this.outFloat(0, this.rt.now - this.t); }
}
def('timer', Timer);

// ------------------------------------------------------------ tables
class Table extends PdObject {
  constructor(c, a, item) {
    super(c, a); this.setIO(1, 0);
    this.name = String(a[0] ?? ('table' + this.rt.tables.size));
    this.rt.defineTable(this.name, num(a[1], 100), item && item.data);
  }
}
def('table', Table);

class TabRead extends PdObject {
  constructor(c, a) { super(c, a); this.name = String(a[0] ?? ''); this.setIO(1, 1); }
  m_float(f) {
    const t = this.rt.tables.get(this.name);
    if (!t) return this.rt.error(`tabread: ${this.name}: no such array`, this);
    let i = Math.trunc(f); if (i < 0) i = 0; if (i >= t.length) i = t.length - 1;
    this.outFloat(0, t[i]);
  }
  m_set(s) { this.name = String(s); }
}
def('tabread', TabRead);

class TabWrite extends PdObject {
  constructor(c, a) { super(c, a); this.name = String(a[0] ?? ''); this.idx = 0; this.setIO(2, 0); }
  m_float(f) {
    const t = this.rt.tables.get(this.name);
    if (!t) return this.rt.error(`tabwrite: ${this.name}: no such array`, this);
    let i = Math.trunc(this.idx); if (i < 0) i = 0; if (i >= t.length) i = t.length - 1;
    t[i] = f;
  }
  m_set(s) { this.name = String(s); }
  m_list(...a) { if (a.length > 1) this.idx = num(a[1]); this.m_float(num(a[0])); }
  in1(s, a) { if (s === 'float') this.idx = a[0]; }
}
def('tabwrite', TabWrite);

// ------------------------------------------------------------ poly
class Poly extends PdObject {
  constructor(c, a) {
    super(c, a);
    this.n = Math.max(1, num(a[0], 1)); this.steal = num(a[1]);
    this.voices = Array.from({ length: this.n }, () => ({ pitch: 0, used: false, serial: 0 }));
    this.serial = 0; this.vel = 0; this.setIO(2, 3);
  }
  in1(s, a) { if (s === 'float') this.vel = a[0]; }
  m_list(...a) { if (a.length > 1) this.vel = num(a[1]); this.m_float(num(a[0])); }
  m_float(f) {
    if (this.vel > 0) {
      let first = null, firstSerial = Infinity, oldest = null, oldestSerial = Infinity;
      this.voices.forEach((v, k) => {
        if (!v.used && v.serial < firstSerial) { first = k; firstSerial = v.serial; }
        if (v.used && v.serial < oldestSerial) { oldest = k; oldestSerial = v.serial; }
      });
      if (first !== null) {
        const v = this.voices[first]; v.pitch = f; v.used = true; v.serial = this.serial++;
        this.outFloat(2, this.vel); this.outFloat(1, f); this.outFloat(0, first + 1);
      } else if (oldest !== null && this.steal) {
        const v = this.voices[oldest];
        this.outFloat(2, 0); this.outFloat(1, v.pitch); this.outFloat(0, oldest + 1);
        v.pitch = f; v.serial = this.serial++;
        this.outFloat(2, this.vel); this.outFloat(1, f); this.outFloat(0, oldest + 1);
      }
    } else {
      let best = null, bs = Infinity;
      this.voices.forEach((v, k) => { if (v.used && v.pitch === f && v.serial < bs) { best = k; bs = v.serial; } });
      if (best !== null) {
        const v = this.voices[best]; v.used = false; v.serial = this.serial++;
        this.outFloat(2, 0); this.outFloat(1, v.pitch); this.outFloat(0, best + 1);
      }
    }
  }
  m_stop() { this.voices.forEach((v, k) => { if (v.used) { this.outFloat(2, 0); this.outFloat(1, v.pitch); this.outFloat(0, k + 1); v.used = false; } }); }
  m_clear() { this.voices.forEach(v => { v.used = false; }); }
}
def('poly', Poly);

// ------------------------------------------------------------ GUI objects (control behaviour)
class GuiBase extends PdObject {
  bindNames(snd, rcv) {
    this.sendName = nonEmpty(snd) ? String(snd) : null;
    this.rcvName = nonEmpty(rcv) ? String(rcv) : null;
    if (this.rcvName) this.rt.bind(this.rcvName, this);
  }
  onReceive(sel, args) { this.inlet0(sel, args); }
  emit(sel, args) {
    this.out(0, sel, args);
    if (this.sendName && this.sendName !== this.rcvName) this.rt.send(this.sendName, sel, args);
  }
}

class Bng extends GuiBase {
  // bng size hold interrupt init send receive label ...
  constructor(c, a) { super(c, a); this.setIO(this.hasRcv(a) ? 0 : 1, 1); this.bindNames(a[4], a[5]); this.init = num(a[3]); }
  hasRcv(a) { return nonEmpty(a[5]); }
  inlet0(sel) { if (sel === 'set') return; this.emit('bang', []); }
  loadbang() { if (this.init) this.emit('bang', []); }
}
def('bng', Bng);

class Tgl extends GuiBase {
  // tgl size init send receive label x y font fs bg fg lbl value nonzero
  constructor(c, a) {
    super(c, a); this.setIO(nonEmpty(a[3]) ? 0 : 1, 1); this.bindNames(a[2], a[3]);
    this.init = num(a[1]); this.val = num(a[12]); this.nonzero = num(a[13], 1) || 1;
    if (!this.init) this.val = 0;
  }
  m_bang() { this.val = this.val ? 0 : this.nonzero; this.emit('float', [this.val]); }
  m_float(f) { this.val = f; if (f) this.nonzero = f; this.emit('float', [f]); }
  m_set(f) { this.val = num(f); }
  m_nonzero(f) { this.nonzero = num(f, 1); }
  loadbang() { if (this.init) this.emit('float', [this.val]); }
}
def('tgl toggle', Tgl);

class Slider extends GuiBase {
  // hsl w h min max log init send receive label x y font fs bg fg lbl default steady
  constructor(c, a) {
    super(c, a); this.setIO(nonEmpty(a[7]) ? 0 : 1, 1); this.bindNames(a[6], a[7]);
    this.min = num(a[2]); this.max = num(a[3], 127); this.init = num(a[5]);
    const w = (this.constructor.cls === 'vsl' ? num(a[1], 128) : num(a[0], 128));
    const pos = num(a[15]);
    this.val = this.min + (this.max - this.min) * (pos / 100) / Math.max(1, w - 1);
  }
  clip(f) { const lo = Math.min(this.min, this.max), hi = Math.max(this.min, this.max); return f < lo ? lo : f > hi ? hi : f; }
  m_float(f) { this.val = this.clip(f); this.emit('float', [this.val]); }
  m_bang() { this.emit('float', [this.val]); }
  m_set(f) { this.val = this.clip(num(f)); }
  m_range(lo, hi) { this.min = num(lo); this.max = num(hi); }
  loadbang() { if (this.init) this.emit('float', [this.val]); }
}
def('hsl', Slider);
class VSlider extends Slider {}
def('vsl', VSlider);

class Nbx extends GuiBase {
  // nbx width height min max log init send receive label x y font fs bg fg lbl value log_height
  constructor(c, a) { super(c, a); this.setIO(nonEmpty(a[7]) ? 0 : 1, 1); this.bindNames(a[6], a[7]); this.min = num(a[2]); this.max = num(a[3]); this.init = num(a[5]); this.val = num(a[15]); }
  clip(f) { return (this.min === 0 && this.max === 0) ? f : Math.min(this.max, Math.max(this.min, f)); }
  m_float(f) { this.val = this.clip(f); this.emit('float', [this.val]); }
  m_bang() { this.emit('float', [this.val]); }
  m_set(f) { this.val = num(f); }
  loadbang() { if (this.init) this.emit('float', [this.val]); }
}
def('nbx', Nbx);

class FloatAtom extends GuiBase {
  // floatatom width min max labelpos label receive send
  constructor(c, a) {
    super(c, a);
    this.min = +a[1] || 0; this.max = +a[2] || 0; this.val = 0;
    this.setIO(nonEmpty(a[5]) ? 0 : 1, nonEmpty(a[6]) ? 0 : 1);
    this.bindNames(a[6], a[5]);
    if (!this.outs.length) this.outs.push([]);
  }
  clip(f) { return (this.min === 0 && this.max === 0) ? f : Math.min(this.max, Math.max(this.min, f)); }
  m_float(f) { this.val = this.clip(f); this.emit('float', [this.val]); }
  m_bang() { this.emit('float', [this.val]); }
  m_set(f) { this.val = num(f); }
  m_symbol() {}
  m_list(...a) { if (a.length && isNum(a[0])) this.m_float(a[0]); }
}
FloatAtom.cls = 'floatatom';
C.__floatatom = FloatAtom;

class SymbolAtom extends GuiBase {
  constructor(c, a) { super(c, a); this.val = 'symbol'; this.setIO(nonEmpty(a[5]) ? 0 : 1, nonEmpty(a[6]) ? 0 : 1); this.bindNames(a[6], a[5]); if (!this.outs.length) this.outs.push([]); }
  m_symbol(s) { this.val = s; this.emit('symbol', [s]); }
  m_bang() { this.emit('symbol', [this.val]); }
  m_set(s) { this.val = s; }
  m_anything(sel) { this.m_symbol(sel); }
}
SymbolAtom.cls = 'symbolatom';
C.__symbolatom = SymbolAtom;

// canvases with no function in control logic
class Cnv extends PdObject { constructor(c, a) { super(c, a); this.setIO(1, 0); } inlet0() {} }
def('cnv', Cnv);

export const vanillaClasses = C;
