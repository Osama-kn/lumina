// Writes tiny glTF files for tests, so no binary fixtures live in the repo.
//
// makeGlb({
//   meshes: [{ name, primitives: [{ positions: [x,y,z, ...], indices?: [...], material?, mode? }] }],
//   nodes:  [{ name, mesh?, translation?, rotation?, scale?, matrix?, children? }],
//   materials?: [{ name, color: [r,g,b,a] }],
//   extensionsRequired?: string[],
//   quantized?: true        // store positions as normalised int16 (KHR_mesh_quantization)
//   format?: 'glb' | 'gltf' // 'gltf' returns a JSON string with an embedded data: URI buffer
//   externalUri?: string    // 'gltf' only: point the buffer at an external file instead
// })

export function makeGlb({ meshes, nodes, materials = [], extensionsRequired = [], quantized = false,
  format = 'glb', externalUri = null }) {
  const chunks = [];
  let offset = 0;
  const bufferViews = [];
  const accessors = [];

  const pushView = (bytes) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); offset += pad; }
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    chunks.push(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    offset += bytes.byteLength;
    return bufferViews.length - 1;
  };

  const gltfMeshes = meshes.map((m) => ({
    name: m.name,
    primitives: m.primitives.map((p) => {
      const count = p.positions.length / 3;
      const min = [0, 1, 2].map((k) => Math.min(...p.positions.filter((_, i) => i % 3 === k)));
      const max = [0, 1, 2].map((k) => Math.max(...p.positions.filter((_, i) => i % 3 === k)));
      let view, componentType, normalized;
      if (quantized) {
        // int16 VEC3 needs 4-byte alignment per element: pad each vertex to 8 bytes.
        const q = new Int16Array(count * 4);
        for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
          q[i * 4 + k] = Math.round(Math.max(-1, Math.min(1, p.positions[i * 3 + k])) * 32767);
        }
        view = pushView(q);
        bufferViews[view].byteStride = 8;
        componentType = 5122; normalized = true;
      } else {
        view = pushView(new Float32Array(p.positions));
        componentType = 5126; normalized = undefined;
      }
      accessors.push({ bufferView: view, componentType, normalized, count, type: 'VEC3', min, max });
      const prim = { attributes: { POSITION: accessors.length - 1 } };
      if (p.indices) {
        const iv = pushView(new Uint16Array(p.indices));
        accessors.push({ bufferView: iv, componentType: 5123, count: p.indices.length, type: 'SCALAR' });
        prim.indices = accessors.length - 1;
      }
      if (p.material !== undefined) prim.material = p.material;
      if (p.mode !== undefined) prim.mode = p.mode;
      return prim;
    }),
  }));

  const bin = new Uint8Array(offset + ((4 - (offset % 4)) % 4));
  let o = 0;
  for (const c of chunks) { bin.set(c, o); o += c.byteLength; }

  const childSet = new Set(nodes.flatMap((n) => n.children ?? []));
  const json = {
    asset: { version: '2.0', generator: 'lumina tests' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i).filter((i) => !childSet.has(i)) }],
    nodes,
    meshes: gltfMeshes,
    materials: materials.map((m) => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: m.color } })),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
  };
  const used = [...extensionsRequired, ...(quantized ? ['KHR_mesh_quantization'] : [])];
  if (used.length) { json.extensionsUsed = used; json.extensionsRequired = used; }

  if (format === 'gltf') {
    json.buffers[0].uri = externalUri ?? `data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`;
    return JSON.stringify(json);
  }

  let text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.byteLength % 4)) % 4;
  const jsonChunk = new Uint8Array(text.byteLength + jsonPad).fill(0x20);
  jsonChunk.set(text);
  const total = 12 + 8 + jsonChunk.byteLength + 8 + bin.byteLength;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsonChunk.byteLength, true); dv.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(out, 20, jsonChunk.byteLength).set(jsonChunk);
  const b = 20 + jsonChunk.byteLength;
  dv.setUint32(b, bin.byteLength, true); dv.setUint32(b + 4, 0x004e4942, true);
  new Uint8Array(out, b + 8, bin.byteLength).set(bin);
  return out;
}

/** A unit square in the XY plane at z = 0, as two triangles. */
export const QUAD = { positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3] };

/** An axis-aligned cube of half-size h centred at c, as 12 triangles. */
export function cube(h = 0.5, c = [0, 0, 0]) {
  const v = [];
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) v.push(c[0] + x, c[1] + y, c[2] + z);
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const indices = faces.flatMap(([a, b, c2, d]) => [a, b, c2, a, c2, d]);
  return { positions: v, indices };
}
