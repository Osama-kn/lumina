// Webcam + MediaPipe Hand Landmarker. Everything runs on-device: frames never
// leave the browser. The tracking runtime comes from vendor/ on the built site
// (scripts/build-site.mjs), from node_modules when run with `npm start`, or
// from the jsDelivr CDN if neither is there; the model file comes from models/
// if present, otherwise from Google's CDN.
// Paths are relative to this file, so the app also works from a sub-path.

const here = (path) => new URL(path, import.meta.url).href;
const VENDOR = here('../vendor/tasks-vision');
const NODE_MODULES = here('../node_modules/@mediapipe/tasks-vision');
const LOCAL_MODEL = here('../models/hand_landmarker.task');
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function exists(url) {
  try {
    return (await fetch(url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

// Last resort when the site was published without the runtime (for example
// GitHub Pages serving the repository as-is). Keep the version in step with
// package.json; a unit test checks it.
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2';

/** Where to load the tracking runtime and model from. */
export async function resolveRuntime() {
  const root = (await exists(`${VENDOR}/vision_bundle.mjs`)) ? VENDOR
    : (await exists(`${NODE_MODULES}/vision_bundle.mjs`)) ? NODE_MODULES
    : CDN;
  return {
    bundle: `${root}/vision_bundle.mjs`,
    wasm: `${root}/wasm`,
    model: (await exists(LOCAL_MODEL)) ? LOCAL_MODEL : CDN_MODEL,
  };
}

/**
 * Ask for the camera, load the hand tracker and start the video.
 * @param {HTMLVideoElement} video
 * @param {(msg:string)=>void} [onStatus]
 * @returns {Promise<{detect(now:number): object[]|null, stop(): void}>}
 */
export async function startHandTracking(video, onStatus = () => {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser can’t access a camera here. Open the app on http://localhost.');
  }

  onStatus('Waiting for camera permission…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();

  onStatus('Loading hand tracking…');
  const runtime = await resolveRuntime();
  const { FilesetResolver, HandLandmarker } = await import(runtime.bundle);
  const fileset = await FilesetResolver.forVisionTasks(runtime.wasm);
  const modelAssetPath = runtime.model;

  let landmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  } catch {
    // Some machines can't run the GPU delegate; the CPU one is slower but works everywhere.
    landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
  }
  onStatus('');

  let lastVideoTime = -1;
  let last = null;
  return {
    detect(now) {
      if (video.readyState < 2) return last;
      // Only run the model when the camera has produced a new frame.
      if (video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const res = landmarker.detectForVideo(video, now);
        last = res.landmarks?.[0] ?? null;
      }
      return last;
    },
    stop() {
      for (const t of stream.getTracks()) t.stop();
      video.srcObject = null;
      landmarker.close();
    },
  };
}
