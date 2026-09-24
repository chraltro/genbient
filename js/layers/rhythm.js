// Gentle percussion on Euclidean patterns, locked to the tempo grid.
import { clamp, rand, pick, chance, makePanner, osc, gain, filter, disposeOnEnd, pluckEnv } from '../util.js';
import { R, C, T } from '../params.js';
import { Layer, Drum, common, euclidParams } from './base.js';
import { accent } from '../composer.js';

const hzf = (v) => `${Math.round(v)} Hz`;
const sec = (v) => `${Math.round(v * 1000)} ms`;

function noiseHit(layer, t, { type = 'bandpass', freq = 3000, q = 1, peak = 0.3, attack = 0.001, decay = 0.05, pan = 0, src = 'white' }) {
  const { ctx } = layer;
  const s = ctx.createBufferSource();
  s.buffer = layer.e.noise[src];
  const f = filter(ctx, type, freq, q);
  const g = gain(ctx, 0);
  pluckEnv(g.gain, t, peak, attack, decay);
  const p = makePanner(ctx, pan);
  s.connect(f).connect(g).connect(p).connect(layer.bus);
  s.start(t, rand(0, 4), attack + decay + 0.05);
  disposeOnEnd(s, [s, f, g, p]);
}

/* ─── Soft kick ─── */
export class Kick extends Drum {
  static schema = [
    ...common({ vol: 0.55, tone: 0.55, rev: 0.12, dly: 0, toneGen: [0.4, 0.7], revGen: [0, 0.3], dlyGen: [0, 0.05] }),
    ...euclidParams({ steps: 16, hits: 4, hitsGen: [1, 4], ghost: 0.05 }),
    R('pitch', 'Pitch', 32, 90, 52, { fmt: hzf, gen: [40, 65] }),
    R('decay', 'Decay', 0.1, 1.2, 0.45, { fmt: sec }),
    R('punch', 'Punch', 0, 1, 0.35),
    R('click', 'Beater', 0, 1, 0.2),
  ];
  hit(t, v) {
    const { ctx, p } = this;
    const o = osc(ctx, 'sine', p.pitch);
    o.frequency.setValueAtTime(p.pitch * (1.5 + p.punch * 2.5), t);
    o.frequency.exponentialRampToValueAtTime(p.pitch, t + 0.03 + p.punch * 0.05);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.9 * v, 0.004, p.decay);
    const sh = this.e.shaper(0.2 + p.punch * 0.3);
    o.connect(amp).connect(sh).connect(this.bus);
    o.start(t); o.stop(t + p.decay + 0.1);
    disposeOnEnd(o, [o, amp, sh]);
    if (p.click > 0.02) noiseHit(this, t, { type: 'lowpass', freq: 2500, peak: 0.25 * p.click * v, decay: 0.012 });
    this.e.duck(t, v);
  }
}

/* ─── Shaker / hats ─── */
const SHAKERS = { shaker: [6000, 1.2, 0.06], hat: [9000, 0.8, 0.035], brush: [3500, 0.6, 0.12], seeds: [4500, 3, 0.08] };
export class Shaker extends Drum {
  static schema = [
    ...common({ vol: 0.45, tone: 0.95, rev: 0.3, dly: 0.1, revGen: [0.1, 0.5] }),
    ...euclidParams({ steps: 16, hits: 8, hitsGen: [4, 12], ghost: 0.3 }),
    C('kind', 'Sound', [['shaker', 'Shaker'], ['hat', 'Hi-hat'], ['brush', 'Brush'], ['seeds', 'Seed pod']], 'shaker'),
    R('color', 'Colour', 0, 1, 0.5),
    R('decay', 'Length', 0.3, 3, 1, { fmt: (v) => `×${v.toFixed(1)}` }),
    R('open', 'Open hits', 0, 1, 0.1),
    R('width', 'Width', 0, 1, 0.4),
  ];
  hit(t, v, ghost) {
    const { p } = this;
    const [f, q, d] = SHAKERS[p.kind] || SHAKERS.shaker;
    const open = !ghost && chance(p.open * 0.5);
    noiseHit(this, t, {
      type: 'bandpass', freq: f * (0.6 + p.color * 0.8), q, peak: 0.35 * v,
      attack: p.kind === 'brush' ? 0.01 : 0.002, decay: d * p.decay * (open ? 4 : 1),
      pan: rand(-p.width, p.width),
    });
  }
}

/* ─── Hand drum ─── */
export class HandDrum extends Drum {
  static schema = [
    ...common({ vol: 0.5, tone: 0.75, rev: 0.35, dly: 0.1 }),
    ...euclidParams({ steps: 16, hits: 5, hitsGen: [3, 7], ghost: 0.25 }),
    R('pitch', 'Pitch', 70, 320, 150, { fmt: hzf, gen: [100, 240] }),
    R('slap', 'Slaps', 0, 1, 0.3),
    R('decay', 'Resonance', 0.1, 1, 0.35, { fmt: sec }),
    R('bend', 'Pitch bend', 0, 1, 0.3),
    T('tuned', 'Tuned to key', false, { gen: 0.4 }),
  ];
  hit(t, v, ghost, info) {
    const { ctx, p, h } = this;
    const strong = info && accent(info.sib, info.groups) >= 0.8;
    const slap = !strong && !ghost && chance(p.slap);
    let f = p.pitch * (strong ? 1 : pick([1, 1, 1.5, 1.33]));
    if (p.tuned) f = h.hz(pick([0, 4, 2]), 2) * Math.pow(2, Math.round(Math.log2(p.pitch / h.hz(0, 2))));
    if (slap) {
      noiseHit(this, t, { freq: f * 6, q: 1.5, peak: 0.5 * v, decay: 0.06, pan: this.p.pan });
      return;
    }
    const o = osc(ctx, 'sine', f);
    o.frequency.setValueAtTime(f * (1 + p.bend * 0.6), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const o2 = osc(ctx, 'sine', f * 1.59);
    const g2 = gain(ctx, 0);
    pluckEnv(g2.gain, t, 0.15 * v, 0.002, p.decay * 0.3);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.55 * v, 0.003, p.decay);
    o.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(this.bus);
    for (const x of [o, o2]) { x.start(t); x.stop(t + p.decay + 0.1); }
    disposeOnEnd(o, [o, o2, g2, amp]);
    noiseHit(this, t, { freq: 2200, q: 1, peak: 0.08 * v, decay: 0.015 });
  }
}

/* ─── Wood percussion ─── */
const WOODS = { block: [900, 0.06, 'sine'], clave: [2400, 0.04, 'sine'], rim: [1700, 0.03, 'triangle'], tick: [5200, 0.012, 'square'] };
export class Wood extends Drum {
  static schema = [
    ...common({ vol: 0.4, tone: 0.9, rev: 0.45, dly: 0.3 }),
    ...euclidParams({ steps: 12, hits: 3, stepsGen: [5, 16], hitsGen: [2, 5], ghost: 0.1 }),
    C('kind', 'Sound', [['block', 'Woodblock'], ['clave', 'Clave'], ['rim', 'Rim'], ['tick', 'Tick']], 'block'),
    R('pitch', 'Pitch', 0.5, 2, 1, { fmt: (v) => `×${v.toFixed(2)}` }),
    R('decay', 'Length', 0.5, 3, 1, { fmt: (v) => `×${v.toFixed(1)}` }),
    R('pitchVar', 'Two-tone', 0, 1, 0.3),
  ];
  hit(t, v) {
    const { ctx, p } = this;
    const [f0, d, type] = WOODS[p.kind] || WOODS.block;
    const f = f0 * p.pitch * (chance(p.pitchVar) ? 1.33 : 1);
    const o = osc(ctx, type, f);
    const bp = filter(ctx, 'bandpass', f, 4);
    const amp = gain(ctx, 0);
    const dec = d * p.decay;
    pluckEnv(amp.gain, t, (type === 'square' ? 0.2 : 0.45) * v, 0.001, dec);
    o.connect(bp).connect(amp).connect(this.bus);
    o.start(t); o.stop(t + dec + 0.05);
    disposeOnEnd(o, [o, bp, amp]);
  }
}

/* ─── Heartbeat ─── */
export class Heartbeat extends Layer {
  static schema = [
    ...common({ vol: 0.55, tone: 0.5, rev: 0.25, dly: 0, revGen: [0.1, 0.4], dlyGen: [0, 0.1] }),
    C('every', 'Beats', [[1, 'Every beat'], [2, 'Every other'], [4, 'Once a bar']], 1),
    R('pitch', 'Depth', 0, 1, 0.4),
    R('second', 'Second beat', 0, 1, 0.55),
    R('decay', 'Length', 0.2, 1.4, 0.7, { fmt: sec }),
  ];
  onStep(info) {
    if (!this.g.beat || accent(info.sib, info.groups) < 0.8) return;
    this.beat = info.sib === 0 ? 0 : (this.beat ?? 0) + 1;
    const every = this.p.every;
    if (every === 4 ? info.sib !== 0 : this.beat % every !== 0) return;
    const t = this.e.human(info.t);
    this.thump(t, 1);
    if (this.p.second > 0.02) this.thump(t + Math.min(0.3, info.dur * 1.3), this.p.second * 0.8);
  }
  thump(t, vel) {
    const { ctx, h, p } = this;
    const f = h.hz(0, 1) * (1 + p.pitch);
    const o = osc(ctx, 'sine', f * 1.6);
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const o2 = osc(ctx, 'triangle', f * 2);
    const g2 = gain(ctx, 0.25);
    const lp = filter(ctx, 'lowpass', 500);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.5 * vel, 0.012, p.decay);
    o.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(lp).connect(this.bus);
    o.start(t); o2.start(t); o.stop(t + p.decay + 0.2); o2.stop(t + p.decay + 0.2);
    disposeOnEnd(o, [o, o2, g2, lp, amp]);
    if (vel === 1) this.note(t, f, 0, 0.5, 'pulse');
  }
}
