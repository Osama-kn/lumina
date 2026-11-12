// The app's state machine. Gestures (or keys) go in, a small description of
// what the particles should be doing comes out. Pure and clock-free: the
// caller passes `now` so tests can drive it deterministically.
//
//   dormant ──snap──▶ cloud ──fist──▶ formed
//      ▲                │ ▲              │  open hand → explode (follows openness)
//      └──────snap──────┘ └─────snap─────┘  fist → contract, peace → next model

export const MODE = { DORMANT: 'dormant', CLOUD: 'cloud', FORMED: 'formed' };

export class Controller {
  constructor({ modelCount = 1, modelIndex = 0 } = {}) {
    this.modelCount = modelCount;
    this.mode = MODE.DORMANT;
    this.modelIndex = modelIndex;
    this.explode = 0;            // 0 = assembled, 1 = fully apart
    this.exploding = false;      // true while an open hand controls explode
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, detail = {}) { for (const fn of this.listeners) fn({ type, ...detail }); }

  setMode(mode) {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    if (mode !== MODE.FORMED) { this.explode = 0; this.exploding = false; }
    this.emit('mode', { from, to: mode });
  }

  /** A finger snap toggles the particles in and out of existence. */
  snap() {
    this.setMode(this.mode === MODE.DORMANT ? MODE.CLOUD : MODE.DORMANT);
  }

  /** A newly stable pose from the debouncer. */
  pose(pose) {
    switch (pose) {
      case 'fist':
        if (this.mode === MODE.CLOUD) this.setMode(MODE.FORMED);
        else if (this.mode === MODE.FORMED) { this.exploding = false; this.setExplode(0); }
        break;
      case 'open':
        if (this.mode === MODE.FORMED) this.exploding = true;
        break;
      case 'peace':
        if (this.mode !== MODE.DORMANT) this.step(1);
        break;
      case 'none':
        // A half-open hand is "in between" poses: keep following openness so the
        // parts can glide back together as the hand closes.
        break;
      default:
        // Point and pinch freeze the explode amount where it is.
        this.exploding = false;
    }
  }

  /** Continuous input while the hand is open: how far apart the parts fly. */
  openness(value) {
    if (this.mode === MODE.FORMED && this.exploding) this.setExplode(value);
  }

  setExplode(v) {
    const clamped = Math.max(0, Math.min(1, v));
    if (clamped === this.explode) return;
    this.explode = clamped;
    this.emit('explode', { value: clamped });
  }

  step(delta) {
    const n = this.modelCount;
    this.modelIndex = (((this.modelIndex + delta) % n) + n) % n;
    this.explode = 0;
    this.exploding = false;
    this.emit('model', { index: this.modelIndex });
  }

  snapshot() {
    return { mode: this.mode, modelIndex: this.modelIndex, explode: this.explode };
  }
}
