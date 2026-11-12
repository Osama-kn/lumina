// The maths behind part labels: where a part is on screen, which part is under
// a cursor, and how to stack callouts without overlaps. Pure, so it runs in Node tests.

import { mulMat3 } from '../lib/mat.js';

/** A model-space point after the beat and explode offset: the same formula as the physics shader. */
export function explodedPoint(p, center, rule, explode, beat = 1) {
  return [
    p[0] * beat + explode * (rule[0] + rule[3] * (p[0] - center[0])),
    p[1] * beat + explode * (rule[1] + rule[3] * (p[1] - center[1])),
    p[2] * beat + explode * (rule[2] + rule[3] * (p[2] - center[2])),
  ];
}

/**
 * Model space to CSS pixels.
 * @param {{rot:Float32Array, distance:number, fovY:number, width:number, height:number}} cam
 * @returns {{x:number, y:number}|null} null when the point is behind the camera
 */
export function project(p, cam) {
  const [x, y, z] = mulMat3(cam.rot, p);
  const depth = cam.distance - z;
  if (depth < 0.05) return null;
  const f = 1 / Math.tan(cam.fovY / 2);
  const aspect = cam.width / cam.height;
  return {
    x: (((f / aspect) * x) / depth + 1) * 0.5 * cam.width,
    y: (1 - (f * y) / depth) * 0.5 * cam.height,
  };
}

const partRule = (rules, part) => [rules[part * 4], rules[part * 4 + 1], rules[part * 4 + 2], rules[part * 4 + 3]];
const vec3At = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];

/** Where a part's anchor particle is on screen right now. */
export function anchorOnScreen(model, rules, part, explode, beat, cam) {
  const p = explodedPoint(vec3At(model.anchors, part), vec3At(model.centers, part), partRule(rules, part), explode, beat);
  return project(p, cam);
}

/**
 * The part under a screen position: the part of the nearest sampled particle
 * within `radius` pixels, or -1. Particles are shuffled, so a stride is a fair sample.
 */
export function pickPart(model, rules, explode, beat, cam, cursor, radius, samples = 6000) {
  const n = model.target.length / 4;
  const stride = Math.max(1, Math.floor(n / samples));
  let best = radius * radius;
  let found = -1;
  for (let i = 0; i < n; i += stride) {
    const part = model.target[i * 4 + 3];
    const p = explodedPoint(
      [model.target[i * 4], model.target[i * 4 + 1], model.target[i * 4 + 2]],
      vec3At(model.centers, part), partRule(rules, part), explode, beat,
    );
    const s = project(p, cam);
    if (!s) continue;
    const d = (s.x - cursor.x) ** 2 + (s.y - cursor.y) ** 2;
    if (d < best) {
      best = d;
      found = part;
    }
  }
  return found;
}

/**
 * Stack callouts in a column as close as possible to where each one wants to be.
 * @param {{want:number, h:number}[]} items
 * @returns {number[]} a top position for each item, in the items' original order
 */
export function stackColumn(items, top, bottom, gap = 6) {
  const order = items.map((_, i) => i).sort((a, b) => items[a].want - items[b].want);
  const y = new Array(items.length);
  let cursor = top;
  for (const i of order) {
    y[i] = Math.max(cursor, items[i].want);
    cursor = y[i] + items[i].h + gap;
  }
  let limit = bottom;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    y[i] = Math.min(y[i], limit - items[i].h);
    limit = y[i] - gap;
  }
  return y;
}

/** Keep a label on its current side until its anchor is clearly past the middle, so labels don't flicker across. */
export function chooseSide(current, anchorX, width, hysteresis = 40) {
  const mid = width / 2;
  if (current === 'left' && anchorX < mid + hysteresis) return 'left';
  if (current === 'right' && anchorX > mid - hysteresis) return 'right';
  return anchorX < mid ? 'left' : 'right';
}
