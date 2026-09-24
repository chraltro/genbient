// The screen as an instrument. Horizontal position picks a note from the
// current key (always in harmony), vertical position shapes its tone, and
// a finger can also sculpt the whole mix: brightness and space.
import { clamp, lerp, glide, makePanner, osc, gain, filter, disposeOnEnd, pluckEnv } from './util.js';

export class Touch {
  constructor(e) {
    this.e = e;
    const ctx = (this.ctx = e.ctx);
    this.bus = gain(ctx, 0.5);
    this.bus.connect(e.dryIn);
    this.echo = gain(ctx, 0.4);
    this.bus.connect(this.echo).connect(e.dlyIn);
    this.rev = gain(ctx, 0.7);
    this.bus.connect(this.rev).connect(e.revIn);
    this.voices = new Map();
    this.sculpting = 0;
  }

  get g() { return this.e.g; }
  get plays() { return this.g.touchMode === 'both' || this.g.touchMode === 'play'; }
  get sculpts() { return this.g.touchMode === 'both' || this.g.touchMode === 'sculpt'; }

  configure() {
    const t = this.ctx.currentTime;
    glide(this.bus.gain, this.g.touchLevel * 0.8, t, 0.2);
    glide(this.echo.gain, this.g.touchEcho * 0.9, t, 0.2);
  }

  degrees() {
    const h = this.e.harmony;
    const oct = Math.round(this.g.touchRange);
    const out = [];
    if (this.g.touchNotes === 'chord') {
      for (let o = 0; o <= oct; o++) for (const d of h.chord.tones) out.push(d + o * h.len);
      out.sort((a, b) => a - b);
      return [...new Set(out)].filter((d) => d <= h.chord.tones[0] + oct * h.len);
    }
    const keep = this.g.touchNotes === 'penta' && h.len >= 7 ? [0, 1, 2, 4, 5] : null;
    for (let d = 0; d <= oct * h.len; d++) if (!keep || keep.includes(((d % h.len) + h.len) % h.len)) out.push(d);
    return out;
  }

  pick(v, x) {
    const list = this.degrees();
    const pos = clamp(x, 0, 0.999) * list.length;
    // hysteresis so a resting finger doesn't flutter between two notes
    if (v.idx != null && v.len === list.length && Math.abs(pos - (v.idx + 0.5)) < 0.72) return null;
    v.idx = Math.floor(pos);
    v.len = list.length;
    const base = 4 - Math.floor(this.g.touchRange / 2);
    return this.e.harmony.hz(list[v.idx], base);
  }

  down(id, x, y) {
    if (!this.e.ctx || this.g.touchMode === 'off') return;
    if (this.sculpts) this.sculpt(x, y, true);
    if (!this.plays) return;
    const v = { idx: null };
    const f = this.pick(v, x);
    this.build(v, f, y, x);
    this.voices.set(id, v);
    this.announce(v, f, x, 0.9);
  }

  move(id, x, y) {
    if (this.sculpts) this.sculpt(x, y, false);
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.ctx.currentTime;
    const bright = 1 - y;
    if (v.lp) glide(v.lp.frequency, 400 + bright * bright * 6000, t, 0.05);
    if (v.mg) glide(v.mg.gain, v.f * (0.2 + bright * 2.5), t, 0.05);
    if (v.formants) v.formants.forEach((bp, i) => glide(bp.frequency, lerp([320, 900][i], [800, 1300][i], bright), t, 0.08));
    if (v.pan && v.pan.pan) glide(v.pan.pan, (x - 0.5) * 1.4, t, 0.05);
    const f = this.pick(v, x);
    if (f == null) return;
    const tc = 0.004 + this.g.touchGlide * 0.09;
    if (v.kind === 'pluck') this.pluck(f, bright, x);
    for (const [p, mult] of v.freqs || []) glide(p, f * mult, t, tc);
    if (v.amp) {
      // a soft re-articulation on each new note
      v.amp.gain.cancelScheduledValues(t);
      v.amp.gain.setValueAtTime(v.amp.gain.value, t);
      v.amp.gain.linearRampToValueAtTime(v.peak * 0.55, t + 0.03);
      v.amp.gain.linearRampToValueAtTime(v.peak, t + 0.12);
    }
    v.f = f;
    this.announce(v, f, x, 0.55);
  }

  up(id) {
    if (this.sculpting && this.voices.size <= 1) this.release();
    const v = this.voices.get(id);
    this.voices.delete(id);
    if (!v || !v.amp) return;
    const t = this.ctx.currentTime;
    glide(v.amp.gain, 0, t, 0.35);
    for (const s of v.srcs) s.stop(t + 2);
  }

  announce(v, f, x, strength) {
    this.e.notify({ t: this.ctx.currentTime, f, pan: (x - 0.5) * 1.6, v: strength, kind: 'touch' });
  }

  pluck(f, bright, x) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.35, 0.003, 1.6);
    const o1 = osc(ctx, 'triangle', f);
    const o2 = osc(ctx, 'sine', f * 3);
    const g2 = gain(ctx, 0);
    pluckEnv(g2.gain, t, 0.12 * bright, 0.002, 0.25);
    const pan = makePanner(ctx, (x - 0.5) * 1.4);
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(pan).connect(this.bus);
    o1.start(t); o2.start(t); o1.stop(t + 1.8); o2.stop(t + 1.8);
    disposeOnEnd(o1, [o1, o2, g2, amp, pan]);
  }

  build(v, f, y, x) {
    const { ctx } = this;
    const t = ctx.currentTime;
    const kind = this.g.touchVoice;
    const bright = 1 - y;
    v.kind = kind;
    v.f = f;
    if (kind === 'pluck') { this.pluck(f, bright, x); return; }
    const amp = gain(ctx, 0);
    const pan = makePanner(ctx, (x - 0.5) * 1.4);
    amp.connect(pan).connect(this.bus);
    const srcs = [];
    const nodes = [amp, pan];
    const freqs = [];
    const add = (type, mult, g, dest, det = 0) => {
      const o = osc(ctx, type, f * mult, det);
      const gg = gain(ctx, g);
      o.connect(gg).connect(dest);
      o.start(t);
      srcs.push(o);
      nodes.push(o, gg);
      freqs.push([o.frequency, mult]);
      return o;
    };
    let peak = 0.3;
    if (kind === 'glass') {
      const lp = filter(ctx, 'lowpass', 400 + bright * bright * 6000, 0.7);
      lp.connect(amp);
      add('sine', 1, 0.5, lp);
      add('sine', 2, 0.12, lp, 3);
      add('triangle', 1, 0.15, lp, -4);
      const trem = osc(ctx, 'sine', 5.5);
      const tg = gain(ctx, 0.12);
      trem.connect(tg).connect(amp.gain);
      trem.start(t);
      srcs.push(trem);
      nodes.push(lp, trem, tg);
      v.lp = lp;
    } else if (kind === 'warm') {
      const lp = filter(ctx, 'lowpass', 400 + bright * bright * 6000, 1.2);
      lp.connect(amp);
      add('triangle', 1, 0.45, lp, -5);
      add('sawtooth', 1, 0.12, lp, 6);
      add('sine', 0.5, 0.25, lp);
      nodes.push(lp);
      v.lp = lp;
    } else if (kind === 'voice') {
      const sum = gain(ctx, 1);
      v.formants = [0, 1].map((i) => {
        const bp = filter(ctx, 'bandpass', lerp([320, 900][i], [800, 1300][i], bright), 8);
        const g = gain(ctx, i ? 0.6 : 1.4);
        sum.connect(bp).connect(g).connect(amp);
        nodes.push(bp, g);
        return bp;
      });
      add('sawtooth', 1, 0.5, sum, -7);
      add('sawtooth', 1, 0.5, sum, 7);
      nodes.push(sum);
      peak = 0.45;
    } else {
      // bell: sustained FM
      const car = add('sine', 1, 0.6, amp);
      const mod = osc(ctx, 'sine', f * 3.5);
      const mg = gain(ctx, f * (0.2 + bright * 2.5));
      mod.connect(mg).connect(car.frequency);
      mod.start(t);
      srcs.push(mod);
      nodes.push(mod, mg);
      freqs.push([mod.frequency, 3.5]);
      v.mg = mg;
    }
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.06);
    disposeOnEnd(srcs[0], nodes);
    Object.assign(v, { amp, pan, srcs, freqs, peak });
  }

  // Sculpting bends the master mix while a finger is down.
  sculpt(x, y, first) {
    const e = this.e;
    const t = this.ctx.currentTime;
    const depth = this.g.touchSculpt;
    const up = 1 - y;
    this.sculpting = 1;
    const tc = first ? 0.15 : 0.06;
    const open = this.g.touchMode === 'sculpt' ? x : lerp(0.35, 1, up);
    glide(e.sculpt.frequency, lerp(20000, 250 * Math.pow(2, open * 6.3), depth), t, tc);
    const space = this.g.touchMode === 'sculpt' ? up : up * 0.8;
    glide(e.revOut.gain, (0.1 + e.g.revMix * 1.2) * (1 + space * depth * 1.6), t, tc);
    glide(e.fbGL.gain, clamp(e.g.dlyFb + space * depth * 0.3, 0, 0.92), t, tc);
    glide(e.fbGR.gain, clamp(e.g.dlyFb + space * depth * 0.3, 0, 0.92), t, tc);
  }

  release() {
    const e = this.e;
    const t = this.ctx.currentTime;
    this.sculpting = 0;
    glide(e.sculpt.frequency, 20000, t, 0.8);
    glide(e.revOut.gain, 0.1 + e.g.revMix * 1.2, t, 1.2);
    glide(e.fbGL.gain, e.g.dlyFb, t, 1.2);
    glide(e.fbGR.gain, e.g.dlyFb, t, 1.2);
  }
}
