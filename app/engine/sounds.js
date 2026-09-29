// Resolve a dplay sound name into what should actually play.
import { fnv, hex8 } from './runtime.js';

export class SoundBank {
  constructor(samples, instruments) {
    this.samples = samples;         // hex -> {url, rate, frames, channels, loopStart, name}
    this.instruments = instruments; // hex -> {name, zones}
  }
  resolve(name, p) {
    const h = hex8(fnv(String(name)));
    const inst = this.instruments[h];
    if (inst) {
      const note = p.note, vel = p.velocity;
      const zone = inst.zones.find(z => note >= z.lokey && note <= z.hikey && vel >= z.lovel && vel <= z.hivel)
        || inst.zones.find(z => note >= z.lokey && note <= z.hikey)
        || nearest(inst.zones, note);
      if (!zone) return null;
      const s = this.samples[zone.sample];
      if (!s) return null;
      return { kind: 'inst', inst, zone, sample: s, sampleId: zone.sample,
               rate: Math.pow(2, (note - zone.root) / 12) };
    }
    const s = this.samples[h];
    if (s) return { kind: 'sample', sample: s, sampleId: h, rate: 1 };
    return null;
  }
}

function nearest(zones, note) {
  let best = null, d = Infinity;
  for (const z of zones) { const dd = Math.abs(z.root - note); if (dd < d) { d = dd; best = z; } }
  return best;
}

// Envelope/duration rules for instrument notes (EA sampler definition):
//   attack, hold, decay: seconds; sustainDb: attenuation (0 = full level); release: seconds
//   The note is held for noteduration ms, then released.
export function noteTimes(res, p) {
  const z = res.zone;
  const sampleSecs = res.sample.frames / res.sample.rate / (res.rate * (p.pitch || 1));
  const looped = res.sample.loopStart !== null && res.sample.loopStart !== undefined;
  const hold = p.duration > 0 ? p.duration / 1000 : sampleSecs;
  const natural = looped ? Infinity : sampleSecs;
  const releaseAt = Math.min(hold, natural);
  const end = Math.min(natural, releaseAt + z.release);
  return { releaseAt, end, looped };
}
