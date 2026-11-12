// Records the README screenshots and the hero GIF from the real app.
//
//   npm run capture            software rendering (works anywhere, same result every time)
//   npm run capture -- --gpu   use your graphics card (faster, smoother particles)
//
// Writes docs/preview.png, docs/explode.png, docs/import.png and docs/hero.gif.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import gifenc from 'gifenc';

const { GIFEncoder, quantize, applyPalette } = gifenc;
const PORT = 5198;
const GPU = process.argv.includes('--gpu');
const GIF = { width: 720, height: 405, fps: 12, viewport: { width: 960, height: 540 } };

const server = spawn(process.execPath, ['server.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

const browser = await chromium.launch({
  args: GPU ? ['--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await open({ width: 1280, height: 720 });
  await shot(page, 0, 0, 'docs/preview.png');      // Saturn, built
  await shot(page, 1, 1, 'docs/explode.png');      // the heart, pulled apart
  await shot(page, index(page, 'Chess set'), 1, 'docs/import.png');
  await page.close();

  await gif();
} finally {
  await browser.close();
  server.kill();
}

async function open(viewport) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => { try { localStorage.setItem('lumina.hints.done', '1'); } catch {} });
  await page.goto(`http://localhost:${PORT}/?autostart=nocamera&n=120000`);
  await page.waitForFunction(() => window.__lumina);
  await page.evaluate(() => window.__lumina.pause());
  return page;
}

async function index(page, name) {
  return page.evaluate((n) => {
    const L = window.__lumina;
    return [...Array(L.controller.modelCount).keys()].find((i) => L.entryName(i) === n);
  }, name);
}

/** Build model i, set how far apart it is, let it settle, take a screenshot. */
async function shot(page, i, explode, path) {
  await page.evaluate(async ([i, explode]) => {
    const L = window.__lumina;
    L.controller.goTo(await i);
    await L.ready();
    if (L.controller.mode === 'dormant') L.controller.snap();
    L.controller.pose('fist');
    L.view.autoRotate = false;
    L.view.yaw = 0.6;
    L.view.pitch = 0.32;
    L.tick(150);
    L.controller.setExplode(explode);
    L.tick(150);
  }, [await i, explode]);
  await page.waitForTimeout(500); // let the parts list fade in
  await page.screenshot({ path });
  console.log(`wrote ${path}`);
}

/** The story in a few seconds: wake, build, pull apart, then a 3D file coming apart. */
async function gif() {
  const page = await open(GIF.viewport); // recorded larger, then scaled down so the UI isn't cramped
  const chess = await index(page, 'Chess set');
  await page.evaluate(async (c) => { await window.__lumina.showModel(c); await window.__lumina.showModel(0); }, chess);
  const dt = 60 / GIF.fps; // simulation frames per GIF frame
  const wait = (n) => Array(n).fill(['wait']);
  const apart = (n) => Array.from({ length: n }, (_, k) => ['explode', (k + 1) / n]);
  const steps = [
    ...wait(6), ['snap'], ...wait(12), ['fist'], ...wait(16),
    ...apart(14), ...wait(10), ['explode', 0], ...wait(8),
    ['model', chess], ...wait(14), ...apart(12), ...wait(14),
  ];

  // A helper page turns screenshots (PNG) into raw pixels, so no image library is needed.
  const decoder = await browser.newPage();
  const encoder = GIFEncoder();
  for (const step of steps) {
    await page.evaluate(([[action, value], n]) => {
      const L = window.__lumina;
      if (action === 'snap') L.controller.snap();
      if (action === 'fist') L.controller.pose('fist');
      if (action === 'explode') L.controller.setExplode(value);
      if (action === 'model') { L.controller.goTo(value); L.controller.pose('fist'); }
      L.tick(n);
    }, [step, dt]);
    const png = (await page.screenshot()).toString('base64');
    const rgba = Buffer.from(await decoder.evaluate(async ([b64, w, h]) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      let s = '';
      for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
      return btoa(s);
    }, [png, GIF.width, GIF.height]), 'base64');
    const data = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    const palette = quantize(data, 256);
    encoder.writeFrame(applyPalette(data, palette), GIF.width, GIF.height, { palette, delay: Math.round(1000 / GIF.fps) });
  }
  encoder.finish();
  writeFileSync('docs/hero.gif', encoder.bytes());
  console.log(`wrote docs/hero.gif (${steps.length} frames, ${(encoder.bytes().length / 1e6).toFixed(1)} MB)`);
}
