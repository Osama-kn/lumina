import { test, expect } from '@playwright/test';

// Small particle count keeps software WebGL fast; the engine code path is the same.
const URL_ = '/?autostart=nocamera&n=20000';

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Keep tests offline: serve an empty stylesheet instead of Google Fonts.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
  return errors;
}

/** Average brightness of the WebGL canvas, 0..255. */
async function brightness(page) {
  return page.evaluate(() => {
    const c = document.getElementById('scene');
    const off = document.createElement('canvas');
    off.width = 160; off.height = 100;
    const g = off.getContext('2d');
    g.drawImage(c, 0, 0, off.width, off.height);
    const d = g.getImageData(0, 0, off.width, off.height).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return s / (d.length / 4) / 3;
  });
}

test('boots without errors and renders particles', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => window.__lumina.tick(30));
  expect(errors).toEqual([]);
  await expect(page.locator('#model-name')).toHaveText('Saturn');
  await expect(page.locator('#start')).toBeHidden();
});

test('keyboard drives the full story: snap, form, explode, next, sleep', async ({ page }) => {
  const errors = await boot(page);
  const mode = () => page.evaluate(() => window.__lumina.controller.mode);

  const dormant = await brightness(page);
  await page.keyboard.press('Space');
  expect(await mode()).toBe('cloud');
  await page.evaluate(() => window.__lumina.tick(120));
  const cloud = await brightness(page);
  expect(cloud).toBeGreaterThan(dormant);

  await page.keyboard.press('f');
  expect(await mode()).toBe('formed');
  await page.evaluate(() => window.__lumina.tick(150));
  await expect(page.locator('#parts li')).toHaveCount(8);

  await page.keyboard.press('o');
  expect(await page.evaluate(() => window.__lumina.controller.explode)).toBe(1);
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.__lumina.controller.explode)).toBeCloseTo(0.9, 5);

  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#model-name')).toHaveText('Human heart');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  // Wrapped around to the last model in the list.
  const last = await page.evaluate(async () => {
    const L = window.__lumina;
    await L.ready();
    return L.entryName(L.controller.modelCount - 1);
  });
  await expect(page.locator('#model-name')).toHaveText(last);

  await page.keyboard.press('Space');
  expect(await mode()).toBe('dormant');
  expect(errors).toEqual([]);
});

test('synthetic hands drive the gesture pipeline', async ({ page }) => {
  const errors = await boot(page);
  const result = await page.evaluate(async () => {
    const { HANDS } = await import('/src/logic/synthetic-hand.js');
    const L = window.__lumina;
    const log = [];
    const hold = (hand, frames) => L.tick(frames, 1 / 60, hand);

    hold(HANDS.open(), 10);
    hold(HANDS.snapContact(), 6);
    hold(HANDS.open(), 12);          // flick: snap
    log.push(L.controller.mode);

    hold(HANDS.fist(), 12);           // debounced fist: form
    log.push(L.controller.mode);

    hold(HANDS.open(), 12);           // open hand: explode
    log.push(L.controller.explode > 0.8);

    hold(HANDS.fist(), 12);           // close: back together
    log.push(L.controller.explode);

    hold(HANDS.peace(), 12);          // next model
    log.push(L.model.name);
    return log;
  });
  expect(result).toEqual(['cloud', 'formed', true, 0, 'Human heart']);
  expect(errors).toEqual([]);
});

test('the GPU physics shader matches its CPU twin', async ({ page }) => {
  const errors = await boot(page);
  const worst = await page.evaluate(async () => {
    const { stepParticle } = await import('/src/logic/physics.js');
    const L = window.__lumina;
    const r = L.renderer;
    const N = 64;
    let worst = 0;

    for (const mode of [0, 1, 2]) {
      // Put known positions and velocities into the first N particles.
      const state = new Float32Array(N * 6);
      for (let i = 0; i < N; i++) {
        state.set([Math.sin(i) * 1.5, Math.cos(i * 1.7), Math.sin(i * 0.3) * 0.8, 0.3, -0.2, 0.1 * (i % 5)], i * 6);
      }
      r.writeState(state, 0);
      const u = {
        mode, dt: 1 / 60, time: 1.25, explode: 0.6, beat: 1.03, attract: 1, attractor: [0.3, -0.1, 0.2],
        rules: r.partRules, centers: r.partCenters,
      };
      r.step(u);
      const gpu = r.readState(0, N);

      const target = L.model.target;
      for (let i = 0; i < N; i++) {
        const [p, v] = stepParticle(
          Array.from(state.subarray(i * 6, i * 6 + 3)),
          Array.from(state.subarray(i * 6 + 3, i * 6 + 6)),
          target.subarray(i * 4, i * 4 + 4),
          r.seeds.subarray(i * 4, i * 4 + 4),
          u,
        );
        for (let k = 0; k < 3; k++) {
          worst = Math.max(worst, Math.abs(gpu[i * 6 + k] - p[k]), Math.abs(gpu[i * 6 + 3 + k] - v[k]));
        }
      }
    }
    return worst;
  });
  // Float32 on the GPU vs float64 in JS: agreement to well under a micrometre per frame.
  expect(worst).toBeLessThan(1e-4);
  expect(errors).toEqual([]);
});

test('every model loads and renders', async ({ page }) => {
  const errors = await boot(page);
  const { names, count } = await page.evaluate(async () => {
    const L = window.__lumina;
    L.controller.snap();
    L.controller.pose('fist');
    const seen = [];
    for (let i = 0; i < L.controller.modelCount; i++) {
      await L.ready();
      L.tick(20);
      seen.push(L.model.name);
      L.controller.step(1);
    }
    return { names: seen, count: L.controller.modelCount };
  });
  expect(count).toBeGreaterThan(6);
  expect(new Set(names).size).toBe(count);
  expect(errors).toEqual([]);
});

test('part labels appear when pulled apart and hovering explains a part', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => {
    const L = window.__lumina;
    L.controller.snap();
    L.controller.pose('fist');
    L.tick(30);
  });
  await expect(page.locator('.label').first()).toBeHidden();

  await page.evaluate(() => {
    const L = window.__lumina;
    L.controller.setExplode(1);
    L.tick(60);
  });
  const count = await page.evaluate(() => window.__lumina.model.parts.length);
  await expect(page.locator('.label:visible')).toHaveCount(count);

  const label = page.locator('.label').nth(6);
  await label.hover();
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(label.locator('.label-info')).toBeVisible();
  await expect(label.locator('.label-info')).toContainText('moon');
  expect(await page.evaluate(() => window.__lumina.view.highlight)).toBe(6);

  await page.keyboard.press('l');
  await page.mouse.move(2, 2);
  await page.evaluate(() => window.__lumina.tick(90));
  await expect(page.locator('.label:visible')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('pointing a finger at the model selects a part', async ({ page }) => {
  const errors = await boot(page);
  const result = await page.evaluate(async () => {
    const { syntheticHand } = await import('/src/logic/synthetic-hand.js');
    const L = window.__lumina;
    L.controller.snap();
    L.controller.pose('fist');
    L.tick(30);
    const pointing = syntheticHand({ cx: 0.5, cy: 0.72, ext: { index: 1, middle: 0, ring: 0, pinky: 0 } });
    L.tick(30, 1 / 60, pointing);
    return { pose: L.input.pose, part: L.view.highlight };
  });
  expect(result.pose).toBe('point');
  expect(result.part).toBeGreaterThanOrEqual(0);
  await expect(page.locator('#finger')).toBeVisible();
  await expect(page.locator('.label.active .label-info')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the demo plays the gesture story by itself', async ({ page }) => {
  const errors = await boot(page);
  const seen = await page.evaluate(() => {
    const L = window.__lumina;
    const modes = new Set();
    let maxExplode = 0;
    L.playDemo();
    for (let i = 0; i < 1100; i++) {
      L.tick(1);
      modes.add(L.controller.mode);
      maxExplode = Math.max(maxExplode, L.controller.explode);
    }
    return { modes: [...modes].sort(), maxExplode, model: L.model.name };
  });
  expect(seen.modes).toEqual(['cloud', 'dormant', 'formed']);
  expect(seen.maxExplode).toBeGreaterThan(0.9);
  expect(seen.model).toBe('Human heart'); // the demo's peace sign moves on one model
  expect(errors).toEqual([]);
});

test('help opens and closes from the keyboard', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('h');
  await expect(page.locator('#help')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help')).toBeHidden();
});

test('phone layout keeps everything on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await expect(page.locator('#controls [data-action="help"]')).toBeInViewport();
});

test('starting on a 3D-file model waits for it without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  const index = await (async () => {
    await page.goto('/?autostart=nocamera&n=20000');
    await page.waitForFunction(() => window.__lumina);
    return page.evaluate(() => window.__lumina.entryName && [...Array(window.__lumina.controller.modelCount).keys()]
      .find((i) => window.__lumina.entryName(i) === 'Chess set'));
  })();
  await page.goto(`/?autostart=nocamera&n=20000&model=${index}`);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.ready());
  await page.waitForTimeout(300);
  await expect(page.locator('#model-name')).toHaveText('Chess set');
  expect(errors).toEqual([]);
});
