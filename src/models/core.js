// What every model turns into before it reaches the GPU. A model is a set of
// particles, each with a target position and a part index; each part has a
// colour, an explode rule and a one-line explanation shown when it is selected:
//   offset = explode * (dir + spread * (position - partCentre))
// so parts can both fly off in a direction and expand around their own centre.

// The shaders declare uniform arrays of this size; change both together.
export const MAX_PARTS = 12;

/** How far parts travel at explode = 1, relative to each part's rule. */
export const EXPLODE_GAIN = { dir: 0.75, spread: 0.6 };

/**
 * Turn sampled points into the packed form the renderer uses.
 * @param {{name:string, blurb:string, beat?:boolean, parts:object[], scale?:number, credit?:string}} def
 * @param {Array<[[number,number,number], number]>} pts  [position, partIndex] pairs; shuffled in place
 * @param {() => number} rng
 * @returns {{name:string, blurb:string, beat:boolean, parts:object[], credit:string|null,
 *            target:Float32Array, centers:Float32Array, anchors:Float32Array}}
 *   target is n×vec4 (x, y, z, partIndex); centers and anchors are MAX_PARTS×vec3.
 *   An anchor is a real particle of the part, so a label always points at something visible.
 */
export function finishModel(def, pts, rng) {
  const n = pts.length;

  // Shuffle so neighbouring particle indices aren't all in the same part:
  // when the model changes, particles then travel to random new spots, which looks better.
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pts[i]; pts[i] = pts[j]; pts[j] = t;
  }

  const target = new Float32Array(n * 4);
  const sums = new Float64Array(MAX_PARTS * 4);
  const k = def.scale ?? 1;
  for (let i = 0; i < n; i++) {
    const [[x0, y0, z0], part] = pts[i];
    const x = x0 * k, y = y0 * k, z = z0 * k;
    target.set([x, y, z, part], i * 4);
    sums[part * 4] += x; sums[part * 4 + 1] += y; sums[part * 4 + 2] += z; sums[part * 4 + 3]++;
  }
  const centers = new Float32Array(MAX_PARTS * 3);
  for (let p = 0; p < MAX_PARTS; p++) {
    const c = sums[p * 4 + 3] || 1;
    centers[p * 3] = sums[p * 4] / c;
    centers[p * 3 + 1] = sums[p * 4 + 1] / c;
    centers[p * 3 + 2] = sums[p * 4 + 2] / c;
  }

  // A part centred near the origin (a ring, a halo) has nothing at its centre of mass,
  // so it anchors on a particle at its typical radius instead.
  const radiusSum = new Float64Array(MAX_PARTS);
  for (let i = 0; i < n; i++) {
    radiusSum[target[i * 4 + 3]] += Math.hypot(target[i * 4], target[i * 4 + 1], target[i * 4 + 2]);
  }
  const anchors = new Float32Array(MAX_PARTS * 3);
  const best = new Float64Array(MAX_PARTS).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = target[i * 4], y = target[i * 4 + 1], z = target[i * 4 + 2], p = target[i * 4 + 3];
    const cx = centers[p * 3], cy = centers[p * 3 + 1], cz = centers[p * 3 + 2];
    const score = Math.hypot(cx, cy, cz) > 0.15
      ? Math.hypot(x - cx, y - cy, z - cz)
      : Math.abs(Math.hypot(x, y, z) - radiusSum[p] / sums[p * 4 + 3]);
    if (score < best[p]) {
      best[p] = score;
      anchors.set([x, y, z], p * 3);
    }
  }
  return {
    name: def.name, blurb: def.blurb, beat: !!def.beat, parts: def.parts, credit: def.credit ?? null,
    target, centers, anchors,
  };
}

/** Packed per-part uniforms: colours (vec3), explode rules (vec4: dir.xyz, spread). */
export function partUniforms(model) {
  const colors = new Float32Array(MAX_PARTS * 3);
  const rules = new Float32Array(MAX_PARTS * 4);
  model.parts.forEach((p, i) => {
    colors.set(p.color, i * 3);
    rules.set([...p.dir.map((d) => d * EXPLODE_GAIN.dir), p.spread * EXPLODE_GAIN.spread], i * 4);
  });
  return { colors, rules };
}
