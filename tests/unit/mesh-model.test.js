import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshToModel, cleanName } from '../../src/models/mesh-model.js';
import { MAX_PARTS } from '../../src/models/core.js';
import { parseGltf } from '../../src/models/gltf.js';
import { makeGlb, cube, QUAD } from './fixtures/make-glb.js';

const N = 6000;
const meshesOf = (spec) => parseGltf(makeGlb(spec)).meshes;
const cubeMesh = (h = 0.5) => ({ name: 'cube', primitives: [cube(h)] });

const threeParts = () => meshesOf({
  meshes: [cubeMesh()],
  nodes: [
    { name: 'Body', mesh: 0, scale: [2, 1, 1] },
    { name: 'left_wheel.001', mesh: 0, translation: [-1, -1, 0], scale: [0.4, 0.4, 0.4] },
    { name: 'RightWheel', mesh: 0, translation: [1, -1, 0], scale: [0.4, 0.4, 0.4] },
  ],
});

function partCounts(model) {
  const counts = new Array(model.parts.length).fill(0);
  for (let k = 0; k < model.target.length / 4; k++) counts[model.target[k * 4 + 3]]++;
  return counts;
}

function maxRadius(model) {
  let r = 0;
  for (let k = 0; k < model.target.length / 4; k++) {
    r = Math.max(r, Math.hypot(model.target[k * 4], model.target[k * 4 + 1], model.target[k * 4 + 2]));
  }
  return r;
}

test('cleanName makes file names readable', () => {
  assert.equal(cleanName('left_wheel.001'), 'Left wheel');
  assert.equal(cleanName('GEAR-BOX'), 'Gear box');
  assert.equal(cleanName('RightWheel'), 'Right wheel');
  assert.equal(cleanName('  '), 'Part');
  assert.equal(cleanName('Piston 2'), 'Piston 2');
});

test('a mesh model follows every model rule', () => {
  const a = meshToModel(threeParts(), null, N);
  const b = meshToModel(threeParts(), null, N);
  assert.equal(a.target.length, N * 4);
  assert.deepEqual(a.target, b.target, 'deterministic');
  assert.ok(a.parts.length <= MAX_PARTS);
  assert.ok(partCounts(a).every((c) => c > 0), 'every part used');
  assert.ok(a.target.every(Number.isFinite));
  const r = maxRadius(a);
  assert.ok(r > 0.5 && r < 1.8, `max radius ${r}`);
  for (const p of a.parts) {
    assert.ok(p.info.length > 20);
    assert.equal(p.color.length, 3);
    assert.ok(p.dir.every(Number.isFinite) && Math.hypot(...p.dir) > 0);
  }
  assert.deepEqual(a.parts.map((p) => p.name), ['Body', 'Left wheel', 'Right wheel']);
  assert.equal(a.name, 'Your model');
});

test('groups by top-level node, descending when there is only one', () => {
  const meshes = meshesOf({
    meshes: [cubeMesh()],
    nodes: [
      { name: 'Assembly', children: [1, 2] },
      { name: 'A', children: [3], translation: [-1, 0, 0] },
      { name: 'B', mesh: 0, translation: [1, 0, 0] },
      { name: 'A bolt', mesh: 0, scale: [0.2, 0.2, 0.2] },
    ],
  });
  assert.deepEqual(meshToModel(meshes, null, N).parts.map((p) => p.name), ['A', 'B']);
});

test('a single mesh is split into regions', () => {
  const meshes = meshesOf({ meshes: [cubeMesh()], nodes: [{ name: 'Blob', mesh: 0 }] });
  const m = meshToModel(meshes, null, N);
  assert.ok(m.parts.length >= 2 && m.parts.length <= 6, `${m.parts.length} parts`);
  m.parts.forEach((p, i) => assert.equal(p.name, `Region ${i + 1}`));
  assert.ok(partCounts(m).every((c) => c > 0));
});

test('more than 12 parts are merged down to 12, smallest first', () => {
  const nodes = [];
  for (let i = 0; i < 20; i++) {
    const big = i < 12;
    nodes.push({ name: `${big ? 'Big' : 'Small'} ${i}`, mesh: 0, translation: [(i % 5) * 2, Math.floor(i / 5) * 2, 0], scale: big ? [1, 1, 1] : [0.1, 0.1, 0.1] });
  }
  const m = meshToModel(meshesOf({ meshes: [cubeMesh()], nodes }), null, N);
  assert.equal(m.parts.length, 12);
  assert.ok(m.parts.every((p) => p.name.startsWith('Big')), m.parts.map((p) => p.name).join(', '));
});

test('tiny parts still get enough particles to see', () => {
  const meshes = meshesOf({
    meshes: [cubeMesh()],
    nodes: [{ name: 'Hull', mesh: 0, scale: [10, 10, 10] }, { name: 'Screw', mesh: 0, translation: [6, 0, 0], scale: [0.1, 0.1, 0.1] }],
  });
  const m = meshToModel(meshes, null, N);
  assert.ok(partCounts(m)[1] >= Math.ceil(0.015 * N), `screw got ${partCounts(m)[1]}`);
});

test('the details file sets the title, text, colours, directions and groups', () => {
  const details = {
    name: 'Toy car',
    blurb: 'A little car.',
    credit: 'Model by someone (CC BY 4.0)',
    rotation: [0, 90, 0],
    parts: {
      Wheels: { merge: ['Left wheel', 'RightWheel'], info: 'Four wheels that turn on axles.', color: '#ff0000', dir: [0, -1, 0], spread: 0.5 },
      Body: { info: 'The shell that holds everything together.' },
    },
  };
  const m = meshToModel(threeParts(), details, N);
  assert.equal(m.name, 'Toy car');
  assert.equal(m.blurb, 'A little car.');
  assert.equal(m.credit, 'Model by someone (CC BY 4.0)');
  assert.deepEqual(m.parts.map((p) => p.name).sort(), ['Body', 'Wheels']);
  const wheels = m.parts.find((p) => p.name === 'Wheels');
  assert.equal(wheels.info, 'Four wheels that turn on axles.');
  assert.deepEqual(wheels.color, [1, 0, 0]);
  assert.deepEqual(wheels.dir, [0, -1, 0]);
  assert.equal(wheels.spread, 0.5);
  assert.equal(m.parts.find((p) => p.name === 'Body').info, 'The shell that holds everything together.');
  // Rotated 90° about y: the body (long along x) is now long along z.
  let xs = 0, zs = 0;
  for (let k = 0; k < N; k++) {
    if (m.parts[m.target[k * 4 + 3]].name !== 'Body') continue;
    xs = Math.max(xs, Math.abs(m.target[k * 4])); zs = Math.max(zs, Math.abs(m.target[k * 4 + 2]));
  }
  assert.ok(zs > xs * 1.5, `x ${xs} z ${zs}`);
});

test('parts sharing the model centre still fly apart', () => {
  const meshes = meshesOf({
    meshes: [cubeMesh(0.5), cubeMesh(1)],
    nodes: [{ name: 'Inner', mesh: 0 }, { name: 'Outer', mesh: 1 }],
  });
  const m = meshToModel(meshes, null, N);
  for (const p of m.parts) assert.ok(p.dir.every(Number.isFinite) && Math.hypot(...p.dir) > 0.1, p.name);
  assert.notDeepEqual(m.parts[0].dir, m.parts[1].dir);
});

test('colours come from materials unless they are near black or white', () => {
  const meshes = meshesOf({
    meshes: [{ name: 'a', primitives: [{ ...QUAD, material: 0 }] }, { name: 'b', primitives: [{ ...QUAD, material: 1 }] }],
    nodes: [{ name: 'Blue', mesh: 0 }, { name: 'White', mesh: 1, translation: [2, 0, 0] }],
    materials: [{ name: 'blue', color: [0.1, 0.3, 0.9, 1] }, { name: 'white', color: [1, 1, 1, 1] }],
  });
  const m = meshToModel(meshes, null, N);
  assert.deepEqual(m.parts[0].color.map((c) => +c.toFixed(2)), [0.1, 0.3, 0.9]);
  assert.notDeepEqual(m.parts[1].color, [1, 1, 1]);
});

test('builds 200k particles from 100k triangles in under 1500 ms', () => {
  const tri = new Float32Array(100_000 * 9);
  for (let i = 0; i < 100_000; i++) {
    const x = (i % 400) / 100, y = Math.floor(i / 400) / 100;
    tri.set([x, y, 0, x + 0.01, y, 0, x, y + 0.01, 0.01], i * 9);
  }
  const meshes = [
    { name: 'Left', path: ['Left'], triangles: tri.slice(0, 450_000), color: null },
    { name: 'Right', path: ['Right'], triangles: tri.slice(450_000), color: null },
  ];
  const t0 = performance.now();
  const m = meshToModel(meshes, null, 200_000);
  const ms = performance.now() - t0;
  assert.equal(m.target.length, 800_000);
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms`);
});
