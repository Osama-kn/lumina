// Phones and tablets: pinch to zoom, a lighter default load, and a roomier layout.
import { test, expect } from '@playwright/test';

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function open(browser, url = '/?autostart=nocamera&n=20000') {
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(url);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
  return { page, context, errors };
}

/** Two fingers on the scene: start apart by `from` px, end apart by `to` px. */
async function pinch(page, from, to) {
  await page.evaluate(([from, to]) => {
    const el = document.getElementById('scene');
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const ev = (type, id, x) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: cy, bubbles: true,
    }));
    ev('pointerdown', 1, cx - from / 2);
    ev('pointerdown', 2, cx + from / 2);
    for (let k = 1; k <= 10; k++) {
      const d = from + ((to - from) * k) / 10;
      ev('pointermove', 1, cx - d / 2);
      ev('pointermove', 2, cx + d / 2);
    }
    ev('pointerup', 1, cx - to / 2);
    ev('pointerup', 2, cx + to / 2);
  }, [from, to]);
}

test('pinching out zooms in, pinching in zooms out, and a pinch does not spin the model', async ({ browser }) => {
  const { page, context, errors } = await open(browser);
  const before = await page.evaluate(() => ({ zoom: window.__lumina.view.zoom, yaw: window.__lumina.view.yaw }));
  await pinch(page, 100, 200);
  const closer = await page.evaluate(() => ({ zoom: window.__lumina.view.zoom, yaw: window.__lumina.view.yaw }));
  expect(closer.zoom).toBeLessThan(before.zoom * 0.7);
  expect(Math.abs(closer.yaw - before.yaw)).toBeLessThan(0.05);
  await pinch(page, 200, 60);
  const farther = await page.evaluate(() => window.__lumina.view.zoom);
  expect(farther).toBeGreaterThan(closer.zoom * 1.5);
  expect(errors).toEqual([]);
  await context.close();
});

test('phones start with fewer particles and a capped resolution, unless the URL says otherwise', async ({ browser }) => {
  const { page, context } = await open(browser, '/?autostart=nocamera');
  const phone = await page.evaluate(() => ({ count: window.__lumina.count, dpr: window.__lumina.renderer.dpr }));
  expect(phone.count).toBe(80000);
  expect(phone.dpr).toBeLessThanOrEqual(1.5);
  await context.close();
  const asked = await open(browser, '/?autostart=nocamera&n=150000');
  expect(await asked.page.evaluate(() => window.__lumina.count)).toBe(150000);
  await asked.context.close();
});

test('on a phone the controls sit in one swipeable row and the bottom is uncluttered', async ({ browser }) => {
  const { page, context } = await open(browser);
  await page.evaluate(() => { const L = window.__lumina; L.controller.snap(); L.controller.pose('fist'); L.tick(30); });
  const tops = await page.evaluate(() => [...document.querySelectorAll('#controls button')].map((b) => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await expect(page.locator('#parts')).toBeHidden();
  await expect(page.locator('#model-blurb')).toBeHidden();
  await expect(page.locator('#model-name')).toBeVisible();
  await context.close();
});

test('on a phone the guide starts folded away and opens from the Guide button', async ({ browser }) => {
  const { page, context } = await open(browser);
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide')).toBeHidden();
  await page.locator('[data-action="guide"]').click();
  await page.evaluate(() => window.__lumina.tick(1));
  await expect(page.locator('#guide')).toBeVisible();
  await expect(page.locator('[data-action="guide"]')).toHaveAttribute('aria-pressed', 'true');
  await context.close();
});

test('on a tall phone screen the model starts far enough back to fit the width', async ({ browser }) => {
  const { page, context } = await open(browser);
  const fit = await page.evaluate(() => {
    const L = window.__lumina;
    const halfWidth = Math.tan(L.renderer.fovY / 2) * L.view.zoom * (innerWidth / innerHeight);
    return { halfWidth, zoom: L.view.zoom };
  });
  expect(fit.halfWidth).toBeGreaterThanOrEqual(1.5); // models reach a radius of about 1.1-1.5
  await context.close();
});

test('on a wide screen the starting distance is unchanged', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/?autostart=nocamera&n=20000');
  await page.waitForFunction(() => window.__lumina);
  expect(await page.evaluate(() => window.__lumina.view.zoom)).toBeCloseTo(4.2, 5);
});
