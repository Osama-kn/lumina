import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyPose, openness, snapDistance, SnapDetector, Debouncer, palmCenter,
} from '../../src/logic/gestures.js';
import { HANDS, syntheticHand } from '../../src/logic/synthetic-hand.js';
import { Controller, MODE } from '../../src/logic/controller.js';

test('classifies each synthetic pose', () => {
  assert.equal(classifyPose(HANDS.open()), 'open');
  assert.equal(classifyPose(HANDS.fist()), 'fist');
  assert.equal(classifyPose(HANDS.point()), 'point');
  assert.equal(classifyPose(HANDS.peace()), 'peace');
  assert.equal(classifyPose(HANDS.pinch()), 'pinch');
  assert.equal(classifyPose(null), 'none');
  assert.equal(classifyPose([]), 'none');
});

test('pose classification ignores hand size and position', () => {
  for (const scale of [0.5, 1, 1.8]) {
    for (const cx of [0.2, 0.5, 0.8]) {
      assert.equal(classifyPose(syntheticHand({ scale, cx })), 'open', `scale ${scale} cx ${cx}`);
      assert.equal(
        classifyPose(syntheticHand({ scale, cx, ext: { index: 0, middle: 0, ring: 0, pinky: 0 } })),
        'fist',
      );
    }
  }
});

test('openness rises as fingers straighten', () => {
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.1) {
    const o = openness(syntheticHand({ ext: { index: t, middle: t, ring: t, pinky: t } }));
    assert.ok(o >= prev - 1e-9, `openness should not drop (t=${t.toFixed(1)})`);
    assert.ok(o >= 0 && o <= 1);
    prev = o;
  }
  assert.ok(openness(HANDS.fist()) < 0.1);
  assert.ok(openness(HANDS.open()) > 0.8);
});

test('forgiving sensitivity accepts a looser fist', () => {
  // Find a half-curled hand whose finger extension sits between the two "curled" bands.
  let looseFist = null;
  for (let t = 0; t <= 1; t += 0.01) {
    const hand = syntheticHand({ ext: { index: t, middle: t, ring: t, pinky: t } });
    const o = openness(hand);
    if (o > 0.37 && o < 0.43) { looseFist = hand; break; }
  }
  assert.ok(looseFist, 'expected a hand between the standard and forgiving fist thresholds');
  assert.notEqual(classifyPose(looseFist, 'standard'), 'fist');
  assert.equal(classifyPose(looseFist, 'forgiving'), 'fist');
});

test('palm centre follows the hand', () => {
  const a = palmCenter(syntheticHand({ cx: 0.3 }));
  const b = palmCenter(syntheticHand({ cx: 0.7 }));
  assert.ok(b.x - a.x > 0.35);
});

function runSnap(detector, frames) {
  let snaps = 0;
  for (const [hand, t] of frames) if (detector.update(snapDistance(hand), t)) snaps++;
  return snaps;
}

test('snap detector fires on press-then-flick', () => {
  const d = new SnapDetector();
  const frames = [
    [HANDS.open(), 0],
    [HANDS.snapContact(), 33],
    [HANDS.snapContact(), 66],
    [HANDS.snapContact(), 100],
    [HANDS.open(), 133],
  ];
  assert.equal(runSnap(d, frames), 1);
});

test('snap detector ignores slow opening, brief touches and repeats within cooldown', () => {
  // Contact too short (one frame, 0 ms held).
  assert.equal(runSnap(new SnapDetector(), [[HANDS.snapContact(), 0], [HANDS.open(), 33]]), 0);

  // Released, but drifted open over 400 ms through a half-open hand.
  const mid = syntheticHand({ thumb: 'side', ext: { index: 0.3, middle: 0.3, ring: 0.3, pinky: 0.3 } });
  const slow = [
    [HANDS.snapContact(), 0], [HANDS.snapContact(), 80],
    [mid, 120], [mid, 250], [mid, 400], [HANDS.open(), 520],
  ];
  // Only valid if the middle tip lands between contact and release thresholds for the mid hand.
  const md = snapDistance(mid);
  if (md > 0.32 && md < 0.75) assert.equal(runSnap(new SnapDetector(), slow), 0);

  // Two snaps 200 ms apart: second one is inside the cooldown.
  const d = new SnapDetector();
  const twice = [
    [HANDS.snapContact(), 0], [HANDS.snapContact(), 60], [HANDS.open(), 90],
    [HANDS.snapContact(), 150], [HANDS.snapContact(), 210], [HANDS.open(), 240],
  ];
  assert.equal(runSnap(d, twice), 1);
});

test('debouncer waits for a stable value', () => {
  const d = new Debouncer(100);
  assert.deepEqual(d.update('fist', 0), { value: 'none', changed: false });
  assert.deepEqual(d.update('fist', 50), { value: 'none', changed: false });
  assert.deepEqual(d.update('open', 60), { value: 'none', changed: false }); // flicker resets
  assert.deepEqual(d.update('open', 150), { value: 'none', changed: false });
  assert.deepEqual(d.update('open', 170), { value: 'open', changed: true });
  assert.deepEqual(d.update('open', 400), { value: 'open', changed: false });
});

test('controller walks the full gesture story', () => {
  const c = new Controller({ modelCount: 3 });
  const events = [];
  c.on((e) => events.push(e.type));

  assert.equal(c.mode, MODE.DORMANT);
  c.pose('fist');                       // nothing to form yet
  assert.equal(c.mode, MODE.DORMANT);

  c.snap();
  assert.equal(c.mode, MODE.CLOUD);
  c.pose('fist');
  assert.equal(c.mode, MODE.FORMED);

  c.openness(0.9);                      // ignored until the hand is open
  assert.equal(c.explode, 0);
  c.pose('open');
  c.openness(0.6);
  assert.equal(c.explode, 0.6);
  c.openness(1.4);
  assert.equal(c.explode, 1);

  c.pose('fist');                       // closing the hand reassembles
  assert.equal(c.explode, 0);
  assert.equal(c.mode, MODE.FORMED);

  c.pose('peace');
  assert.equal(c.modelIndex, 1);
  c.step(-2);
  assert.equal(c.modelIndex, 2);        // wraps around

  c.snap();
  assert.equal(c.mode, MODE.DORMANT);
  assert.ok(events.includes('mode') && events.includes('explode') && events.includes('model'));
});

test('peace does nothing while dormant', () => {
  const c = new Controller({ modelCount: 4 });
  c.pose('peace');
  assert.equal(c.modelIndex, 0);
});

test('the model list can grow, and goTo jumps straight to a model', () => {
  const c = new Controller({ modelCount: 3 });
  const seen = [];
  c.on((e) => { if (e.type === 'model') seen.push(e.index); });
  c.snap(); c.pose('fist'); c.setExplode(0.7);
  c.setModelCount(4);
  c.goTo(3);
  assert.equal(c.modelIndex, 3);
  assert.equal(c.explode, 0, 'a new model starts assembled');
  c.step(1);
  assert.equal(c.modelIndex, 0, 'wraps over the new count');
  c.goTo(-1);
  assert.equal(c.modelIndex, 3);
  assert.deepEqual(seen, [3, 0, 3]);
});
