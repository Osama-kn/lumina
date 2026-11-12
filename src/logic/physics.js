// CPU twin of the GPU particle physics in src/gl/shaders.js (PHYSICS_VS).
// The browser never runs this for the real particles; it exists so tests can
// check the shader against plain JavaScript, and so the maths is readable.
// Keep the two in sync: same constants, same order of operations.

export const MODE_ID = { dormant: 0, cloud: 1, formed: 2 };
export const MAX_DT = 1 / 30;

/** Lub-dub heartbeat at 72 bpm, as a scale factor around 1. */
export function heartbeat(t) {
  const period = 60 / 72;
  const ph = (((t % period) + period) % period) / period;
  const lub = Math.exp(-(((ph - 0.1) / 0.05) ** 2));
  const dub = 0.6 * Math.exp(-(((ph - 0.32) / 0.05) ** 2));
  return 1 + 0.07 * (lub + dub);
}

/**
 * Advance one particle. All vectors are [x, y, z] arrays.
 * @param {object} u uniforms: mode, dt, time, explode, beat, attract, attractor, rules (Float32Array 12×4), centers (12×3)
 */
export function stepParticle(pos, vel, target, seed, u) {
  let [px, py, pz] = pos;
  let [vx, vy, vz] = vel;
  const [sx, sy, sz, sw] = seed;
  let ax, ay, az, damp;

  if (u.mode === 0) {
    // Dormant: drift out to a far-away home on a big sphere.
    let hx = sy * 2 - 1 + 1e-3, hy = sz * 2 - 1 + 1e-3, hz = sw * 2 - 1 + 1e-3;
    const hl = Math.hypot(hx, hy, hz);
    const R = 4.5 + 3.0 * sx;
    hx = (hx / hl) * R; hy = (hy / hl) * R; hz = (hz / hl) * R;
    ax = (hx - px) * 0.6; ay = (hy - py) * 0.6; az = (hz - pz) * 0.6;
    damp = 1.2;
  } else if (u.mode === 1) {
    // Cloud: a swirling shell around the hand (or the origin when no hand is visible).
    const cx = u.attractor[0] * u.attract, cy = u.attractor[1] * u.attract, cz = u.attractor[2] * u.attract;
    const rx = px - cx, ry = py - cy, rz = pz - cz;
    const r = Math.hypot(rx, ry, rz) + 1e-4;
    const R = 0.55 + 0.4 * sx;
    const pull = (r - R) * 7.0;
    const swirl = (1.5 * (0.6 + sy)) / r;
    // cross((0,1,0), rel) = (rz, 0, -rx)
    ax = (-rx / r) * pull + rz * swirl + Math.sin(u.time * 1.3 + sy * 20 + py * 3) * 0.8;
    ay = (-ry / r) * pull + Math.sin(u.time * 1.1 + sz * 20 + pz * 3) * 0.8;
    az = (-rz / r) * pull - rx * swirl + Math.sin(u.time * 0.9 + sw * 20 + px * 3) * 0.8;
    damp = 2.0;
  } else {
    // Formed: a spring to the model target, plus the explode offset for this particle's part.
    const part = Math.round(target[3]);
    const rule = u.rules.subarray(part * 4, part * 4 + 4);
    const c = u.centers.subarray(part * 3, part * 3 + 3);
    const tx = target[0] * u.beat + u.explode * (rule[0] + rule[3] * (target[0] - c[0]));
    const ty = target[1] * u.beat + u.explode * (rule[1] + rule[3] * (target[1] - c[1]));
    const tz = target[2] * u.beat + u.explode * (rule[2] + rule[3] * (target[2] - c[2]));
    const k = 18 + (40 - 18) * sx;
    ax = (tx - px) * k + Math.sin(u.time * 2.0 + sy * 30) * 0.03;
    ay = (ty - py) * k + Math.sin(u.time * 2.3 + sz * 30) * 0.03;
    az = (tz - pz) * k + Math.sin(u.time * 1.7 + sw * 30) * 0.03;
    damp = 7.0;
  }

  const dt = Math.min(u.dt, MAX_DT);
  const decay = Math.exp(-damp * dt);
  vx = (vx + ax * dt) * decay; vy = (vy + ay * dt) * decay; vz = (vz + az * dt) * decay;
  px += vx * dt; py += vy * dt; pz += vz * dt;
  return [[px, py, pz], [vx, vy, vz]];
}
