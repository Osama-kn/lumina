import { TAU, hex, allocate, gauss, onSphere, rotX, rotY, smooth } from '../geometry.js';

// A high-bypass turbofan. Built along the x axis (air flows from -x to +x),
// then turned so that, with the app's starting camera angle, it is seen from the side.
const engineView = (p) => rotX(rotY(p, -0.25), 0.18);

export default {
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
