import { hex, allocate, onSphere, rotX, rotY, add, sub, mul, len, gammaRadius } from '../geometry.js';

const atomView = (p) => rotY(rotX(p, 0.4), 0.5);

// Orbital shapes come from the hydrogen-like wavefunctions. Only the nucleus is
// out of scale: at true size it would be far too small to see.
export default {
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
