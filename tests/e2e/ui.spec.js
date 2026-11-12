import { test, expect } from '@playwright/test';

const URL_ = '/?autostart=nocamera&n=20000';

async function boot(page, url = URL_) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
  return errors;
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('the model picker lists every model and switches to one', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('#model-list')).toBeHidden();
  await page.locator('[data-action="models"]').click();
  await expect(page.locator('#model-list')).toBeVisible();
  const count = await page.evaluate(() => window.__lumina.controller.modelCount);
  await expect(page.locator('#model-list [data-index]')).toHaveCount(count);
  await expect(page.locator('#model-list [data-index="0"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#model-list')).toContainText('Open 3D file');

  await page.locator('#model-list [data-index="3"]').click();
  const want = await page.evaluate(() => window.__lumina.entryName(3));
  await expect(page.locator('#model-name')).toHaveText(want);
  await expect(page.locator('#model-list')).toBeHidden();

  await page.keyboard.press('m');
  await expect(page.locator('#model-list')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#model-list')).toBeHidden();
  expect(errors).toEqual([]);
});

test('pulled apart, the title gets out of the way of the labels', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const L = window.__lumina;
    L.controller.snap(); L.controller.pose('fist'); L.tick(30);
  });
  await expect(page.locator('body')).not.toHaveClass(/compact/);
  await page.evaluate(() => { window.__lumina.controller.setExplode(1); window.__lumina.tick(60); });
  await expect(page.locator('body')).toHaveClass(/compact/);
  await expect(page.locator('#parts')).toBeHidden();
  const title = await page.locator('.model h1').boundingBox();
  expect(title.height).toBeLessThan(48);
  for (const label of await page.locator('.label:visible').all()) {
    expect(overlaps(title, await label.boundingBox())).toBe(false);
  }
  await page.evaluate(() => { window.__lumina.controller.pose('fist'); window.__lumina.tick(10); });
  await expect(page.locator('body')).not.toHaveClass(/compact/);
});

test('hints walk a first-time visitor through the story, once', async ({ page }) => {
  await boot(page);
  const hint = page.locator('#hint');
  await expect(hint).toContainText('Space');
  await page.keyboard.press('Space');
  await expect(hint).toContainText('fist');
  await page.keyboard.press('f');
  await expect(hint).toContainText('Open your hand');
  await page.keyboard.press('o');
  await expect(hint).toBeHidden();

  await boot(page);
  await expect(page.locator('#hint')).toBeHidden();
});

test('hints can be dismissed', async ({ page }) => {
  await boot(page);
  await page.locator('#hint button').click();
  await expect(page.locator('#hint')).toBeHidden();
});

test('help explains how to use your own model', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('h');
  await expect(page.locator('#help')).toContainText('Use your own model');
  await expect(page.locator('#help')).toContainText('.glb');
});

test('on a phone the open picker fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('[data-action="models"]').click();
  await expect(page.locator('#model-list')).toBeInViewport({ ratio: 1 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('a 3D model shows who made it', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#model-credit')).toBeHidden();
  await page.evaluate(async () => {
    const L = window.__lumina;
    L.controller.goTo([...Array(L.controller.modelCount).keys()].find((i) => L.entryName(i) === 'Chess set'));
    await L.ready();
  });
  await expect(page.locator('#model-credit')).toBeVisible();
  await expect(page.locator('#model-credit')).toContainText('CC BY 4.0');
  await expect(page.locator('#model-credit a')).toHaveAttribute('href', /CREDITS\.md/);
});

test('in the picker, Space chooses the focused model and arrows move between models', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('m');
  await page.locator('#model-list [data-index="2"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#model-list [data-index="3"]')).toBeFocused();
  await page.keyboard.press('Space');
  const want = await page.evaluate(() => window.__lumina.entryName(3));
  await expect(page.locator('#model-name')).toHaveText(want);
  expect(await page.evaluate(() => window.__lumina.controller.mode)).toBe('dormant');
});

test('with the camera on, a guide on the left shows what your hand can do', async ({ page }) => {
  const errors = await boot(page);
  const guide = page.locator('#guide');
  await expect(guide.locator('[data-gesture="snap"]')).toBeHidden();

  // A stand-in camera that reports whatever hand the test sets.
  await page.evaluate(() => {
    window.__hand = null;
    window.__lumina.useTracker({ detect: () => window.__hand, stop() {} });
    window.__lumina.tick(1);
  });
  await expect(guide).toBeVisible();
  const box = await guide.boundingBox();
  expect(box.x).toBeLessThan(60);
  for (const g of ['snap', 'fist', 'open', 'tilt', 'peace', 'point']) {
    await expect(guide.locator(`[data-gesture="${g}"]`)).toBeVisible();
  }

  // Asleep: only the snap does anything.
  await expect(guide.locator('[data-gesture="snap"]')).toHaveClass(/now/);
  await expect(guide.locator('[data-gesture="open"]')).not.toHaveClass(/now/);

  // Built: pulling apart is what to try, and the pose you hold lights up.
  await page.evaluate(async () => {
    const { HANDS } = await import('/src/logic/synthetic-hand.js');
    const L = window.__lumina;
    L.controller.snap(); L.controller.pose('fist');
    window.__hand = HANDS.fist();
    L.tick(12);
  });
  await expect(guide.locator('[data-gesture="open"]')).toHaveClass(/now/);
  await expect(guide.locator('[data-gesture="fist"]')).toHaveClass(/held/);

  await page.evaluate(() => { window.__lumina.useTracker(null); window.__lumina.tick(1); });
  await expect(guide.locator('[data-gesture="snap"]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('without a camera, the guide lists the keys and mouse instead', async ({ page }) => {
  const errors = await boot(page);
  const guide = page.locator('#guide');
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(guide).toBeVisible();
  await expect(guide.locator('.guide-title')).toContainText(/keyboard/i);
  for (const k of ['space', 'f', 'o', 'updown', 'leftright', 'drag', 'click']) {
    await expect(guide.locator(`[data-key="${k}"]`)).toBeVisible();
  }
  await expect(guide.locator('[data-gesture="snap"]')).toBeHidden();

  // Asleep: only Space does anything.
  await expect(guide.locator('[data-key="space"]')).toHaveClass(/now/);
  await expect(guide.locator('[data-key="o"]')).not.toHaveClass(/now/);

  await page.keyboard.press('Space');
  await page.keyboard.press('f');
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(guide.locator('[data-key="o"]')).toHaveClass(/now/);
  await expect(guide.locator('[data-key="click"]')).toHaveClass(/now/);
  expect(errors).toEqual([]);
});

test('the guide can be put away and brought back, and stays put away', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.__lumina.tick(1));
  await page.locator('#guide-hide').click();
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide')).toBeHidden();

  await boot(page);
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide')).toBeHidden();
  await page.keyboard.press('g');
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide')).toBeVisible();
});

test('on a touch screen the guide speaks of tapping and dragging', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('lumina.guide.hidden', '0'); } catch {} });
  await boot(page);
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide .guide-title')).toContainText(/touch/i);
  // The guide already says what to do next, so the first-run hint steps aside on small screens.
  await expect(page.locator('#hint')).toBeHidden();
  await expect(page.locator('#guide [data-touch="drag"]')).toBeVisible();
  await expect(page.locator('#guide [data-key="space"]')).toBeHidden();
  await context.close();
});

test('labels on the left start below the gesture guide', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const L = window.__lumina;
    L.useTracker({ detect: () => null, stop() {} });
    L.controller.snap(); L.controller.pose('fist'); L.tick(30);
    L.controller.setExplode(1); L.tick(60);
  });
  const guide = await page.locator('#guide').boundingBox();
  for (const label of await page.locator('.label:visible').all()) {
    const b = await label.boundingBox();
    const overlap = b.x < guide.x + guide.width && guide.x < b.x + b.width && b.y < guide.y + guide.height && guide.y < b.y + b.height;
    expect(overlap).toBe(false);
  }
});

test('on a phone, a selected part\'s explanation sits below the gesture guide', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { try { localStorage.setItem('lumina.guide.hidden', '0'); } catch {} });
  await boot(page);
  await page.evaluate(() => {
    const L = window.__lumina;
    L.useTracker({ detect: () => null, stop() {} });
    L.controller.snap(); L.controller.pose('fist'); L.tick(30);
    L.controller.setExplode(1); L.tick(30);
    L.select.pinned = 2; L.tick(60);
  });
  const guide = await page.locator('#guide').boundingBox();
  const label = await page.locator('.label.active').boundingBox();
  expect(label.y).toBeGreaterThanOrEqual(guide.y + guide.height);
});
