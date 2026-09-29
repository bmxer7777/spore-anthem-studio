// Web Audio backend: plays what the patches ask for, sample-accurately.
// The Pd runtime runs in logical time a little ahead of the audio clock
// (LOOKAHEAD_MS); every sound is scheduled at its exact logical time.
import { noteTimes } from './sounds.js';

const LOOKAHEAD_MS = 150;
const TICK_MS = 20;

// Mix bus tree from Spore's bus definitions (Spore_Audio1/PatchData type 0x02c9eff2):
// city_music_*_submix -> all_submix -> master
const BUS_PARENT = { all_submix: 'master' };

export class WebAudioBackend {
  constructor({ baseUrl = '../', resolveUrl } = {}) {
    this.baseUrl = baseUrl;
    this.resolveUrl = resolveUrl || (s => this.baseUrl + s.url);
    this.ctx = null;
    this.rt = null;
    this.bank = null;
    this.buffers = new Map();   // sampleId -> AudioBuffer | Promise
    this.buses = new Map();
    this.missing = new Map();
    this.onMissing = null;
    this.loadListeners = new Set();
  }
  setBank(b) { this.bank = b; }
  attach(rt) { this.rt = rt; }
  random() { return Math.random(); }

  async boot() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(this.analyser);
    this.buses.set('master', this.master);
    this.t0 = this.ctx.currentTime + 0.05 - this.rt.now / 1000;
    this.timer = setInterval(() => this.pump(), TICK_MS);
    this.pump();
  }
  pump() {
    const target = (this.ctx.currentTime - this.t0) * 1000 + LOOKAHEAD_MS;
    this.rt.sched.advance(target);
  }
  // logical ms -> AudioContext seconds
  at(ms) { return this.t0 + ms / 1000; }
  // current logical time the audio is actually at
  audioNowMs() { return (this.ctx.currentTime - this.t0) * 1000; }

  bus(name) {
    if (this.buses.has(name)) return this.buses.get(name);
    const g = this.ctx.createGain();
    const parent = BUS_PARENT[name] || (name === 'all_submix' ? 'master' : 'all_submix');
    g.connect(this.bus(parent));
    this.buses.set(name, g);
    return g;
  }
  busGain(name, t, g) { if (this.ctx) this.bus(name).gain.setTargetAtTime(g, this.at(t), 0.01); }

  // ---------------------------------------------------------------- loading
  load(sampleId) {
    const cached = this.buffers.get(sampleId);
    if (cached) return cached;
    const s = this.bank.samples[sampleId];
    if (!s) return Promise.resolve(null);
    const p = fetch(this.resolveUrl(s))
      .then(r => { if (!r.ok) throw new Error(r.status + ' ' + r.url); return r.arrayBuffer(); })
      .then(b => this.ctx.decodeAudioData(b))
      .then(buf => { this.buffers.set(sampleId, buf); for (const f of this.loadListeners) f(sampleId); return buf; })
      .catch(e => { console.error('load failed', s.name, e); this.buffers.delete(sampleId); return null; });
    this.buffers.set(sampleId, p);
    return p;
  }
  preload(ids) { return Promise.all(ids.map(id => this.load(id))); }
  isLoaded(id) { const b = this.buffers.get(id); return b && !(b instanceof Promise); }

  // ---------------------------------------------------------------- voices
  start({ time, name, params, gain, onEnd }) {
    const res = this.bank.resolve(name, params);
    if (!res) {
      this.missing.set(name, (this.missing.get(name) || 0) + 1);
      if (this.onMissing) this.onMissing(name);
      this.rt.sched.add(time, () => onEnd(time));
      return null;
    }
    const p = { ...params };
    const rate = res.rate * (p.pitch || 1);
    const sampleSecs = res.sample.frames / res.sample.rate / rate;
    let endMs, releaseMs = null;
    if (res.kind === 'inst') {
      const tt = noteTimes(res, p);
      releaseMs = Number.isFinite(tt.releaseAt) ? time + tt.releaseAt * 1000 : null;
      endMs = Number.isFinite(tt.end) ? time + tt.end * 1000 : null;
    } else {
      endMs = res.sample.loopStart != null ? null : time + sampleSecs * 1000;
    }
    const v = { name, res, p, rate, time, stopped: false, onEnd, gain, nodes: null, endEv: null };
    if (endMs !== null) v.endEv = this.rt.sched.add(endMs, () => { if (!v.stopped) { v.stopped = true; onEnd(endMs); } });
    v.releaseMs = releaseMs; v.endMs = endMs;
    if (this.ctx) this.realize(v);
    return v;
  }

  realize(v) {
    const buf = this.buffers.get(v.res.sampleId);
    if (buf && !(buf instanceof Promise)) return this.build(v, buf);
    this.load(v.res.sampleId).then(b => { if (b && !v.stopped) this.build(v, b); });
  }

  build(v, buf) {
    const ctx = this.ctx;
    const { res, p } = v;
    let when = this.at(v.time);
    let offset = 0;
    const now = ctx.currentTime;
    if (when < now) {                // late (buffer arrived after its start time): join in sync
      offset = (now - when) * v.rate;
      when = now;
      if (offset >= buf.duration && res.sample.loopStart == null) return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = v.rate;
    if (res.sample.loopStart != null) {
      src.loop = true;
      src.loopStart = res.sample.loopStart / res.sample.rate;
      src.loopEnd = buf.duration;
    }
    let node = src;
    if (p.lowpass > 0 || p.hipass > 0) {
      v.filters = [];
      if (p.hipass > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = p.hipass; node.connect(f); node = f; v.filters.push(f); }
      if (p.lowpass > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.lowpass; node.connect(f); node = f; v.filters.push(f); }
    }
    const env = ctx.createGain();
    const vg = ctx.createGain();
    vg.gain.value = this.voiceGain(v, v.gain);
    node.connect(env); env.connect(vg); vg.connect(this.bus(p.bus || 'master'));
    // envelope
    const g = env.gain;
    if (res.kind === 'inst') {
      const z = res.zone;
      const susLin = Math.pow(10, -z.sustainDb / 20);
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(1, when + Math.max(0.002, z.attack));
      let t = when + Math.max(0.002, z.attack) + z.hold;
      if (susLin < 1) { g.setValueAtTime(1, t); g.linearRampToValueAtTime(susLin, t + Math.max(0.001, z.decay)); }
      if (v.releaseMs !== null) this.release(v, v.releaseMs, z.release, env);
    } else if (p.fadein > 0) {
      g.setValueAtTime(0, when); g.linearRampToValueAtTime(1, when + p.fadein);
    } else {
      g.setValueAtTime(1, when);
    }
    src.start(when, offset % buf.duration);
    if (v.endMs !== null) src.stop(this.at(v.endMs) + 0.05);
    v.nodes = { src, env, vg };
  }

  release(v, atMs, secs, env = v.nodes && v.nodes.env) {
    if (!env) return;
    const t = Math.max(this.ctx.currentTime, this.at(atMs));
    const g = env.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, Math.max(0.005, secs / 5));   // ~ -43 dB at the release time
    try { v.nodes.src.stop(t + secs + 0.05); } catch (e) { /* already stopping */ }
  }

  voiceGain(v, g) {
    // dplay gain scaled by note velocity for instrument voices
    return v.res.kind === 'inst' ? g * (v.p.velocity / 127) : g;
  }

  stop(v, t, fade) {
    if (!v || v.stopped) return;
    v.stopped = true;
    if (v.endEv) v.endEv.dead = true;
    // Instrument voices go into their release; samples fade over `fadeout`.
    const secs = v.res.kind === 'inst' ? Math.max(fade, v.res.zone.release) : fade;
    const end = t + secs * 1000;
    this.rt.sched.add(end, () => v.onEnd(end));
    if (!this.ctx) return;
    if (v.nodes) {
      if (v.res.kind === 'inst') this.release(v, t, secs);
      else {
        const at = Math.max(this.ctx.currentTime, this.at(t));
        const g = v.nodes.env.gain;
        g.cancelScheduledValues(at);
        g.setValueAtTime(g.value, at);
        if (secs > 0) g.linearRampToValueAtTime(0, at + secs); else g.setValueAtTime(0, at + 0.003);
        try { v.nodes.src.stop(at + secs + 0.05); } catch (e) { /* noop */ }
      }
    }
  }
  setGain(v, t, g) {
    if (!v) return;
    v.gain = g;
    if (v.nodes) v.nodes.vg.gain.setTargetAtTime(this.voiceGain(v, g), Math.max(this.ctx.currentTime, this.at(t)), 0.015);
  }
  setRate(v, t, pitch) {
    if (!v) return;
    v.p.pitch = pitch; v.rate = v.res.rate * pitch;
    if (v.nodes) v.nodes.src.playbackRate.setValueAtTime(v.rate, Math.max(this.ctx.currentTime, this.at(t)));
  }
  setFilter(v, t, p) {
    if (!v || !v.filters) return;
    for (const f of v.filters) f.frequency.setTargetAtTime(f.type === 'lowpass' ? p.lowpass : p.hipass, Math.max(this.ctx.currentTime, this.at(t)), 0.01);
  }
}
