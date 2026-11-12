// Glue between raw hand landmarks and the controller: classify the pose,
// debounce it, watch for snaps, and feed continuous values (openness, palm
// position, twist). Pure: the caller passes the landmarks and the time, so the
// browser tests and the demo can drive it with synthetic hands.

import {
  classifyPose, openness, snapDistance, palmCenter, SnapDetector, Debouncer, LM,
} from './gestures.js';

/** Map raw finger openness (≈0.1 relaxed fist … 1 flat hand) to explode amount. */
export function explodeFromOpenness(o) {
  return Math.max(0, Math.min(1, (o - 0.2) / 0.7));
}

export class HandInput {
  constructor(controller, { sensitivity = 'standard', holdMs = 110 } = {}) {
    this.controller = controller;
    this.sensitivity = sensitivity;
    this.snap = new SnapDetector();
    this.debouncer = new Debouncer(holdMs);
    this.reset();
  }

  reset() {
    this.present = false;
    this.rawPose = 'none';
    this.pose = 'none';
    this.openness = 0;
    this.palm = null;   // { x, y } in mirrored screen space (0..1, left to right as the user sees it)
    this.twist = 0;     // hand roll in radians, 0 = upright, positive = tilted to the user's right
    this.landmarks = null;
  }

  /** @param {object[]|null} lm 21 landmarks or null when no hand is visible */
  process(lm, now) {
    this.landmarks = lm;
    if (!lm) {
      this.present = false;
      this.rawPose = 'none';
      this.palm = null;
      this.snap.update(null, now);
      const r = this.debouncer.update('none', now);
      if (r.changed) this.controller.pose('none');
      this.pose = r.value;
      return;
    }

    this.present = true;
    this.rawPose = classifyPose(lm, this.sensitivity);
    this.openness = openness(lm);

    const p = palmCenter(lm);
    this.palm = { x: 1 - p.x, y: p.y }; // the preview is mirrored, so flip x to match what the user sees
    const w = lm[LM.WRIST], m = lm[LM.MIDDLE_MCP];
    // Image x is mirrored on screen, so -dx is "to the user's right".
    this.twist = Math.atan2(-(m.x - w.x), -(m.y - w.y));

    if (this.snap.update(snapDistance(lm), now)) this.controller.snap();

    const r = this.debouncer.update(this.rawPose, now);
    if (r.changed) this.controller.pose(r.value);
    this.pose = r.value;

    this.controller.openness(explodeFromOpenness(this.openness));
  }
}
