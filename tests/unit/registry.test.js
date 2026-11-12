import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryCount, entryName, addEntry, loadModel, buildModel, MODELS } from '../../src/models/registry.js';
import { makeGlb, cube } from './fixtures/make-glb.js';

const glb = (y = 0) => makeGlb({
  meshes: [{ name: 'cube', primitives: [cube(0.5)] }],
  nodes: [{ name: 'Top', mesh: 0, translation: [0, 1 + y, 0] }, { name: 'Bottom', mesh: 0 }],
});

test('procedural models load through the same promise API', async () => {
  const a = await loadModel(1, 3000);
  assert.deepEqual(a.target, buildModel(1, 3000).target);
  assert.equal(entryName(0), MODELS[0].name);
});

test('a dropped file becomes a new model that loads', async () => {
  const before = entryCount();
  const i = addEntry({ type: 'mesh', name: 'Toy', buffer: glb(), dropped: true });
  assert.equal(i, before);
  assert.equal(entryCount(), before + 1);
  assert.equal(entryName(i), 'Toy');
  const m = await loadModel(i, 3000);
  assert.equal(m.name, 'Toy');
  assert.equal(m.target.length, 3000 * 4);
  assert.deepEqual(m.parts.map((p) => p.name), ['Top', 'Bottom']);
  assert.throws(() => buildModel(i, 3000), /use loadModel/);
});

test('dropping a file with the same name replaces it', async () => {
  const first = addEntry({ type: 'mesh', name: 'Again', buffer: glb(), dropped: true });
  const count = entryCount();
  const second = addEntry({ type: 'mesh', name: 'Again', buffer: glb(2), dropped: true });
  assert.equal(second, first);
  assert.equal(entryCount(), count);
});

test('a broken file rejects with a readable error', async () => {
  const i = addEntry({ type: 'mesh', name: 'Junk', buffer: new Uint8Array([1, 2, 3, 4]).buffer, dropped: true });
  await assert.rejects(loadModel(i, 1000), (e) => e.code === 'not-gltf');
});
