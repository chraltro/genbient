// Melodic layers. Most inherit the grid-based styles from Melodic.
import { clamp, lerp, rand, pick, chance, expRand, makePanner, osc, gain, filter, disposeOnEnd, pluckEnv } from '../util.js';
import { R, C } from '../params.js';
import { Layer, Melodic, common, OCT, STYLE, DENSITY } from './base.js';
import { euclid, accent, arpSequence } from '../composer.js';

const sec = (v) => `${v.toFixed(1)} s`;
const STYLES = { motif: 'Motif', arp: 'Arpeggio', walk: 'Wander', sparse: 'Sparse', chords: 'Chords', euclid: 'Rhythm' };
const styles = (...ids) => ids.map((id) => [id, STYLES[id]]);
const ARP_SHAPES = [['up', 'Up'], ['down', 'Down'], ['updown', 'Up & down'], ['converge', 'Converge'], ['pinky', 'Pinky'], ['thumb', 'Thumb'], ['random', 'Random']];
const RATES = [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2']];

const panOf = (p) => (p.pan ? p.pan.value : 0);

/* ─── Arpeggiator ─── */
export class Arp extends Melodic {
  static schema = [
    ...common({ vol: 0.5, tone: 0.8, rev: 0.55, dly: 0.35 }),
    OCT(0),
    C('shape', 'Pattern', ARP_SHAPES, 'updown'),
    C('rate', 'Rate', RATES, 2, { gen: [1, 2, 2, 4] }),
    R('octaves', 'Octaves', 1, 3, 2, { step: 1, fmt: (v) => `${v}` }),
    DENSITY(0.75),
    R('gate', 'Gate', 0.1, 1, 0.6),
    C('wave', 'Waveform', [['triangle', 'Triangle'], ['sine', 'Sine'], ['square', 'Square'], ['sawtooth', 'Saw']], 'triangle'),
    R('pluck', 'Filter snap', 0, 1, 0.5),
    R('reso', 'Resonance', 0, 1, 0.3, { gen: [0, 0.6] }),
  ];
  onStep(info) { this.arpStep(info); }
  play(t, f, v, dur) {
    const { ctx, p } = this;
    const o = osc(ctx, p.wave, f);
    const lp = filter(ctx, 'lowpass', 400, 0.7 + p.reso * 10);
    lp.frequency.setValueAtTime(600 + p.pluck * 5000 * v, t);
    lp.frequency.setTargetAtTime(350 + (1 - p.pluck) * 1500, t + 0.005, 0.05 + dur * 0.3);
    const amp = gain(ctx, 0);
    const lvl = 0.22 * v * (p.wave === 'square' || p.wave === 'sawtooth' ? 0.6 : 1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(lvl, t + 0.005);
    amp.gain.setTargetAtTime(0, t + Math.max(0.03, dur), 0.07);
    o.connect(lp).connect(amp).connect(this.bus);
    o.start(t); o.stop(t + dur + 0.6);
    disposeOnEnd(o, [o, lp, amp]);
    if (v > 0.9) this.note(t, f, undefined, 0.3, 'arp');
  }
}

/* ─── Kalimba ─── */
export class Kalimba extends Melodic {
  static schema = [
    ...common({ vol: 0.55, tone: 0.9, rev: 0.65, dly: 0.4 }),
    OCT(0),
    STYLE(styles('motif', 'arp', 'walk', 'sparse'), 'motif'),
    DENSITY(0.5),
    R('decay', 'Decay', 0.5, 5, 2.6, { fmt: sec }),
    R('tine', 'Tine', 0, 1, 0.45, { hint: 'metallic attack' }),
    R('warmth', 'Body', 0, 1, 0.4),
  ];
  play(t, f, v, dur) {
    const { ctx, p } = this;
    const decay = p.decay * rand(0.85, 1.15);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.3 * v, 0.003, decay);
    const o1 = osc(ctx, 'sine', f);
    const o2 = osc(ctx, 'sine', f * 2);
    const g2 = gain(ctx, 0);
    pluckEnv(g2.gain, t, 0.05 + 0.12 * (1 - p.warmth), 0.002, 0.7);
    const o3 = osc(ctx, 'sine', f * 5.95);
    const g3 = gain(ctx, 0);
    pluckEnv(g3.gain, t, 0.12 * p.tine, 0.001, 0.09);
    const pan = makePanner(ctx, rand(-0.5, 0.5));
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    o3.connect(g3).connect(amp);
    amp.connect(pan).connect(this.bus);
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(t + decay + 0.1); }
    disposeOnEnd(o1, [o1, o2, o3, g2, g3, amp, pan]);
    this.note(t, f, panOf(pan), v * 0.6, 'keys');
  }
}

/* ─── Felt piano ─── */
export class Piano extends Melodic {
  static schema = [
    ...common({ vol: 0.55, tone: 0.8, rev: 0.7, dly: 0.2 }),
    OCT(0),
    STYLE(styles('chords', 'motif', 'walk', 'sparse', 'arp'), 'chords'),
    DENSITY(0.45),
    R('decay', 'Sustain', 1, 10, 4.5, { fmt: sec }),
    R('felt', 'Felt', 0, 1, 0.6, { hint: 'soft ↔ bright hammer' }),
    R('detune', 'Wobble', 0, 1, 0.2, { hint: 'old upright' }),
    R('roll', 'Strum', 0, 1, 0.35),
    R('noise', 'Mechanics', 0, 1, 0.3, { hint: 'hammer and pedal sounds' }),
  ];
  get octave() { return 4 + (this.p.oct ?? 0); }
  play(t, f, v, dur) {
    const { ctx, p } = this;
    const decay = p.decay * rand(0.9, 1.1) * clamp(300 / f, 0.5, 1.4);
    const sum = gain(ctx, 1);
    const lp = filter(ctx, 'lowpass', 900 + (1 - p.felt) * 5000 * v, 0.5);
    lp.frequency.setTargetAtTime(500 + (1 - p.felt) * 1500, t + 0.02, decay * 0.25);
    const pan = makePanner(ctx, clamp(Math.log2(f / 260) * 0.35, -0.7, 0.7));
    sum.connect(lp).connect(pan).connect(this.bus);
    const nodes = [sum, lp, pan];
    const det = p.detune * 9;
    let first;
    for (let n = 1; n <= 5; n++) {
      const stretch = 1 + 0.0004 * n * n;
      const o = osc(ctx, 'sine', f * n * stretch, rand(-det, det));
      const g = gain(ctx, 0);
      const a = 0.26 * v / Math.pow(n, 1.1 + p.felt * 0.9);
      pluckEnv(g.gain, t, a, 0.004 + p.felt * 0.006, decay / (1 + (n - 1) * 0.6));
      o.connect(g).connect(sum);
      o.start(t); o.stop(t + decay + 0.2);
      nodes.push(o, g);
      first ||= o;
    }
    if (p.noise > 0.02) {
      const s = ctx.createBufferSource();
      s.buffer = this.e.noise.white;
      const bp = filter(ctx, 'bandpass', 1800, 1.2);
      const g = gain(ctx, 0);
      pluckEnv(g.gain, t, 0.05 * p.noise * v, 0.001, 0.04);
      s.connect(bp).connect(g).connect(sum);
      s.start(t, rand(0, 3), 0.08);
      nodes.push(s, bp, g);
    }
    disposeOnEnd(first, nodes);
    if (v > 0.5) this.note(t, f, panOf(pan), v * 0.5, 'piano');
  }
}

/* ─── Bells ─── */
const METALS = { bell: [3.5, 1], glass: [2, 0.7], chime: [4.2, 0.8], gong: [1.41, 1.4], soft: [1, 0.5] };
export class Bells extends Melodic {
  static schema = [
    ...common({ vol: 0.5, tone: 0.95, rev: 0.9, dly: 0.55 }),
    OCT(0),
    STYLE(styles('sparse', 'motif', 'walk', 'arp'), 'sparse'),
    DENSITY(0.4),
    C('metal', 'Metal', Object.keys(METALS).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), 'bell'),
    R('bright', 'Brightness', 0, 1, 0.5),
    R('decay', 'Ring', 1, 10, 5, { fmt: sec }),
  ];
  get octave() { return 5 + (this.p.oct ?? 0); }
  play(t, f, v) {
    const { ctx, p } = this;
    const [ratio, idxScale] = METALS[p.metal] || METALS.bell;
    const dur = p.decay * rand(0.8, 1.2);
    const car = osc(ctx, 'sine', f);
    const mod = osc(ctx, 'sine', f * ratio);
    const mg = gain(ctx, 0);
    mg.gain.setValueAtTime(f * (0.4 + p.bright * 3) * idxScale, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.02, t + dur * 0.5);
    mod.connect(mg).connect(car.frequency);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.22 * v, 0.004, dur);
    const pan = makePanner(ctx, rand(-0.8, 0.8));
    car.connect(amp).connect(pan).connect(this.bus);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
    disposeOnEnd(car, [car, mod, mg, amp, pan]);
    this.note(t, f, panOf(pan), v, 'bells');
  }
}

/* ─── Marimba ─── */
export class Marimba extends Melodic {
  static schema = [
    ...common({ vol: 0.55, tone: 0.85, rev: 0.45, dly: 0.25 }),
    OCT(0),
    STYLE(styles('euclid', 'motif', 'arp', 'walk'), 'euclid'),
    DENSITY(0.55),
    R('hits', 'Rhythm hits', 1, 12, 5, { step: 1, fmt: (v) => `${v}`, gen: [3, 7] }),
    R('rotate', 'Rhythm rotation', 0, 15, 0, { step: 1, fmt: (v) => `${v}` }),
    R('hardness', 'Mallet', 0, 1, 0.4, { hint: 'soft yarn ↔ hard rubber' }),
    R('decay', 'Decay', 0.2, 2, 0.8, { fmt: sec }),
  ];
  onStep(info) {
    if (!this.g.beat && this.p.style === 'euclid') return this.sparseStep(info);
    if (this.p.style !== 'euclid') return super.onStep(info);
    const pat = euclid(info.spb, Math.min(this.p.hits, info.spb), this.p.rotate);
    if (!pat[info.sib] || !chance(0.5 + this.dens * 0.5)) return;
    const h = this.h;
    if (!this.seq || info.sib === 0) this.seq = arpSequence(pick(['up', 'updown', 'random', 'converge']), h.chord.tones.length + 2);
    this.k = info.sib === 0 ? 0 : (this.k ?? 0) + 1;
    const tones = [...h.chord.tones, h.chord.tones[0] + h.len, h.chord.tones[1] + h.len];
    const d = tones[this.seq[this.k % this.seq.length] % tones.length];
    this.playDeg(info, d - h.chord.deg, accent(info.sib, info.groups) >= 0.8 ? 1 : 0.7, 0.5, false);
  }
  play(t, f, v) {
    const { ctx, p } = this;
    const dec = p.decay * clamp(400 / f, 0.4, 1.6);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.3 * v, 0.002, dec);
    const o1 = osc(ctx, 'sine', f);
    const o2 = osc(ctx, 'sine', f * 3.93);
    const g2 = gain(ctx, 0);
    pluckEnv(g2.gain, t, 0.08 + p.hardness * 0.2, 0.001, dec * 0.25);
    const o3 = osc(ctx, 'sine', f * 9.2);
    const g3 = gain(ctx, 0);
    pluckEnv(g3.gain, t, p.hardness * 0.08, 0.001, 0.03);
    const pan = makePanner(ctx, clamp(Math.log2(f / 400) * 0.4, -0.8, 0.8));
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    o3.connect(g3).connect(amp);
    amp.connect(pan).connect(this.bus);
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(t + dec + 0.1); }
    disposeOnEnd(o1, [o1, o2, o3, g2, g3, amp, pan]);
    if (v > 0.9) this.note(t, f, panOf(pan), 0.35, 'marimba');
  }
}

/* ─── Flute ─── */
export class Flute extends Layer {
  static schema = [
    ...common({ vol: 0.5, tone: 0.85, rev: 0.85, dly: 0.35 }),
    OCT(0),
    DENSITY(0.4),
    R('phrase', 'Phrase length', 2, 10, 5, { step: 1, fmt: (v) => `${v} notes` }),
    R('breath', 'Breath', 0, 1, 0.35),
    R('vibrato', 'Vibrato', 0, 1, 0.5),
    R('glide', 'Glide', 0, 1, 0.3),
    C('voice', 'Instrument', [['flute', 'Flute'], ['shaku', 'Shakuhachi'], ['ocarina', 'Ocarina'], ['whistle', 'Whistle']], 'flute'),
  ];
  start() { this.deg = 2; this.busyUntil = 0; }
  onStep(info) {
    if (info.t < this.busyUntil) return;
    if (accent(info.sib, info.groups) < 0.8) return;
    if (!chance(0.05 + this.dens * 0.3)) return;
    this.busyUntil = this.phrase(info) + info.dur * 4 * (1 + this.g.rests * 4);
  }
  phrase(info) {
    const { ctx, h, p } = this;
    const t0 = info.t;
    const wave = this.e.waves[p.voice] || this.e.waves.flute;
    const count = Math.max(2, Math.round(p.phrase * rand(0.7, 1.2)));
    const o = osc(ctx, wave, 440);
    const vib = osc(ctx, 'sine', rand(4.6, 5.4));
    const vg = gain(ctx, 0);
    vib.connect(vg).connect(o.detune);
    const amp = gain(ctx, 0);
    const breath = ctx.createBufferSource();
    breath.buffer = this.e.noise.white;
    breath.loop = true;
    const bp = filter(ctx, 'bandpass', 1000, p.voice === 'shaku' ? 1.2 : 2.5);
    const bg = gain(ctx, p.breath * (p.voice === 'shaku' ? 0.35 : 0.18));
    breath.connect(bp).connect(bg).connect(amp);
    const pan = makePanner(ctx, rand(-0.4, 0.4));
    o.connect(amp).connect(pan).connect(this.bus);
    let t = t0;
    amp.gain.setValueAtTime(0, t0);
    const choices = [2, 2, 3, 4, 4, 6, 8];
    let lastDur = 0;
    for (let i = 0; i < count; i++) {
      this.deg += chance(this.g.leap * 0.5) ? pick([-3, 3, 4]) : pick([-2, -1, -1, 1, 1, 2]);
      if (i === count - 1 && !h.isChordTone(this.deg)) this.deg = h.nearestChordTone(this.deg);
      this.deg = clamp(this.deg, -1, h.len + 3);
      const f = h.hz(this.deg, 5 + p.oct);
      const dur = (i === count - 1 ? pick([8, 12, 16]) : pick(choices)) * info.dur;
      lastDur = dur;
      if (i === 0) o.frequency.setValueAtTime(f, t);
      else o.frequency.setTargetAtTime(f, t, 0.01 + p.glide * 0.08);
      bp.frequency.setValueAtTime(f * 2, t);
      amp.gain.setTargetAtTime(0.16 * this.vel(1), t, 0.05);
      amp.gain.setTargetAtTime(0.11, t + dur * 0.6, dur * 0.3);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(p.vibrato * (dur > 0.9 ? 22 : 8), t + Math.min(0.7, dur));
      if (i < count - 1) amp.gain.setTargetAtTime(0.05, t + dur - 0.07, 0.02);
      this.note(t, f, 0, 0.25, 'flute');
      t += dur;
    }
    // release after the last note's own settle, or it would win and hold
    const rel = Math.max(t - 0.4, t - lastDur * 0.4 + 0.01);
    amp.gain.setTargetAtTime(0, rel, 0.35);
    const end = rel + 2.4;
    for (const s of [o, vib, breath]) { s.start(t0); s.stop(end); }
    disposeOnEnd(o, [o, vib, vg, amp, breath, bp, bg, pan]);
    return t;
  }
}

/* ─── Singing bowls ─── */
export class Bowls extends Layer {
  static schema = [
    ...common({ vol: 0.6, tone: 0.9, rev: 0.7, dly: 0.1 }),
    OCT(0),
    DENSITY(0.4),
    R('decay', 'Ring', 0.3, 1.5, 1, { fmt: (v) => `${Math.round(22 * v)} s` }),
    R('beating', 'Beating', 0, 1, 0.5, { hint: 'the wah-wah shimmer' }),
    R('hardness', 'Striker', 0, 1, 0.3, { hint: 'suede ↔ wood' }),
    R('quant', 'On the beat', 0, 1, 0.5, { hint: 'free ↔ in time' }),
  ];
  interval() { return lerp(34, 6, this.dens) * rand(0.6, 1.4); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => {
      if (this.e.locked || chance(this.p.quant)) t = this.e.nextBeat(t);
      this.strike(t, rand(0.7, 1));
    });
  }
  strike(t, vel) {
    const { ctx, h, p } = this;
    const d = pick([0, 0, 0, 4, h.len, 2]);
    const f = h.hz(d, pick([3, 3, 4]) + p.oct);
    const partials = [[1, 1, 22], [2.71, 0.45, 14], [5.18, 0.22 + p.hardness * 0.2, 8], [8.46, 0.1 + p.hardness * 0.15, 4.5]];
    const pan = makePanner(ctx, rand(-0.6, 0.6));
    const sum = gain(ctx, 1);
    sum.connect(pan).connect(this.bus);
    const nodes = [sum, pan];
    let first = null;
    for (const [r, a, dec] of partials) {
      const beat = rand(0.2, 0.6) + p.beating * 2;
      const decay = dec * p.decay * rand(0.8, 1.2);
      for (const off of [0, beat]) {
        const o = osc(ctx, 'sine', f * r + off);
        const g = gain(ctx, 0);
        pluckEnv(g.gain, t, 0.13 * a * vel, 0.005 + (1 - p.hardness) * 0.05, decay);
        o.connect(g).connect(sum);
        o.start(t);
        o.stop(t + decay + 0.2);
        nodes.push(o, g);
        if (r === 1) first = o;
      }
    }
    disposeOnEnd(first, nodes);
    this.note(t, f, panOf(pan), vel * 1.6, 'bowls');
  }
}
