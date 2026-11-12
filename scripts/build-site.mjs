// Assembles the static site for GitHub Pages (or any static host).
// There is no bundling: the app's files are copied as they are, plus the hand
// tracking runtime from node_modules (under vendor/) and the hand model.
//
//   node scripts/build-site.mjs [out-dir=_site]
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? '_site';
const runtime = 'node_modules/@mediapipe/tasks-vision';
if (!existsSync(runtime)) {
  console.error('Run `npm install` first: the hand tracking runtime comes from node_modules.');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'styles.css', 'src', 'examples']) cpSync(f, join(out, f), { recursive: true });
cpSync(join(runtime, 'vision_bundle.mjs'), join(out, 'vendor/tasks-vision/vision_bundle.mjs'));
cpSync(join(runtime, 'wasm'), join(out, 'vendor/tasks-vision/wasm'), { recursive: true });
if (existsSync('models/hand_landmarker.task')) {
  cpSync('models/hand_landmarker.task', join(out, 'models/hand_landmarker.task'));
} else {
  console.warn('models/hand_landmarker.task is missing; the site will load it from Google instead.');
}
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Site written to ${out}/`);
