import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, MAX_PARTS, buildModel, allocate, partUniforms } from '../../src/models/registry.js';
import { stepParticle, heartbeat } from '../../src/logic/physics.js';

const N = 6000;

test('allocate always sums to n', () => {
  for (const n of [1, 7, 1000, 99999]) {
    assert.equal(allocate(n, [0.3, 0.3, 0.4]).reduce((a, b) => a + b), n);
    assert.equal(allocate(n, [1, 2, 3, 4, 5]).reduce((a, b) => a + b), n);
  }
});

for (let i = 0; i < MODELS.length; i++) {
  test(`model "${MODELS[i].name}" is finite, bounded, deterministic and uses every part`, () => {
    const a = buildModel(i, N);
    const b = buildModel(i, N);
    assert.deepEqual(a.target, b.target, 'same seed gives the same cloud');
    assert.ok(a.parts.length <= MAX_PARTS);

    const used = new Set();
    let maxR = 0;
    for (let k = 0; k < N; k++) {
      const [x, y, z, part] = a.target.subarray(k * 4, k * 4 + 4);
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `point ${k} not finite`);
      assert.ok(Number.isInteger(part) && part >= 0 && part < a.parts.length, `bad part ${part}`);
      used.add(part);
      maxR = Math.max(maxR, Math.hypot(x, y, z));
    }
    assert.equal(used.size, a.parts.length, 'every part gets particles');
    assert.ok(maxR > 0.5 && maxR < 1.8, `fits the view (max radius ${maxR.toFixed(2)})`);

    const { colors, rules } = partUniforms(a);
    assert.equal(colors.length, MAX_PARTS * 3);
    assert.equal(rules.length, MAX_PARTS * 4);
  });
}

test('models build fast enough for 200k particles', () => {
  for (let i = 0; i < MODELS.length; i++) {
    const t0 = performance.now();
    buildModel(i, 200_000);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${MODELS[i].name} took ${ms.toFixed(0)} ms`);
  }
});

function settle(model, k, uniforms, frames) {
  const target = model.target.subarray(k * 4, k * 4 + 4);
  const seed = [0.5, 0.2, 0.7, 0.4];
  let pos = [3, -2, 1], vel = [0, 0, 0];
  for (let f = 0; f < frames; f++) {
    [pos, vel] = stepParticle(pos, vel, target, seed, { ...uniforms, time: f / 60 });
  }
  return { pos, target };
}

test('formed mode pulls a particle onto its target', () => {
  const model = buildModel(0, 1000);
  const { colors, rules } = partUniforms(model);
  const u = { mode: 2, dt: 1 / 60, explode: 0, beat: 1, attract: 0, attractor: [0, 0, 0], rules, centers: model.centers };
  void colors;
  const { pos, target } = settle(model, 10, u, 240);
  const err = Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
  assert.ok(err < 0.01, `still ${err.toFixed(4)} away after 4 s`);
});

test('explode moves particles by their part rule', () => {
  const model = buildModel(2, 2000); // DNA: strand A flies -x, strand B +x
  const { rules } = partUniforms(model);
  const base = { mode: 2, dt: 1 / 60, beat: 1, attract: 0, attractor: [0, 0, 0], rules, centers: model.centers };
  let a = -1, b = -1;
  for (let k = 0; k < 2000 && (a < 0 || b < 0); k++) {
    const part = model.target[k * 4 + 3];
    if (part === 0 && a < 0) a = k;
    if (part === 1 && b < 0) b = k;
  }
  const pa = settle(model, a, { ...base, explode: 1 }, 300).pos;
  const pb = settle(model, b, { ...base, explode: 1 }, 300).pos;
  assert.ok(pa[0] < model.target[a * 4] - 0.4, 'strand A moved left');
  assert.ok(pb[0] > model.target[b * 4] + 0.4, 'strand B moved right');
});

test('cloud mode keeps particles orbiting near the attractor', () => {
  const model = buildModel(0, 100);
  const { rules } = partUniforms(model);
  const u = { mode: 1, dt: 1 / 60, explode: 0, beat: 1, attract: 1, attractor: [0.5, 0.2, 0], rules, centers: model.centers };
  const { pos } = settle(model, 0, u, 600);
  const r = Math.hypot(pos[0] - 0.5, pos[1] - 0.2, pos[2]);
  assert.ok(r > 0.3 && r < 2.2, `radius ${r.toFixed(2)}`);
});

test('heartbeat has two beats per cycle and stays near 1', () => {
  let peaks = 0, prev = heartbeat(0), rising = false;
  for (let t = 0.001; t < 60 / 72; t += 0.001) {
    const v = heartbeat(t);
    if (v > prev) rising = true;
    else if (rising && v < prev) { peaks++; rising = false; }
    assert.ok(v >= 1 && v < 1.09);
    prev = v;
  }
  assert.equal(peaks, 2);
});
