// A starter model to copy. It builds a small planet with a ring, in two parts.
//
// To make your own:
//   1. Copy this file into procedural/, e.g. procedural/my-model.js.
//   2. Change the name, the parts and build().
//   3. In registry.js, import it and add it to MODELS.
//   4. Run `npm test`: the tests check that your model follows the rules below.
//
// The rules: build(n, rng) returns exactly n points, every part gets some, at most
// 12 parts, the model fits within a radius of about 1.5, and it uses only rng()
// for randomness so it looks the same every time.
//
// Prefer a real 3D file? You don't need code at all: see docs/adding-models.md.
import { TAU, hex, allocate, onSphere } from './geometry.js';

export default {
  // Shown as the big title and the line under it.
  name: 'Ringed planet',
  blurb: 'A starter model: a planet and its ring.',

  // One entry per part. The index of a part in this list is the number build() uses.
  //   color  [r, g, b] from 0 to 1 (hex() converts 0xRRGGBB)
  //   dir    where the part flies when the model is pulled apart, roughly 0 to 1.5 long
  //   spread how much the part also grows around its own centre (0 = not at all)
  //   info   one sentence shown when someone points at the part
  parts: [
    { name: 'Planet', color: hex(0x7fb2ff), dir: [0, 0.4, 0], spread: 0.3,
      info: 'A ball of particles spread evenly over a sphere.' },
    { name: 'Ring', color: hex(0xffd166), dir: [0, -0.6, 0], spread: 0.15,
      info: 'A flat band of particles circling the planet.' },
  ],

  // Return n entries of [[x, y, z], partIndex]. Keep coordinates within about ±1.5.
  build(n, rng) {
    const [planet, ring] = allocate(n, [0.6, 0.4]);  // how many particles each part gets
    const pts = [];

    for (let i = 0; i < planet; i++) {
      const [x, y, z] = onSphere(rng);               // a random direction
      const r = 0.55 * Math.cbrt(rng());             // filled ball, denser look than a shell
      pts.push([[x * r, y * r, z * r], 0]);
    }

    for (let i = 0; i < ring; i++) {
      const a = rng() * TAU;                         // angle around the ring
      const r = 0.8 + 0.35 * rng();                  // between the inner and outer edge
      pts.push([[Math.cos(a) * r, (rng() - 0.5) * 0.02, Math.sin(a) * r], 1]);
    }

    return pts;
  },
};
