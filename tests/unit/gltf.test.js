import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGltf, GltfError } from '../../src/models/gltf.js';
import { makeGlb, QUAD } from './fixtures/make-glb.js';

const ys = (tri) => Array.from(tri).filter((_, i) => i % 3 === 1);
const code = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof GltfError, `not a GltfError: ${e}`); return e.code; }
  assert.fail('did not throw');
};

test('reads two named nodes with transforms', () => {
  const glb = makeGlb({
    meshes: [{ name: 'quad', primitives: [QUAD] }],
    nodes: [{ name: 'Base', mesh: 0 }, { name: 'Lid', mesh: 0, translation: [0, 2, 0] }],
  });
  const { meshes } = parseGltf(glb);
  assert.deepEqual(meshes.map((m) => m.name), ['Base', 'Lid']);
  assert.equal(meshes[0].triangles.length, 18);
  assert.ok(ys(meshes[1].triangles).every((y) => y >= 2));
});

test('applies parent transforms and records the node path', () => {
  const glb = makeGlb({
    meshes: [{ name: 'quad', primitives: [QUAD] }],
    nodes: [{ name: 'Lid', children: [1], translation: [0, 10, 0] }, { name: 'Bolt', mesh: 0, scale: [2, 2, 2] }],
  });
  const [bolt] = parseGltf(glb).meshes;
  assert.deepEqual(bolt.path, ['Lid', 'Bolt']);
  assert.equal(Math.max(...ys(bolt.triangles)), 12);
  assert.equal(Math.min(...ys(bolt.triangles)), 10);
});

test('applies rotations', () => {
  const s = Math.SQRT1_2; // 90° about z: x becomes y
  const glb = makeGlb({
    meshes: [{ name: 'quad', primitives: [QUAD] }],
    nodes: [{ name: 'Turned', mesh: 0, rotation: [0, 0, s, s] }],
  });
  const t = parseGltf(glb).meshes[0].triangles;
  // vertex (1,0,0) becomes (0,1,0)
  assert.ok(Math.abs(t[3]) < 1e-6 && Math.abs(t[4] - 1) < 1e-6);
});

test('reads every primitive and every instance of a shared mesh', () => {
  const glb = makeGlb({
    meshes: [{ name: 'two', primitives: [QUAD, { positions: [0, 0, 1, 1, 0, 1, 0, 1, 1] }] }],
    nodes: [0, 1, 2].map((i) => ({ name: `Copy ${i}`, mesh: 0, translation: [i * 3, 0, 0] })),
  });
  const { meshes } = parseGltf(glb);
  assert.equal(meshes.length, 3);
  for (const m of meshes) assert.equal(m.triangles.length / 9, 3);
});

test('decodes normalised int16 positions', () => {
  const glb = makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }], quantized: true });
  const t = parseGltf(glb).meshes[0].triangles;
  const want = [0, 0, 0, 1, 0, 0, 1, 1, 0];
  want.forEach((v, i) => assert.ok(Math.abs(t[i] - v) < 1e-4, `${t[i]} vs ${v}`));
});

test('reads the material base colour', () => {
  const glb = makeGlb({
    meshes: [{ name: 'q', primitives: [{ ...QUAD, material: 0 }] }],
    nodes: [{ name: 'Red', mesh: 0 }],
    materials: [{ name: 'red', color: [1, 0, 0, 1] }],
  });
  assert.deepEqual(parseGltf(glb).meshes[0].color, [1, 0, 0]);
});

test('names fall back to the mesh name, then a number', () => {
  const glb = makeGlb({ meshes: [{ name: 'Wheel', primitives: [QUAD] }, { primitives: [QUAD] }], nodes: [{ mesh: 0 }, { mesh: 1 }] });
  assert.deepEqual(parseGltf(glb).meshes.map((m) => m.name), ['Wheel', 'Part 2']);
});

test('drops zero-area and non-finite triangles', () => {
  const glb = makeGlb({
    meshes: [{ name: 'q', primitives: [{ positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, NaN, 1, 0, 1, 1, 1] }] }],
    nodes: [{ name: 'Q', mesh: 0 }],
  });
  const t = parseGltf(glb).meshes[0].triangles;
  assert.equal(t.length, 9);
  assert.ok(t.every(Number.isFinite));
});

test('a file with only degenerate triangles has nothing to show', () => {
  const glb = makeGlb({ meshes: [{ name: 'flat', primitives: [{ positions: [0, 0, 0, 1, 0, 0, 2, 0, 0] }] }], nodes: [{ name: 'F', mesh: 0 }] });
  assert.equal(code(() => parseGltf(glb)), 'no-triangles');
});

test('points and lines are not triangles', () => {
  const glb = makeGlb({ meshes: [{ name: 'p', primitives: [{ ...QUAD, mode: 0 }] }], nodes: [{ name: 'P', mesh: 0 }] });
  assert.equal(code(() => parseGltf(glb)), 'no-triangles');
});

test('refuses compressed files', () => {
  for (const ext of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression']) {
    const glb = makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }], extensionsRequired: [ext] });
    assert.equal(code(() => parseGltf(glb)), 'compressed');
  }
});

test('refuses a .gltf that needs separate files', () => {
  const gltf = makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }], format: 'gltf', externalUri: 'scene.bin' });
  assert.equal(code(() => parseGltf(gltf)), 'external-buffer');
});

test('parses a .gltf with an embedded buffer, as text or bytes', () => {
  const gltf = makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }], format: 'gltf' });
  assert.equal(parseGltf(gltf).meshes[0].triangles.length, 18);
  assert.equal(parseGltf(new TextEncoder().encode(gltf).buffer).meshes[0].triangles.length, 18);
});

test('refuses things that are not glTF', () => {
  assert.equal(code(() => parseGltf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer)), 'not-gltf');
  assert.equal(code(() => parseGltf(new ArrayBuffer(0))), 'not-gltf');
  assert.equal(code(() => parseGltf('{"hello": 1}')), 'not-gltf');
  assert.equal(code(() => parseGltf('{ broken')), 'not-gltf');
});

test('refuses models over the triangle limit', () => {
  const glb = makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }] });
  assert.equal(code(() => parseGltf(glb, { maxTriangles: 1 })), 'too-large');
});
