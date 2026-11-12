// Turns triangle meshes (from gltf.js) into a Lumina model: particles spread
// evenly over the surfaces, grouped into parts that fly apart.
//
// Parts come from the file's named objects. An optional details object (the
// .json next to a bundled model) adds a title, explanations, colours,
// directions, rotation, scale and hand-made groups. See docs/adding-models.md.
import { MAX_PARTS, finishModel } from './core.js';
import { mulberry32, allocate } from './geometry.js';

const MAX_REGIONS = 6;
const MIN_SHARE = 0.015;     // every part gets at least 1.5% of the particles
const FIT_RADIUS = 1.1;      // 99th-percentile radius after normalising
const MAX_RADIUS = 1.6;      // nothing may stick out further than this
const DIR_LENGTH = 0.8;      // how far parts fly by default
const DEFAULT_SPREAD = 0.25;

// Bright, distinct colours that glow well with additive blending.
const PALETTE = [
  [0.45, 0.7, 1], [1, 0.72, 0.35], [0.5, 0.95, 0.65], [1, 0.45, 0.55], [0.75, 0.55, 1], [0.35, 0.9, 0.95],
  [1, 0.9, 0.4], [1, 0.55, 0.85], [0.6, 1, 0.4], [0.55, 0.6, 1], [1, 0.6, 0.45], [0.7, 0.85, 1],
];

/** 'left_wheel.001' → 'Left wheel', 'GEAR-BOX' → 'Gear box', 'RightWheel' → 'Right wheel'. */
export function cleanName(raw) {
  const s = String(raw ?? '')
    .replace(/\.\d{3}$/, '')               // Blender's duplicate suffix
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Part';
}

const key = (s) => cleanName(s).toLowerCase();

/**
 * @param {Array<{name:string, path:string[], triangles:Float32Array, color:number[]|null}>} meshes
 * @param {object|null} details  see docs/adding-models.md
 * @param {number} n             particle count
 * @param {number} [seed]
 * @param {string} [fallbackName] title when the details don't give one (e.g. the file name)
 */
export function meshToModel(meshes, details, n, seed = 1337, fallbackName = 'Your model') {
  const d = details ?? {};
  const rng = mulberry32(seed);
  const title = d.name ?? fallbackName;

  const warnings = [];
  let groups = groupMeshes(meshes, d.parts ?? {}, warnings);
  let regions = false;
  if (groups.length === 1) {
    groups = splitIntoRegions(groups[0]);
    regions = groups.length > 1;
  }
  groups = mergeDown(groups, MAX_PARTS);

  // Sample: each part gets a share by area, with a floor so small parts stay visible.
  const floor = Math.min(Math.ceil(MIN_SHARE * n), Math.floor(n / groups.length));
  const extra = allocate(n - floor * groups.length, groups.map((g) => g.area || 1));
  const pts = [];
  groups.forEach((g, part) => samplePart(g.triangles, floor + extra[part], part, rng, pts));

  // Orient, centre and scale.
  const rot = rotationMatrix(d.rotation ?? [0, 0, 0]);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    p[0] = apply(rot, p[0]);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[0][k]); max[k] = Math.max(max[k], p[0][k]); }
  }
  const centre = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  const radii = new Float64Array(pts.length);
  pts.forEach((p, i) => {
    for (let k = 0; k < 3; k++) p[0][k] -= centre[k];
    radii[i] = Math.hypot(...p[0]);
  });
  const sorted = radii.slice().sort();
  const p99 = sorted[Math.floor(0.99 * (sorted.length - 1))] || 1;
  const s = Math.min((FIT_RADIUS * (d.scale ?? 1)) / p99, MAX_RADIUS / (sorted[sorted.length - 1] || 1));
  for (const p of pts) for (let k = 0; k < 3; k++) p[0][k] *= s;

  const usedColors = new Set();
  const parts = groups.map((g, i) => {
    const o = g.override ?? {};
    const name = g.name;
    const color = o.color ? hexColor(o.color) : pickColor(g.color, i, usedColors);
    usedColors.add(color.join());
    return {
      name,
      color,
      dir: o.dir ?? defaultDir(pts, i),
      spread: o.spread ?? DEFAULT_SPREAD,
      info: o.info ?? (regions
        ? `One region of ${title}, grouped by position.`
        : `Part of ${title}, as named in the file.`),
    };
  });

  const blurb = d.blurb ?? `${parts.length} parts from a 3D file. Open your hand to pull it apart.`;
  const model = finishModel({ name: title, blurb, parts, credit: d.credit ?? null }, pts, rng);
  model.warnings = warnings;
  return model;
}

// ── grouping ─────────────────────────────────────────────

function groupMeshes(meshes, partDetails, warnings) {
  // Hand-made groups from the details file: any node on a mesh's path can match.
  const mergeTo = new Map();
  const overrideFor = new Map();
  for (const [name, o] of Object.entries(partDetails)) {
    overrideFor.set(key(name), { name, o });
    for (const m of o.merge ?? []) mergeTo.set(key(m), name);
  }

  // Automatic groups: the shallowest level of the node tree with at least two names.
  const depth = (() => {
    const deepest = Math.max(...meshes.map((m) => m.path.length));
    for (let dd = 0; dd < deepest; dd++) {
      if (new Set(meshes.map((m) => key(m.path[Math.min(dd, m.path.length - 1)]))).size >= 2) return dd;
    }
    return 0;
  })();

  const byName = new Map();
  const usedMerges = new Set();
  for (const m of meshes) {
    const hit = [...m.path].reverse().find((p) => mergeTo.has(key(p)));
    if (hit !== undefined) usedMerges.add(key(hit));
    const manual = hit !== undefined ? mergeTo.get(key(hit)) : undefined;
    const name = manual ?? cleanName(m.path[Math.min(depth, m.path.length - 1)]);
    let g = byName.get(key(name));
    if (!g) {
      const ov = overrideFor.get(key(name));
      g = { name: ov ? ov.name : name, override: ov?.o, chunks: [], color: null, colorArea: 0 };
      byName.set(key(name), g);
    }
    g.chunks.push(m.triangles);
    const a = areaOf(m.triangles);
    if (m.color && a > g.colorArea) { g.color = m.color; g.colorArea = a; }
  }
  // A typo in the details file would otherwise do nothing, silently.
  for (const [name, o] of Object.entries(partDetails)) {
    if (!byName.has(key(name))) warnings.push(`Details part "${name}" matches nothing in the file`);
    for (const m of o.merge ?? []) {
      if (!usedMerges.has(key(m))) warnings.push(`Merge name "${m}" (in "${name}") matches nothing in the file`);
    }
  }
  return [...byName.values()].map((g) => finalizeGroup(g, concat(g.chunks)));
}

function finalizeGroup(g, triangles) {
  const { area, centroid } = measure(triangles);
  return { name: g.name, override: g.override, color: g.color, triangles, area, centroid };
}

/** A single object has nothing to pull apart, so split it into regions by position. */
function splitIntoRegions(g) {
  const tris = g.triangles;
  const count = tris.length / 9;
  const k = Math.min(MAX_REGIONS, count);
  if (k < 2) return [g];
  const cx = new Float64Array(count * 3), w = new Float64Array(count);
  for (let t = 0; t < count; t++) {
    for (let a = 0; a < 3; a++) cx[t * 3 + a] = (tris[t * 9 + a] + tris[t * 9 + 3 + a] + tris[t * 9 + 6 + a]) / 3;
    w[t] = triArea(tris, t);
  }
  // Farthest-point seeding: deterministic and spreads the regions out.
  const seeds = [];
  let first = 0, far = -1;
  for (let t = 0; t < count; t++) { const r = cx[t * 3] ** 2 + cx[t * 3 + 1] ** 2 + cx[t * 3 + 2] ** 2; if (r > far) { far = r; first = t; } }
  seeds.push([cx[first * 3], cx[first * 3 + 1], cx[first * 3 + 2]]);
  const dist = new Float64Array(count).fill(Infinity);
  while (seeds.length < k) {
    const s = seeds[seeds.length - 1];
    let best = 0, bestD = -1;
    for (let t = 0; t < count; t++) {
      dist[t] = Math.min(dist[t], (cx[t * 3] - s[0]) ** 2 + (cx[t * 3 + 1] - s[1]) ** 2 + (cx[t * 3 + 2] - s[2]) ** 2);
      if (dist[t] > bestD) { bestD = dist[t]; best = t; }
    }
    if (bestD <= 0) break;
    seeds.push([cx[best * 3], cx[best * 3 + 1], cx[best * 3 + 2]]);
  }
  const label = new Int32Array(count);
  for (let iter = 0; iter < 12; iter++) {
    for (let t = 0; t < count; t++) {
      let bi = 0, bd = Infinity;
      seeds.forEach((s, i) => {
        const dd = (cx[t * 3] - s[0]) ** 2 + (cx[t * 3 + 1] - s[1]) ** 2 + (cx[t * 3 + 2] - s[2]) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      });
      label[t] = bi;
    }
    const sum = seeds.map(() => [0, 0, 0, 0]);
    for (let t = 0; t < count; t++) {
      const s = sum[label[t]], ww = w[t] || 1e-12;
      s[0] += cx[t * 3] * ww; s[1] += cx[t * 3 + 1] * ww; s[2] += cx[t * 3 + 2] * ww; s[3] += ww;
    }
    sum.forEach((s, i) => { if (s[3] > 0) seeds[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const regions = seeds.map(() => []);
  for (let t = 0; t < count; t++) regions[label[t]].push(t);
  return regions
    .filter((r) => r.length)
    .map((r, i) => {
      const out = new Float32Array(r.length * 9);
      r.forEach((t, j) => out.set(tris.subarray(t * 9, t * 9 + 9), j * 9));
      return finalizeGroup({ name: `Region ${i + 1}`, override: g.override, color: g.color }, out);
    });
}

/** Merge the smallest group into its nearest neighbour until at most `limit` remain. */
function mergeDown(groups, limit) {
  const gs = [...groups];
  while (gs.length > limit) {
    let si = 0;
    gs.forEach((g, i) => { if (g.area < gs[si].area) si = i; });
    const small = gs[si];
    let ni = -1, nd = Infinity;
    gs.forEach((g, i) => {
      if (i === si) return;
      const dd = (g.centroid[0] - small.centroid[0]) ** 2 + (g.centroid[1] - small.centroid[1]) ** 2 + (g.centroid[2] - small.centroid[2]) ** 2;
      if (dd < nd) { nd = dd; ni = i; }
    });
    const big = gs[ni];
    gs[ni] = finalizeGroup(big, concat([big.triangles, small.triangles]));
    gs.splice(si, 1);
  }
  return gs;
}

// ── sampling ─────────────────────────────────────────────

function samplePart(tris, count, part, rng, out) {
  const t = tris.length / 9;
  const cum = new Float64Array(t);
  let acc = 0;
  for (let i = 0; i < t; i++) { acc += triArea(tris, i); cum[i] = acc; }
  for (let s = 0; s < count; s++) {
    const r = rng() * acc;
    let lo = 0, hi = t - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    const o = lo * 9;
    const su = Math.sqrt(rng()), v = rng();
    const a = 1 - su, b = su * (1 - v), c = su * v;
    out.push([[
      a * tris[o] + b * tris[o + 3] + c * tris[o + 6],
      a * tris[o + 1] + b * tris[o + 4] + c * tris[o + 7],
      a * tris[o + 2] + b * tris[o + 5] + c * tris[o + 8],
    ], part]);
  }
}

// ── part defaults ────────────────────────────────────────

function defaultDir(pts, part) {
  let sx = 0, sy = 0, sz = 0, c = 0;
  for (const [p, q] of pts) if (q === part) { sx += p[0]; sy += p[1]; sz += p[2]; c++; }
  const m = [sx / c, sy / c, sz / c];
  const l = Math.hypot(...m);
  if (l > 0.08) return m.map((v) => (v / l) * DIR_LENGTH);
  // Centred on the model (a shell around the rest): fly along the part's longest axis,
  // alternating sides so concentric parts separate.
  const axis = principalAxis(pts, part, m);
  const sign = part % 2 === 0 ? 1 : -1;
  return axis.map((v) => v * sign * DIR_LENGTH);
}

function principalAxis(pts, part, mean) {
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const [p, q] of pts) {
    if (q !== part) continue;
    const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i * 3 + j] += d[i] * d[j];
  }
  let v = [0.36, 0.8, 0.48];
  for (let it = 0; it < 30; it++) {
    const nv = [0, 1, 2].map((i) => cov[i * 3] * v[0] + cov[i * 3 + 1] * v[1] + cov[i * 3 + 2] * v[2]);
    const l = Math.hypot(...nv);
    if (!(l > 0)) break;
    v = nv.map((x) => x / l);
  }
  return v;
}

function pickColor(material, index, used) {
  if (material) {
    const [r, g, b] = material;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 0.08 && lum < 0.92 && sat > 0.15 && !used.has(material.join())) return material.slice(0, 3);
  }
  let c = PALETTE[index % PALETTE.length];
  for (let i = 0; used.has(c.join()) && i < PALETTE.length; i++) c = PALETTE[(index + i) % PALETTE.length];
  return c.slice();
}

function hexColor(h) {
  const v = parseInt(String(h).replace('#', ''), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ── small maths ──────────────────────────────────────────

function triArea(t, i) {
  const o = i * 9;
  const ax = t[o + 3] - t[o], ay = t[o + 4] - t[o + 1], az = t[o + 5] - t[o + 2];
  const bx = t[o + 6] - t[o], by = t[o + 7] - t[o + 1], bz = t[o + 8] - t[o + 2];
  return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);
}

function areaOf(tris) {
  let a = 0;
  for (let i = 0; i < tris.length / 9; i++) a += triArea(tris, i);
  return a;
}

function measure(tris) {
  let area = 0;
  const c = [0, 0, 0];
  for (let i = 0; i < tris.length / 9; i++) {
    const a = triArea(tris, i);
    area += a;
    for (let k = 0; k < 3; k++) c[k] += a * (tris[i * 9 + k] + tris[i * 9 + 3 + k] + tris[i * 9 + 6 + k]) / 3;
  }
  return { area, centroid: area > 0 ? c.map((v) => v / area) : [0, 0, 0] };
}

function concat(chunks) {
  if (chunks.length === 1) return chunks[0];
  const out = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** Rotation from Euler angles in degrees, applied x, then y, then z. */
function rotationMatrix([dx, dy, dz]) {
  const [x, y, z] = [dx, dy, dz].map((v) => (v * Math.PI) / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}

function mul3(a, b) {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}

const apply = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z, m[6] * x + m[7] * y + m[8] * z];
