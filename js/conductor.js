// The running arranger. Turns a fixed running beat into an evolving song:
// sections with their own energy, instruments that take turns, drums that
// change pattern, fills and risers into the big moments, breakdowns that
// breathe, and a step pulse that never disappears.
import { LAYER_BY_ID } from './layers/index.js';
import { randomize, defaults } from './params.js';
import { seeded, clamp, lerp, rand, pick, chance, weighted, glide, gain, filter, osc, makePanner, pluckEnv, disposeOnEnd } from './util.js';

const LEADS = ['piano', 'keys', 'bells', 'marimba', 'arp', 'flute'];
const PADS = ['pad', 'strings', 'choir', 'shimmer'];
const PAD_ROLE = [...PADS, 'drone'];           // a scene's drone counts as its bed
const TEXTURES = ['rain', 'wind', 'stream', 'birds', 'ocean'];
const TEX_ROLE = [...TEXTURES, 'night', 'fire', 'thunder', 'noise']; // anything ambient can drift out

// energy 0..1 · bars are drum bars (one chord = 16 bars in running mode)
export const SECTIONS = {
  intro:     { name: 'Intro',     energy: 0.3,  bars: [16],     next: { groove: 1 } },
  groove:    { name: 'Groove',    energy: 0.6,  bars: [32, 16], next: { lift: 5, breakdown: 2, groove: 1.5 } },
  lift:      { name: 'Lift',      energy: 0.8,  bars: [16, 32], next: { peak: 6, groove: 1.5 } },
  peak:      { name: 'Peak',      energy: 1,    bars: [32, 16], next: { breakdown: 4, groove: 3, peak: 1.2 } },
  breakdown: { name: 'Breakdown', energy: 0.3,  bars: [16],     next: { build: 5, groove: 1.5 } },
  build:     { name: 'Build',     energy: 0.55, bars: [16],     next: { peak: 5, lift: 1 } },
};

const INTENSITY = {
  easy: { cap: 0.8, drums: 0.85, bias: { peak: 0.3, lift: 0.8, groove: 1.6, breakdown: 1.3 } },
  steady: { cap: 1, drums: 1, bias: {} },
  push: { cap: 1, drums: 1.06, bias: { peak: 1.7, lift: 1.4, breakdown: 0.6, groove: 0.7 } },
};

export class Conductor {
  // host: { state, setLayer(id, on, p, fade, at), onSection(info), onKey() }
  constructor(engine, host) {
    this.e = engine;
    this.host = host;
    this.active = false;
    this.intensity = 'steady';
    engine.on('bar', (b) => this.onBar(b));
  }

  get ctx() { return this.e.ctx; }

  start() {
    this.active = true;
    this.section = null;
    this.endBar = null;
    this.history = [];
    this.leadSince = 0;
    this.padSince = 0;
  }

  stop() {
    this.active = false;
    if (this.ctx) glide(this.e.arr.frequency, 20000, this.ctx.currentTime, 0.5);
    this.host.onSection(null);
  }

  skip() { if (this.active && this.nextBar != null) this.endBar = this.nextBar; }

  // jump to a particular section at the next bar (intervals use this)
  force(type) {
    if (!this.active || this.nextBar == null) return;
    this.upcoming = type;
    this.endBar = this.nextBar;
  }

  onBar({ bar, t, dur, beat, step }) {
    if (!this.active) return;
    this.nextBar = bar + 1;
    if (this.endBar == null) {
      // join at the next 16-bar line so sections land on chord changes
      this.enter('intro', t, dur, bar);
      this.endBar = bar + 16 - (bar % 16);
      return;
    }
    const left = this.endBar - bar;
    if (left === 1 && !this.upcoming) this.upcoming = this.pickNext();
    const nextE = this.upcoming ? SECTIONS[this.upcoming].energy : 0;
    const cur = SECTIONS[this.section];
    // a drum fill in the last bar before a rise in energy
    if (left === 1 && nextE > cur.energy + 0.1) this.fill(t, dur, beat, nextE);
    if (bar >= this.endBar) {
      const next = this.upcoming || this.pickNext();
      this.upcoming = null;
      this.enter(next, t, dur, bar);
    }
  }

  pickNext() {
    const s = SECTIONS[this.section] || SECTIONS.intro;
    const cfg = INTENSITY[this.intensity];
    const ids = Object.keys(s.next).filter((id) => SECTIONS[id].energy <= cfg.cap + 0.01);
    const w = ids.map((id) => s.next[id] * (cfg.bias[id] ?? 1));
    // avoid three of the same section in a row
    const recent = this.history.slice(-2);
    ids.forEach((id, i) => { if (recent.length === 2 && recent.every((r) => r === id)) w[i] = 0; });
    return ids.length ? weighted(ids, w) : 'groove';
  }

  enter(type, t, barDur, bar) {
    const sec = SECTIONS[type];
    const cfg = INTENSITY[this.intensity];
    const prev = this.section;
    const prevE = prev ? SECTIONS[prev].energy : 0;
    this.section = type;
    this.history.push(type);
    this.length = pick(sec.bars);
    this.endBar = bar + this.length;
    const fade = barDur * 1.5;
    const st = this.host.state;
    const on = (id) => st.layers[id].on;
    const set = (id, v, p, f = fade) => this.host.setLayer(id, v, p, f, t);
    const e = Math.min(sec.energy, cfg.cap);

    /* ─── drums: the step pulse (kick) always stays ─── */
    const kd = cfg.drums;
    const kick = type === 'breakdown'
      ? { vol: 0.38 * kd, punch: 0.15, click: 0.1, tone: 0.42 }
      : { vol: lerp(0.5, 0.6, e) * kd, punch: lerp(0.45, 0.8, e), click: lerp(0.25, 0.55, e), tone: 0.6 };
    set('kick', true, { steps: 16, hits: 4, rotate: 0, prob: 1, ghost: 0, ...kick }, barDur * 0.5);

    let hats;
    if (type === 'breakdown') hats = { hits: 4, rotate: 0, ghost: 0.05, vol: 0.32, open: 0 }; // on the beat: keeps the step
    else if (type === 'intro') hats = { hits: 4, rotate: 2, ghost: 0.05, vol: 0.34 };
    else if (e >= 0.95) hats = { hits: pick([16, 12, 8]), rotate: 0, prob: 1, ghost: 0.2, vol: 0.46, open: rand(0.1, 0.25) };
    else if (e >= 0.75) hats = { hits: pick([8, 16, 6]), rotate: pick([0, 2]), prob: 1, ghost: 0.15, vol: 0.44, open: rand(0, 0.15) };
    else hats = { hits: pick([4, 8]), rotate: 2, prob: 1, ghost: 0.12, vol: 0.42, open: rand(0, 0.1) };
    set('shaker', true, { steps: 16, prob: 1, kind: st.layers.shaker.p.kind, ...hats, vol: hats.vol * kd }, barDur * 0.5);

    const wantHand = e >= 0.75 || (type === 'groove' && chance(0.35));
    if (wantHand) {
      const fresh = !on('handdrum') || chance(0.5);
      set('handdrum', true, fresh ? { steps: 16, hits: pick([3, 5, 5, 7]), rotate: pick([0, 2, 3, 6]), prob: 1, ghost: rand(0.1, 0.3), vol: 0.42 * kd, pitch: rand(120, 220), tuned: chance(0.5) } : null);
    } else if (on('handdrum')) set('handdrum', false);
    if (e >= 0.95 && chance(0.55)) set('wood', true, { steps: pick([12, 16]), hits: pick([3, 5]), rotate: pick([0, 1, 3]), prob: 1, ghost: 0.1, vol: 0.3 * kd, kind: pick(['block', 'clave', 'rim']) });
    else if (on('wood')) set('wood', false);
    if (on('pulse')) set('pulse', false);

    /* ─── bass ─── */
    if (type === 'intro') { if (on('bass')) set('bass', false); }
    else set('bass', true, {
      pattern: type === 'breakdown' || type === 'build' ? 'held' : e >= 0.95 ? pick(['pulse', 'synco', 'pulse']) : e >= 0.75 ? pick(['pulse', 'roots']) : pick(['roots', 'pulse', 'rootfifth']),
      vol: type === 'breakdown' ? 0.4 : 0.5,
    });

    /* ─── pads: one bed, occasionally handed to another instrument ─── */
    const padNow = PAD_ROLE.filter(on);
    this.padSince++;
    if (!padNow.length || (this.padSince >= 3 && chance(0.5)) || (type === 'breakdown' && chance(0.4))) {
      const next = pick(PADS.filter((id) => !padNow.includes(id)));
      padNow.forEach((id) => set(id, false, null, barDur * 3));
      set(next, true, this.freshParams(next, { vol: rand(0.38, 0.48) }), barDur * 3);
      this.padSince = 0;
    }

    /* ─── leads: take turns, each section brings a new melody ─── */
    const leadCount = type === 'intro' ? (chance(0.5) ? 1 : 0) : type === 'breakdown' ? 1 : e >= 0.95 ? 2 : e >= 0.55 ? 1 + (chance(0.3) ? 1 : 0) : 1;
    let leads = LEADS.filter(on);
    this.leadSince++;
    const swap = this.leadSince >= 2 || type === 'breakdown' || (prev === 'build' && chance(0.6));
    const resting = new Set();
    if (swap && leads.length) {
      const out = pick(leads);
      resting.add(out);
      set(out, false, null, barDur * 2);
      leads = leads.filter((x) => x !== out);
      this.leadSince = 0;
    }
    while (leads.length > leadCount) set(leads.pop(), false, null, barDur * 2);
    while (leads.length < leadCount) {
      const pool = LEADS.filter((id) => !leads.includes(id) && !on(id) && !resting.has(id));
      if (!pool.length) break;
      const id = pick(pool);
      const style = type === 'breakdown' && id === 'piano' ? 'chords' : pick(['motif', 'motif', 'motif', 'arp', 'walk']);
      set(id, true, this.freshParams(id, { vol: rand(0.36, 0.48) * (leads.length ? 0.85 : 1), style, density: rand(0.35, 0.65), oct: 0 }), barDur * 2);
      leads.push(id);
    }
    // a new melody for everyone who stays
    for (const id of leads) { const l = this.e.layers[id]; if (l) l.motif = null; }

    /* ─── texture: weather passes through ─── */
    const tex = TEX_ROLE.filter(on);
    while (tex.length > 1) set(tex.pop(), false, null, barDur * 4);
    if (tex.length && chance(0.35)) set(tex[0], false, null, barDur * 4);
    else if (!tex.length && chance(type === 'breakdown' ? 0.7 : 0.25)) {
      const id = pick(TEXTURES);
      set(id, true, this.freshParams(id, { vol: rand(0.25, 0.4) }), barDur * 4);
    }

    /* ─── harmony & colour ─── */
    const h = this.e.harmony;
    if (type === 'breakdown' && chance(0.5)) h.newLoop();
    if (type === 'peak' && prev === 'build' && chance(0.18)) {
      h.setKey((h.root + 2) % 12, h.mode);
      for (const id in this.e.layers) this.e.layers[id].onKey(t);
      this.host.onKey();
    }
    const f = this.e.arr.frequency;
    // hold the value a build's sweep will have reached at t, not today's value
    if (f.cancelAndHoldAtTime) f.cancelAndHoldAtTime(t);
    else { f.cancelScheduledValues(t); f.setValueAtTime(f.value, t); }
    if (type === 'breakdown') f.setTargetAtTime(1600, t, barDur);
    else if (type === 'build') { f.setValueAtTime(1400, t); f.exponentialRampToValueAtTime(18000, t + barDur * this.length); }
    else f.setTargetAtTime(20000, t, barDur * 0.3);
    if (e >= 0.95 && prevE < 0.7) this.impact(t);
    if (type === 'build') this.riser(t, barDur * this.length);

    this.host.onSection({ type, name: sec.name, bars: this.length, t });
  }

  freshParams(id, over) {
    const def = LAYER_BY_ID[id];
    const p = randomize(def.schema, seeded((Math.random() * 2 ** 32) >>> 0), defaults(def.schema));
    return { ...p, ...over };
  }

  /* ─── transitions, synthesised here so they don't need a layer ─── */

  out() {
    if (!this.bus) {
      this.bus = gain(this.ctx, 0.75);
      this.bus.connect(this.e.dryIn);
      const r = gain(this.ctx, 0.5);
      this.bus.connect(r).connect(this.e.revIn);
    }
    return this.bus;
  }

  // a tom roll in the last bar that rises into the next section
  fill(t, bar, beat, energy) {
    const ctx = this.ctx;
    // the last beat or two of the bar, whatever the meter
    const span = energy > 0.9 ? Math.min(2 * beat, bar / 2) : beat;
    const start = t + bar - span;
    const n = energy > 0.9 ? 8 : 4;
    const step = span / n;
    const base = pick([110, 130, 150]);
    for (let i = 0; i < n; i++) {
      const at = start + i * step;
      const f = base * Math.pow(2, i / (n + 2));
      const o = osc(ctx, 'sine', f * 1.6);
      o.frequency.setValueAtTime(f * 1.6, at);
      o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
      const g = gain(ctx, 0);
      pluckEnv(g.gain, at, 0.18 + 0.3 * (i / n), 0.003, 0.22);
      const p = makePanner(ctx, lerp(-0.4, 0.4, i / n));
      o.connect(g).connect(p).connect(this.out());
      o.start(at); o.stop(at + 0.3);
      disposeOnEnd(o, [o, g, p]);
    }
  }

  // filtered noise sweeping up across a build
  riser(t, len) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.white;
    s.loop = true;
    const bp = filter(ctx, 'bandpass', 300, 2.5);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + len);
    const g = gain(ctx, 0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + len * 0.97);
    g.gain.linearRampToValueAtTime(0, t + len);
    s.connect(bp).connect(g).connect(this.out());
    s.start(t);
    s.stop(t + len + 0.05);
    disposeOnEnd(s, [s, bp, g]);
  }

  // two soft bell notes: rising into a push, falling into a recovery
  cue(up, t = this.ctx.currentTime + 0.05) {
    const ctx = this.ctx;
    const f0 = 440 * Math.pow(2, (this.e.harmony.root - 9) / 12) * 2;
    const notes = up ? [f0, f0 * 1.5] : [f0 * 1.5, f0];
    notes.forEach((f, i) => {
      const at = t + i * 0.22;
      const o = osc(ctx, 'sine', f);
      const o2 = osc(ctx, 'sine', f * 2.76);
      const g = gain(ctx, 0);
      const g2 = gain(ctx, 0.12);
      pluckEnv(g.gain, at, 0.22, 0.004, 1.4);
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(this.out());
      o.start(at); o2.start(at);
      o.stop(at + 1.5); o2.stop(at + 1.5);
      disposeOnEnd(o, [o, o2, g, g2]);
    });
  }

  // a deep hit on the downbeat of a peak
  impact(t) {
    const ctx = this.ctx;
    const o = osc(ctx, 'sine', 90);
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.5);
    const g = gain(ctx, 0);
    pluckEnv(g.gain, t, 0.32, 0.005, 1.6);
    o.connect(g).connect(this.out());
    o.start(t); o.stop(t + 1.8);
    disposeOnEnd(o, [o, g]);
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.pink;
    const lp = filter(ctx, 'lowpass', 2400, 0.7);
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 1.2);
    const ng = gain(ctx, 0);
    pluckEnv(ng.gain, t, 0.3, 0.004, 1.2);
    s.connect(lp).connect(ng).connect(this.out());
    s.start(t, rand(0, 3), 1.4);
    disposeOnEnd(s, [s, lp, ng]);
  }
}
