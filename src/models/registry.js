// The list of models the app shows, in order. Two kinds of entry:
//   { type: 'procedural', def }  a model written in code (see procedural/ and template.js)
//   { type: 'mesh', ... }        a 3D file turned into particles
// To add a model, add one line here.
import { mulberry32 } from './geometry.js';
import { finishModel } from './core.js';
import saturn from './procedural/saturn.js';
import heart from './procedural/heart.js';
import dna from './procedural/dna.js';
import tower from './procedural/tower.js';
import atom from './procedural/atom.js';
import galaxy from './procedural/galaxy.js';
import engine from './procedural/engine.js';

export { MAX_PARTS, EXPLODE_GAIN, partUniforms, finishModel } from './core.js';
export { allocate, mulberry32 } from './geometry.js';

/** The models written in code, in the order they appear. */
export const MODELS = [saturn, heart, dna, tower, atom, galaxy, engine];

export const ENTRIES = MODELS.map((def) => ({ type: 'procedural', def }));

const wrap = (index) => ((index % ENTRIES.length) + ENTRIES.length) % ENTRIES.length;

export const entryCount = () => ENTRIES.length;

export function entryName(index) {
  const e = ENTRIES[wrap(index)];
  return e.type === 'procedural' ? e.def.name : e.name;
}

/** Build a procedural model into `n` particles. Same index and seed always give the same cloud. */
export function buildModel(index, n, seed = 1337) {
  const i = wrap(index);
  const e = ENTRIES[i];
  if (e.type !== 'procedural') throw new Error(`${entryName(i)} is a 3D file; use loadModel()`);
  const rng = mulberry32(seed + i * 7919);
  const pts = e.def.build(n, rng);
  if (pts.length !== n) throw new Error(`${e.def.name} produced ${pts.length} points, expected ${n}`);
  return finishModel(e.def, pts, rng);
}
