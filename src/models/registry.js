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

/**
 * Every model in the app.
 *   { type: 'procedural', def }
 *   { type: 'mesh', name, url, details }     a bundled 3D file; details is the URL of its .json (optional)
 *   { type: 'mesh', name, buffer, dropped }  a file someone dropped on the page
 */
export const ENTRIES = [
  ...MODELS.map((def) => ({ type: 'procedural', def })),
];

/** Add a model; a dropped file with the same name as an earlier one replaces it. Returns its index. */
export function addEntry(entry) {
  if (entry.dropped) {
    const same = ENTRIES.findIndex((e) => e.dropped && e.name === entry.name);
    if (same >= 0) { ENTRIES[same] = entry; return same; }
  }
  ENTRIES.push(entry);
  return ENTRIES.length - 1;
}

const wrap = (index) => ((index % ENTRIES.length) + ENTRIES.length) % ENTRIES.length;

export const entryCount = () => ENTRIES.length;

export function entryName(index) {
  const e = ENTRIES[wrap(index)];
  return e.type === 'procedural' ? e.def.name : e.name;
}

export const isProcedural = (index) => ENTRIES[wrap(index)].type === 'procedural';

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

/**
 * Load any model. Procedural models build straight away; 3D files are fetched,
 * read and sampled in a worker (in the browser) so the page never freezes.
 * Rejects with an Error whose `code` matches GltfError codes when a file can't be used.
 */
export async function loadModel(index, n, seed = 1337) {
  const i = wrap(index);
  const e = ENTRIES[i];
  if (e.type === 'procedural') return buildModel(i, n, seed);

  const [buffer, details] = await Promise.all([
    e.buffer ? e.buffer.slice(0) : fetchBuffer(e.url),
    typeof e.details === 'string' ? fetchJson(e.details) : e.details ?? null,
  ]);
  const job = { buffer, details, n, seed: seed + i * 7919, name: e.name };
  return typeof Worker === 'undefined' ? buildMeshHere(job) : buildMeshInWorker(job);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error(`Couldn't load ${url} (${res.status})`), { code: 'fetch' });
  return res.arrayBuffer();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function buildMeshHere({ buffer, details, n, seed, name }) {
  const [{ parseGltf }, { meshToModel }] = await Promise.all([import('./gltf.js'), import('./mesh-model.js')]);
  return meshToModel(parseGltf(buffer).meshes, details, n, seed, name);
}

let worker = null;
let jobs = 0;
const pending = new Map();

function buildMeshInWorker(job) {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p.reject(Object.assign(new Error(data.error.message), { code: data.error.code }));
      else p.resolve(data.model);
    };
    worker.onerror = (ev) => {
      for (const p of pending.values()) p.reject(Object.assign(new Error(ev.message || 'The model worker failed'), { code: 'worker' }));
      pending.clear();
    };
  }
  const id = ++jobs;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, ...job }, [job.buffer]);
  });
}
