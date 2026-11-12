import { TAU, hex, allocate, gauss, onSphere, rotX, rotZ, add, mul } from '../geometry.js';

const satView = (p) => rotZ(rotX(p, 0.42), -0.14);

// Ring radii use Saturn's real proportions (planet radius 0.5). Only the moons are moved in close.
export default {
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
