// The live demo on GitHub Pages is served from a sub-path (/lumina/) with no
// node_modules, so this builds the site the way the Pages workflow does and
// serves it the same way.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const OUT = 'test-results/site';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary' };

let server, base;
test.beforeAll(async () => {
  execFileSync('node', ['scripts/build-site.mjs', OUT]);
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/lumina/')) { res.writeHead(404).end(); return; }
    let file = join(OUT, decodeURIComponent(url.pathname.slice('/lumina/'.length)) || 'index.html');
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/lumina/`;
});
test.afterAll(() => server?.close());

test('the built site works from a sub-path, with no node_modules', async ({ page }) => {
  expect(existsSync(join(OUT, 'node_modules'))).toBe(false);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(`${base}?autostart=nocamera&n=20000`);
  await page.waitForFunction(() => window.__lumina);

  const runtime = await page.evaluate(async (b) => {
    const { resolveRuntime } = await import(`${b}src/hands.js`);
    return resolveRuntime();
  }, base);
  expect(runtime.bundle).toBe(`${base}vendor/tasks-vision/vision_bundle.mjs`);
  expect(runtime.wasm).toBe(`${base}vendor/tasks-vision/wasm`);
  expect(runtime.model).toBe(`${base}models/hand_landmarker.task`);
  const bundleOk = await page.evaluate(async (u) => (await fetch(u)).ok, runtime.bundle);
  expect(bundleOk).toBe(true);

  // A bundled 3D example loads from the sub-path too.
  const name = await page.evaluate(async () => {
    const L = window.__lumina;
    const i = [...Array(L.controller.modelCount).keys()].find((k) => L.entryName(k) === 'Flight helmet');
    L.controller.goTo(i);
    await L.ready();
    return L.model.name;
  });
  expect(name).toBe('Flight helmet');
  expect(errors).toEqual([]);
});

test('run locally, hand tracking still comes from node_modules', async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto('/?autostart=nocamera&n=20000');
  const runtime = await page.evaluate(async () => (await import('/src/hands.js')).resolveRuntime());
  expect(runtime.bundle).toMatch(/\/node_modules\/@mediapipe\/tasks-vision\/vision_bundle\.mjs$/);
});
