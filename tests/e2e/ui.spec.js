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
