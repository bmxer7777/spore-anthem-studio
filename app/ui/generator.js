// "Generate new anthem" / "Randomize your music".
//
// Spore's generator is compiled game code (SporeApp.exe, DRM-wrapped, not examined).
// This reconstruction uses the game's own tuning data from "playercitymusic":
//   - note count drawn from noteCountWeights (index = number of notes)
//   - a Markov walk over the 7 scale degrees using the transition table
//     (row order as listed in SporeApp.exe's data; each row has a zero on its own
//     degree, i.e. the game never repeats a scale degree)
//   - pitches kept between minPitch and maxPitch (two octaves of C major)
// Rhythm choice is not described by the data we can read; durations are drawn from
// the editor's range with a bias toward quarter/eighth notes. Marked as an assumption.

export function weightedPick(weights, rnd = Math.random) {
  const tot = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (tot <= 0) return 0;
  let r = rnd() * tot;
  for (let k = 0; k < weights.length; k++) { r -= Math.max(0, weights[k]); if (r < 0) return k; }
  return weights.length - 1;
}

export function generateMelody(t, rnd = Math.random) {
  const n = Math.max(1, Math.min(t.maxNotes, weightedPick(t.noteCountWeights, rnd)));
  const degreesPitches = [];
  let degree = 0;
  let prev = t.basePitch + (rnd() < 0.5 ? 0 : 12);
  const notes = [];
  const DUR = [0.25, 0.5, 1, 2, 4];
  const DUR_W = [0.1, 0.3, 0.4, 0.15, 0.05];   // assumption (see header)
  for (let i = 0; i < n; i++) {
    const pc = t.scale[degree];
    // choose the octave placement closest to the previous note, within range
    let best = null;
    for (let base = t.minPitch - 12; base <= t.maxPitch + 12; base += 12) {
      const p = base - ((base - t.basePitch) % 12 + 12) % 12 + pc;
      if (p < t.minPitch || p > t.maxPitch) continue;
      if (best === null || Math.abs(p - prev) < Math.abs(best - prev)) best = p;
    }
    if (best === null) best = t.basePitch + pc;
    notes.push({ pitch: best, duration: i === n - 1 ? 2 : DUR[weightedPick(DUR_W, rnd)] });
    prev = best;
    degreesPitches.push(degree);
    const row = t.transitions[degree] || t.transitions[0];
    degree = weightedPick(row, rnd);
  }
  return notes;
}

export function randomizeAll(t, state, rnd = Math.random) {
  const count = 1 + Math.floor(rnd() * 4);
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  const amb = [];
  while (amb.length < count) amb.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return {
    ...state,
    beat: 1 + Math.floor(rnd() * 10),
    instrument: 1 + Math.floor(rnd() * 10),
    ambience: amb,
    notes: generateMelody(t, rnd),
  };
}
