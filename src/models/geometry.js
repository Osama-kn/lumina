// Shared maths for procedural models: a seeded random generator, particle
// allocation, vector helpers and shapes (curves, tubes, boxes, ellipsoids).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Split n particles across parts in proportion to their weights; the counts always sum to n. */
export function allocate(n, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((n * w) / total));
  let rest = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % counts.length, rest--) counts[i]++;
  return counts;
}

// ───────────────────────────── helpers ─────────────────────────────

export function gauss(rng) {
  // Box–Muller, one value, tails capped at 2.5σ so no stray point escapes the view.
  const u = Math.max(rng(), 1e-9);
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  return Math.max(-2.5, Math.min(2.5, g));
}

export function onSphere(rng) {
  const z = rng() * 2 - 1;
  const a = rng() * TAU;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

export function rotX([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}
export function rotZ([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}
export function rotY([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => mul(a, 1 / (len(a) || 1));
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Catmull-Rom curve through pts, reparametrised by arc length so particles spread evenly along it. */
export function spline(pts) {
  const n = pts.length - 1;
  const raw = (t) => {
    const f = Math.min(n - 1e-9, Math.max(0, t * n));
    const i = Math.floor(f), u = f - i, u2 = u * u, u3 = u2 * u;
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
    return [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * u
      + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2
      + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3));
  };
  const STEPS = 120;
  const table = [0];
  let prev = raw(0);
  for (let i = 1; i <= STEPS; i++) {
    const p = raw(i / STEPS);
    table.push(table[i - 1] + len(sub(p, prev)));
    prev = p;
  }
  const total = table[STEPS];
  return (t) => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let lo = 0, hi = STEPS;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (table[m] <= d) lo = m; else hi = m;
    }
    const span = table[hi] - table[lo] || 1;
    return raw((lo + (d - table[lo]) / span) / STEPS);
  };
}

/** A random point on the skin of a tube following `curve`; `radius` is a number or a function of t. */
export function tubePoint(rng, curve, radius, t = rng()) {
  const p = curve(t);
  const a = curve(Math.max(0, t - 0.004)), b = curve(Math.min(1, t + 0.004));
  const T = norm(sub(b, a));
  const N = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const B = cross(T, N);
  const r = typeof radius === 'function' ? radius(t) : radius;
  const ang = rng() * TAU;
  return add(p, add(mul(N, Math.cos(ang) * r), mul(B, Math.sin(ang) * r)));
}

export function boxSurface(rng, c, [hx, hy, hz]) {
  const ax = hy * hz, ay = hx * hz, az = hx * hy;
  const u = rng() * (ax + ay + az);
  const s = rng() < 0.5 ? -1 : 1;
  const a = rng() * 2 - 1, b = rng() * 2 - 1;
  if (u < ax) return [c[0] + s * hx, c[1] + a * hy, c[2] + b * hz];
  if (u < ax + ay) return [c[0] + a * hx, c[1] + s * hy, c[2] + b * hz];
  return [c[0] + a * hx, c[1] + b * hy, c[2] + s * hz];
}

/** Sum of k exponentials: a Gamma(k, a) radius, the shape of hydrogen-like orbitals. */
export function gammaRadius(rng, k, a) {
  let p = 1;
  for (let i = 0; i < k; i++) p *= Math.max(rng(), 1e-9);
  return -a * Math.log(p);
}

// Ellipsoids tilted around z. The heart is a union of these.
export const ellipsoid = (c, r, ang = 0) => ({ c, r, ang });
export function ellLocal(e, p) {
  const d = rotZ(sub(p, e.c), -e.ang);
  return [d[0] / e.r[0], d[1] / e.r[1], d[2] / e.r[2]];
}
export const insideEll = (e, p, k = 1) => len(ellLocal(e, p)) < k;
export function ellSurface(e, rng, k = 1) {
  const s = onSphere(rng);
  return add(e.c, rotZ([s[0] * e.r[0] * k, s[1] * e.r[1] * k, s[2] * e.r[2] * k], e.ang));
}
export function pushOutOf(ells, p) {
  let q = p;
  for (let pass = 0; pass < 2; pass++) {
    for (const e of ells) {
      const l = ellLocal(e, q);
      const L = len(l);
      if (L < 1.02) {
        const s = 1.03 / (L || 1);
        q = add(e.c, rotZ([l[0] * s * e.r[0], l[1] * s * e.r[1], l[2] * s * e.r[2]], e.ang));
      }
    }
  }
  return q;
}
