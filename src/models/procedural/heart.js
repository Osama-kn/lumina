import { hex, allocate, spline, tubePoint, ellipsoid, insideEll, ellSurface, pushOutOf } from '../geometry.js';

// Chambers and vessels in the view of a chest from the front: +x is the patient's left.
const LV = ellipsoid([0.18, -0.22, -0.08], [0.33, 0.55, 0.33], 0.5);
const RV = ellipsoid([-0.1, -0.15, 0.13], [0.35, 0.47, 0.26], 0.55);
const LA = ellipsoid([0.14, 0.3, -0.3], [0.27, 0.18, 0.2]);
const LA_APP = ellipsoid([0.38, 0.32, 0.02], [0.11, 0.07, 0.08], -0.3);
const RA = ellipsoid([-0.42, 0.16, -0.02], [0.22, 0.27, 0.22], 0.1);
const RA_APP = ellipsoid([-0.3, 0.42, 0.17], [0.13, 0.08, 0.09], 0.4);
const CHAMBERS = [LV, RV, LA, LA_APP, RA, RA_APP];

export default {
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
