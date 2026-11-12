# Changelog

## Unreleased

- Phones: pinch to zoom, the model starts far enough back to fit a tall screen, one swipeable row of buttons with Help always in reach, and the guide folded behind a **Guide** button.
- Phones start lighter (80,000 particles, capped resolution) so hand tracking keeps up; `?n=` still sets any count.
- Hand control is steadier everywhere: small changes in hand height no longer tip the model.
- Hand tracking loads from a CDN when the site was published without its own copy.
- A new, quieter look: serif names, placard-style part labels, plain text controls and a numbered model list. No more frosted panels or glows; the particles are the only thing that shines.
- The model title shows its place in the catalogue ("No. 03 of 10"), and "?" is now "Help".
- With the camera on, a gesture guide on the left shows what your hand can do right now and underlines the pose you're making.
- Without a camera, the same guide lists the keyboard and mouse controls, or touch controls on phones. `G` shows or hides it.

## 1.0.0 — 2026-11-12

First public release.

- Hand-gesture control from a webcam: snap, fist, open hand, tilt, peace and point. Keyboard, mouse and touch work too.
- WebGL2 particle engine with transform feedback: 200,000 particles by default.
- Seven models built from maths: Saturn, a human heart, DNA, the Eiffel Tower, a carbon atom, the Milky Way and a jet engine.
- Load your own `.glb` by dragging it onto the page or with **Open 3D file**. Named objects become parts.
- Three bundled 3D examples: a chess set, a flight helmet and a drinks fridge.
- Part labels with explanations, a model picker, and first-run hints.
- Live demo on GitHub Pages.
