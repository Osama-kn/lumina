// Turns MediaPipe hand landmarks (21 points, normalised image coordinates)
// into poses, a continuous "openness" value and finger-snap events.
// Everything here is pure: no DOM, no clocks, so it runs in Node tests.

export const LM = {
  WRIST: 0,
  THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20,
};

const FINGERS = [
  ['index', LM.INDEX_PIP, LM.INDEX_TIP],
  ['middle', LM.MIDDLE_PIP, LM.MIDDLE_TIP],
  ['ring', LM.RING_PIP, LM.RING_TIP],
  ['pinky', LM.PINKY_PIP, LM.PINKY_TIP],
];

export const POSES = ['none', 'fist', 'open', 'point', 'peace', 'pinch'];

/** Threshold sets. "forgiving" relaxes the static pose bands a little. */
export const SENSITIVITY = {
  standard: { extended: 0.68, curled: 0.36, pinch: 0.3 },
  forgiving: { extended: 0.6, curled: 0.44, pinch: 0.36 },
};

export function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Distance wrist→middle-finger knuckle: a scale that doesn't depend on how far the hand is from the camera. */
export function handScale(lm) {
  return dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]) || 1e-6;
}

/**
 * How straight each finger is, 0 = fully curled, 1 = fully extended.
 * A curled finger's tip ends up closer to the wrist than its middle joint,
 * so the tip/PIP distance ratio from the wrist is a robust, rotation-free signal.
 */
export function fingerExtension(lm) {
  const wrist = lm[LM.WRIST];
  const out = {};
  for (const [name, pip, tip] of FINGERS) {
    const ratio = dist(wrist, lm[tip]) / (dist(wrist, lm[pip]) || 1e-6);
    out[name] = clamp01((ratio - 0.85) / (1.45 - 0.85));
  }
  return out;
}

/** Mean extension of the four fingers: drives how far a model explodes. */
export function openness(lm) {
  const e = fingerExtension(lm);
  return (e.index + e.middle + e.ring + e.pinky) / 4;
}

/** Thumb tip to index tip, relative to hand size. */
export function pinchDistance(lm) {
  return dist(lm[LM.THUMB_TIP], lm[LM.INDEX_TIP]) / handScale(lm);
}

/** Thumb tip to middle tip, relative to hand size: the snap signal. */
export function snapDistance(lm) {
  return dist(lm[LM.THUMB_TIP], lm[LM.MIDDLE_TIP]) / handScale(lm);
}

/** Palm centre (average of wrist and the four knuckles), in image coordinates. */
export function palmCenter(lm) {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0, y = 0, z = 0;
  for (const i of ids) { x += lm[i].x; y += lm[i].y; z += lm[i].z || 0; }
  return { x: x / ids.length, y: y / ids.length, z: z / ids.length };
}

/** Classify a single frame's landmarks into one of POSES. */
export function classifyPose(lm, sensitivity = 'standard') {
  if (!lm || lm.length < 21) return 'none';
  const t = SENSITIVITY[sensitivity] || SENSITIVITY.standard;
  const e = fingerExtension(lm);
  const up = (v) => v >= t.extended;
  const down = (v) => v <= t.curled;

  // Pinch first: thumb and index touching while the other three stay up (an "OK" sign),
  // so it can't be confused with a fist where everything is close together.
  if (pinchDistance(lm) < t.pinch && !down(e.middle) && !down(e.ring) && !down(e.pinky)) {
    return 'pinch';
  }
  if (down(e.index) && down(e.middle) && down(e.ring) && down(e.pinky)) return 'fist';
  if (up(e.index) && up(e.middle) && up(e.ring) && up(e.pinky)) return 'open';
  if (up(e.index) && up(e.middle) && down(e.ring) && down(e.pinky)) return 'peace';
  if (up(e.index) && down(e.middle) && down(e.ring) && down(e.pinky)) return 'point';
  return 'none';
}

/**
 * Finger-snap detector. A snap is: thumb and middle fingertip pressed together
 * for a moment, then the middle finger flicks away fast. We look for a contact
 * phase (distance below `contact` for at least `minHold` ms) followed by a
 * release above `release` within `maxFlick` ms.
 */
export class SnapDetector {
  constructor({ contact = 0.32, release = 0.75, minHold = 40, maxFlick = 180, cooldown = 450 } = {}) {
    Object.assign(this, { contact, release, minHold, maxFlick, cooldown });
    this.reset();
  }

  reset() {
    this.contactSince = null;  // when the fingers first touched
    this.releasedAt = null;    // when they last let go of contact
    this.lastSnap = -Infinity;
  }

  /** Feed one sample. Returns true on the frame a snap is recognised. */
  update(distance, now) {
    if (distance == null) { this.contactSince = null; this.releasedAt = null; return false; }

    if (distance < this.contact) {
      if (this.contactSince === null) this.contactSince = now;
      this.releasedAt = null;
      return false;
    }

    // Fingers apart. Remember the moment contact ended, if it was held long enough.
    if (this.contactSince !== null) {
      const held = now - this.contactSince;
      this.contactSince = null;
      this.releasedAt = held >= this.minHold ? now : null;
    }

    if (this.releasedAt !== null && distance > this.release) {
      const flick = now - this.releasedAt;
      this.releasedAt = null;
      if (flick <= this.maxFlick && now - this.lastSnap >= this.cooldown) {
        this.lastSnap = now;
        return true;
      }
    } else if (this.releasedAt !== null && now - this.releasedAt > this.maxFlick) {
      this.releasedAt = null; // opened too slowly: not a snap
    }
    return false;
  }
}

/** Only reports a new value once it has been seen continuously for `holdMs`. */
export class Debouncer {
  constructor(holdMs = 120, initial = 'none') {
    this.holdMs = holdMs;
    this.value = initial;
    this.candidate = initial;
    this.since = 0;
  }

  /** Returns the stable value; `changed` is true on the frame it switches. */
  update(raw, now) {
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = now;
    }
    if (this.candidate !== this.value && now - this.since >= this.holdMs) {
      this.value = this.candidate;
      return { value: this.value, changed: true };
    }
    return { value: this.value, changed: false };
  }
}
