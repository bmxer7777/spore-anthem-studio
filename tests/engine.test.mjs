// Engine tests on small hand-written Pd patches (no Spore data needed).
// run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, PdObject, fnv, hex8 } from '../app/engine/runtime.js';
import { vanillaClasses } from '../app/engine/vanilla.js';
import { eaClasses } from '../app/engine/ea.js';
import { parsePatch } from '../app/engine/pdparse.js';
import { NullBackend } from '../app/engine/nullbackend.js';
import { SoundBank } from '../app/engine/sounds.js';

// [sink name]: records every message it receives
function makeRuntime(patches, { samples = {}, instruments = {} } = {}) {
  const log = [];
  class Sink extends PdObject {
    constructor(c, a) { super(c, a); this.name = String(a[0] ?? 'sink'); this.setIO(4, 0); }
    receive(i, sel, args) { log.push([this.name, i, sel, ...args]); }
  }
  const backend = new NullBackend(new SoundBank(samples, instruments));
  const errors = [];
  const rt = new Runtime({ patches, classes: { ...vanillaClasses, ...eaClasses, sink: Sink }, backend,
    log: (lvl, m) => { if (lvl === 'error') errors.push(m); } });
  backend.attach(rt);
  return { rt, log, backend, errors };
}
const P = lines => lines.join(';\n') + ';\n';
const open = (patch, extra = {}, opts) => {
  const ctx = makeRuntime({ root: patch, ...extra }, opts);
  ctx.canvas = ctx.rt.open('root');
  return ctx;
};

test('parser keeps Pd object numbering, escapes and #C coll data', () => {
  const p = parsePatch(P(['#N canvas 0 0 100 100 12', '#X obj 10 10 f 3', '#X text 1 1 a comment', '#X msg 1 1 set \\$1 \\, bang',
    '#X obj 1 1 coll 2 2', '#C list 0 reversing 0.4 2000', '#X connect 0 0 2 0']));
  assert.equal(p.items.length, 4);
  assert.equal(p.items[1].kind, 'text');
  assert.deepEqual(p.items[2].atoms.map(a => (typeof a === 'object' ? (a.dollar || a.sep) : a)), ['set', '$1', ',', 'bang']);
  assert.deepEqual(p.items[3].coll, [[0, 'reversing', 0.4, 2000]]);
});

test('trigger fires right to left; fan-out follows connection order', () => {
  const { log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 loadbang', '#X obj 0 0 t b f s', '#X obj 0 0 sink a',
    '#X obj 0 0 sink b', '#X obj 0 0 sink c', '#X msg 0 0 7',
    '#X connect 0 0 5 0', '#X connect 5 0 1 0', '#X connect 1 0 2 0', '#X connect 1 1 3 0', '#X connect 1 2 4 0']));
  assert.deepEqual(log.map(l => l[0]), ['c', 'b', 'a']);
  assert.deepEqual(log[1], ['b', 0, 'float', 7]);
  assert.deepEqual(log[0], ['c', 0, 'symbol', 'float']);
});

test('EA gate: data on the left, open/close on the right', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r in', '#X obj 0 0 r ctl', '#X obj 0 0 gate 2', '#X obj 0 0 sink out1', '#X obj 0 0 sink out2',
    '#X connect 0 0 2 0', '#X connect 1 0 2 1', '#X connect 2 0 3 0', '#X connect 2 1 4 0']));
  rt.send('in', 'float', [1]);             // closed
  rt.send('ctl', 'float', [2]);
  rt.send('in', 'float', [2]);             // -> outlet 2
  rt.send('ctl', 'float', [1]);
  rt.send('in', 'float', [3]);             // -> outlet 1
  assert.deepEqual(log, [['out2', 0, 'float', 2], ['out1', 0, 'float', 3]]);
});

test('route and select', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r in', '#X obj 0 0 route startplayer stopplayer', '#X obj 0 0 sink start',
    '#X obj 0 0 sink rest', '#X obj 0 0 r n', '#X obj 0 0 sel 1 3', '#X obj 0 0 sink one', '#X obj 0 0 sink other',
    '#X connect 0 0 1 0', '#X connect 1 0 2 0', '#X connect 1 2 3 0', '#X connect 4 0 5 0', '#X connect 5 0 6 0', '#X connect 5 2 7 0']));
  rt.send('in', 'startplayer', [2]);
  rt.send('in', 'volume', [5]);
  rt.send('n', 'float', [1]);
  rt.send('n', 'float', [9]);
  assert.deepEqual(log, [['start', 0, 'float', 2], ['rest', 0, 'volume', 5], ['one', 0, 'bang'], ['other', 0, 'float', 9]]);
});

test('delay and metro run on the logical clock', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 loadbang', '#X obj 0 0 metro 250', '#X obj 0 0 del 600', '#X obj 0 0 sink tick',
    '#X obj 0 0 sink done', '#X msg 0 0 stop', '#X connect 0 0 1 0', '#X connect 0 0 2 0', '#X connect 1 0 3 0', '#X connect 2 0 4 0', '#X connect 2 0 5 0', '#X connect 5 0 1 0']));
  rt.sched.advance(1000);
  assert.equal(log.filter(l => l[0] === 'tick').length, 3);   // t = 0, 250, 500
  assert.deepEqual(log.at(-1), ['done', 0, 'bang']);
});

test('message box expands $1 and ; sends to receivers', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r in', '#X msg 0 0 use \\$1 \\; other 5', '#X obj 0 0 sink out', '#X obj 0 0 r other', '#X obj 0 0 sink o2',
    '#X connect 0 0 1 0', '#X connect 1 0 2 0', '#X connect 3 0 4 0']));
  rt.send('in', 'symbol', ['guitar']);
  assert.deepEqual(log, [['out', 0, 'use', 'guitar'], ['o2', 0, 'float', 5]]);
});

test('abstractions: $1 args, unique $0, inlets ordered by x position', () => {
  const abs = P(['#N canvas 0 0 100 100 12', '#X obj 200 0 inlet', '#X obj 10 0 inlet', '#X obj 0 50 pack f f', '#X obj 0 90 outlet',
    '#X obj 0 0 loadbang', '#X msg 0 0 \\$1', '#X obj 0 0 s \\$0-x', '#X obj 0 0 r \\$0-x', '#X obj 0 0 outlet',
    '#X connect 1 0 2 0', '#X connect 0 0 2 1', '#X connect 2 0 3 0', '#X obj 0 0 f \\$1', '#X connect 4 0 9 0', '#X connect 9 0 6 0', '#X connect 7 0 8 0']);
  const root = P(['#N canvas 0 0 100 100 12', '#X obj 0 0 myabs 11', '#X obj 0 0 myabs 22', '#X obj 0 0 sink a', '#X obj 0 0 sink b', '#X obj 0 0 r go',
    '#X connect 0 1 2 0', '#X connect 1 1 3 0', '#X connect 4 0 0 0', '#X connect 0 0 2 1']);
  const { rt, log } = open(root, { [hex8(fnv('myabs'))]: abs });
  // each instance echoed its own $1 through its own $0 channel only
  assert.deepEqual(log.filter(l => l[1] === 0), [['a', 0, 'float', 11], ['b', 0, 'float', 22]]);
  log.length = 0;
  rt.send('go', 'float', [5]);   // into leftmost inlet (x=10), the hot pack inlet
  assert.deepEqual(log, [['a', 1, 'list', 5, 0]]);
});

test('coll lookup outputs rows as messages; collread nth/length on named colls', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r k', '#X obj 0 0 coll 20 3', '#C list 0 reversing 0.4 2000', '#C list 1 ice_floe 0.5 2500',
    '#X obj 0 0 sink row', '#X obj 0 0 coll scales', '#C list 1 0 2 4 5 7 9 11', '#X obj 0 0 r q', '#X obj 0 0 collread scales', '#X obj 0 0 sink deg',
    '#X connect 0 0 1 0', '#X connect 1 0 2 0', '#X connect 4 0 5 0', '#X connect 5 0 6 0']));
  rt.send('k', 'float', [1]);
  rt.send('q', 'nth', [1, 5]);
  rt.send('q', 'length', [1]);
  assert.deepEqual(log, [['row', 0, 'ice_floe', 0.5, 2500], ['deg', 0, 'float', 7], ['deg', 0, 'float', 7]]);
});

test('function interpolates between normalized breakpoints', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r x', '#X obj 0 0 function 200 100 3549 0 4080 0 190 0 1 0 0 0.5 0 1 1',
    '#X obj 0 0 sink y', '#X connect 0 0 1 0', '#X connect 1 0 2 0']));
  for (const x of [0, 95, 142.5, 190]) rt.send('x', 'float', [x]);
  assert.deepEqual(log.map(l => +l[3].toFixed(3)), [0, 0, 0.5, 1]);
});

test('gfparam, dplay groups and sendgame drive the backend', () => {
  const samples = { [hex8(fnv('loop_a'))]: { name: 'loop_a', url: '', rate: 1000, frames: 2000, channels: 1, loopStart: null },
                    [hex8(fnv('loop_b'))]: { name: 'loop_b', url: '', rate: 1000, frames: 2000, channels: 1, loopStart: null } };
  const { rt, backend, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 group beats loop_a loop_b', '#X obj 0 0 gfparam pick',
    '#X msg 0 0 use beats \\, startselect \\$1', '#X obj 0 0 dplay 1', '#X obj 0 0 sendgame done', '#X obj 0 0 sink ended',
    '#X connect 1 0 2 0', '#X connect 2 0 3 0', '#X connect 3 0 5 0']), {}, { samples });
  const game = [];
  rt.onGame((n, v) => game.push(n));
  rt.setGameParam('pick', 1);
  rt.sched.advance(500);
  rt.setGameParam('pick', 0);          // one voice: steals loop_b
  rt.sched.advance(5000);
  const ev = backend.events.map(e => `${e.type}:${e.name}`);
  assert.deepEqual(ev, ['start:loop_b', 'stop:loop_b', 'start:loop_a']);
  assert.equal(log.filter(l => l[0] === 'ended').length, 2);     // "done" bang for both voices
});

test('logical and/or return 0/1 like Pd', () => {
  const { rt, log } = open(P(['#N canvas 0 0 100 100 12', '#X obj 0 0 r x', '#X obj 0 0 && 4', '#X obj 0 0 sink out', '#X connect 0 0 1 0', '#X connect 1 0 2 0']));
  rt.send('x', 'float', [1]);
  assert.deepEqual(log, [['out', 0, 'float', 1]]);
});
