import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, buildModel, partUniforms } from '../../src/models/registry.js';
import { yawPitch } from '../../src/lib/mat.js';
import { project, explodedPoint, pickPart, anchorOnScreen, stackColumn, chooseSide } from '../../src/logic/labels.js';

const cam = { rot: yawPitch(0, 0), distance: 4, fovY: Math.PI / 4, width: 1000, height: 800 };

test('the origin projects to the middle of the screen', () => {
  const s = project([0, 0, 0], cam);
  assert.ok(Math.abs(s.x - 500) < 1e-6 && Math.abs(s.y - 400) < 1e-6);
});

test('up in the model is up on the screen, right is right', () => {
  assert.ok(project([0, 1, 0], cam).y < 400);
  assert.ok(project([1, 0, 0], cam).x > 500);
});

test('points behind the camera do not project', () => {
  assert.equal(project([0, 0, 5], cam), null);
});

test('explodedPoint follows the part rule', () => {
  const p = explodedPoint([1, 0, 0], [0.5, 0, 0], [0, 2, 0, 0.5], 1);
  assert.deepEqual(p, [1.25, 2, 0]);
});

for (let i = 0; i < MODELS.length; i++) {
  test(`every part of "${MODELS[i].name}" has a title, an explanation and an anchor on the part`, () => {
    const model = buildModel(i, 6000);
    model.parts.forEach((part, p) => {
      assert.ok(part.name.length > 0, 'has a name');
      assert.ok(part.info.length > 20, `${part.name} has an explanation`);
      const a = [model.anchors[p * 3], model.anchors[p * 3 + 1], model.anchors[p * 3 + 2]];
      let found = false;
      for (let k = 0; k < 6000 && !found; k++) {
        found = model.target[k * 4 + 3] === p
          && Math.abs(model.target[k * 4] - a[0]) < 1e-6
          && Math.abs(model.target[k * 4 + 1] - a[1]) < 1e-6
          && Math.abs(model.target[k * 4 + 2] - a[2]) < 1e-6;
      }
      assert.ok(found, `${part.name}'s anchor is one of its own particles`);
    });
  });
}

test('picking at a part\'s anchor finds a particle nearby, and empty space finds nothing', () => {
  const model = buildModel(0, 20000);
  const { rules } = partUniforms(model);
  const s = anchorOnScreen(model, rules, 6, 1, 1, cam);
  assert.equal(pickPart(model, rules, 1, 1, cam, s, 12, 20000), 6);
  assert.equal(pickPart(model, rules, 0, 1, cam, { x: 2, y: 2 }, 10), -1);
});

test('stacked labels never overlap and stay inside the column', () => {
  const items = [100, 102, 104, 106, 500, 505].map((want) => ({ want, h: 30 }));
  const ys = stackColumn(items, 90, 540);
  const sorted = ys.map((y, i) => [y, items[i].h]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i][0] >= sorted[i - 1][0] + sorted[i - 1][1]);
  assert.ok(sorted[0][0] >= 90);
  assert.ok(sorted.at(-1)[0] + 30 <= 540);
});

test('a label only switches sides once its anchor is clearly across the middle', () => {
  assert.equal(chooseSide(null, 300, 1000), 'left');
  assert.equal(chooseSide('left', 530, 1000), 'left');
  assert.equal(chooseSide('left', 560, 1000), 'right');
  assert.equal(chooseSide('right', 470, 1000), 'right');
});
