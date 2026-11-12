// Procedural models, sampled into point clouds. Each particle gets a target
// position and a part index; each part has a colour, an explode rule and a
// one-line explanation shown when the part is selected:
//   offset = explode * (dir + spread * (position - partCentre))
// so parts can both fly off in a direction and expand around their own centre.
// Deterministic for a given seed, so tests and screenshots are repeatable.

// The shaders declare uniform arrays of this size; change both together.
export const MAX_PARTS = 12;

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

const TAU = Math.PI * 2;
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** Split n particles across parts in proportion to their weights; the counts always sum to n. */
export function allocate(n, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.floor((n * w) / total));
  let rest = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % counts.length, rest--) counts[i]++;
  return counts;
}

// ───────────────────────────── helpers ─────────────────────────────

function gauss(rng) {
  // Box–Muller, one value, tails capped at 2.5σ so no stray point escapes the view.
  const u = Math.max(rng(), 1e-9);
  const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rng());
  return Math.max(-2.5, Math.min(2.5, g));
}

function onSphere(rng) {
  const z = rng() * 2 - 1;
  const a = rng() * TAU;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

function rotX([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}
function rotZ([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}
function rotY([x, y, z], a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Catmull-Rom curve through pts, reparametrised by arc length so particles spread evenly along it. */
function spline(pts) {
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
function tubePoint(rng, curve, radius, t = rng()) {
  const p = curve(t);
  const a = curve(Math.max(0, t - 0.004)), b = curve(Math.min(1, t + 0.004));
  const T = norm(sub(b, a));
  const N = norm(cross(T, Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const B = cross(T, N);
  const r = typeof radius === 'function' ? radius(t) : radius;
  const ang = rng() * TAU;
  return add(p, add(mul(N, Math.cos(ang) * r), mul(B, Math.sin(ang) * r)));
}

function boxSurface(rng, c, [hx, hy, hz]) {
  const ax = hy * hz, ay = hx * hz, az = hx * hy;
  const u = rng() * (ax + ay + az);
  const s = rng() < 0.5 ? -1 : 1;
  const a = rng() * 2 - 1, b = rng() * 2 - 1;
  if (u < ax) return [c[0] + s * hx, c[1] + a * hy, c[2] + b * hz];
  if (u < ax + ay) return [c[0] + a * hx, c[1] + s * hy, c[2] + b * hz];
  return [c[0] + a * hx, c[1] + b * hy, c[2] + s * hz];
}

/** Sum of k exponentials: a Gamma(k, a) radius, the shape of hydrogen-like orbitals. */
function gammaRadius(rng, k, a) {
  let p = 1;
  for (let i = 0; i < k; i++) p *= Math.max(rng(), 1e-9);
  return -a * Math.log(p);
}

// Ellipsoids tilted around z. The heart is a union of these.
const ellipsoid = (c, r, ang = 0) => ({ c, r, ang });
function ellLocal(e, p) {
  const d = rotZ(sub(p, e.c), -e.ang);
  return [d[0] / e.r[0], d[1] / e.r[1], d[2] / e.r[2]];
}
const insideEll = (e, p, k = 1) => len(ellLocal(e, p)) < k;
function ellSurface(e, rng, k = 1) {
  const s = onSphere(rng);
  return add(e.c, rotZ([s[0] * e.r[0] * k, s[1] * e.r[1] * k, s[2] * e.r[2] * k], e.ang));
}
function pushOutOf(ells, p) {
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

// ───────────────────────────── models ─────────────────────────────

const satView = (p) => rotZ(rotX(p, 0.42), -0.14);

// Ring radii use Saturn's real proportions (planet radius 0.5). Only the moons are moved in close.
const saturn = {
  name: 'Saturn',
  blurb: 'Its rings and moons, with ring radii to scale',
  parts: [
    { name: 'Planet', color: hex(0xffc46b), dir: [0, 0, 0], spread: 0.05,
      info: 'A ball of hydrogen and helium about nine times wider than Earth, banded by winds of up to 1,800 km/h.' },
    { name: 'Polar hexagon', color: hex(0xfff1cf), dir: satView([0, 0.95, 0]), spread: 0.3,
      info: 'A six-sided jet stream circling the north pole. Each side is longer than Earth is wide.' },
    { name: 'C ring', color: hex(0x8d8fa8), dir: satView([0, -0.25, 0]), spread: 0.08,
      info: 'A faint inner ring of darker, more thinly spread particles.' },
    { name: 'B ring', color: hex(0xfff1cf), dir: satView([0, -0.5, 0]), spread: 0.08,
      info: 'The brightest and most massive ring: water ice in chunks from sand grains to boulders.' },
    { name: 'A ring', color: hex(0x8fc4ff), dir: satView([0, -0.75, 0]), spread: 0.08,
      info: 'The outer main ring, beyond the Cassini Division. The tiny moon Pan sweeps the Encke Gap clear.' },
    { name: 'F ring', color: hex(0xc8e4ff), dir: satView([0, -1, 0]), spread: 0.08,
      info: 'A narrow, braided ring kept in place by the shepherd moons Prometheus and Pandora.' },
    { name: 'Titan', color: hex(0xffa94d), dir: satView([-0.3, 0.25, 0]), spread: 0.4,
      info: 'Saturn\'s largest moon, bigger than Mercury, with a thick orange haze and lakes of liquid methane.' },
    { name: 'Icy moons', color: hex(0xdfeaff), dir: satView([0.3, 0.25, 0]), spread: 0.3,
      info: 'Mimas with its giant crater, Rhea, and Enceladus, which sprays water into space from its south pole.' },
  ],
  build(n, rng) {
    const [planet, hexagon, c, b, a, f, titan, icy] = allocate(n, [0.36, 0.04, 0.07, 0.22, 0.15, 0.03, 0.05, 0.08]);
    const pts = [];
    const R = 0.5, FLAT = 0.9;
    const push = (p, part) => pts.push([satView(p), part]);

    for (let i = 0; i < planet;) {
      const s = onSphere(rng);
      const lat = Math.asin(s[1]);
      const band = Math.cos(lat * 14 + 0.6 * Math.sin(lat * 5));
      if (rng() > 0.5 + 0.5 * band * band) continue;
      const r = R * (0.985 + 0.015 * rng());
      push([s[0] * r, s[1] * r * FLAT, s[2] * r], 0);
      i++;
    }

    const rho0 = R * Math.sin((12 * Math.PI) / 180);
    for (let i = 0; i < hexagon; i++) {
      const ang = rng() * TAU;
      let rho;
      if (rng() < 0.8) {
        const sector = ((ang % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3);
        rho = (rho0 * Math.cos(Math.PI / 6)) / Math.cos(sector - Math.PI / 6) + (rng() - 0.5) * 0.012;
      } else {
        rho = rho0 * 0.35 * rng(); // the vortex at the pole itself
      }
      const y = Math.sqrt(Math.max(0, R * R - rho * rho)) * FLAT + 0.006;
      push([rho * Math.cos(ang), y, rho * Math.sin(ang)], 1);
    }

    const ring = (count, r0, r1, density, part) => {
      for (let i = 0; i < count;) {
        const r = Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * rng());
        if (rng() > density(r)) continue;
        const ang = rng() * TAU;
        push([r * Math.cos(ang), (rng() - 0.5) * 0.008, r * Math.sin(ang)], part);
        i++;
      }
    };
    const wave = (r, f) => { const s = Math.sin(r * f); return s * s; };
    ring(c, 0.62, 0.765, (r) => 0.35 + 0.3 * wave(r, 220), 2);
    ring(b, 0.765, 0.975, (r) => 0.65 + 0.35 * wave(r, 400), 3);
    ring(a, 1.015, 1.135, (r) => (r > 1.1 && r < 1.108 ? 0 : 0.6 + 0.4 * wave(r, 300)), 4);

    for (let i = 0; i < f; i++) {
      const ang = rng() * TAU;
      const strand = rng() < 0.5 ? 0 : Math.PI;
      const r = 1.165 + 0.005 * Math.sin(ang * 9 + strand) + (rng() - 0.5) * 0.004;
      push([r * Math.cos(ang), (rng() - 0.5) * 0.006, r * Math.sin(ang)], 5);
    }

    const moonAt = (r, ang) => [r * Math.cos(ang), 0, r * Math.sin(ang)];
    const T = moonAt(1.68, 3.9);
    for (let i = 0; i < titan; i++) {
      const s = onSphere(rng);
      const r = rng() < 0.72 ? 0.06 : 0.066 + 0.016 * rng();
      push(add(T, mul(s, r)), 6);
    }

    const moons = [
      { c: moonAt(1.27, 2.2), r: 0.018, w: 0.25 },
      { c: moonAt(1.36, -0.9), r: 0.022, w: 0.3 },
      { c: moonAt(1.5, 0.9), r: 0.032, w: 0.45 },
    ];
    const enceladus = moons[1];
    for (let i = 0; i < icy; i++) {
      const u = rng();
      if (u < 0.12) {
        // Water plume from Enceladus's south pole.
        const h = rng() * 0.1;
        const spread = 0.006 + h * 0.28;
        push(add(enceladus.c, [gauss(rng) * spread, -enceladus.r - h, gauss(rng) * spread]), 7);
        continue;
      }
      const v = (u - 0.12) / 0.88;
      const m = v < moons[0].w ? moons[0] : v < moons[0].w + moons[1].w ? moons[1] : moons[2];
      push(add(m.c, mul(onSphere(rng), m.r)), 7);
    }
    return pts;
  },
};

// Chambers and vessels in the view of a chest from the front: +x is the patient's left.
const LV = ellipsoid([0.18, -0.22, -0.08], [0.33, 0.55, 0.33], 0.5);
const RV = ellipsoid([-0.1, -0.15, 0.13], [0.35, 0.47, 0.26], 0.55);
const LA = ellipsoid([0.14, 0.3, -0.3], [0.27, 0.18, 0.2]);
const LA_APP = ellipsoid([0.38, 0.32, 0.02], [0.11, 0.07, 0.08], -0.3);
const RA = ellipsoid([-0.42, 0.16, -0.02], [0.22, 0.27, 0.22], 0.1);
const RA_APP = ellipsoid([-0.3, 0.42, 0.17], [0.13, 0.08, 0.09], 0.4);
const CHAMBERS = [LV, RV, LA, LA_APP, RA, RA_APP];

const heart = {
  name: 'Human heart',
  scale: 0.84,
  blurb: 'Four chambers and the great vessels, beating at 72 bpm',
  beat: true,
  parts: [
    { name: 'Left ventricle', color: hex(0xff2d55), dir: [0.75, -0.45, -0.2], spread: 0.08,
      info: 'The thick-walled main pump. It drives oxygen-rich blood through the aorta to the whole body.' },
    { name: 'Right ventricle', color: hex(0xff6b81), dir: [-0.65, -0.5, 0.5], spread: 0.08,
      info: 'Pumps oxygen-poor blood to the lungs. It needs far less force, so its wall is much thinner.' },
    { name: 'Left atrium', color: hex(0xff9f6b), dir: [0.6, 0.35, -0.8], spread: 0.08,
      info: 'Collects oxygen-rich blood coming back from the lungs through the four pulmonary veins.' },
    { name: 'Right atrium', color: hex(0xc06bff), dir: [-0.95, 0.25, 0.1], spread: 0.08,
      info: 'Receives oxygen-poor blood from the body. The sinoatrial node here sets the heartbeat.' },
    { name: 'Aorta', color: hex(0xff4b3a), dir: [0.3, 0.55, -0.3], spread: 0.06,
      info: 'The largest artery in the body. Its arch sends branches to the head and arms.' },
    { name: 'Pulmonary artery', color: hex(0x5c8bff), dir: [0.05, 0.36, 0.85], spread: 0.06,
      info: 'Carries blood from the right ventricle to both lungs to pick up oxygen.' },
    { name: 'Venae cavae', color: hex(0x7f6bff), dir: [-1.05, 0.05, -0.45], spread: 0.15,
      info: 'The two large veins that return blood from the upper and lower body.' },
    { name: 'Coronary arteries', color: hex(0xffd166), dir: [0.05, -0.05, 1.05], spread: 0.05,
      info: 'Small arteries on the surface that supply the heart muscle itself. Blockages here cause heart attacks.' },
  ],
  build(n, rng) {
    const [lv, rv, la, ra, aorta, pulm, cavae, coron] = allocate(n, [0.25, 0.2, 0.1, 0.11, 0.12, 0.08, 0.07, 0.07]);
    const pts = [];

    const chamber = (count, main, appendage, part, tubes = []) => {
      const own = [main, appendage].filter(Boolean);
      const others = CHAMBERS.filter((e) => !own.includes(e));
      for (let i = 0; i < count; i++) {
        let p;
        for (let tries = 0; tries < 40; tries++) {
          const u = rng();
          if (tubes.length && u < 0.18) {
            const tb = tubes[Math.floor(rng() * tubes.length)];
            p = tubePoint(rng, tb, 0.04);
          } else {
            const e = appendage && u > 0.9 ? appendage : main;
            p = ellSurface(e, rng, 0.975 + 0.025 * rng());
          }
          if (!others.some((e) => insideEll(e, p, 0.99))) break;
        }
        pts.push([p, part]);
      }
    };
    const veins = [
      spline([[0.0, 0.34, -0.36], [-0.25, 0.42, -0.42], [-0.5, 0.48, -0.45]]),
      spline([[0.02, 0.22, -0.4], [-0.25, 0.2, -0.48], [-0.5, 0.18, -0.5]]),
      spline([[0.3, 0.36, -0.36], [0.55, 0.44, -0.42], [0.75, 0.5, -0.45]]),
      spline([[0.3, 0.22, -0.4], [0.55, 0.2, -0.48], [0.75, 0.16, -0.5]]),
    ];
    chamber(lv, LV, null, 0);
    chamber(rv, RV, null, 1);
    chamber(la, LA, LA_APP, 2, veins);
    chamber(ra, RA, RA_APP, 3);

    const vessels = (count, tubes, part) => {
      const total = tubes.reduce((s, tb) => s + tb.w, 0);
      for (let i = 0; i < count; i++) {
        let p;
        for (let tries = 0; tries < 40; tries++) {
          let u = rng() * total, tb = tubes[0];
          for (const candidate of tubes) {
            if (u < candidate.w) { tb = candidate; break; }
            u -= candidate.w;
          }
          p = tubePoint(rng, tb.curve, tb.r);
          if (!CHAMBERS.some((e) => insideEll(e, p, 0.98))) break;
        }
        pts.push([p, part]);
      }
    };
    vessels(aorta, [
      { w: 1, r: 0.1, curve: spline([[0.02, 0.2, -0.02], [0, 0.55, 0], [0.05, 0.82, -0.05], [0.25, 0.9, -0.15], [0.38, 0.75, -0.25], [0.4, 0.3, -0.35], [0.38, -0.2, -0.42]]) },
      { w: 0.13, r: 0.036, curve: spline([[0.08, 0.86, -0.08], [0.02, 1.0, -0.06], [-0.02, 1.16, -0.05]]) },
      { w: 0.13, r: 0.032, curve: spline([[0.18, 0.9, -0.12], [0.18, 1.04, -0.12], [0.18, 1.18, -0.12]]) },
      { w: 0.13, r: 0.034, curve: spline([[0.28, 0.87, -0.18], [0.36, 1.0, -0.2], [0.42, 1.14, -0.22]]) },
    ], 4);
    vessels(pulm, [
      { w: 0.5, r: 0.09, curve: spline([[-0.08, 0.2, 0.22], [-0.02, 0.5, 0.22], [0.05, 0.62, 0.1]]) },
      { w: 0.3, r: 0.06, curve: spline([[0.05, 0.62, 0.1], [0.4, 0.6, -0.05], [0.62, 0.56, -0.15]]) },
      { w: 0.35, r: 0.06, curve: spline([[0.05, 0.62, 0.1], [-0.15, 0.62, -0.14], [-0.6, 0.56, -0.2]]) },
    ], 5);
    vessels(cavae, [
      { w: 0.6, r: 0.075, curve: spline([[-0.42, 0.35, -0.02], [-0.42, 0.7, -0.04], [-0.4, 1.02, -0.05]]) },
      { w: 0.4, r: 0.08, curve: spline([[-0.42, 0, -0.05], [-0.4, -0.25, -0.08], [-0.38, -0.55, -0.1]]) },
    ], 6);

    const coronaries = [
      { w: 1, r: 0.018, curve: spline([[0.05, 0.15, 0.2], [0.12, -0.1, 0.25], [0.22, -0.4, 0.2], [0.38, -0.66, 0.06]]) },
      { w: 0.8, r: 0.016, curve: spline([[0.1, 0.2, 0.1], [0.35, 0.12, 0], [0.45, 0, -0.25], [0.35, -0.12, -0.4]]) },
      { w: 0.9, r: 0.016, curve: spline([[-0.05, 0.18, 0.18], [-0.35, 0.05, 0.2], [-0.5, -0.15, 0.05], [-0.4, -0.35, -0.2]]) },
      { w: 0.3, r: 0.01, curve: spline([[0.12, -0.1, 0.25], [0.3, -0.2, 0.18], [0.5, -0.36, 0.08]]) },
      { w: 0.3, r: 0.01, curve: spline([[-0.35, 0.05, 0.2], [-0.2, -0.22, 0.32], [-0.02, -0.42, 0.3]]) },
    ];
    const totalW = coronaries.reduce((s, c) => s + c.w, 0);
    for (let i = 0; i < coron; i++) {
      let u = rng() * totalW, tb = coronaries[0];
      for (const candidate of coronaries) {
        if (u < candidate.w) { tb = candidate; break; }
        u -= candidate.w;
      }
      pts.push([pushOutOf(CHAMBERS, tubePoint(rng, tb.curve, tb.r)), 7]);
    }
    return pts;
  },
};

const dnaView = (p) => rotZ(p, 0.3);

const dna = {
  name: 'DNA double helix',
  scale: 0.8,
  blurb: 'B-form DNA, 10.5 base pairs to each turn',
  parts: [
    { name: 'Sugar backbone 1', color: hex(0x4fe3ff), dir: dnaView([-0.9, 0, 0.15]), spread: 0.1,
      info: 'A chain of deoxyribose sugars. The two strands run in opposite directions.' },
    { name: 'Sugar backbone 2', color: hex(0x6b8cff), dir: dnaView([0.9, 0, -0.15]), spread: 0.1,
      info: 'The partner strand. Its sequence is the complement of the first, so either can rebuild the other.' },
    { name: 'Phosphate groups', color: hex(0xffd166), dir: dnaView([0, 0, -0.95]), spread: 0.2,
      info: 'They link each sugar to the next and give DNA its negative charge.' },
    { name: 'Adenine (A)', color: hex(0xff5f6d), dir: dnaView([-0.4, 0.22, 0.75]), spread: 0.12,
      info: 'A purine base with two fused rings. It always pairs with thymine, through two hydrogen bonds.' },
    { name: 'Thymine (T)', color: hex(0xffb36b), dir: dnaView([0.4, 0.22, 0.75]), spread: 0.12,
      info: 'A pyrimidine base with a single ring. It pairs with adenine.' },
    { name: 'Guanine (G)', color: hex(0x5effb0), dir: dnaView([-0.4, -0.22, 0.75]), spread: 0.12,
      info: 'A purine base. It pairs with cytosine through three hydrogen bonds, a stronger link than A–T.' },
    { name: 'Cytosine (C)', color: hex(0xc6ff6b), dir: dnaView([0.4, -0.22, 0.75]), spread: 0.12,
      info: 'A pyrimidine base. It pairs with guanine.' },
    { name: 'Hydrogen bonds', color: hex(0xdfe6ff), dir: [0, 0, 0], spread: 0.35,
      info: 'Weak bonds between paired bases: strong together, but easy to unzip when DNA is copied.' },
  ],
  build(n, rng) {
    const [bb1, bb2, phos, ade, thy, gua, cyt, hb] = allocate(n, [0.15, 0.15, 0.16, 0.12, 0.1, 0.12, 0.1, 0.1]);
    const pts = [];
    const N = 32, H = 2.7, RS = 0.31, RP = 0.39, PER = 10.5, MINOR = 2.4;
    const yAt = (k) => ((k + 0.5) / N - 0.5) * H;
    const angAt = (k, strand) => (k * TAU) / PER + (strand ? MINOR : 0);
    const onHelix = (k, strand, r) => { const a = angAt(k, strand); return [r * Math.cos(a), yAt(k), r * Math.sin(a)]; };
    const sugar = (k, strand) => onHelix(k, strand, RS);
    const phosphate = (k, strand) => onHelix(k + 0.5, strand, RP);
    const j = (a) => (rng() - 0.5) * a;
    const push = (p, part) => pts.push([dnaView(p), part]);

    const PAIR = { A: 'T', T: 'A', G: 'C', C: 'G' };
    const PURINE = { A: true, G: true, T: false, C: false };
    const seq = [];
    for (let k = 0; k < N; k++) seq.push('ATGC'[Math.floor(rng() * 4)]);
    ['A', 'G', 'T', 'C'].forEach((b, i) => { seq[i * 7 + 2] = b; });
    const where = { A: [], T: [], G: [], C: [] };
    seq.forEach((b, k) => { where[b].push({ k, side: 0 }); where[PAIR[b]].push({ k, side: 1 }); });

    const polygon = (sides, rho, phase) => {
      const i = Math.floor(rng() * sides), t = rng();
      const a0 = phase + (i * TAU) / sides, a1 = phase + ((i + 1) * TAU) / sides;
      return [rho * (Math.cos(a0) + (Math.cos(a1) - Math.cos(a0)) * t), rho * (Math.sin(a0) + (Math.sin(a1) - Math.sin(a0)) * t)];
    };

    const backbone = (count, strand, part) => {
      for (let i = 0; i < count; i++) {
        const k = Math.floor(rng() * N);
        if (rng() < 0.55) {
          // Deoxyribose: a five-membered ring facing outward.
          const S = sugar(k, strand);
          const a = angAt(k, strand);
          const tangent = [-Math.sin(a), 0, Math.cos(a)];
          const [u, v] = polygon(5, 0.05, 0.3);
          const f = rng() < 0.2 ? Math.sqrt(rng()) : 1;
          push(add(S, add(mul(tangent, u * f), [j(0.008), v * f, j(0.008)])), part);
        } else {
          const m = Math.min(k, N - 2);
          const P = phosphate(m, strand);
          const from = rng() < 0.5 ? sugar(m, strand) : sugar(m + 1, strand);
          const p = lerp3(from, P, rng());
          push([p[0] + j(0.02), p[1] + j(0.02), p[2] + j(0.02)], part);
        }
      }
    };
    backbone(bb1, 0, 0);
    backbone(bb2, 1, 1);

    const OXYGENS = [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].map(norm);
    for (let i = 0; i < phos; i++) {
      const k = Math.floor(rng() * (N - 1));
      const P = phosphate(k, rng() < 0.5 ? 0 : 1);
      if (rng() < 0.55) {
        push(add(P, mul(onSphere(rng), 0.036)), 2);
      } else {
        const O = OXYGENS[Math.floor(rng() * 4)];
        push(add(add(P, mul(O, 0.058)), mul(onSphere(rng), 0.02)), 2);
      }
    }

    const pairFrame = (k) => {
      const a = sugar(k, 0), b = sugar(k, 1);
      const L = len(sub(b, a));
      const U = norm(sub(b, a));
      return { a, b, L, U, V: norm(cross([0, 1, 0], U)) };
    };
    const baseAtoms = (count, type, part) => {
      const list = where[type];
      const purine = PURINE[type];
      for (let i = 0; i < count; i++) {
        const { k, side } = list[Math.floor(rng() * list.length)];
        const f = pairFrame(k);
        const O = side === 0 ? f.a : f.b;
        const D = side === 0 ? f.U : mul(f.U, -1);
        const start = 0.1 * f.L, end = (purine ? 0.52 : 0.38) * f.L;
        const at = (du, dv) => add(add(O, mul(D, du)), add(mul(f.V, dv), [0, j(0.006), 0]));
        const u = rng();
        if (u < 0.1) {
          // The glycosidic bond from the sugar to the ring.
          push(at(start * rng(), j(0.006)), part);
          continue;
        }
        let centre, rho, sides, phase;
        if (purine) {
          const rhoHex = (end - start) * 0.31;
          const hexagon = rng() < 0.58;
          rho = hexagon ? rhoHex : rhoHex * 0.85;
          sides = hexagon ? 6 : 5;
          phase = hexagon ? 0 : Math.PI;
          centre = hexagon ? end - rhoHex : start + rho;
        } else {
          rho = (end - start) * 0.5;
          sides = 6;
          phase = 0;
          centre = start + rho;
        }
        if (u < 0.72) {
          const [du, dv] = polygon(sides, rho, phase);
          push(at(centre + du, dv), part);
        } else {
          const ang = rng() * TAU, r = rho * 0.85 * Math.sqrt(rng());
          push(at(centre + Math.cos(ang) * r, Math.sin(ang) * r), part);
        }
      }
    };
    baseAtoms(ade, 'A', 3);
    baseAtoms(thy, 'T', 4);
    baseAtoms(gua, 'G', 5);
    baseAtoms(cyt, 'C', 6);

    for (let i = 0; i < hb;) {
      const k = Math.floor(rng() * N);
      const t = rng();
      if ((t * 4) % 1 > 0.55) continue;
      const f = pairFrame(k);
      const start = PURINE[seq[k]] ? 0.52 : 0.38;
      const offsets = seq[k] === 'A' || seq[k] === 'T' ? [-0.028, 0.028] : [-0.042, 0, 0.042];
      const off = offsets[Math.floor(rng() * offsets.length)];
      const p = add(add(f.a, mul(f.U, (start + 0.1 * t) * f.L)), mul(f.V, off));
      push([p[0] + j(0.004), p[1] + j(0.004), p[2] + j(0.004)], 7);
      i++;
    }
    return pts;
  },
};

// Heights follow the real tower: floors at 57, 116 and 276 m of its 330 m.
const TY0 = -1.3, TF1 = -0.81, TF2 = -0.3, TS = 1.09;
const eiffelW = (y) => 0.05 + 0.49 * Math.exp(-1.37 * (y - TY0));
const TOWER_CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

const tower = {
  name: 'Eiffel Tower',
  scale: 0.65,
  blurb: '330 metres of wrought-iron lattice, at true proportions',
  parts: [
    { name: 'Foundations', color: hex(0xb59a7a), dir: [0, -0.35, 0], spread: 0.45,
      info: 'Four masonry piers, one under each leg. The two nearest the Seine were dug using compressed-air caissons.' },
    { name: 'Legs', color: hex(0xffa64d), dir: [0, -0.18, 0], spread: 0.55,
      info: 'Four hollow columns of riveted girders that lean inward, following the line of wind forces.' },
    { name: 'Base arches', color: hex(0xffd27a), dir: [0, -0.03, 0], spread: 0.95,
      info: 'Large arches between the legs. They carry almost no load and were added mainly for looks.' },
    { name: 'First floor', color: hex(0xfff0b8), dir: [0, 0.04, 0], spread: 0.5,
      info: '57 metres up, a square platform that ties the four legs together.' },
    { name: 'Middle section', color: hex(0xffb84d), dir: [0, 0.16, 0], spread: 0.5,
      info: 'The four columns curve steadily closer between the first and second floors.' },
    { name: 'Second floor', color: hex(0xfff0b8), dir: [0, 0.3, 0], spread: 0.5,
      info: '116 metres up, reached by 674 steps from the ground. Above it the legs merge into one shaft.' },
    { name: 'Upper tower', color: hex(0xffc069), dir: [0, 0.42, 0], spread: 0.12,
      info: 'A single tapering shaft of four corner members braced in X patterns, with lifts running up the centre.' },
    { name: 'Summit', color: hex(0xfff7e0), dir: [0, 0.56, 0], spread: 0.4,
      info: '276 metres up: the top viewing deck, Gustave Eiffel\'s small apartment and a beacon.' },
    { name: 'Antennas', color: hex(0x9ad7ff), dir: [0, 0.7, 0], spread: 0.1,
      info: 'Radio and television masts added over the years. They brought the tower to its present 330 metres.' },
  ],
  build(n, rng) {
    const [found, legs, arches, f1, mid, f2, upper, summit, ant] = allocate(n, [0.05, 0.25, 0.08, 0.08, 0.15, 0.06, 0.22, 0.06, 0.05]);
    const pts = [];
    const j = (a) => (rng() - 0.5) * a;
    const jitter = (p, a) => [p[0] + j(a), p[1] + j(a), p[2] + j(a)];

    // One point on a leg: a hollow box of four edges with X-bracing on every face.
    const legPoint = (y0, y1, s0, s1, levels, part) => {
      const c = TOWER_CORNERS[Math.floor(rng() * 4)];
      const sAt = (y) => s0 + ((s1 - s0) * (y - y0)) / (y1 - y0);
      const edge = (y, e) => {
        const s = sAt(y), w = eiffelW(y) - s;
        return [c[0] * w + TOWER_CORNERS[e][0] * s, y, c[1] * w + TOWER_CORNERS[e][1] * s];
      };
      const k = rng();
      let p;
      if (k < 0.42) {
        p = edge(y0 + (y1 - y0) * rng(), Math.floor(rng() * 4));
      } else {
        const lv = Math.floor(rng() * levels);
        const ya = y0 + ((y1 - y0) * lv) / levels, yb = y0 + ((y1 - y0) * (lv + 1)) / levels;
        const e = Math.floor(rng() * 4), e2 = (e + 1) % 4, t = rng();
        if (k < 0.85) p = rng() < 0.5 ? lerp3(edge(ya, e), edge(yb, e2), t) : lerp3(edge(yb, e), edge(ya, e2), t);
        else p = lerp3(edge(ya, e), edge(ya, e2), t);
      }
      pts.push([jitter(p, 0.006), part]);
    };
    for (let i = 0; i < legs; i++) legPoint(TY0, TF1, 0.085, 0.065, 12, 1);
    for (let i = 0; i < mid; i++) legPoint(TF1, TF2, 0.06, 0.04, 11, 4);

    for (let i = 0; i < found; i++) {
      const c = TOWER_CORNERS[Math.floor(rng() * 4)];
      const w = eiffelW(TY0) - 0.085;
      pts.push([boxSurface(rng, [c[0] * w, TY0 - 0.035, c[1] * w], [0.125, 0.035, 0.125]), 0]);
    }

    // Arches: two concentric curves on each face, tied together by short struts.
    const footY = TY0 + 0.1, peakY = TF1 - 0.03;
    const archAt = (face, t, inset) => {
      const span = eiffelW(footY) - 0.17;
      const y = footY + (peakY - footY - inset) * Math.sin(Math.PI * t);
      const across = (2 * t - 1) * span, out = (face < 2 ? 1 : -1) * (eiffelW(y) - 0.07);
      return face % 2 === 0 ? [across, y, out] : [out, y, across];
    };
    for (let i = 0; i < arches; i++) {
      const face = Math.floor(rng() * 4), t = rng(), u = rng();
      let p;
      if (u < 0.42) p = archAt(face, t, 0);
      else if (u < 0.84) p = archAt(face, t, 0.04);
      else {
        const k = Math.round(t * 20) / 20;
        p = lerp3(archAt(face, k, 0), archAt(face, k, 0.04), rng());
      }
      pts.push([jitter(p, 0.005), 2]);
    }

    // A square platform: deck ring, railing and a band of frieze below.
    const platform = (count, y, inner, outer, railH, part) => {
      for (let i = 0; i < count; i++) {
        const side = Math.floor(rng() * 4), t = rng() * 2 - 1;
        const u = rng();
        let w, h;
        if (u < 0.55) { w = inner + (outer - inner) * rng(); h = 0; }
        else if (u < 0.8) { w = outer; h = railH * (rng() < 0.5 ? 1 : rng()); }
        else { w = outer; h = -0.035 * rng(); }
        const a = t * w;
        const p = side === 0 ? [w, y + h, a] : side === 1 ? [-w, y + h, a] : side === 2 ? [a, y + h, w] : [a, y + h, -w];
        pts.push([jitter(p, 0.004), part]);
      }
    };
    const w1 = eiffelW(TF1), w2 = eiffelW(TF2);
    const pav = Math.floor(f1 * 0.25);
    platform(f1 - pav, TF1, w1 - 0.16, w1 + 0.05, 0.04, 3);
    for (let i = 0; i < pav; i++) {
      // Pavilions standing on the first-floor deck.
      const side = Math.floor(rng() * 4), a = (rng() < 0.5 ? -1 : 1) * 0.12;
      const d = w1 - 0.05;
      const c = side === 0 ? [d, TF1 + 0.04, a] : side === 1 ? [-d, TF1 + 0.04, a] : side === 2 ? [a, TF1 + 0.04, d] : [a, TF1 + 0.04, -d];
      pts.push([boxSurface(rng, c, [0.04, 0.04, 0.04]), 3]);
    }
    platform(f2, TF2, w2 - 0.08, w2 + 0.04, 0.035, 5);

    const corner = (y, c) => { const w = eiffelW(y); return [c[0] * w, y, c[1] * w]; };
    for (let i = 0; i < upper; i++) {
      const c = Math.floor(rng() * 4), u = rng();
      let p;
      if (u < 0.08) {
        p = jitter([0, TF2 + (TS - TF2) * rng(), 0], 0.03); // the lift shaft
      } else if (u < 0.45) {
        p = jitter(corner(TF2 + (TS - TF2) * rng(), TOWER_CORNERS[c]), 0.016);
      } else {
        const LV_COUNT = 16;
        const lv = Math.floor(rng() * LV_COUNT);
        const ya = TF2 + ((TS - TF2) * lv) / LV_COUNT, yb = TF2 + ((TS - TF2) * (lv + 1)) / LV_COUNT;
        const c2 = (c + 1) % 4, t = rng();
        p = rng() < 0.5
          ? lerp3(corner(ya, TOWER_CORNERS[c]), corner(yb, TOWER_CORNERS[c2]), t)
          : lerp3(corner(yb, TOWER_CORNERS[c]), corner(ya, TOWER_CORNERS[c2]), t);
        p = jitter(p, 0.006);
      }
      pts.push([p, 6]);
    }

    for (let i = 0; i < summit; i++) {
      const u = rng();
      if (u < 0.5) {
        pts.push([boxSurface(rng, [0, TS + 0.05, 0], [0.09, 0.05, 0.09]), 7]);
      } else if (u < 0.78) {
        const a = rng() * TAU;
        pts.push([[0.045 * Math.cos(a), TS + 0.1 + rng() * 0.09, 0.045 * Math.sin(a)], 7]);
      } else {
        // The dome over the beacon.
        const s = onSphere(rng);
        pts.push([[s[0] * 0.05, TS + 0.19 + Math.abs(s[1]) * 0.06, s[2] * 0.05], 7]);
      }
    }

    for (let i = 0; i < ant; i++) {
      const y = TS + 0.25 + rng() * 0.21;
      const taper = 0.022 * (1 - (y - TS - 0.25) / 0.24);
      const dish = rng() < 0.15;
      const r = dish ? 0.05 * rng() : taper * rng();
      const a = rng() * TAU;
      const yy = dish ? TS + 0.25 + Math.floor(rng() * 3) * 0.06 : y;
      pts.push([[r * Math.cos(a), yy, r * Math.sin(a)], 8]);
    }
    return pts;
  },
};

const atomView = (p) => rotY(rotX(p, 0.4), 0.5);

// Orbital shapes come from the hydrogen-like wavefunctions. Only the nucleus is
// out of scale: at true size it would be far too small to see.
const atom = {
  name: 'Carbon atom',
  blurb: 'Six protons, six neutrons and real electron orbitals',
  parts: [
    { name: 'Protons', color: hex(0xff5f6d), dir: atomView([-0.28, 0.16, 0.5]), spread: 1,
      info: 'Six positively charged particles. Having exactly six is what makes this atom carbon.' },
    { name: 'Neutrons', color: hex(0xb8c0d8), dir: atomView([0.28, -0.16, 0.5]), spread: 1,
      info: 'Six neutral particles that help bind the nucleus. Carbon-14 has eight of them and is radioactive.' },
    { name: '1s orbital', color: hex(0xffd166), dir: [0, 0, 0], spread: 0.9,
      info: 'The innermost two electrons, held tightly near the nucleus. They take no part in chemistry.' },
    { name: '2s orbital', color: hex(0x5ce1ff), dir: [0, 0, 0], spread: 0.35,
      info: 'A larger spherical cloud with a hollow shell inside it where an electron is never found.' },
    { name: '2p orbital (x)', color: hex(0xa78bfa), dir: atomView([0, 1.05, 0]), spread: 0.1,
      info: 'A dumbbell-shaped cloud with no chance of finding the electron at the centre plane.' },
    { name: '2p orbital (y)', color: hex(0x5effb0), dir: atomView([-1.05, 0, 0]), spread: 0.1,
      info: 'A second dumbbell at right angles. Carbon\'s 2s and 2p electrons mix to form its four bonds.' },
    { name: '2p orbital (z)', color: hex(0xff8ad8), dir: atomView([1, -0.4, 0]), spread: 0.1,
      info: 'The third dumbbell. In ground-state carbon only two of the three 2p orbitals hold an electron.' },
  ],
  build(n, rng) {
    const [protons, neutrons, s1, s2, px, py, pz] = allocate(n, [0.05, 0.05, 0.1, 0.16, 0.21, 0.21, 0.22]);
    const pts = [];
    const push = (p, part) => pts.push([atomView(p), part]);

    const balls = [];
    for (let tries = 0; balls.length < 12 && tries < 4000; tries++) {
      const c = mul(onSphere(rng), 0.14 * Math.cbrt(rng()));
      if (tries > 3000 || balls.every((b) => len(sub(b, c)) > 0.085)) balls.push(c);
    }
    while (balls.length < 12) balls.push(mul(onSphere(rng), 0.14));
    const nucleon = (count, offset, part) => {
      for (let i = 0; i < count; i++) {
        const b = balls[offset + (i % 6)];
        const r = 0.055 * (rng() < 0.7 ? 1 : Math.cbrt(rng()));
        push(add(b, mul(onSphere(rng), r)), part);
      }
    };
    nucleon(protons, 0, 0);
    nucleon(neutrons, 6, 1);

    for (let i = 0; i < s1;) {
      const r = gammaRadius(rng, 3, 0.06);
      if (r > 0.6) continue;
      push(mul(onSphere(rng), r), 2);
      i++;
    }

    // Each cloud is cut off at a contour of its own probability density, the way
    // orbitals are usually drawn, so that it has a readable edge.
    const A2 = 0.13, RMAX = 0.95;
    const psi2s = (r) => { const q = 2 - r / A2; return q * q * Math.exp(-r / A2); };
    const SHELL_CONTOUR = 0.35 * 4 * Math.exp(-4);
    const f2s = (r) => (r > 2 * A2 && psi2s(r) < SHELL_CONTOUR ? 0 : r * r * psi2s(r));
    let peak = 0;
    for (let i = 0; i <= 400; i++) peak = Math.max(peak, f2s((i / 400) * RMAX));
    for (let i = 0; i < s2;) {
      const r = rng() * RMAX;
      if (rng() * peak > f2s(r)) continue;
      push(mul(onSphere(rng), r), 3);
      i++;
    }

    const A_P = 0.16;
    const LOBE_CONTOUR = 0.12 * (2 * A_P) ** 2 * Math.exp(-2);

    const lobes = (count, axis, part) => {
      for (let i = 0; i < count;) {
        const r = gammaRadius(rng, 5, A_P);
        const s = onSphere(rng);
        const c = s[0] * axis[0] + s[1] * axis[1] + s[2] * axis[2];
        if (rng() > c * c) continue;
        if (r * r * Math.exp(-r / A_P) * c * c < LOBE_CONTOUR) continue;
        push(mul(s, r), part);
        i++;
      }
    };
    lobes(px, [1, 0, 0], 4);
    lobes(py, [0, 1, 0], 5);
    lobes(pz, [0, 0, 1], 6);
    return pts;
  },
};

const galView = (p) => rotX(p, 1.0);

const galaxy = {
  name: 'Milky Way',
  blurb: 'Our barred spiral galaxy, and where we are in it',
  parts: [
    { name: 'Central bulge', color: hex(0xfff3d6), dir: [0, 0, 0], spread: 0.4,
      info: 'A dense swarm of old stars around a black hole four million times the mass of the Sun.' },
    { name: 'Galactic bar', color: hex(0xffd9a0), dir: galView([0, 0.14, 0]), spread: 0.3,
      info: 'A long bar of stars through the centre that funnels gas inward and anchors the main arms.' },
    { name: 'Scutum–Centaurus Arm', color: hex(0x6aa8ff), dir: galView([0, 0.32, 0]), spread: 0.05,
      info: 'One of the two major arms, packed with young stars and starting at the end of the bar.' },
    { name: 'Perseus Arm', color: hex(0xc08bff), dir: galView([0, 0.62, 0]), spread: 0.05,
      info: 'The other major arm, starting at the opposite end of the bar and curving around the outer disc.' },
    { name: 'Sagittarius Arm', color: hex(0x5ce1ff), dir: galView([0, -0.32, 0]), spread: 0.05,
      info: 'A minor arm just inward of the Sun, rich in gas and bright nebulae.' },
    { name: 'Norma Arm', color: hex(0x7e8fff), dir: galView([0, -0.62, 0]), spread: 0.05,
      info: 'A minor arm close to the centre that winds out to become the distant Outer Arm.' },
    { name: 'Orion Spur and the Sun', color: hex(0xffe27a), dir: galView([0, 0.95, 0]), spread: 0.05,
      info: 'You are here. A small branch between two arms, about 26,000 light-years from the centre.' },
    { name: 'Star-forming nebulae', color: hex(0xff6fae), dir: [0, 0, 0], spread: 0.2,
      info: 'Glowing clouds of hydrogen where new stars are being born along the spiral arms.' },
    { name: 'Halo and globular clusters', color: hex(0x9fb0d8), dir: [0, 0, 0], spread: 0.5,
      info: 'A faint sphere of ancient stars, with about 150 tight clusters orbiting far above the disc.' },
  ],
  build(n, rng) {
    const [bulge, bar, sc, pe, sa, no, spur, neb, halo] = allocate(n, [0.13, 0.06, 0.2, 0.2, 0.11, 0.11, 0.03, 0.06, 0.1]);
    const pts = [];
    const push = (p, part) => pts.push([galView(p), part]);
    const BAR = 0.47, B = 0.22;
    const R_END = 1.45;
    const ARMS = [
      { start: BAR, r0: 0.38, width: 1, part: 2 },
      { start: BAR + Math.PI, r0: 0.38, width: 1, part: 3 },
      { start: BAR + Math.PI / 2, r0: 0.42, width: 0.72, part: 4 },
      { start: BAR + (3 * Math.PI) / 2, r0: 0.42, width: 0.72, part: 5 },
    ].map((arm) => ({ ...arm, phiMax: Math.log(R_END / arm.r0) / B }));

    for (let i = 0; i < bulge; i++) {
      push([gauss(rng) * 0.15, gauss(rng) * 0.1, gauss(rng) * 0.15], 0);
    }
    for (let i = 0; i < bar; i++) {
      const along = (rng() * 2 - 1) * 0.42, side = gauss(rng) * 0.05;
      push([
        along * Math.cos(BAR) - side * Math.sin(BAR),
        gauss(rng) * 0.035,
        along * Math.sin(BAR) + side * Math.cos(BAR),
      ], 1);
    }

    const armAt = (arm, phi) => {
      const r = arm.r0 * Math.exp(B * phi);
      const ang = arm.start + phi;
      return [r * Math.cos(ang), 0, r * Math.sin(ang)];
    };
    const armStars = (count, arm) => {
      for (let i = 0; i < count;) {
        const t = Math.pow(rng(), 0.8);
        const phi = t * arm.phiMax;
        const knots = Math.sin(phi * 6.2 + arm.part);
        if (rng() > 0.62 + 0.38 * knots * knots) continue;
        const r = arm.r0 * Math.exp(B * phi);
        const w = (0.025 + 0.06 * t) * arm.width;
        const rr = r + gauss(rng) * w;
        const ang = arm.start + phi + (gauss(rng) * w) / r;
        push([rr * Math.cos(ang), gauss(rng) * (0.012 + 0.02 * (1 - t)), rr * Math.sin(ang)], arm.part);
        i++;
      }
    };
    armStars(sc, ARMS[0]);
    armStars(pe, ARMS[1]);
    armStars(sa, ARMS[2]);
    armStars(no, ARMS[3]);

    const SUN_R = 0.76, SUN_ANG = BAR + 5.28;
    const sunPos = [SUN_R * Math.cos(SUN_ANG), 0, SUN_R * Math.sin(SUN_ANG)];
    for (let i = 0; i < spur; i++) {
      if (rng() < 0.3) {
        push(add(sunPos, mul(onSphere(rng), 0.016 * Math.cbrt(rng()))), 6);
      } else {
        const r = 0.66 + rng() * 0.22;
        const ang = SUN_ANG + Math.log(r / SUN_R) / 0.35 + gauss(rng) * 0.03;
        push([r * Math.cos(ang), gauss(rng) * 0.012, r * Math.sin(ang)], 6);
      }
    }

    const clumps = [];
    for (let i = 0; i < 90; i++) {
      const arm = ARMS[Math.floor(rng() * 4)];
      clumps.push(armAt(arm, (0.1 + 0.85 * rng()) * arm.phiMax));
    }
    for (let i = 0; i < neb; i++) {
      const c = clumps[Math.floor(rng() * clumps.length)];
      push([c[0] + gauss(rng) * 0.02, gauss(rng) * 0.008, c[2] + gauss(rng) * 0.02], 7);
    }

    const clusters = [];
    for (let i = 0; i < 22; i++) {
      const s = onSphere(rng);
      const r = 0.35 + rng() * 0.95;
      clusters.push([s[0] * r, s[1] * r * 0.8, s[2] * r]);
    }
    for (let i = 0; i < halo; i++) {
      if (rng() < 0.55) {
        const s = onSphere(rng);
        const r = 0.3 + Math.pow(rng(), 0.5) * 1.1;
        push([s[0] * r, s[1] * r * 0.6, s[2] * r], 8);
      } else {
        const c = clusters[Math.floor(rng() * clusters.length)];
        push([c[0] + gauss(rng) * 0.02, c[1] + gauss(rng) * 0.02, c[2] + gauss(rng) * 0.02], 8);
      }
    }
    return pts;
  },
};

// A high-bypass turbofan. Built along the x axis (air flows from -x to +x),
// then turned so that, with the app's starting camera angle, it is seen from the side.
const engineView = (p) => rotX(rotY(p, -0.25), 0.18);

const engine = {
  name: 'Jet engine',
  scale: 0.8,
  blurb: 'A high-bypass turbofan, from fan blades to exhaust cone',
  parts: [
    { name: 'Upper fan cowl', color: hex(0xcfdcef), dir: engineView([0, 0.85, 0]), spread: 0.08,
      info: 'A streamlined cover hinged at the top so mechanics can open it. It smooths the air around the engine.' },
    { name: 'Lower fan cowl', color: hex(0x9fb3cf), dir: engineView([0, -0.85, 0]), spread: 0.08,
      info: 'The matching lower half. Behind the cowls, the fan case is built to contain a broken blade.' },
    { name: 'Fan', color: hex(0x5ce1ff), dir: engineView([-0.95, 0, 0]), spread: 0.15,
      info: 'The huge front blades. Most of the air bypasses the core, producing around 80% of the thrust.' },
    { name: 'Booster', color: hex(0x7fb0ff), dir: engineView([-0.55, 0, 0]), spread: 0.75,
      info: 'The low-pressure compressor. It turns with the fan and gives the core air a first squeeze.' },
    { name: 'High-pressure compressor', color: hex(0x5b7cff), dir: engineView([-0.2, 0, 0]), spread: 0.8,
      info: 'Nine shrinking stages of blades squeeze the air to many times atmospheric pressure, heating it.' },
    { name: 'Combustor', color: hex(0xff7a2f), dir: engineView([0, -0.45, 0]), spread: 0.3,
      info: 'A ring-shaped chamber where twenty nozzles spray fuel into the air and it burns continuously.' },
    { name: 'High-pressure turbine', color: hex(0xffd166), dir: engineView([0.2, 0, 0]), spread: 0.8,
      info: 'Two stages of cooled blades in gas hotter than their own melting point. They drive the compressor.' },
    { name: 'Low-pressure turbine', color: hex(0xffa94d), dir: engineView([0.5, 0, 0]), spread: 0.75,
      info: 'Five widening stages that take the remaining energy from the gas to spin the fan.' },
    { name: 'Shafts', color: hex(0x8a90a8), dir: [0, 0, 0], spread: 0,
      info: 'Two nested shafts spin at different speeds: one links fan to low-pressure turbine, the other the core.' },
    { name: 'Core cowl', color: hex(0xc070ff), dir: engineView([0, 0, 1.05]), spread: 0.06,
      info: 'The casing around the core. It forms the inner wall of the duct that carries the bypass air.' },
    { name: 'Exhaust nozzle', color: hex(0xff5f8a), dir: engineView([1, 0, 0]), spread: 0.1,
      info: 'The nozzle and tail cone shape the hot gas leaving the core, turning its pressure into speed.' },
    { name: 'Pylon', color: hex(0x9bf2c8), dir: engineView([0, 1.02, 0]), spread: 0.03,
      info: 'The strut that hangs the engine from the wing, carrying its thrust, fuel lines and wiring.' },
  ],
  build(n, rng) {
    const [nacelle, fan, booster, hpc, comb, hpt, lpt, shaft, cowl, nozzle, pylon] =
      allocate(n, [0.22, 0.17, 0.06, 0.1, 0.08, 0.06, 0.1, 0.03, 0.06, 0.07, 0.05]);
    const pts = [];
    const j = (a) => (rng() - 0.5) * a;
    const OFFSET = 0.17;
    const put = (x, r, th, part) => pts.push([engineView([x - OFFSET, r * Math.cos(th), r * Math.sin(th)]), part]);
    const ringPt = (x, r, part, jit = 0.006) => put(x + j(jit), r + j(jit), rng() * TAU, part);
    const choose = (list) => list[Math.floor(rng() * list.length)];

    // One point on a bladed row: `count` twisted blades between rHub and rTip.
    // Leading and trailing edges get extra points so each blade reads as an outline.
    const blade = (x0, rHub, rTip, count, halfChord, stagger, twist, sweep, part) => {
      const k = Math.floor(rng() * count);
      const s = rng();
      const r = rHub + (rTip - rHub) * s;
      const e = rng();
      const c = e < 0.3 ? (e < 0.15 ? -1 : 1) : rng() * 2 - 1;
      const phi = stagger + twist * s;
      const x = x0 + c * halfChord * Math.cos(phi) + sweep * s * s + j(0.004);
      put(x, r + j(0.003), (k / count) * TAU + (c * halfChord * Math.sin(phi)) / r, part);
    };

    // Nacelle: inlet lip, outer skin with panel seams, inner duct wall. Split top and bottom.
    const NX0 = -1.15, NX1 = 0.45;
    const nacOuter = (u) => 0.62 + 0.05 * Math.sin(Math.PI * Math.min(1, 1.3 * u)) - 0.06 * u * u;
    const nacInner = (u) => 0.565 - 0.02 * u * u;
    const SEAMS = [0.18, 0.42, 0.66, 0.86];
    for (let i = 0; i < nacelle; i++) {
      const sel = rng();
      let x, r, th = rng() * TAU;
      if (sel < 0.1) {
        const rc = (nacOuter(0) + nacInner(0)) / 2, tr = (nacOuter(0) - nacInner(0)) / 2;
        const a = Math.PI / 2 + rng() * Math.PI;
        x = NX0 + tr * Math.cos(a) * 1.6;
        r = rc + tr * Math.sin(a);
      } else if (sel < 0.62) {
        const u = rng();
        x = NX0 + (NX1 - NX0) * u;
        r = nacOuter(u);
      } else if (sel < 0.86) {
        const u = rng();
        x = NX0 + (NX1 - NX0) * u;
        r = nacInner(u);
      } else if (sel < 0.95) {
        const u = sel < 0.92 ? choose(SEAMS) : 0.999;
        x = NX0 + (NX1 - NX0) * u;
        r = nacOuter(u) + 0.003;
      } else {
        // The line where the two cowl halves meet.
        const u = rng();
        x = NX0 + (NX1 - NX0) * u;
        r = nacOuter(u) + 0.003;
        th = (rng() < 0.5 ? 0.5 : 1.5) * Math.PI + j(0.01);
      }
      put(x + j(0.004), r + j(0.004), th, r * Math.cos(th) >= 0 ? 0 : 1);
    }

    // Fan: spinner, 22 wide-chord swept blades, 40 outlet guide vanes behind.
    const XF = -0.82;
    for (let i = 0; i < fan; i++) {
      const p = rng();
      if (p < 0.13) {
        const t = Math.sqrt(rng());
        const r = 0.14 * Math.pow(Math.sin((Math.PI / 2) * t), 0.85);
        put(XF - 0.2 + 0.2 * t + j(0.003), r, rng() * TAU, 2);
      } else if (p < 0.82) {
        blade(XF, 0.14, 0.555, 22, 0.075, 0.35, 0.8, 0.05, 2);
      } else {
        blade(-0.6, 0.33, 0.56, 40, 0.035, 0.12, 0, 0, 2);
      }
    }

    // Each compressor or turbine stage is a rotor, a row of stator vanes, a disc and a casing ring.
    const stagePoint = (st, part, rotorStagger, statorStagger, statorOffset) => {
      const p = rng();
      if (p < 0.55) {
        blade(st.x, st.hub, st.tip, st.blades, st.h, rotorStagger, rotorStagger > 0 ? 0.15 : -0.2, 0, part);
      } else if (p < 0.85) {
        blade(st.x + statorOffset, st.hub, st.tip, st.blades + 6, st.h * 0.8, statorStagger, 0, 0, part);
      } else if (rng() < 0.6) {
        put(st.x + j(0.008), 0.07 + (st.hub - 0.07) * Math.sqrt(rng()), rng() * TAU, part);
      } else {
        ringPt(st.x + statorOffset * 0.5, st.tip + 0.008, part, 0.012);
      }
    };

    const boosterStages = [0, 1, 2].map((s) => ({ x: -0.55 + s * 0.08, hub: 0.17, tip: 0.29, blades: 34 + s * 4, h: 0.016 }));
    const hpcStages = [];
    for (let s = 0; s < 9; s++) {
      const t = s / 8;
      hpcStages.push({ x: -0.28 + s * 0.04, hub: 0.15 + 0.03 * t, tip: 0.26 - 0.05 * t, blades: 44 + s * 4, h: 0.014 });
    }
    for (let i = 0; i < booster; i++) stagePoint(choose(boosterStages), 3, 0.8, -0.7, 0.03);
    for (let i = 0; i < hpc; i++) stagePoint(choose(hpcStages), 4, 0.8, -0.7, 0.02);

    // Combustor: annular chamber with 20 fuel nozzles and a glowing flame zone.
    const CX0 = 0.08, CX1 = 0.36;
    for (let i = 0; i < comb; i++) {
      const p = rng();
      const u = rng(), x = CX0 + (CX1 - CX0) * u;
      if (p < 0.3) {
        put(x, 0.25 + 0.018 * Math.sin(Math.PI * u) + j(0.003), rng() * TAU, 5);
      } else if (p < 0.52) {
        put(x, 0.15 - 0.012 * Math.sin(Math.PI * u) + j(0.003), rng() * TAU, 5);
      } else if (p < 0.64) {
        const a = Math.PI / 2 + rng() * Math.PI;
        put(CX0 + 0.05 * Math.cos(a), 0.2 + 0.05 * Math.sin(a), rng() * TAU, 5);
      } else if (p < 0.82) {
        const k = Math.floor(rng() * 20), th = (k / 20) * TAU;
        if (rng() < 0.5) {
          const s = onSphere(rng);
          put(CX0 - 0.045 + s[0] * 0.012, 0.2 + s[1] * 0.012, th + (s[2] * 0.012) / 0.2, 5);
        } else {
          put(CX0 - 0.045 + j(0.008), 0.2 + rng() * 0.17, th + j(0.04), 5);
        }
      } else {
        put(CX0 + 0.03 + (CX1 - CX0 - 0.05) * Math.pow(rng(), 1.4), 0.2 + gauss(rng) * 0.018, rng() * TAU, 5);
      }
    }

    const hptStages = [0, 1].map((s) => ({ x: 0.42 + s * 0.06, hub: 0.17, tip: 0.25, blades: 70, h: 0.018 }));
    const lptStages = [];
    for (let s = 0; s < 5; s++) {
      const t = s / 4;
      lptStages.push({ x: 0.57 + s * 0.07, hub: 0.18 + 0.03 * t, tip: 0.27 + 0.08 * t, blades: 80 + s * 6, h: 0.02 });
    }
    for (let i = 0; i < hpt; i++) stagePoint(choose(hptStages), 6, -0.9, 0.6, -0.025);
    for (let i = 0; i < lpt; i++) stagePoint(choose(lptStages), 7, -0.9, 0.6, -0.025);

    // Shafts: low-pressure shaft from fan to turbine, a hollow high-pressure spool around it, bearings.
    for (let i = 0; i < shaft; i++) {
      const p = rng();
      if (p < 0.5) put(-0.82 + 1.75 * rng(), 0.035 + j(0.004), rng() * TAU, 8);
      else if (p < 0.85) put(-0.3 + 0.8 * rng(), 0.062 + j(0.004), rng() * TAU, 8);
      else ringPt(choose([-0.7, -0.32, 0.06, 0.52, 0.9]), 0.09, 8, 0.02);
    }

    // The core cowl is sparse so the machinery shows through it.
    const coreR = (x) => 0.3 + 0.07 * smooth(-0.66, -0.3, x) - 0.09 * smooth(0.9, 1.2, x);
    for (let i = 0; i < cowl; i++) {
      if (rng() < 0.82) {
        const x = -0.66 + 1.56 * rng();
        put(x, coreR(x) + j(0.004), rng() * TAU, 9);
      } else {
        ringPt(-0.66, coreR(-0.66), 9, 0.006);
      }
    }

    for (let i = 0; i < nozzle; i++) {
      const p = rng();
      if (p < 0.38) {
        const x = 0.9 + 0.3 * rng();
        put(x, coreR(x) + j(0.004), rng() * TAU, 10);
      } else if (p < 0.5) {
        ringPt(1.2, coreR(1.2), 10, 0.006);
      } else {
        const t = 1 - Math.sqrt(rng());
        put(0.92 + 0.6 * t + j(0.004), 0.17 * Math.pow(1 - t, 0.75), rng() * TAU, 10);
      }
    }

    // Pylon: a flat-sided strut on top of the nacelle, dropping behind it to meet the core.
    const yBottom = (x) => {
      if (x < NX1) return nacOuter((x - NX0) / (NX1 - NX0));
      return nacOuter(1) + (coreR(x) - nacOuter(1)) * smooth(NX1, 0.7, x);
    };
    const yTop = (x) => 0.66 + 0.24 * smooth(-0.3, -0.05, x);
    const HALF = 0.045;
    for (let i = 0; i < pylon; i++) {
      const x = -0.3 + 1.3 * rng();
      const lo = yBottom(x), hi = Math.max(lo + 0.01, yTop(x));
      const sel = rng();
      let y, z;
      if (sel < 0.72) { y = lo + (hi - lo) * rng(); z = rng() < 0.5 ? -HALF : HALF; }
      else if (sel < 0.88) { y = hi; z = (rng() * 2 - 1) * HALF; }
      else { y = lo; z = (rng() * 2 - 1) * HALF; }
      pts.push([engineView([x - OFFSET, y + j(0.003), z + j(0.003)]), 11]);
    }
    return pts;
  },
};

export const MODELS = [saturn, heart, dna, tower, atom, galaxy, engine];

/**
 * Sample model `index` into `n` particles.
 * @returns {{name:string, blurb:string, beat:boolean, parts:object[], target:Float32Array, centers:Float32Array, anchors:Float32Array}}
 *   target is n×vec4 (x, y, z, partIndex); centers and anchors are MAX_PARTS×vec3.
 *   An anchor is a real particle of the part, so a label always points at something visible.
 */
export function buildModel(index, n, seed = 1337) {
  const m = MODELS[((index % MODELS.length) + MODELS.length) % MODELS.length];
  const rng = mulberry32(seed + index * 7919);
  const pts = m.build(n, rng);
  if (pts.length !== n) throw new Error(`${m.name} produced ${pts.length} points, expected ${n}`);

  // Shuffle so neighbouring particle indices aren't all in the same part:
  // when the model changes, particles then travel to random new spots, which looks better.
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
  }

  const target = new Float32Array(n * 4);
  const sums = new Float64Array(MAX_PARTS * 4);
  for (let i = 0; i < n; i++) {
    const [[x0, y0, z0], part] = pts[i];
    const k = m.scale ?? 1;
    const x = x0 * k, y = y0 * k, z = z0 * k;
    target.set([x, y, z, part], i * 4);
    sums[part * 4] += x; sums[part * 4 + 1] += y; sums[part * 4 + 2] += z; sums[part * 4 + 3]++;
  }
  const centers = new Float32Array(MAX_PARTS * 3);
  for (let p = 0; p < MAX_PARTS; p++) {
    const c = sums[p * 4 + 3] || 1;
    centers[p * 3] = sums[p * 4] / c;
    centers[p * 3 + 1] = sums[p * 4 + 1] / c;
    centers[p * 3 + 2] = sums[p * 4 + 2] / c;
  }

  // A part centred near the origin (a ring, a halo) has nothing at its centre of mass,
  // so it anchors on a particle at its typical radius instead.
  const radiusSum = new Float64Array(MAX_PARTS);
  for (let i = 0; i < n; i++) {
    radiusSum[target[i * 4 + 3]] += Math.hypot(target[i * 4], target[i * 4 + 1], target[i * 4 + 2]);
  }
  const anchors = new Float32Array(MAX_PARTS * 3);
  const best = new Float64Array(MAX_PARTS).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = target[i * 4], y = target[i * 4 + 1], z = target[i * 4 + 2], p = target[i * 4 + 3];
    const cx = centers[p * 3], cy = centers[p * 3 + 1], cz = centers[p * 3 + 2];
    const score = Math.hypot(cx, cy, cz) > 0.15
      ? Math.hypot(x - cx, y - cy, z - cz)
      : Math.abs(Math.hypot(x, y, z) - radiusSum[p] / sums[p * 4 + 3]);
    if (score < best[p]) {
      best[p] = score;
      anchors.set([x, y, z], p * 3);
    }
  }
  return { name: m.name, blurb: m.blurb, beat: !!m.beat, parts: m.parts, target, centers, anchors };
}

/** How far parts travel at explode = 1, relative to each part's rule. */
export const EXPLODE_GAIN = { dir: 0.75, spread: 0.6 };

/** Packed per-part uniforms: colours (vec3), explode rules (vec4: dir.xyz, spread). */
export function partUniforms(model) {
  const colors = new Float32Array(MAX_PARTS * 3);
  const rules = new Float32Array(MAX_PARTS * 4);
  model.parts.forEach((p, i) => {
    colors.set(p.color, i * 3);
    rules.set([...p.dir.map((d) => d * EXPLODE_GAIN.dir), p.spread * EXPLODE_GAIN.spread], i * 4);
  });
  return { colors, rules };
}
