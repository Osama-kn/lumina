import { hex, allocate, gauss, onSphere, rotX, add, mul } from '../geometry.js';

const galView = (p) => rotX(p, 1.0);

export default {
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
