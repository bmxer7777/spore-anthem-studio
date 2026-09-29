// Headless backend: no sound, just a timeline of what would play. Used by tests.
import { noteTimes } from './sounds.js';

export class NullBackend {
  constructor(bank, seed = 12345) {
    this.bank = bank; this.events = []; this.rt = null; this.seed = seed >>> 0; this.missing = new Map();
  }
  attach(rt) { this.rt = rt; }
  random() { // xorshift32, deterministic for tests
    let x = this.seed; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.seed = x; return x / 4294967296;
  }
  start({ time, name, params, gain, onEnd }) {
    const res = this.bank.resolve(name, params);
    if (!res) {
      this.missing.set(name, (this.missing.get(name) || 0) + 1);
      this.events.push({ t: time, type: 'missing', name });
      // a missing sound "finishes" immediately
      this.rt.sched.add(time, () => onEnd(time));
      return null;
    }
    let endMs;
    if (res.kind === 'inst') {
      const { end } = noteTimes(res, params);
      endMs = time + (Number.isFinite(end) ? end * 1000 : 3600e3);
    } else {
      endMs = time + 1000 * res.sample.frames / res.sample.rate / (params.pitch || 1);
    }
    const v = { name, res, start: time, end: endMs, stopped: false, onEnd };
    this.events.push({ t: time, type: 'start', name, sample: res.sample.name, bus: params.bus, gain,
                       note: res.kind === 'inst' ? params.note : undefined, dur: params.duration });
    v.ev = this.rt.sched.add(endMs, () => { if (!v.stopped) { v.stopped = true; onEnd(endMs); } });
    return v;
  }
  stop(v, t, fade) {
    if (!v || v.stopped) return;
    v.stopped = true; v.ev.dead = true;
    // same rule as the Web Audio backend: instrument voices go into their release
    const secs = v.res.kind === 'inst' ? Math.max(fade, v.res.zone.release) : fade;
    this.events.push({ t, type: 'stop', name: v.name, fade: secs });
    const end = t + secs * 1000;
    this.rt.sched.add(end, () => v.onEnd(end));
  }
  setGain(v, t, g) { if (v) this.events.push({ t, type: 'gain', name: v.name, gain: g }); }
  setRate() {}
  setFilter() {}
  busGain(bus, t, g) { this.events.push({ t, type: 'busgain', bus, gain: g }); }
}
