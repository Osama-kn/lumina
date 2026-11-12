import { TAU, hex, allocate, onSphere, rotZ, add, sub, mul, cross, len, norm, lerp3 } from '../geometry.js';

const dnaView = (p) => rotZ(p, 0.3);

export default {
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
