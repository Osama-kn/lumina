import { test, expect } from '@playwright/test';
import { makeGlb, cube, QUAD } from '../unit/fixtures/make-glb.js';

const URL_ = '/?autostart=nocamera&n=20000';

const robot = () => Buffer.from(makeGlb({
  meshes: [{ name: 'cube', primitives: [cube(0.5)] }],
  nodes: [
    { name: 'Head', mesh: 0, translation: [0, 1.2, 0], scale: [0.6, 0.6, 0.6] },
    { name: 'Body', mesh: 0, scale: [1, 1.4, 0.8] },
    { name: 'Left_arm', mesh: 0, translation: [-0.9, 0.2, 0], scale: [0.3, 1, 0.3] },
  ],
}));

async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(URL_);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
  return errors;
}

/** Drop files on the page the way a browser does, built inside the page. */
async function drop(page, files) {
  await page.evaluate(async (list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([new Uint8Array(f.bytes)], f.name));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await window.__lumina.imported();
  }, files.map((f) => ({ name: f.name, bytes: [...f.buffer] })));
}

test('opening a .glb adds it to the list and shows it built', async ({ page }) => {
  const errors = await boot(page);
  const before = await page.evaluate(() => window.__lumina.controller.modelCount);
  await page.setInputFiles('#file-input', { name: 'toy_robot.glb', mimeType: 'model/gltf-binary', buffer: robot() });
  await page.evaluate(() => window.__lumina.imported());
  await expect(page.locator('#model-name')).toHaveText('Toy robot');
  const state = await page.evaluate(() => {
    const L = window.__lumina;
    return { count: L.controller.modelCount, mode: L.controller.mode, parts: L.model.parts.map((p) => p.name) };
  });
  expect(state.count).toBe(before + 1);
  expect(state.mode).toBe('formed');
  expect(state.parts).toEqual(['Head', 'Body', 'Left arm']);
  expect(errors).toEqual([]);
});

test('the Open button opens the file picker', async ({ page }) => {
  await boot(page);
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="open-file"]').click();
  expect((await chooser).isMultiple()).toBe(false);
});

test('dragging a file over the page shows where to drop it', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#drop')).toBeHidden();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'thing.glb'));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  await expect(page.locator('#drop')).toBeVisible();
  await expect(page.locator('#drop')).toContainText('.glb');
  await page.evaluate(() => window.dispatchEvent(new DragEvent('dragleave', { bubbles: true, clientX: 0, clientY: 0 })));
  await expect(page.locator('#drop')).toBeHidden();
});

test('dropping a file works like opening it, and the same name replaces the earlier one', async ({ page }) => {
  const errors = await boot(page);
  const before = await page.evaluate(() => window.__lumina.controller.modelCount);
  await drop(page, [{ name: 'robot.glb', buffer: robot() }]);
  await expect(page.locator('#model-name')).toHaveText('Robot');
  await drop(page, [{ name: 'robot.glb', buffer: robot() }]);
  expect(await page.evaluate(() => window.__lumina.controller.modelCount)).toBe(before + 1);
  await expect(page.locator('#drop')).toBeHidden();
  expect(errors).toEqual([]);
});

test('files Lumina cannot use explain themselves and change nothing', async ({ page }) => {
  const errors = await boot(page);
  const before = await page.evaluate(() => ({ name: window.__lumina.model.name, count: window.__lumina.controller.modelCount }));
  const external = Buffer.from(makeGlb({ meshes: [{ name: 'q', primitives: [QUAD] }], nodes: [{ name: 'Q', mesh: 0 }], format: 'gltf', externalUri: 'scene.bin' }));
  const cases = [
    [{ name: 'photo.png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]) }, "isn't a 3D model"],
    [{ name: 'empty.glb', buffer: Buffer.alloc(0) }, "isn't a 3D model"],
    [{ name: 'scene.gltf', buffer: external }, 'single .glb'],
  ];
  for (const [file, message] of cases) {
    await drop(page, [file]);
    await expect(page.locator('#toast')).toContainText(message);
  }
  const after = await page.evaluate(() => ({ name: window.__lumina.model.name, count: window.__lumina.controller.modelCount }));
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('files over 50 MB are refused before reading them', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(51 * 1024 * 1024)], 'huge.glb'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    await window.__lumina.imported();
  });
  await expect(page.locator('#toast')).toContainText('too big');
});
