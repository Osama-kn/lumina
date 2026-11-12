// Guards the visual language: museum captions, not a template. If frosted
// glass, pill buttons, glows or emoji creep back in, these fail.
import { test, expect } from '@playwright/test';

const URL_ = '/?autostart=nocamera&n=20000';

async function boot(page) {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
}

/** Everything that matters on screen at once: built, apart, picker and guide open. */
async function everything(page) {
  await page.evaluate(() => {
    const L = window.__lumina;
    L.useTracker({ detect: () => null, stop() {} });
    L.controller.snap(); L.controller.pose('fist'); L.tick(30);
    L.controller.setExplode(1); L.tick(60);
  });
  await page.locator('[data-action="models"]').click();
}

test('nothing on screen uses frosted glass, pills or glow', async ({ page }) => {
  await boot(page);
  await everything(page);
  const offenders = await page.evaluate(() => {
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'none') continue;
      const what = el.id || el.className || el.tagName;
      if (s.backdropFilter && s.backdropFilter !== 'none') bad.push(`${what}: backdrop-filter`);
      if (s.boxShadow !== 'none') bad.push(`${what}: box-shadow`);
      if (parseFloat(s.borderTopLeftRadius) > 2) bad.push(`${what}: radius ${s.borderTopLeftRadius}`);
      if (s.backgroundImage.includes('gradient')) bad.push(`${what}: gradient`);
    }
    for (const b of document.querySelectorAll('#controls button')) {
      if (getComputedStyle(b).borderTopWidth !== '0px') bad.push(`control ${b.dataset.action}: border`);
    }
    return bad;
  });
  expect(offenders).toEqual([]);
});

test('no emoji anywhere in the interface', async ({ page }) => {
  await boot(page);
  await everything(page);
  await page.keyboard.press('Escape');
  await page.keyboard.press('h');
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(/\p{Extended_Pictographic}/gu) ?? []).toEqual([]);
});

test('keyboard focus is still visible without borders', async ({ page }) => {
  await boot(page);
  await page.locator('#controls button').first().focus();
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  expect(outline).not.toBe('none');
});

test('names are set in the serif', async ({ page }) => {
  await boot(page);
  const family = await page.evaluate(() => getComputedStyle(document.getElementById('model-name')).fontFamily);
  expect(family).toContain('Newsreader');
});

test('the title reads like a catalogue entry', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#model-number')).toHaveText(/^No\. 01 of \d+$/);
  await page.evaluate(() => window.__lumina.controller.goTo(2));
  await expect(page.locator('#model-number')).toHaveText(/^No\. 03 of \d+$/);
});

test('the model list is a numbered index', async ({ page }) => {
  await boot(page);
  await page.locator('[data-action="models"]').click();
  await expect(page.locator('#model-list [data-index="0"]')).toHaveText(/^01\s*Saturn$/);
  await expect(page.locator('#model-list [data-index="9"]')).toHaveText(/^10\s*/);
});

test('the hint hides with a word, not a symbol', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('lumina.hints.done'); } catch {} });
  await boot(page);
  await expect(page.locator('#hint button')).toHaveText('Hide');
});
