// Tones for the nervous system rather than the ear: binaural beats and noise beds.
import { lerp, glide, makePanner, osc, gain, filter } from '../util.js';
import { R, C } from '../params.js';
import { Continuous, noiseSrc, common } from './base.js';

const BANDS = (b) => (b < 4 ? 'delta' : b < 8 ? 'theta' : b < 13 ? 'alpha' : 'beta');

export class Binaural extends Continuous {
  static schema = [
    ...common({ vol: 0.35, tone: 1, rev: 0, dly: 0, revGen: [0, 0], dlyGen: [0, 0] }),
    R('beat', 'Beat frequency', 1, 16, 6, { step: 0.5, fmt: (v) => `${v} Hz · ${BANDS(v)}`, gen: [2, 10] }),
    R('carrier', 'Carrier', 0, 1, 0.5, { hint: 'low ↔ high hum' }),
    R('pulse', 'Isochronic pulse', 0, 1, 0, { gen: [0, 0.3], hint: 'audible on speakers' }),
  ];
  carrier() { return this.h.hz(0, 2) * Math.pow(2, this.p.carrier * 1.6); }
  start(t) {
    const { ctx } = this;
    const f = this.carrier(), b = this.p.beat;
    this.l = this.keep(osc(ctx, 'sine', f - b / 2));
    this.r = this.keep(osc(ctx, 'sine', f + b / 2));
    const pl = this.keep(makePanner(ctx, -1));
    const pr = this.keep(makePanner(ctx, 1));
    this.mixG = this.keep(gain(ctx, 0.5));
    this.am = this.keep(osc(ctx, 'sine', b));
    this.amG = this.keep(gain(ctx, this.p.pulse * 0.45));
    this.am.connect(this.amG).connect(this.mixG.gain);
    this.l.connect(pl).connect(this.mixG);
    this.r.connect(pr).connect(this.mixG);
    this.mixG.connect(this.bus);
    this.l.start(t); this.r.start(t); this.am.start(t);
  }
  retune(t) {
    const f = this.carrier(), b = this.p.beat;
    glide(this.l.frequency, f - b / 2, t, 1.5);
    glide(this.r.frequency, f + b / 2, t, 1.5);
    glide(this.am.frequency, b, t, 1.5);
    glide(this.amG.gain, this.p.pulse * 0.45, t, 0.5);
  }
  param() { this.retune(this.now); }
  onKey(t) { if (this.running) this.retune(t); }
}

export class Noise extends Continuous {
  static schema = [
    ...common({ vol: 0.35, tone: 0.7, rev: 0.1, dly: 0, revGen: [0, 0.3], dlyGen: [0, 0] }),
    C('color', 'Colour', [['brown', 'Brown'], ['pink', 'Pink'], ['white', 'White']], 'brown'),
    R('sweep', 'Sweep', 0, 1, 0.3, { hint: 'slow filter breathing' }),
    R('sweepRate', 'Sweep speed', 0, 1, 0.3),
  ];
  start(t) {
    const { ctx } = this;
    this.src = this.keep(noiseSrc(this, this.p.color, t));
    this.lp = this.keep(filter(ctx, 'lowpass', 2000, 0.5));
    this.lfo = this.keep(osc(ctx, 'sine', this.rateHz()));
    this.lfoG = this.keep(gain(ctx, this.p.sweep * 1600));
    this.lfo.connect(this.lfoG).connect(this.lp.frequency);
    this.src.connect(this.lp).connect(this.bus);
    this.lfo.start(t);
  }
  rateHz() { return lerp(0.01, 0.25, this.p.sweepRate); }
  param(id) {
    if (id === 'color') {
      const old = this.src;
      this.src = this.keep(noiseSrc(this, this.p.color, this.now));
      this.src.connect(this.lp);
      old.stop(this.now + 0.05);
    }
    if (id === 'sweep') glide(this.lfoG.gain, this.p.sweep * 1600, this.now, 0.3);
    if (id === 'sweepRate') glide(this.lfo.frequency, this.rateHz(), this.now, 0.3);
  }
}
