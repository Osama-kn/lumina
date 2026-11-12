# Lumina

Shape glowing particles into 3D models with your hands, in the browser.

Snap your fingers and 200,000 particles swirl in around your hand. Make a fist and they build Saturn, a beating human heart or the Eiffel Tower. Open your hand and the model comes apart: how wide you open sets how far the parts fly, and closing your hand puts it back together. Every part is labelled, and pointing at one tells you what it does.

![Saturn made of particles](docs/preview.png)

## Run it

You need [Node.js](https://nodejs.org/) 18 or newer and, ideally, a webcam. Without one, everything also works from the keyboard and the on-screen buttons.

```bash
git clone https://github.com/Osama-kn/lumina.git
cd lumina
npm install
npm start
```

Open **http://localhost:5173** in Chrome or Edge and choose **Start with camera**. Browsers only allow the camera on `localhost` or `https`, which is why Lumina ships with a small local server. To use another port: `npm start -- 8080`.

## Gestures

| Gesture | What it does |
| --- | --- |
| 🫰 Snap | Wake the particles, or send them back to sleep |
| ✊ Fist | Build the model. When it's apart, put it back together |
| ✋ Open hand | Pull the parts apart; the wider you open, the farther they go |
| 🤚 Tilt | Tilt your hand left or right to spin the model; raise or lower it to tip it |
| ✌️ Peace | Next model |
| ☝️ Point | Point at a part to highlight it and see what it does |
| 👋 Move | While the particles swirl, they follow your hand |

## Keyboard and mouse

| Input | Action |
| --- | --- |
| `Space` | Snap |
| `F` / `O` / `V` | Fist / open hand / peace |
| `←` `→` | Previous / next model |
| `↑` `↓` | Pull apart / put together |
| Drag, wheel | Rotate, zoom |
| `R` / `T` | Auto-rotate / motion trails |
| `C` | Camera on or off |
| `D` | Play the demo (a scripted hand performs every gesture) |
| `L` | Part labels on or off |
| Hover, click | See what a part does; click to keep it open, `Esc` to close |
| `H` | Help |

## How it works

![The DNA helix pulled apart](docs/explode.png)

**Hand tracking.** [MediaPipe Hand Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker) finds 21 landmarks on your hand in each webcam frame, entirely on your device. Nothing is uploaded.

**Gesture recognition** (`src/logic/gestures.js`). Each finger's extension is measured as how much farther its tip is from the wrist than its middle joint, which doesn't depend on hand size, distance or rotation. Poses are threshold bands on those four values. A snap is detected as thumb and middle finger held together for at least 40 ms, then flicked apart within 180 ms. A debouncer only reports a pose after it has been stable for 110 ms, so a hand passing through a shape doesn't trigger it.

**State machine** (`src/logic/controller.js`). Three states (asleep, swirling, built) and a handful of transitions. It's pure and clock-free, so the tests drive it directly.

**Particle engine** (`src/gl/`). Hand-written WebGL2, no Three.js. Each particle's position and velocity live in GPU buffers. Every frame a vertex shader runs the physics for all particles and writes the results into a second buffer with *transform feedback*; the two buffers then swap. The CPU never touches per-particle data after setup, which is what makes hundreds of thousands of particles run smoothly. Points are drawn with additive blending so dense areas glow, and the previous frame is faded rather than cleared to leave short motion trails.

**Physics** (`src/logic/physics.js`). Asleep, particles drift to homes on a distant sphere. Swirling, they're pulled onto a shell around your palm and spun around it with a little noise. Built, each one is a damped spring to its point on the model, offset by its part's explode rule. The JavaScript version is a line-for-line twin of the shader, and a test checks that the GPU output matches it.

**Models** (`src/models/models.js`). Seven procedural models, sampled into point clouds from equations rather than mesh files: Saturn (banded atmosphere, polar hexagon, and rings at their real proportions with the Cassini Division and Encke Gap), an anatomical human heart beating in a lub-dub rhythm at 72 bpm, B-form DNA with ring-structured bases and two or three hydrogen bonds per pair, the Eiffel Tower at its real height ratios, a carbon atom with orbitals shaped by their wavefunctions, the Milky Way with its bar and named arms, and a turbofan jet engine. Every model is split into up to 12 named parts, each with a colour, a one-line explanation and a rule for how it moves when the model comes apart.

**Labels** (`src/logic/labels.js`). Each part has an anchor, one of its own particles. Every frame the anchor is run through the same explode formula as the physics and projected to the screen, and callouts are stacked in columns on either side so they never overlap. A hover, click or pointed finger picks the part of the nearest particle from a sample of about 6,000.

## URL options

| Option | Effect |
| --- | --- |
| `?n=100000` | Particle count (default 200,000) |
| `?model=2` | Start on a given model |
| `?autostart=camera` or `?autostart=nocamera` | Skip the start screen |
| `?trails=0` | Turn off motion trails |
| `?dpr=1` | Lower the render resolution on slower GPUs |

## Tests

```bash
npx playwright install chromium   # once
npm test
```

- **Unit tests** (Node's built-in runner): pose classification at different hand sizes and positions, the snap detector, the debouncer, the state machine, every model (finite, bounded, deterministic, every part used, fast to build at 200k), and the physics in each mode.
- **Browser tests** (Playwright, software WebGL so no GPU is needed): the app boots cleanly, the keyboard and synthetic hands each drive the whole story, the GPU physics matches the CPU twin, every model renders, the demo runs, and the phone layout fits.

The synthetic hands in `src/logic/synthetic-hand.js` generate realistic landmark sets for any finger configuration, so the gesture pipeline is tested exactly as it runs with a real camera.

## Project structure

```
index.html, styles.css    page and styles
server.mjs                zero-dependency static server
scripts/fetch-model.mjs   downloads the hand model on npm install
src/main.js               frame loop, HUD, input, camera preview, demo
src/hands.js              webcam + MediaPipe
src/gl/                   WebGL2 renderer and shaders
src/logic/                gestures, controller, input pipeline, physics twin, synthetic hands
src/models/               procedural models
src/lib/                  matrix helpers
tests/unit, tests/e2e     tests
```

## Troubleshooting

- **The camera doesn't start.** Open the app from `http://localhost:5173` rather than the file, and allow camera access when asked.
- **Hand tracking never loads.** Run `npm install` first; the tracking runtime is served from `node_modules`. If the model download failed during install, the app loads it from Google's CDN instead, which needs an internet connection.
- **Low frame rate.** Try `http://localhost:5173/?n=80000&dpr=1`.

## Credits

Inspired by [WonderSnap](https://github.com/AkbarSheikh-debug/wondersnap) by Akbar Sheikh. Lumina is an independent implementation written from scratch.

## License

[MIT](LICENSE)
