// Webcam + MediaPipe Hand Landmarker. Everything runs on-device: frames never
// leave the browser. The tracking runtime is served from node_modules by our
// own server; the model file comes from models/ if `npm install` fetched it,
// otherwise from Google's CDN.

const BUNDLE = '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
const WASM = '/node_modules/@mediapipe/tasks-vision/wasm';
const LOCAL_MODEL = '/models/hand_landmarker.task';
const CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function modelPath() {
  try {
    const res = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    if (res.ok) return LOCAL_MODEL;
  } catch { /* fall through */ }
  return CDN_MODEL;
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
  const { FilesetResolver, HandLandmarker } = await import(BUNDLE);
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const modelAssetPath = await modelPath();

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
