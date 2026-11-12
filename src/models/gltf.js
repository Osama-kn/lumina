// A small glTF 2.0 reader: just enough to turn a .glb (or a .gltf with embedded
// data) into named triangle meshes in world space. No textures, animation or
// compression; those files are refused with a reason a person can act on.
// Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html

export class GltfError extends Error {
  /** @param {'not-gltf'|'compressed'|'external-buffer'|'no-triangles'|'too-large'} code */
  constructor(code, message) {
    super(message);
    this.name = 'GltfError';
    this.code = code;
  }
}

const GLB_MAGIC = 0x46546c67;    // 'glTF'
const CHUNK_JSON = 0x4e4f534a;   // 'JSON'
const CHUNK_BIN = 0x004e4942;    // 'BIN\0'
const COMPRESSED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'];
const TRIANGLES = 4;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const READERS = {
  5120: [1, (dv, o) => dv.getInt8(o), (v) => Math.max(v / 127, -1)],
  5121: [1, (dv, o) => dv.getUint8(o), (v) => v / 255],
  5122: [2, (dv, o) => dv.getInt16(o, true), (v) => Math.max(v / 32767, -1)],
  5123: [2, (dv, o) => dv.getUint16(o, true), (v) => v / 65535],
  5125: [4, (dv, o) => dv.getUint32(o, true), (v) => v],
  5126: [4, (dv, o) => dv.getFloat32(o, true), (v) => v],
};

/**
 * @param {ArrayBuffer | string} data  a .glb, or the text (or bytes) of a .gltf
 * @param {{maxTriangles?: number}} [opts]
 * @returns {{meshes: Array<{name:string, path:string[], triangles:Float32Array, color:number[]|null}>, warnings:string[]}}
 */
export function parseGltf(data, { maxTriangles = 5_000_000 } = {}) {
  const { json, bin } = readContainer(data);
  if (!json || typeof json !== 'object' || !json.asset || !Array.isArray(json.meshes)) {
    throw new GltfError('not-gltf', "That file isn't a 3D model Lumina can read.");
  }
  const required = json.extensionsRequired ?? [];
  if (required.some((e) => COMPRESSED.includes(e))) {
    throw new GltfError('compressed', 'This model is compressed (Draco or Meshopt).');
  }
  const warnings = required
    .filter((e) => e !== 'KHR_mesh_quantization')
    .map((e) => `Ignoring required extension ${e}`);

  const buffers = (json.buffers ?? []).map((b, i) => loadBuffer(b, i, bin));
  const nodes = json.nodes ?? [];

  // Count first, so a huge file is refused before any big allocation.
  const roots = sceneRoots(json);
  let total = 0;
  walk(nodes, roots, (node) => {
    for (const p of json.meshes[node.mesh]?.primitives ?? []) {
      if ((p.mode ?? TRIANGLES) !== TRIANGLES) continue;
      const acc = json.accessors?.[p.indices ?? p.attributes?.POSITION];
      total += Math.floor((acc?.count ?? 0) / 3);
    }
  });
  if (total > maxTriangles) {
    throw new GltfError('too-large', `This model has ${total.toLocaleString('en')} triangles; the limit is ${maxTriangles.toLocaleString('en')}.`);
  }

  const meshes = [];
  let unnamed = 0;
  walk(nodes, roots, (node, matrix, path) => {
    const mesh = json.meshes[node.mesh];
    unnamed++;
    const prims = (mesh?.primitives ?? [])
      .filter((p) => (p.mode ?? TRIANGLES) === TRIANGLES && p.attributes?.POSITION !== undefined);
    const max = prims.reduce((s, p) => s + Math.floor(json.accessors[p.indices ?? p.attributes.POSITION].count / 3), 0);
    const out = new Float32Array(max * 9);
    let used = 0;
    let color = null;
    for (const p of prims) {
      const pos = readAccessor(json, buffers, p.attributes.POSITION);
      const idx = p.indices !== undefined ? readAccessor(json, buffers, p.indices) : null;
      used = appendTriangles(out, used, pos, idx, matrix);
      if (color === null) color = materialColor(json, p.material);
    }
    if (!used) return;
    const name = node.name || mesh.name || `Part ${unnamed}`;
    meshes.push({ name, path: [...path.slice(0, -1), name], triangles: out.slice(0, used), color });
  });

  if (!meshes.length) throw new GltfError('no-triangles', 'This model has no surfaces to turn into particles.');
  return { meshes, warnings };
}

function readContainer(data) {
  if (typeof data === 'string') return { json: parseJson(data), bin: null };
  const bytes = new Uint8Array(data);
  const dv = new DataView(data);
  if (bytes.byteLength >= 12 && dv.getUint32(0, true) === GLB_MAGIC) {
    let json = null, bin = null;
    for (let o = 12; o + 8 <= bytes.byteLength;) {
      const len = dv.getUint32(o, true), type = dv.getUint32(o + 4, true);
      const chunk = bytes.subarray(o + 8, o + 8 + len);
      if (type === CHUNK_JSON) json = parseJson(new TextDecoder().decode(chunk));
      else if (type === CHUNK_BIN && !bin) bin = chunk;
      o += 8 + len;
    }
    return { json, bin };
  }
  // Maybe the bytes of a .gltf text file.
  let i = 0;
  while (i < bytes.length && i < 64 && bytes[i] <= 0x20) i++;
  if (bytes[i] === 0x7b) return { json: parseJson(new TextDecoder().decode(bytes)), bin: null };
  return { json: null, bin: null };
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function loadBuffer(buffer, index, bin) {
  if (buffer.uri === undefined) {
    if (index === 0 && bin) return bin;
    throw new GltfError('not-gltf', 'This model is missing its data.');
  }
  const m = /^data:[^,]*;base64,(.*)$/s.exec(buffer.uri);
  if (!m) throw new GltfError('external-buffer', 'This .gltf keeps its data in separate files.');
  const raw = atob(m[1]);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sceneRoots(json) {
  const scene = json.scenes?.[json.scene ?? 0];
  if (scene?.nodes) return scene.nodes;
  const children = new Set((json.nodes ?? []).flatMap((n) => n.children ?? []));
  return (json.nodes ?? []).map((_, i) => i).filter((i) => !children.has(i));
}

/** Depth-first over the node tree; visit(node, worldMatrix, namePath) for nodes with a mesh. */
function walk(nodes, roots, visit) {
  const seen = new Set();
  const go = (i, parent, path) => {
    const node = nodes[i];
    if (!node || seen.has(i)) return; // a cycle would be invalid; don't loop forever
    seen.add(i);
    const m = mul4(parent, localMatrix(node));
    const p = [...path, node.name || `node ${i}`];
    if (node.mesh !== undefined) visit(node, m, p);
    for (const c of node.children ?? []) go(c, m, p);
    seen.delete(i);
  };
  for (const r of roots) go(r, IDENTITY, []);
}

function readAccessor(json, buffers, index) {
  const acc = json.accessors[index];
  const comps = COMPONENTS[acc.type] ?? 1;
  const out = new Float64Array(acc.count * comps);
  if (acc.bufferView === undefined) return { data: out, comps };
  const view = json.bufferViews[acc.bufferView];
  const buf = buffers[view.buffer];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const [size, read, norm] = READERS[acc.componentType];
  const stride = view.byteStride || size * comps;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < comps; k++) {
      const v = read(dv, base + i * stride + k * size);
      out[i * comps + k] = acc.normalized ? norm(v) : v;
    }
  }
  return { data: out, comps };
}

/** Writes world-space triangles into out from offset `used`; returns the new offset. */
function appendTriangles(out, used, pos, idx, m) {
  const p = pos.data;
  const count = idx ? idx.data.length : p.length / 3;
  const v = new Float64Array(9);
  for (let t = 0; t + 2 < count; t += 3) {
    let ok = true;
    for (let c = 0; c < 3; c++) {
      const j = (idx ? idx.data[t + c] : t + c) * 3;
      const x = p[j], y = p[j + 1], z = p[j + 2];
      v[c * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
      v[c * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
      v[c * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    for (let k = 0; k < 9; k++) if (!Number.isFinite(v[k])) ok = false;
    if (!ok) continue;
    const ax = v[3] - v[0], ay = v[4] - v[1], az = v[5] - v[2];
    const bx = v[6] - v[0], by = v[7] - v[1], bz = v[8] - v[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz <= 1e-24) continue;
    out.set(v, used);
    used += 9;
  }
  return used;
}

function materialColor(json, index) {
  const f = json.materials?.[index]?.pbrMetallicRoughness?.baseColorFactor;
  return Array.isArray(f) && f.length >= 3 ? [f[0], f[1], f[2]] : null;
}

// ── 4×4 column-major matrices, as glTF stores them ──
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function localMatrix(node) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  // T · R · S
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function mul4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}
