// Makes a 3D file small enough to ship with Lumina. It keeps only what Lumina
// uses (named objects, their shapes, base colours), drops textures, and thins
// the triangles to a budget. 200,000 particles don't need millions of triangles.
//
//   node scripts/slim-glb.mjs in.glb out.glb [max-triangles=60000]
//   node scripts/slim-glb.mjs in.gltf out.glb      (a .gltf with a .bin beside it works too)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseGltf } from '../src/models/gltf.js';
import { mulberry32 } from '../src/models/geometry.js';

const [input, output, budgetArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/slim-glb.mjs in.glb out.glb [max-triangles=60000]');
  process.exit(1);
}
const budget = Number(budgetArg ?? 60_000);

const meshes = parseGltf(readInput(input), { maxTriangles: Infinity }).meshes;
const total = meshes.reduce((s, m) => s + m.triangles.length / 9, 0);
const keep = Math.min(1, budget / total);
const rng = mulberry32(42);

// Thin each mesh by the same ratio, but never below 200 triangles, so small parts keep their shape.
const slim = meshes.map((m) => {
  const count = m.triangles.length / 9;
  const want = Math.min(count, Math.max(200, Math.round(count * keep)));
  if (want === count) return { ...m };
  const idx = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const out = new Float32Array(want * 9);
  idx.slice(0, want).sort((a, b) => a - b).forEach((t, k) => out.set(m.triangles.subarray(t * 9, t * 9 + 9), k * 9));
  return { ...m, triangles: out };
});

const bytes = writeGlb(slim);
writeFileSync(output, Buffer.from(bytes));
const after = slim.reduce((s, m) => s + m.triangles.length / 9, 0);
console.log(`${input}: ${meshes.length} objects, ${total} → ${after} triangles, ${(bytes.byteLength / 1e6).toFixed(1)} MB`);

function readInput(file) {
  const data = readFileSync(file);
  if (!file.endsWith('.gltf')) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const json = JSON.parse(data.toString());
  for (const b of json.buffers ?? []) {
    if (b.uri && !b.uri.startsWith('data:')) {
      b.uri = `data:application/octet-stream;base64,${readFileSync(join(dirname(file), decodeURIComponent(b.uri))).toString('base64')}`;
    }
  }
  return JSON.stringify(json);
}

/** World-space triangles back into a GLB, keeping the node names as a tree so grouping still works. */
function writeGlb(list) {
  const nodes = [];
  const roots = [];
  const byPath = new Map();
  const materials = [];
  const meshesOut = [];
  const accessors = [];
  const views = [];
  const chunks = [];
  let offset = 0;

  const nodeFor = (path) => {
    const k = path.join('\u0000');
    if (byPath.has(k)) return byPath.get(k);
    const node = { name: path[path.length - 1] };
    nodes.push(node);
    const i = nodes.length - 1;
    byPath.set(k, i);
    if (path.length === 1) roots.push(i);
    else {
      const parent = nodes[nodeFor(path.slice(0, -1))];
      (parent.children ??= []).push(i);
    }
    return i;
  };

  for (const m of list) {
    const pos = m.triangles;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) { const k = i % 3; min[k] = Math.min(min[k], pos[i]); max[k] = Math.max(max[k], pos[i]); }
    views.push({ buffer: 0, byteOffset: offset, byteLength: pos.byteLength });
    chunks.push(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength));
    offset += pos.byteLength;
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max });
    const prim = { attributes: { POSITION: accessors.length - 1 } };
    if (m.color) {
      materials.push({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [...m.color, 1] } });
      prim.material = materials.length - 1;
    }
    meshesOut.push({ name: m.name, primitives: [prim] });

    // A leaf node per mesh; several meshes may share the same named parent.
    const parentPath = m.path.slice(0, -1);
    const leaf = { name: m.path[m.path.length - 1], mesh: meshesOut.length - 1 };
    nodes.push(leaf);
    const li = nodes.length - 1;
    if (parentPath.length) (nodes[nodeFor(parentPath)].children ??= []).push(li);
    else roots.push(li);
  }

  const bin = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const json = {
    asset: { version: '2.0', generator: 'Lumina slim-glb' },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    meshes: meshesOut,
    materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.byteLength }],
  };
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.byteLength / 4) * 4;
  const binLen = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen); out.set(text, 20);
  const b = 20 + jsonLen;
  dv.setUint32(b, binLen, true); dv.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  return out.buffer;
}
