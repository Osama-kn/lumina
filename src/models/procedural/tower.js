import { TAU, hex, allocate, onSphere, lerp3, boxSurface } from '../geometry.js';

// Heights follow the real tower: floors at 57, 116 and 276 m of its 330 m.
const TY0 = -1.3, TF1 = -0.81, TF2 = -0.3, TS = 1.09;
const eiffelW = (y) => 0.05 + 0.49 * Math.exp(-1.37 * (y - TY0));
const TOWER_CORNERS = [[1, 1], [-1, 1], [-1, -1], [1, -1]];

export default {
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
