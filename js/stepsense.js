// Counts steps with the phone's motion sensor and reports a steady cadence.
//
// Each footfall is a jolt in overall acceleration, whichever way the phone
// sits (hand, pocket, armband). The signal is detrended against gravity and
// smoothed, and a step is a peak above a threshold that follows how hard the
// runner lands. A cadence is reported only once the recent steps agree.

const MIN_GAP = 260;      // ms: faster than ~230 steps a minute is noise
const WINDOW = 12;        // steps used for the estimate

export class StepSense {
  constructor(onCadence, onStatus) {
    this.onCadence = onCadence;
    this.onStatus = onStatus || (() => {});
    this.active = false;
    this.handler = (e) => this.sample(e);
  }

  static get supported() { return typeof window !== 'undefined' && 'DeviceMotionEvent' in window; }

  // Must be called from a tap: iOS asks for permission.
  async start() {
    if (!StepSense.supported) throw new Error('unsupported');
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const answer = await DeviceMotionEvent.requestPermission();
      if (answer !== 'granted') throw new Error('denied');
    }
    this.reset();
    addEventListener('devicemotion', this.handler);
    this.active = true;
    this.onStatus('listening');
  }

  stop() {
    removeEventListener('devicemotion', this.handler);
    this.active = false;
  }

  reset() {
    this.avg = null;
    this.smooth = 0;
    this.env = 1;
    this.above = false;
    this.last = 0;
    this.steps = [];
    this.heard = false;
  }

  sample(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const t = performance.now();
    const mag = Math.hypot(a.x, a.y, a.z);
    if (this.avg == null) this.avg = mag;
    this.avg += (mag - this.avg) * 0.02;              // gravity and slow drift
    const v = mag - this.avg;
    this.smooth = this.smooth * 0.55 + v * 0.45;      // tame sensor jitter
    this.env = Math.max(Math.abs(this.smooth), this.env * 0.996);
    const thr = Math.max(0.9, this.env * 0.42);
    if (!this.above && this.smooth > thr && t - this.last > MIN_GAP) {
      this.above = true;
      this.step(t);
    } else if (this.above && this.smooth < thr * 0.3) {
      this.above = false;
    }
  }

  step(t) {
    // a pause longer than two seconds starts a new count
    if (this.last && t - this.last > 2000) this.steps = [];
    this.last = t;
    this.steps.push(t);
    if (this.steps.length > WINDOW) this.steps.shift();
    if (!this.heard) { this.heard = true; this.onStatus('counting'); }
    if (this.steps.length < 8) return;
    const iv = this.steps.slice(1).map((s, i) => s - this.steps[i]).sort((a, b) => a - b);
    const median = iv[Math.floor(iv.length / 2)];
    const q1 = iv[Math.floor(iv.length * 0.25)], q3 = iv[Math.floor(iv.length * 0.75)];
    if ((q3 - q1) / median > 0.18) return;            // not steady yet
    let cadence = 60000 / median;
    if (cadence < 105) cadence *= 2;                  // only one foot showed up (phone in a pocket)
    if (cadence < 120 || cadence > 220) return;
    this.onCadence(Math.round(cadence));
  }
}
