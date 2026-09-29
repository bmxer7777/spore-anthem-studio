// Headless run of Spore's city-music patch. Prints errors, missing objects and the
// resulting sound timeline.  usage: node tools/test_engine.mjs [seconds]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, AnthemEngine } from '../app/engine/engine.js';
import { NullBackend } from '../app/engine/nullbackend.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = f => JSON.parse(fs.readFileSync(path.join(root, 'app/data', f), 'utf8'));
const secs = +(process.argv[2] || 40);

const logs = [];
const backend = new NullBackend(null);
const { rt } = createRuntime({
  patches: load('patches.json'), samples: load('samples.json'), instruments: load('instruments.json'),
  backend, log: (lvl, msg) => logs.push(`${lvl}: ${msg}`),
});
const eng = new AnthemEngine(rt);
const game = [];
eng.on((name, v, t) => game.push({ t, name, v }));
eng.open();
rt.sched.advance(100);

eng.setVolumes({ ambience: 1, rhythm: 1, melody: 1 });
eng.setBeat(1);
eng.startAmbience(1, 3);
eng.setMelody([{ pitch: 60, duration: 1 }, { pitch: 64, duration: 1 }, { pitch: 67, duration: 2 }, { pitch: 72, duration: 4 }]);
eng.setInstrument(3);
eng.setLoop(1);
eng.playMelody(0);
rt.sched.advance(secs * 1000);

const uniq = [...new Set(logs)];
console.log('--- log (' + logs.length + ' lines, ' + uniq.length + ' unique)');
for (const l of uniq.slice(0, 40)) console.log(l);
console.log('--- missing classes:', [...rt.missing].join(', ') || 'none');
console.log('--- missing sounds:', [...backend.missing.entries()].map(([k, n]) => `${k}x${n}`).join(', ') || 'none');
console.log('--- game messages:', game.length);
for (const g of game.slice(0, 20)) console.log(`${(g.t / 1000).toFixed(3)}s ${g.name} ${g.v}`);
console.log('--- sound events:', backend.events.length);
for (const e of backend.events.filter(e => e.type !== 'gain').slice(0, 60)) {
  console.log(`${(e.t / 1000).toFixed(3)}s ${e.type} ${e.name}${e.sample ? ' -> ' + e.sample : ''}${e.note !== undefined ? ' note=' + e.note + ' dur=' + e.dur : ''}${e.bus ? ' bus=' + e.bus : ''}${e.gain !== undefined ? ' gain=' + (+e.gain).toFixed(3) : ''}${e.fade !== undefined ? ' fade=' + e.fade : ''}`);
}
