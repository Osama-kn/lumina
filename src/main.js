// Wires everything together: renderer, controller, hand input, keyboard and
// mouse, HUD, camera preview and the built-in demo.

import { ParticleRenderer } from './gl/renderer.js';
import { entryCount, entryName, isProcedural, buildModel, loadModel as loadEntry, partUniforms } from './models/registry.js';
import { Controller, MODE } from './logic/controller.js';
import { HandInput } from './logic/input.js';
import { MODE_ID, heartbeat } from './logic/physics.js';
import { syntheticHand } from './logic/synthetic-hand.js';
import { yawPitch, mulMat3T } from './lib/mat.js';
import { anchorOnScreen, pickPart, stackColumn, chooseSide } from './logic/labels.js';
import { LM } from './logic/gestures.js';

// ───────────── options ─────────────
const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) && Number.isFinite(+params.get(k)) ? +params.get(k) : d);
const COUNT = Math.round(Math.min(Math.max(num('n', 200_000), 1_000), 1_000_000));
const START_MODEL = Math.round(num('model', 0));
const AUTOSTART = params.get('autostart'); // 'camera' | 'nocamera'
const TRAILS = params.get('trails') !== '0';
const DPR = params.has('dpr') ? num('dpr', 1) : Math.min(window.devicePixelRatio || 1, 2);

const $ = (id) => document.getElementById(id);
const ui = {
  scene: $('scene'), status: $('status'), name: $('model-name'), blurb: $('model-blurb'),
  parts: $('parts'), meter: $('explode-meter'), fill: $('explode-fill'),
  cam: $('cam'), video: $('video'), overlay: $('cam-overlay'), camPose: $('cam-pose'),
  controls: $('controls'), toast: $('toast'), start: $('start'), help: $('help'),
  labels: $('labels'), leaders: $('leaders'), finger: $('finger'), model: $('model-info'),
};

function hideStart() {
  ui.start.hidden = true;
  document.body.classList.remove('starting');
}

function toast(msg, ms = 5000) {
  ui.toast.textContent = msg;
  ui.toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { ui.toast.hidden = true; }, ms);
}

// ───────────── core objects ─────────────
let renderer;
try {
  renderer = new ParticleRenderer(ui.scene, { count: COUNT, dpr: DPR, trails: TRAILS });
} catch (err) {
  hideStart();
  toast(`${err.message} Try a recent Chrome, Edge or Firefox.`, 1e9);
  throw err;
}

const controller = new Controller({ modelCount: entryCount(), modelIndex: START_MODEL });
const input = new HandInput(controller);

const modelCache = new Map();
let model = null;
let uniforms = null;
const cssColor = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

// Which part is selected, by source. Hovering wins over a pinned (clicked) part.
const select = { label: -1, legend: -1, pinned: -1, active: -1 };
let labelsOn = true;
let cursor = null;
let callouts = [];

// Models written in code build instantly; 3D files load in the background
// while the current model stays on screen.
let loading = Promise.resolve();
let loadingName = '';
let loadToken = 0;
function showModel(index) {
  const token = ++loadToken;
  if (modelCache.has(index) || isProcedural(index)) {
    if (!modelCache.has(index)) modelCache.set(index, buildModel(index, COUNT));
    applyModel(modelCache.get(index));
    loadingName = '';
    loading = Promise.resolve();
    return loading;
  }
  loadingName = entryName(index);
  loading = loadEntry(index, COUNT)
    .then((m) => {
      modelCache.set(index, m);
      if (token === loadToken) applyModel(m);
    })
    .catch((err) => {
      if (token === loadToken) toast(modelError(err, entryName(index)));
    })
    .finally(() => {
      if (token !== loadToken) return;
      loadingName = '';
      syncHud();
    });
  return loading;
}

/** A sentence a person can act on, for each way a 3D file can fail. */
function modelError(err, name) {
  switch (err?.code) {
    case 'not-gltf': return `${name} isn't a 3D model Lumina can read. Try a .glb file.`;
    case 'compressed': return `${name} is compressed (Draco or Meshopt). Export it again without compression.`;
    case 'external-buffer': return `${name} uses separate files. Export it as a single .glb instead.`;
    case 'no-triangles': return `${name} has no surfaces to turn into particles.`;
    case 'too-large': return `${name} is too big: the limit is 5 million triangles and 50 MB.`;
    default: return `Couldn't load ${name}: ${err?.message || err}`;
  }
}

function applyModel(m) {
  model = m;
  uniforms = partUniforms(model);
  renderer.setModel(model, uniforms);
  ui.name.textContent = model.name;
  ui.blurb.textContent = model.blurb;
  select.label = select.legend = select.pinned = select.active = -1;
  view.highlight = -1;
  ui.parts.replaceChildren(...model.parts.map((p, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('i');
    li.style.color = cssColor(p.color);
    const label = document.createElement('span');
    label.textContent = p.name;
    li.append(dot, label);
    li.addEventListener('pointerenter', () => { select.legend = i; });
    li.addEventListener('pointerleave', () => { select.legend = -1; });
    li.addEventListener('click', () => togglePin(i));
    return li;
  }));
  buildCallouts();
}

function togglePin(part) {
  select.pinned = select.pinned === part ? -1 : part;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function buildCallouts() {
  ui.labels.replaceChildren();
  ui.leaders.replaceChildren();
  callouts = model.parts.map((p, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'label';
    el.style.setProperty('--part', cssColor(p.color));
    const name = document.createElement('span');
    name.className = 'label-name';
    name.textContent = p.name;
    const info = document.createElement('span');
    info.className = 'label-info';
    info.textContent = p.info;
    el.append(name, info);
    el.addEventListener('pointerenter', () => { select.label = i; });
    el.addEventListener('pointerleave', () => { select.label = -1; });
    el.addEventListener('focus', () => { select.label = i; });
    el.addEventListener('blur', () => { select.label = -1; });
    el.addEventListener('click', () => togglePin(i));
    ui.labels.append(el);

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('stroke', cssColor(p.color));
    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', cssColor(p.color));
    ui.leaders.append(line, dot);
    return { el, line, dot, side: null, x: 0, y: 0, w: 0, h: 0, alpha: 0, placed: false };
  });
  measureCallouts();
}

function measureCallouts() {
  for (const c of callouts) {
    c.w = c.el.offsetWidth;
    c.h = c.el.offsetHeight;
  }
}

function setActive(part) {
  if (part === select.active) return;
  select.active = part;
  view.highlight = part;
  callouts.forEach((c, i) => c.el.classList.toggle('active', i === part));
  [...ui.parts.children].forEach((li, i) => li.classList.toggle('active', i === part));
  measureCallouts();
}

// ───────────── view state ─────────────
const view = {
  yaw: 0.6, pitch: 0.15, yawVel: 0,
  autoRotate: true, dragging: false,
  alpha: 0.18, cloudMix: 1, highlight: -1,
  zoom: 4.2,
};
const alphaScale = Math.min(1, Math.max(0.08, 0.36 * Math.sqrt(120_000 / COUNT)));

const STATUS = {
  [MODE.DORMANT]: 'Asleep. Snap to wake the particles',
  [MODE.CLOUD]: 'Awake. Make a fist to build the model',
  [MODE.FORMED]: 'Built. Open your hand to pull it apart',
};
function syncHud() {
  document.body.dataset.mode = controller.mode;
  ui.status.textContent = loadingName ? `Loading ${loadingName}…` : STATUS[controller.mode];
  ui.meter.hidden = controller.mode !== MODE.FORMED;
  ui.fill.style.width = `${Math.round(controller.explode * 100)}%`;
}

controller.on((e) => {
  if (e.type === 'model') showModel(e.index);
  syncHud();
});

// ───────────── camera ─────────────
let tracker = null;
let startingCamera = false;
async function startCamera() {
  if (tracker || startingCamera) return;
  startingCamera = true;
  ui.cam.hidden = false;
  ui.camPose.textContent = 'Starting…';
  try {
    const { startHandTracking } = await import('./hands.js');
    tracker = await startHandTracking(ui.video, (s) => { if (s) ui.camPose.textContent = s; });
    ui.camPose.textContent = 'No hand';
  } catch (err) {
    ui.cam.hidden = true;
    const denied = err?.name === 'NotAllowedError';
    toast(denied
      ? 'Camera access was blocked. Allow it in the address bar, or use the buttons and keys below.'
      : `Hand tracking couldn’t start: ${err?.message || err}. You can still use the buttons and keys.`);
  } finally {
    startingCamera = false;
  }
}
function stopCamera() {
  tracker?.stop();
  tracker = null;
  ui.cam.hidden = true;
  input.process(null, performance.now());
}

const HAND_LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
function drawHand(lm) {
  const c = ui.overlay;
  const w = (c.width = c.clientWidth * DPR), h = (c.height = c.clientHeight * DPR);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  if (!lm) return;
  g.lineWidth = 1.5 * DPR;
  g.strokeStyle = 'rgba(235,232,255,0.75)';
  g.beginPath();
  for (const [a, b] of HAND_LINKS) {
    g.moveTo(lm[a].x * w, lm[a].y * h);
    g.lineTo(lm[b].x * w, lm[b].y * h);
  }
  g.stroke();
  g.fillStyle = '#ffd166';
  for (const i of [4, 8, 12, 16, 20]) {
    g.beginPath();
    g.arc(lm[i].x * w, lm[i].y * h, 3 * DPR, 0, Math.PI * 2);
    g.fill();
  }
}

// ───────────── demo ─────────────
const curled = { index: 0, middle: 0, ring: 0, pinky: 0 };
const flat = { index: 1, middle: 1, ring: 1, pinky: 1 };
const mix = (t) => ({ index: t, middle: t, ring: t, pinky: t });
const DEMO = [
  [500, () => syntheticHand()],
  [140, () => syntheticHand({ thumb: 'middle', ext: { index: 0.5, middle: 0.6, ring: 0.2, pinky: 0.2 } })],
  [2600, (t) => syntheticHand({ cx: 0.5 + 0.22 * Math.sin(t * 5), cy: 0.6 + 0.12 * Math.cos(t * 4) })],
  [1800, () => syntheticHand({ ext: curled })],
  [2200, (t) => syntheticHand({ ext: mix(0.2 + 0.8 * t) })],
  [1000, () => syntheticHand({ ext: flat })],
  [1500, (t) => syntheticHand({ ext: mix(1 - t) })],
  [700, () => syntheticHand({ ext: curled })],
  [450, () => syntheticHand({ ext: { index: 1, middle: 1, ring: 0, pinky: 0 } })],
  [600, () => syntheticHand({ ext: curled })],
  [2000, () => syntheticHand({ ext: curled })],
  [1800, (t) => syntheticHand({ ext: mix(0.2 + 0.8 * Math.sin(t * Math.PI)) })],
  [600, () => syntheticHand({ ext: curled })],
];
let demo = null; // { start, step }
function playDemo() {
  hideStart();
  if (controller.mode !== MODE.DORMANT) controller.setMode(MODE.DORMANT);
  input.reset();
  demo = { start: performance.now() };
  setPressed('demo', true);
}
function demoHand(now) {
  let t = now - demo.start;
  for (const [dur, fn] of DEMO) {
    if (t < dur) return fn(t / dur);
    t -= dur;
  }
  demo = null;
  setPressed('demo', false);
  return null;
}

// ───────────── input: keyboard, buttons, mouse ─────────────
function setPressed(action, on) {
  ui.controls.querySelector(`[data-action="${action}"]`)?.setAttribute('aria-pressed', String(on));
}

const actions = {
  snap: () => controller.snap(),
  fist: () => controller.pose('fist'),
  open: () => {
    if (controller.mode !== MODE.FORMED) return;
    controller.pose('open');
    controller.openness(controller.explode > 0.5 ? 0 : 1);
    controller.exploding = false;
  },
  next: () => controller.step(1),
  prev: () => controller.step(-1),
  demo: () => (demo ? (demo = null, setPressed('demo', false)) : playDemo()),
  labels: () => { labelsOn = !labelsOn; setPressed('labels', labelsOn); },
  help: () => toggleHelp(),
};

function toggleHelp(force) {
  const show = force ?? ui.help.hidden;
  ui.help.hidden = !show;
  if (show) $('help-close').focus();
}

ui.controls.addEventListener('click', (e) => {
  const a = e.target.closest('button')?.dataset.action;
  if (a) actions[a]();
});
$('help-close').addEventListener('click', () => toggleHelp(false));
$('start-camera').addEventListener('click', () => { hideStart(); startCamera(); });
$('start-nocam').addEventListener('click', hideStart);

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (!ui.help.hidden && e.key === 'Escape') { toggleHelp(false); return; }
  if (!ui.start.hidden && e.key !== 'Escape') return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const nudge = (d) => {
    if (controller.mode !== MODE.FORMED) return;
    controller.exploding = false;
    controller.setExplode(controller.explode + d);
  };
  const map = {
    ' ': actions.snap, f: actions.fist, o: actions.open, v: () => controller.pose('peace'),
    ArrowRight: actions.next, ArrowLeft: actions.prev,
    ArrowUp: () => nudge(0.1), ArrowDown: () => nudge(-0.1),
    r: () => { view.autoRotate = !view.autoRotate; },
    t: () => { renderer.trails = !renderer.trails; },
    c: () => (tracker ? stopCamera() : startCamera()),
    d: actions.demo, h: () => toggleHelp(), '?': () => toggleHelp(),
    l: actions.labels,
    Escape: () => { hideStart(); select.pinned = -1; },
  };
  if (map[key]) {
    e.preventDefault();
    map[key]();
  }
});

let drag = null;
ui.scene.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch };
  view.dragging = true;
  ui.scene.setPointerCapture(e.pointerId);
});
ui.scene.addEventListener('pointermove', (e) => {
  cursor = e.pointerType === 'mouse' ? { x: e.clientX, y: e.clientY } : null;
  if (!drag) return;
  view.yaw = drag.yaw + (e.clientX - drag.x) * 0.008;
  view.pitch = Math.max(-1.2, Math.min(1.2, drag.pitch + (e.clientY - drag.y) * 0.008));
});
const endDrag = () => { drag = null; view.dragging = false; };
ui.scene.addEventListener('pointerup', (e) => {
  // A press that didn't move is a click: pin the part under it, or clear the pin.
  if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 && controller.mode === MODE.FORMED) {
    const part = partAt({ x: e.clientX, y: e.clientY }, e.pointerType === 'mouse' ? 28 : 44);
    select.pinned = part === select.pinned ? -1 : part;
  }
  endDrag();
});
ui.scene.addEventListener('pointercancel', endDrag);
ui.scene.addEventListener('pointerleave', () => { cursor = null; });
ui.scene.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.zoom = Math.max(2.4, Math.min(9, view.zoom * Math.exp(e.deltaY * 0.0012)));
}, { passive: false });

// ───────────── frame loop ─────────────
let last = performance.now();
let time = 0;
let paused = false;
const ease = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

let camera = null;
let beatNow = 1;
function partAt(point, radius) {
  return camera ? pickPart(model, uniforms.rules, controller.explode, beatNow, camera, point, radius) : -1;
}

/** Where the index finger points on screen during a point pose, or null. */
function fingerPoint() {
  if (input.pose !== 'point' || !input.landmarks) return null;
  const tip = input.landmarks[LM.INDEX_TIP];
  // Stretch a little around the centre so the screen edges are reachable without leaving the frame.
  const stretch = (v) => Math.max(0, Math.min(1, (v - 0.5) * 1.3 + 0.5));
  return { x: stretch(1 - tip.x) * camera.width, y: stretch(tip.y) * camera.height };
}

function updateSelection(formed) {
  const finger = formed ? fingerPoint() : null;
  ui.finger.hidden = !finger;
  if (finger) ui.finger.style.transform = `translate(${finger.x}px, ${finger.y}px)`;
  if (!formed) {
    setActive(-1);
    return;
  }
  let part = select.label >= 0 ? select.label : select.legend;
  if (part < 0 && finger) part = partAt(finger, 46);
  if (part < 0 && cursor && !view.dragging) part = partAt(cursor, 28);
  if (part < 0) part = select.pinned;
  setActive(part);
}

function updateCallouts(formed, dt) {
  const compact = camera.width < 720;
  const reveal = formed && labelsOn && !compact ? Math.max(0, Math.min(1, (controller.explode - 0.12) / 0.28)) : 0;
  const gutter = Math.max(16, Math.min(36, camera.width * 0.03));
  const camBox = ui.cam.hidden ? null : ui.cam.getBoundingClientRect();
  const columns = { left: [], right: [] };

  callouts.forEach((c, i) => {
    const active = i === select.active;
    const target = active ? 1 : reveal;
    c.alpha = ease(c.alpha, target, 12, dt);
    if (target === 0 && c.alpha < 0.01) c.alpha = 0;
    c.visible = c.alpha > 0;
    c.anchor = c.visible ? anchorOnScreen(model, uniforms.rules, i, controller.explode, beatNow, camera) : null;
    if (!c.anchor) {
      c.visible = false;
      c.placed = false;
      return;
    }
    if (compact) return;
    c.side = chooseSide(c.side, c.anchor.x, camera.width);
    columns[c.side].push(c);
  });

  if (!compact) {
    const top = 96;
    const leftBottom = ui.model.getBoundingClientRect().top - 12;
    const rightBottom = (camBox ? camBox.top : camera.height - gutter - 56) - 12;
    for (const [side, list] of Object.entries(columns)) {
      const ys = stackColumn(list.map((c) => ({ want: c.anchor.y - c.h / 2, h: c.h })), top, side === 'left' ? leftBottom : rightBottom);
      list.forEach((c, i) => { c.wantY = ys[i]; });
    }
  }

  for (const c of callouts) {
    c.el.style.visibility = c.visible ? 'visible' : 'hidden';
    c.line.style.display = c.dot.style.display = c.visible && !compact ? '' : 'none';
    if (!c.visible) continue;
    const wantX = compact ? gutter : c.side === 'left' ? gutter : camera.width - gutter - c.w;
    const wantY = compact ? 72 : c.wantY;
    c.x = c.placed ? ease(c.x, wantX, 14, dt) : wantX;
    c.y = c.placed ? ease(c.y, wantY, 14, dt) : wantY;
    c.placed = true;
    c.el.style.opacity = c.alpha;
    c.el.style.transform = `translate(${c.x}px, ${c.y}px)`;
    if (compact) continue;
    const edgeX = c.x + (c.side === 'left' ? c.w : 0);
    c.line.setAttribute('x1', edgeX);
    c.line.setAttribute('y1', c.y + Math.min(c.h / 2, 15));
    c.line.setAttribute('x2', c.anchor.x);
    c.line.setAttribute('y2', c.anchor.y);
    c.line.style.opacity = c.alpha * 0.6;
    c.dot.setAttribute('cx', c.anchor.x);
    c.dot.setAttribute('cy', c.anchor.y);
    c.dot.style.opacity = c.alpha;
  }
}

function frame(now, fixedDt) {
  const dt = fixedDt ?? Math.min((now - last) / 1000, 0.05);
  last = now;
  time += dt;

  // Hands: the demo overrides the camera while it plays.
  let lm = null;
  if (demo) lm = demoHand(now);
  else if (tracker) lm = tracker.detect(now);
  if (demo || tracker) input.process(lm, now);
  if (tracker || demo) {
    drawHand(lm);
    ui.camPose.textContent = lm ? (input.pose === 'none' ? 'Hand' : input.pose) : 'No hand';
  }

  // Rotation: hand tilt spins a built model; otherwise slow auto-rotate.
  const formed = controller.mode === MODE.FORMED;
  const handSteers = formed && input.present && !controller.exploding;
  if (handSteers) {
    const tw = input.twist;
    const dead = 0.22;
    const speed = Math.abs(tw) > dead ? (tw - Math.sign(tw) * dead) * 3.2 : 0;
    view.yawVel = ease(view.yawVel, speed, 6, dt);
    view.pitch = ease(view.pitch, (input.palm.y - 0.5) * 1.1, 4, dt);
  } else {
    view.yawVel = ease(view.yawVel, view.autoRotate && !view.dragging ? 0.22 : 0, 2, dt);
  }
  if (!view.dragging) view.yaw += view.yawVel * dt;
  const rot = yawPitch(view.yaw, view.pitch);

  renderer.distance = ease(renderer.distance, view.zoom, 6, dt);

  // In the swirling cloud, the particles gather around the user's palm.
  let attract = 0, attractor = [0, 0, 0];
  if (controller.mode === MODE.CLOUD && input.palm) {
    const { halfW, halfH } = renderer.viewHalfExtents();
    attractor = mulMat3T(rot, [(input.palm.x - 0.5) * 2 * halfW * 0.75, (0.5 - input.palm.y) * 2 * halfH * 0.75, 0]);
    attract = 1;
  }

  view.alpha = ease(view.alpha, controller.mode === MODE.DORMANT ? 0.18 : 1, 2.5, dt);
  view.cloudMix = ease(view.cloudMix, formed ? 0 : 1, 2.5, dt);

  beatNow = model.beat ? heartbeat(time) : 1;
  camera = {
    rot,
    distance: renderer.distance,
    fovY: renderer.fovY,
    width: window.innerWidth,
    height: window.innerHeight,
  };
  updateSelection(formed);
  updateCallouts(formed, dt);

  renderer.step({
    mode: MODE_ID[controller.mode],
    dt,
    time,
    explode: controller.explode,
    beat: beatNow,
    attract,
    attractor,
  });
  renderer.draw({
    rot,
    alpha: view.alpha * alphaScale,
    cloudMix: view.cloudMix,
    time,
    highlight: view.highlight,
    pointSize: 8.5,
  });

  ui.fill.style.width = `${Math.round(controller.explode * 100)}%`;
}

function loop(now) {
  if (!paused) frame(now);
  requestAnimationFrame(loop);
}

// ───────────── boot ─────────────
showModel(controller.modelIndex);
syncHud();
window.addEventListener('resize', () => renderer.resize());

if (AUTOSTART === 'camera') { hideStart(); startCamera(); }
else if (AUTOSTART === 'nocamera') hideStart();

requestAnimationFrame(loop);

// Test and debugging hooks. Lets the browser tests drive the app with
// synthetic hands on a fixed clock, and read particle state back from the GPU.
window.__lumina = {
  controller, input, renderer, view,
  get model() { return model; },
  get camera() { return camera; },
  select,
  count: COUNT,
  pause() { paused = true; },
  resume() { paused = false; last = performance.now(); },
  /** Advance n frames of fixed dt (seconds) with an optional hand. */
  tick(n = 1, dt = 1 / 60, hand = undefined) {
    for (let i = 0; i < n; i++) {
      const now = last + dt * 1000;
      if (hand !== undefined) input.process(hand, now);
      frame(now, dt);
    }
  },
  feed(hand, now) { input.process(hand, now); },
  playDemo,
  hideStart,
  /** Resolves once the current model has finished loading. */
  ready: () => loading,
  entryName,
  showModel,
};
