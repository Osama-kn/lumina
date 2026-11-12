// Builds fake MediaPipe landmarks for a hand with chosen finger extensions.
// Used by the unit tests, the browser tests and the built-in demo.

const FINGER_X = { index: -0.06, middle: -0.02, ring: 0.02, pinky: 0.055 };
const FINGER_BASE = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * @param {object} o
 * @param {{index?:number,middle?:number,ring?:number,pinky?:number}} [o.ext] 0 curled … 1 straight
 * @param {'side'|'index'|'middle'} [o.thumb] where the thumb tip rests
 * @param {number} [o.cx] palm centre x (0..1, image space)
 * @param {number} [o.cy] palm centre y
 * @param {number} [o.scale] overall size multiplier
 */
export function syntheticHand({ ext = {}, thumb = 'side', cx = 0.5, cy = 0.62, scale = 1 } = {}) {
  const e = { index: 1, middle: 1, ring: 1, pinky: 1, ...ext };
  const pts = new Array(21);
  // Work in a local frame where the wrist is at (0, 0.18) and fingers point to -y.
  const P = (x, y, z = 0) => ({ x: cx + x * scale, y: cy + (y - 0.0) * scale, z: z * scale });

  pts[0] = P(0, 0.18);
  for (const [name, ids] of Object.entries(FINGER_BASE)) {
    const fx = FINGER_X[name];
    const t = e[name];
    const [mcp, pip, dip, tip] = ids;
    pts[mcp] = P(fx, -0.02);
    pts[pip] = P(fx, -0.1);
    pts[dip] = P(fx, lerp(-0.05, -0.15, t), lerp(-0.04, 0, t));
    pts[tip] = P(fx * 0.9, lerp(0.0, -0.2, t), lerp(-0.06, 0, t));
  }

  // Thumb: base near the wrist, tip either resting at the side or touching a fingertip.
  pts[1] = P(-0.07, 0.12);
  pts[2] = P(-0.1, 0.06);
  pts[3] = P(-0.12, 0.01);
  if (thumb === 'index' || thumb === 'middle') {
    const target = pts[thumb === 'index' ? 8 : 12];
    pts[4] = { x: target.x + 0.004 * scale, y: target.y + 0.004 * scale, z: target.z };
  } else {
    pts[4] = P(-0.13, -0.03);
  }
  return pts;
}

export const HANDS = {
  open: () => syntheticHand(),
  fist: () => syntheticHand({ ext: { index: 0, middle: 0, ring: 0, pinky: 0 } }),
  point: () => syntheticHand({ ext: { index: 1, middle: 0, ring: 0, pinky: 0 } }),
  peace: () => syntheticHand({ ext: { index: 1, middle: 1, ring: 0, pinky: 0 } }),
  pinch: () => syntheticHand({ thumb: 'index' }),
  snapContact: () => syntheticHand({ thumb: 'middle', ext: { index: 0.5, middle: 0.6, ring: 0.2, pinky: 0.2 } }),
  half: () => syntheticHand({ ext: { index: 0.5, middle: 0.5, ring: 0.5, pinky: 0.5 } }),
};
