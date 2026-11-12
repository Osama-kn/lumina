// Downloads the MediaPipe hand landmark model into models/ so the app can run
// hand tracking without reaching Google's CDN at runtime. Best-effort: if this
// fails, the app falls back to loading the model from the CDN.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { get } from 'node:https';

const URL_ =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const DIR = new URL('../models/', import.meta.url);
const OUT = new URL('hand_landmarker.task', DIR);
const TMP = new URL('hand_landmarker.task.part', DIR);

if (existsSync(OUT)) {
  console.log('Hand model already present.');
  process.exit(0);
}
mkdirSync(DIR, { recursive: true });

function download(url, redirects = 0) {
  get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
      download(res.headers.location, redirects + 1);
      return;
    }
    if (res.statusCode !== 200) {
      console.warn(`Could not fetch hand model (HTTP ${res.statusCode}); the app will use the CDN.`);
      return;
    }
    const file = createWriteStream(TMP);
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      renameSync(TMP, OUT);
      console.log('Hand model saved to models/hand_landmarker.task');
    });
  }).on('error', (err) => {
    rmSync(TMP, { force: true });
    console.warn(`Could not fetch hand model (${err.message}); the app will use the CDN.`);
  });
}

download(URL_);
