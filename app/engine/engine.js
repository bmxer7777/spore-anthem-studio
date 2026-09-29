// Spore anthem engine: runs Spore's own city-music patch and drives it the way the
// game's City Planner (Music tab) does, through the same game parameters.
import { Runtime } from './runtime.js';
import { vanillaClasses } from './vanilla.js';
import { eaClasses } from './ea.js';
import { SoundBank } from './sounds.js';

export const CITY_MUSIC_PATCH = '5293d931';

export function createRuntime({ patches, samples, instruments, backend, log }) {
  const bank = new SoundBank(samples, instruments);
  if (backend.setBank) backend.setBank(bank); else backend.bank = bank;
  const rt = new Runtime({ patches, classes: { ...vanillaClasses, ...eaClasses }, backend, log });
  backend.attach(rt);
  return { rt, bank };
}

// High-level controller mirroring the Music tab's game-side calls.
export class AnthemEngine {
  constructor(rt) {
    this.rt = rt;
    this.canvas = null;
    this.listeners = new Set();
    rt.onGame((name, value, t) => { for (const f of this.listeners) f(name, value, t); });
  }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  p(name, v) { this.rt.setGameParam(name, v); }
  open() {
    this.canvas = this.rt.open(CITY_MUSIC_PATCH);
    // We are in the City Planner.
    this.p('@gain', 1);
    this.p('mixmode_cityplanner', 1);
    this.p('mixmode_assetbrowser', 0);
    this.p('npc_city_distance', 190);   // no NPC city nearby: no ducking
    return this;
  }
  // Beat: 1..10 (0 = none)
  setBeat(id) {
    if (this.beat) this.p('city_music_rhythm_stop', this.beat);
    this.beat = id;
    if (id) this.p('city_music_rhythm_start', id);
  }
  // Ambience: up to 4 layers. The game selects the sound (1..20) with
  // city_music_ambi_note, then starts/stops a player slot (1..4).
  startAmbience(slot, id) { this.p('city_music_ambi_note', id); this.p('city_music_ambi_start', slot); }
  stopAmbience(slot) { this.p('city_music_ambi_stop', slot); }
  // Volumes 0..1 (UI sliders)
  setVolumes({ ambience, rhythm, melody }) {
    if (ambience !== undefined) this.p('city_music_ambi_gain', ambience);
    if (rhythm !== undefined) this.p('city_music_rhythm_gain', rhythm);
    if (melody !== undefined) this.p('city_music_melody_gain', melody);
  }
  // Melody: notes = [{pitch: midi, duration: beat units}], instrument 1..10
  setMelody(notes) {
    this.p('city_music_melody_num_notes', notes.length);
    notes.forEach((n, i) => {
      this.p('city_music_melody_note_id', i);
      this.p('city_music_melody_note_pitch', n.pitch);
      this.p('city_music_melody_note_duration', n.duration);
    });
  }
  setInstrument(id) {
    if (this.instrument) this.p('city_music_melody_inst_stop', this.instrument);
    this.instrument = id;
    if (id) this.p('city_music_melody_inst_start', id);
  }
  setLoop(on) { this.p('city_music_melody_loop', on ? 1 : 0); }
  // value = index of the note to start from (the Music tab's Play sends 0)
  playMelody(fromNote = 0) { this.p('city_music_melody_play', fromNote); }
  playNote(i) { this.p('city_music_melody_play_note', i); }
}
