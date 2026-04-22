import { CursorState } from './gestures';

// --- One Euro Filter ---
// Adapts smoothing based on speed: slow movement = heavy smoothing, fast = light
// Much better than fixed EMA for hand tracking

class LowPassFilter {
  private y = 0;
  private s = 0;
  private initialized = false;

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.y = value;
      this.s = value;
      this.initialized = true;
      return value;
    }
    this.y = alpha * value + (1 - alpha) * this.y;
    return this.y;
  }

  lastValue() { return this.y; }
  reset() { this.initialized = false; }
}

class OneEuroFilter {
  private freq: number;
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();
  private lastTime = -1;

  constructor(freq: number, minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.freq = freq;
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number): number {
    const te = 1.0 / this.freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  filter(value: number, timestamp?: number): number {
    if (this.lastTime !== -1 && timestamp !== undefined) {
      const dt = timestamp - this.lastTime;
      if (dt > 0) this.freq = 1.0 / dt;
    }
    if (timestamp !== undefined) this.lastTime = timestamp;

    const dValue = this.xFilter.lastValue()
      ? (value - this.xFilter.lastValue()) * this.freq
      : 0;

    const edValue = this.dxFilter.filter(dValue, this.alpha(this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edValue);

    return this.xFilter.filter(value, this.alpha(cutoff));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = -1;
  }
}

// --- Pinch detector with hysteresis ---
// Different thresholds for entering vs exiting pinch state
const PINCH_ENTER_THRESHOLD = 0.08;  // must get this close to start pinch
const PINCH_EXIT_THRESHOLD = 0.095;  // small opening releases quickly
const PINCH_ENTER_FRAMES = 2;        // 2 consecutive frames to confirm
const PINCH_EXIT_FRAMES = 2;         // 2 frames to release (responsive)

class PinchDetector {
  private isPinched = false;
  private enterCount = 0;
  private exitCount = 0;
  private distFilter = new OneEuroFilter(30, 2.0, 0.005); // lighter smoothing so pinch responds

  update(rawDistance: number): boolean {
    const dist = this.distFilter.filter(rawDistance);

    if (!this.isPinched) {
      if (dist < PINCH_ENTER_THRESHOLD) {
        this.enterCount++;
        this.exitCount = 0;
        if (this.enterCount >= PINCH_ENTER_FRAMES) {
          this.isPinched = true;
          this.enterCount = 0;
        }
      } else {
        this.enterCount = 0;
      }
    } else {
      if (dist > PINCH_EXIT_THRESHOLD) {
        this.exitCount++;
        this.enterCount = 0;
        if (this.exitCount >= PINCH_EXIT_FRAMES) {
          this.isPinched = false;
          this.exitCount = 0;
        }
      } else {
        this.exitCount = 0;
      }
    }

    return this.isPinched;
  }

  reset() {
    this.isPinched = false;
    this.enterCount = 0;
    this.exitCount = 0;
    this.distFilter.reset();
  }
}

// --- Main smoother ---
export class CursorSmoother {
  // minCutoff=1.0 = heavy smoothing when still, beta=0.007 = responsive when moving fast
  private xFilter = new OneEuroFilter(30, 1.0, 0.007);
  private yFilter = new OneEuroFilter(30, 1.0, 0.007);
  private pinch = new PinchDetector();

  update(raw: CursorState): CursorState {
    const t = performance.now() / 1000;

    return {
      x: this.xFilter.filter(raw.x, t),
      y: this.yFilter.filter(raw.y, t),
      pinching: this.pinch.update(raw.pinchDistance),
      pinchDistance: raw.pinchDistance,
    };
  }

  reset() {
    this.xFilter.reset();
    this.yFilter.reset();
    this.pinch.reset();
  }
}
