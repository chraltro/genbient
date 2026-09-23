// Every sound source in Genbient is a Layer. Tonal layers follow the shared
// Harmony; nature layers are shaped noise; all of them schedule their own
// events a little ahead of the audio clock.
import {
  clamp, lerp, rand, randi, pick, chance, expRand,
  glide, makePanner, disposeOnEnd, osc, gain, filter, pluckEnv, swellEnv,
} from './util.js';

export class Layer {
  constructor(engine, def) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.def = def;
    this.id = def.id;
    this.vol = 0.6;
    this.ch = 0.5;
    this.on = false;
    this.running = false;

    this.bus = gain(this.ctx, 0);
    this.bus.connect(engine.dryIn);
    this.rev = gain(this.ctx, def.rev ?? 0.5);
    this.bus.connect(this.rev).connect(engine.revIn);
    if (def.dly) {
      this.dly = gain(this.ctx, def.dly);
      this.bus.connect(this.dly).connect(engine.dlyIn);
    }
  }

  get now() { return this.ctx.currentTime; }
  get level() { return this.def.gain * this.vol * this.vol; }
  get rate() { return this.e.rate; }
  get h() { return this.e.harmony; }

  enable(fade = 4) {
    clearTimeout(this.stopTimer);
    this.on = true;
    if (!this.running) {
      this.running = true;
      this.nextT = null;
      this.start(this.now + 0.05);
    }
    glide(this.bus.gain, this.level, this.now, fade / 3);
  }

  disable(fade = 3) {
    if (!this.on) return;
    this.on = false;
    glide(this.bus.gain, 0, this.now, fade / 4);
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (!this.on && this.running) {
        this.running = false;
        this.stop();
      }
    }, fade * 1000 + 2000);
  }

  setVolume(v) {
    this.vol = v;
    if (this.on) glide(this.bus.gain, this.level, this.now, 0.25);
  }

  setCharacter(c) {
    this.ch = c;
    if (this.running) this.character(c);
  }

  // Poisson-style event loop shared by most event layers.
  events(now, horizon, interval, fire) {
    if (this.nextT == null || this.nextT < now - 1) this.nextT = now + rand(0.3, 2);
    let guard = 0;
    while (this.nextT < horizon && guard++ < 64) {
      const t = this.nextT;
      const next = fire(Math.max(t, now + 0.01));
      this.nextT = t + Math.max(0.02, next ?? interval());
    }
  }

  note(t, f, pan, v, kind) { this.e.notify({ t, f, pan, v, kind: kind || this.id }); }

  start() {}
  stop() {}
  character() {}
  schedule() {}
  onChord(t) {}
  onKey(t) { this.onChord(t); }
}

// A crossfading "sustained chord" base used by Pad and Choir.
class Sustained extends Layer {
  start(t) {
    this.voices = [];
    this.voices.push(this.makeVoice(t, 6));
  }
  onChord(t) {
    if (!this.running) return;
    for (const v of this.voices) this.release(v, t, 9);
    this.voices = this.voices.filter((v) => !v.dead);
    this.voices.push(this.makeVoice(t, 7));
  }
  release(v, t, dur) {
    if (v.releasing) return;
    v.releasing = true;
    glide(v.out.gain, 0, t, dur / 4);
    for (const o of v.srcs) o.stop(t + dur + 0.5);
    disposeOnEnd(v.srcs[0], v.nodes);
    setTimeout(() => { v.dead = true; }, (dur + 1) * 1000);
  }
  stop() {
    for (const v of this.voices || []) this.release(v, this.now, 0.4);
    this.voices = [];
  }
}

/* ───────────────────────────── Tonal ───────────────────────────── */

export class Drone extends Layer {
  cutoff() { return 140 + this.ch * this.ch * 1900; }
  start(t) { this.voice = this.makeVoice(t, 7); }
  makeVoice(t, attack) {
    const { ctx } = this;
    const f = this.h.hz(0, 2);
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const filt = filter(ctx, 'lowpass', this.cutoff(), 1.2);
    const lfo = osc(ctx, 'sine', rand(0.015, 0.04));
    const lfoG = gain(ctx, this.cutoff() * 0.4);
    lfo.connect(lfoG).connect(filt.frequency);
    const parts = [
      ['sawtooth', f, -7, 0.28], ['sawtooth', f, 7, 0.28], ['sine', f / 2, 0, 0.5],
      ['sawtooth', f * 1.5, 4, 0.14], ['triangle', f * 2, -4, 0.16], ['sine', f * 3, 2, 0.05],
    ];
    const srcs = [lfo];
    const nodes = [out, filt, lfoG, lfo];
    for (const [type, fr, det, g] of parts) {
      const o = osc(ctx, type, fr, det);
      // tiny independent pitch drift keeps the beating alive
      const d = osc(ctx, 'sine', rand(0.03, 0.09));
      const dg = gain(ctx, rand(2, 5));
      d.connect(dg).connect(o.detune);
      const gg = gain(ctx, g);
      o.connect(gg).connect(filt);
      o.start(t); d.start(t);
      srcs.push(o, d);
      nodes.push(o, gg, d, dg);
    }
    lfo.start(t);
    filt.connect(out).connect(this.bus);
    return { out, filt, lfoG, srcs, nodes };
  }
  character() {
    if (!this.voice) return;
    glide(this.voice.filt.frequency, this.cutoff(), this.now, 0.6);
    glide(this.voice.lfoG.gain, this.cutoff() * 0.4, this.now, 0.6);
  }
  release(v, t, dur) {
    glide(v.out.gain, 0, t, dur / 4);
    for (const s of v.srcs) s.stop(t + dur + 0.5);
    disposeOnEnd(v.srcs[0], v.nodes);
  }
  onKey(t) {
    if (!this.running) return;
    const old = this.voice;
    this.voice = this.makeVoice(t, 8);
    if (old) this.release(old, t, 10);
  }
  stop() {
    if (this.voice) this.release(this.voice, this.now, 0.3);
    this.voice = null;
  }
}

export class Pad extends Sustained {
  cutoff() { return 300 + this.ch * this.ch * 4200; }
  makeVoice(t, attack) {
    const { ctx, h } = this;
    const [a, b, c, d] = h.chordDegrees(4);
    let notes = [h.midi(a, 3), h.midi(c, 3), h.midi(b, 4), h.midi(d, 4)];
    notes = notes.map((m) => (m > 79 ? m - 12 : m));
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const filt = filter(ctx, 'lowpass', this.cutoff(), 0.6);
    const lfo = osc(ctx, 'sine', rand(0.025, 0.07));
    const lfoG = gain(ctx, this.cutoff() * 0.35);
    lfo.connect(lfoG).connect(filt.frequency);
    lfo.start(t);
    const srcs = [lfo];
    const nodes = [out, filt, lfo, lfoG];
    notes.forEach((m, i) => {
      const f = h.freq(m);
      const pan = makePanner(ctx, (i / (notes.length - 1)) * 1.3 - 0.65);
      // slow per-note swell so the chord breathes
      const ng = gain(ctx, 0.7);
      const trem = osc(ctx, 'sine', rand(0.04, 0.12));
      const tg = gain(ctx, 0.3);
      trem.connect(tg).connect(ng.gain);
      trem.start(t);
      for (const [type, det, g] of [['sawtooth', -rand(4, 9), 0.07], ['triangle', rand(4, 9), 0.12]]) {
        const o = osc(ctx, type, f, det);
        const gg = gain(ctx, g);
        o.connect(gg).connect(ng);
        o.start(t);
        srcs.push(o);
        nodes.push(o, gg);
      }
      ng.connect(pan).connect(filt);
      srcs.push(trem);
      nodes.push(ng, pan, trem, tg);
    });
    filt.connect(out).connect(this.bus);
    return { out, filt, lfoG, srcs, nodes };
  }
  character() {
    for (const v of this.voices || []) {
      glide(v.filt.frequency, this.cutoff(), this.now, 0.6);
      glide(v.lfoG.gain, this.cutoff() * 0.35, this.now, 0.6);
    }
  }
}

const VOWELS = [
  { f: [300, 870, 2240], g: [1, 0.35, 0.12] },  // oo
  { f: [450, 800, 2830], g: [1, 0.5, 0.15] },   // oh
  { f: [730, 1090, 2440], g: [1, 0.55, 0.2] },  // ah
  { f: [530, 1840, 2480], g: [1, 0.4, 0.2] },   // eh
];

export class Choir extends Sustained {
  start(t) {
    const { ctx } = this;
    this.input = gain(ctx, 1);
    this.bank = [0, 1, 2].map((i) => {
      const bp = filter(ctx, 'bandpass', VOWELS[1].f[i], [9, 12, 14][i]);
      const g = gain(ctx, VOWELS[1].g[i]);
      this.input.connect(bp).connect(g).connect(this.bus);
      return { bp, g };
    });
    this.nextVowel = t;
    super.start(t);
  }
  vowelAt(x) {
    x = clamp(x, 0, 1) * (VOWELS.length - 1);
    const i = Math.min(VOWELS.length - 2, Math.floor(x));
    const k = x - i;
    return {
      f: VOWELS[i].f.map((v, j) => lerp(v, VOWELS[i + 1].f[j], k)),
      g: VOWELS[i].g.map((v, j) => lerp(v, VOWELS[i + 1].g[j], k)),
    };
  }
  schedule(now) {
    if (now < this.nextVowel) return;
    this.nextVowel = now + rand(5, 11);
    const v = this.vowelAt(this.ch * 0.8 + rand(-0.2, 0.3));
    this.bank.forEach((b, i) => {
      glide(b.bp.frequency, v.f[i], now, 2.5);
      glide(b.g.gain, v.g[i], now, 2.5);
    });
  }
  character() { this.nextVowel = 0; }
  makeVoice(t, attack) {
    const { ctx, h } = this;
    const [a, b, c] = h.chordDegrees(3);
    const notes = [h.midi(a, 3), h.midi(c, 3), h.midi(b, 4)];
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const vib = osc(ctx, 'sine', rand(4.4, 5.2));
    const vibG = gain(ctx, 9);
    vib.connect(vibG);
    vib.start(t);
    const srcs = [vib];
    const nodes = [out, vib, vibG];
    for (const m of notes) {
      const f = h.freq(m);
      for (let k = 0; k < 3; k++) {
        const o = osc(ctx, 'sawtooth', f, (k - 1) * rand(6, 11));
        const gg = gain(ctx, 0.3);
        vibG.connect(o.detune);
        o.connect(gg).connect(out);
        o.start(t);
        srcs.push(o);
        nodes.push(o, gg);
      }
    }
    out.connect(this.input);
    return { out, srcs, nodes };
  }
  stop() {
    super.stop();
    const nodes = [this.input, ...this.bank.flatMap((b) => [b.bp, b.g])];
    setTimeout(() => nodes.forEach((n) => n.disconnect()), 2000);
  }
}

export class Bells extends Layer {
  start() { this.deg = 0; }
  interval() { return expRand(lerp(9, 1.4, this.ch) / this.rate); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => {
      const n = chance(0.25) ? randi(2, 4) : 1;
      for (let i = 0; i < n; i++) this.ring(t + i * rand(0.18, 0.5) / this.rate, i ? 0.6 : 1);
    });
  }
  ring(t, vel) {
    const { ctx, h } = this;
    this.deg += pick([-2, -1, -1, 1, 1, 2, 3, -3]);
    if (!h.isChordTone(this.deg) && chance(0.6)) this.deg += chance(0.5) ? 1 : -1;
    this.deg = clamp(this.deg, -2, h.len * 2);
    const f = h.hz(this.deg, 5);
    const dur = rand(3.5, 7);
    const ratio = pick([3.5, 3.5, 2.0, 4.2, 2.76]);
    const car = osc(ctx, 'sine', f);
    const mod = osc(ctx, 'sine', f * ratio);
    const mg = gain(ctx, 0);
    const idx = lerp(0.8, 2.6, Math.random());
    mg.gain.setValueAtTime(f * idx, t);
    mg.gain.exponentialRampToValueAtTime(f * 0.02, t + dur * 0.5);
    mod.connect(mg).connect(car.frequency);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.22 * vel, 0.004, dur);
    const pan = makePanner(ctx, rand(-0.8, 0.8));
    car.connect(amp).connect(pan).connect(this.bus);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
    disposeOnEnd(car, [car, mod, mg, amp, pan]);
    this.note(t, f, pan.pan ? pan.pan.value : 0, vel);
  }
}

export class Keys extends Layer {
  start() { this.last = 0; }
  schedule(now, horizon) {
    if (this.nextT == null || this.nextT < now - 1) this.nextT = now + rand(0.5, 2.5);
    if (this.nextT >= horizon) return;
    const { h } = this;
    const bpm = lerp(52, 84, this.e.params.pace);
    const beat = (60 / bpm) * pick([0.5, 0.5, 1]);
    const count = randi(3, 8);
    const shape = pick(['up', 'down', 'wave', 'walk']);
    const tones = h.chordDegrees(3);
    const pool = [];
    for (let o = 0; o < 2; o++) for (const d of tones) pool.push(d + o * h.len);
    let i = shape === 'down' ? pool.length - 1 : randi(0, 2);
    let t = this.nextT;
    for (let k = 0; k < count; k++) {
      let d = pool[clamp(i, 0, pool.length - 1)];
      if (chance(0.15)) d += pick([-1, 1]); // passing tone
      const f = h.hz(d, 4);
      this.pluck(t, f, (k === 0 ? 1 : rand(0.45, 0.85)) * rand(0.8, 1));
      if (shape === 'up') i++;
      else if (shape === 'down') i--;
      else if (shape === 'wave') i += k < count / 2 ? 1 : -1;
      else i += pick([-2, -1, 1, 1, 2]);
      i = clamp(i, 0, pool.length - 1);
      t += beat * pick([1, 1, 1, 2, 1.5]);
    }
    const rest = expRand(lerp(14, 2, this.ch)) / this.rate;
    this.nextT = t + rest;
  }
  pluck(t, f, vel) {
    const { ctx } = this;
    const decay = rand(2, 3.5);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.3 * vel, 0.003, decay);
    const o1 = osc(ctx, 'sine', f);
    const o2 = osc(ctx, 'sine', f * 2);
    const g2 = gain(ctx, 0);
    pluckEnv(g2.gain, t, 0.12, 0.002, 0.7);
    const o3 = osc(ctx, 'sine', f * 5.95);
    const g3 = gain(ctx, 0);
    pluckEnv(g3.gain, t, 0.05, 0.001, 0.09);
    const pan = makePanner(ctx, rand(-0.5, 0.5));
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    o3.connect(g3).connect(amp);
    amp.connect(pan).connect(this.bus);
    for (const o of [o1, o2, o3]) { o.start(t); o.stop(t + decay + 0.1); }
    disposeOnEnd(o1, [o1, o2, o3, g2, g3, amp, pan]);
    this.note(t, f, pan.pan ? pan.pan.value : 0, vel * 0.6);
  }
}

export class Bowls extends Layer {
  interval() { return lerp(34, 8, this.ch) * rand(0.6, 1.4) / this.rate; }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => this.strike(t, rand(0.7, 1)));
  }
  strike(t, vel) {
    const { ctx, h } = this;
    const d = pick([0, 0, 0, 4, h.len, 2]);
    const f = h.hz(d, pick([3, 3, 4]));
    const partials = [[1, 1, 22], [2.71, 0.45, 14], [5.18, 0.22, 8], [8.46, 0.1, 4.5]];
    const pan = makePanner(ctx, rand(-0.6, 0.6));
    const sum = gain(ctx, 1);
    sum.connect(pan).connect(this.bus);
    const nodes = [sum, pan];
    let first = null;
    for (const [r, a, dec] of partials) {
      const beat = rand(0.4, 2.2);
      const decay = dec * rand(0.8, 1.2);
      for (const off of [0, beat]) {
        const o = osc(ctx, 'sine', f * r + off);
        const g = gain(ctx, 0);
        pluckEnv(g.gain, t, 0.13 * a * vel, 0.03, decay);
        o.connect(g).connect(sum);
        o.start(t);
        o.stop(t + decay + 0.2);
        nodes.push(o, g);
        if (!first || r === 1) first = o;
      }
    }
    disposeOnEnd(first, nodes);
    this.note(t, f, pan.pan ? pan.pan.value : 0, vel * 1.6, 'bowls');
  }
}

export class Shimmer extends Layer {
  interval() { return expRand(lerp(7, 1.2, this.ch) / this.rate); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => this.glint(t));
  }
  glint(t) {
    const { ctx, h } = this;
    const d = pick(h.chordDegrees(3)) + (chance(0.3) ? h.len : 0);
    const f = h.hz(d, pick([5, 6, 6]));
    const a = rand(1.5, 4), hold = rand(0.5, 3), r = rand(3, 6);
    const amp = gain(ctx, 0);
    swellEnv(amp.gain, t, rand(0.04, 0.09), a, hold, r);
    const o1 = osc(ctx, 'sine', f);
    const o2 = osc(ctx, 'sine', f * 2.002);
    const g2 = gain(ctx, 0.25);
    const pan = makePanner(ctx, rand(-0.9, 0.9));
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(pan).connect(this.bus);
    const end = t + a + hold + r + 0.1;
    o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
    disposeOnEnd(o1, [o1, o2, g2, amp, pan]);
    this.note(t + a * 0.7, f, pan.pan ? pan.pan.value : 0, 0.35, 'shimmer');
  }
}

export class Flute extends Layer {
  start() { this.deg = 2; }
  schedule(now, horizon) {
    if (this.nextT == null || this.nextT < now - 1) this.nextT = now + rand(2, 6);
    if (this.nextT >= horizon) return;
    const end = this.phrase(this.nextT);
    this.nextT = end + expRand(lerp(18, 4, this.ch)) / this.rate + 1.5;
  }
  phrase(t0) {
    const { ctx, h } = this;
    const wave = this.e.waves.flute;
    const count = randi(3, 7);
    const o = osc(ctx, wave, 440);
    const vib = osc(ctx, 'sine', rand(4.6, 5.4));
    const vg = gain(ctx, 0);
    vib.connect(vg).connect(o.detune);
    const amp = gain(ctx, 0);
    const breath = ctx.createBufferSource();
    breath.buffer = this.e.noise.white;
    breath.loop = true;
    const bp = filter(ctx, 'bandpass', 1000, 2.5);
    const bg = gain(ctx, 0.07);
    breath.connect(bp).connect(bg).connect(amp);
    const pan = makePanner(ctx, rand(-0.4, 0.4));
    o.connect(amp).connect(pan).connect(this.bus);
    let t = t0;
    amp.gain.setValueAtTime(0, t0);
    const slow = lerp(1.25, 0.85, this.e.params.pace);
    for (let i = 0; i < count; i++) {
      this.deg += pick([-2, -1, -1, 1, 1, 2]);
      if (i === count - 1 && !h.isChordTone(this.deg)) this.deg += chance(0.5) ? 1 : -1;
      this.deg = clamp(this.deg, -1, h.len + 3);
      const f = h.hz(this.deg, 5);
      const dur = (i === count - 1 ? rand(2.2, 3.5) : pick([0.5, 0.75, 1, 1, 1.5])) * slow;
      if (i === 0) o.frequency.setValueAtTime(f, t);
      else o.frequency.setTargetAtTime(f, t, 0.035);
      bp.frequency.setValueAtTime(f * 2, t);
      amp.gain.setTargetAtTime(0.16 * rand(0.8, 1), t, 0.06);
      amp.gain.setTargetAtTime(0.11, t + dur * 0.6, dur * 0.3);
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(dur > 0.9 ? 16 : 6, t + Math.min(0.7, dur));
      if (i < count - 1) amp.gain.setTargetAtTime(0.05, t + dur - 0.07, 0.02);
      this.note(t, f, 0, 0.25, 'flute');
      t += dur;
    }
    amp.gain.setTargetAtTime(0, t - 0.4, 0.35);
    const end = t + 2;
    for (const s of [o, vib, breath]) s.start(t0);
    for (const s of [o, vib, breath]) s.stop(end);
    disposeOnEnd(o, [o, vib, vg, amp, breath, bp, bg, pan]);
    return t;
  }
}

export class Pulse extends Layer {
  schedule(now, horizon) {
    const bpm = lerp(42, 70, this.ch);
    this.events(now, horizon, () => 60 / bpm, (t) => {
      this.thump(t, 1);
      this.thump(t + 0.3, 0.55);
    });
  }
  thump(t, vel) {
    const { ctx, h } = this;
    const f = h.hz(0, 2);
    const o = osc(ctx, 'sine', f * 1.6);
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const o2 = osc(ctx, 'triangle', f * 2);
    const g2 = gain(ctx, 0.25);
    const lp = filter(ctx, 'lowpass', 500);
    const amp = gain(ctx, 0);
    pluckEnv(amp.gain, t, 0.5 * vel, 0.012, 0.7);
    o.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(lp).connect(this.bus);
    o.start(t); o2.start(t); o.stop(t + 0.9); o2.stop(t + 0.9);
    disposeOnEnd(o, [o, o2, g2, lp, amp]);
    if (vel === 1) this.note(t, f, 0, 0.5, 'pulse');
  }
}

/* ───────────────────────────── Nature ───────────────────────────── */

function noiseSrc(layer, type, t) {
  const s = layer.ctx.createBufferSource();
  s.buffer = layer.e.noise[type];
  s.loop = true;
  s.start(t, rand(0, s.buffer.duration));
  return s;
}

// Base for layers built from continuous looping noise.
class Continuous extends Layer {
  keep(...nodes) { (this.nodes ||= []).push(...nodes); return nodes[0]; }
  stop() {
    const t = this.now + 0.2;
    for (const n of this.nodes || []) {
      if (n.stop) { try { n.stop(t); } catch { /* not started */ } }
    }
    const nodes = this.nodes || [];
    setTimeout(() => nodes.forEach((n) => n.disconnect()), 600);
    this.nodes = [];
  }
}

export class Rain extends Continuous {
  start(t) {
    const { ctx } = this;
    const src = this.keep(noiseSrc(this, 'pink', t));
    this.hp = this.keep(filter(ctx, 'highpass', 350));
    this.lp = this.keep(filter(ctx, 'lowpass', this.cut()));
    this.body = this.keep(gain(ctx, 0.7));
    src.connect(this.hp).connect(this.lp).connect(this.body).connect(this.bus);
    const hiss = this.keep(noiseSrc(this, 'white', t));
    const hbp = this.keep(filter(ctx, 'highpass', 5000));
    this.hg = this.keep(gain(ctx, 0.06 + this.ch * 0.08));
    hiss.connect(hbp).connect(this.hg).connect(this.bus);
  }
  cut() { return 1800 + this.ch * 6000; }
  character() {
    glide(this.lp.frequency, this.cut(), this.now, 1);
    glide(this.hg.gain, 0.06 + this.ch * 0.08, this.now, 1);
  }
  schedule(now, horizon) {
    const rate = 4 + this.ch * 22;
    this.events(now, horizon, () => expRand(1 / rate), (t) => this.drop(t));
  }
  drop(t) {
    const { ctx } = this;
    const f = rand(1800, 5200);
    const o = osc(ctx, 'sine', f);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.3, 2.2), t + 0.02);
    const g = gain(ctx, 0);
    pluckEnv(g.gain, t, rand(0.01, 0.05), 0.001, 0.025);
    const pan = makePanner(ctx, rand(-1, 1));
    o.connect(g).connect(pan).connect(this.bus);
    o.start(t); o.stop(t + 0.05);
    disposeOnEnd(o, [o, g, pan]);
  }
}

export class Wind extends Continuous {
  start(t) {
    const { ctx } = this;
    const a = this.keep(noiseSrc(this, 'pink', t));
    const b = this.keep(noiseSrc(this, 'brown', t));
    this.bp = this.keep(filter(ctx, 'bandpass', 500, 0.9));
    this.g = this.keep(gain(ctx, 0.5));
    a.connect(this.bp);
    b.connect(this.bp);
    this.bp.connect(this.g).connect(this.bus);
    this.whistle = this.keep(filter(ctx, 'bandpass', 1100, 14));
    this.wg = this.keep(gain(ctx, 0));
    a.connect(this.whistle).connect(this.wg).connect(this.bus);
  }
  schedule(now, horizon) {
    this.events(now, horizon, () => rand(1.5, 4.5), (t) => {
      const gust = this.ch;
      const f = rand(220, 420 + gust * 900);
      glide(this.bp.frequency, f, t, rand(1, 2.5));
      glide(this.bp.Q, rand(0.6, 1.8 + gust * 2), t, 2);
      glide(this.g.gain, rand(0.25, 0.45 + gust * 0.9), t, rand(0.8, 2.2));
      glide(this.whistle.frequency, f * rand(2, 3.2), t, 2);
      glide(this.wg.gain, gust > 0.4 && chance(0.5) ? rand(0.3, 1.2) * gust : 0, t, 2.2);
    });
  }
}

export class Ocean extends Continuous {
  start(t) {
    const { ctx } = this;
    const b = this.keep(noiseSrc(this, 'brown', t));
    this.lp = this.keep(filter(ctx, 'lowpass', 400, 0.5));
    this.g = this.keep(gain(ctx, 0.2));
    b.connect(this.lp).connect(this.g).connect(this.bus);
    const w = this.keep(noiseSrc(this, 'pink', t));
    this.flp = this.keep(filter(ctx, 'bandpass', 2500, 0.6));
    this.fg = this.keep(gain(ctx, 0.02));
    w.connect(this.flp).connect(this.fg).connect(this.bus);
    this.nextT = t + 0.1;
  }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.period, (t) => {
      const size = lerp(0.45, 1, this.ch) * rand(0.7, 1.1);
      this.period = lerp(13, 7.5, this.ch) * rand(0.8, 1.25);
      const T = this.period;
      const rise = T * rand(0.38, 0.5);
      const { g, lp, fg } = this;
      for (const p of [g.gain, lp.frequency, fg.gain]) {
        p.cancelScheduledValues(t);
      }
      g.gain.setTargetAtTime(0.18 + 0.75 * size, t, rise / 2.5);
      lp.frequency.setTargetAtTime(500 + 1600 * size, t, rise / 2.5);
      fg.gain.setTargetAtTime(0.02, t, rise / 2);
      // crash and recede
      g.gain.setTargetAtTime(0.14, t + rise, (T - rise) / 3);
      lp.frequency.setTargetAtTime(320, t + rise, (T - rise) / 3);
      fg.gain.setTargetAtTime(0.25 * size, t + rise - 0.3, 0.4);
      fg.gain.setTargetAtTime(0.015, t + rise + 0.8, (T - rise) / 3.5);
      this.note(t + rise, 120, rand(-0.3, 0.3), 0.8 * size, 'ocean');
    });
  }
  get period() { return this._p ?? 10; }
  set period(v) { this._p = v; }
}

export class Stream extends Continuous {
  start(t) {
    const { ctx } = this;
    const body = this.keep(noiseSrc(this, 'pink', t));
    const blp = this.keep(filter(ctx, 'bandpass', 700, 0.5));
    this.bg = this.keep(gain(ctx, 0.5));
    body.connect(blp).connect(this.bg).connect(this.bus);
    this.babble = [];
    for (let i = 0; i < 4; i++) {
      const src = this.keep(noiseSrc(this, 'white', t));
      const bp = this.keep(filter(ctx, 'bandpass', rand(600, 2500), rand(10, 18)));
      const g = this.keep(gain(ctx, 0.9));
      const pan = this.keep(makePanner(ctx, rand(-0.8, 0.8)));
      src.connect(bp).connect(g).connect(pan).connect(this.bus);
      this.babble.push({ bp, g, next: t });
    }
  }
  schedule(now, horizon) {
    const flow = this.ch;
    for (const b of this.babble) {
      if (b.next < now - 1) b.next = now;
      while (b.next < horizon) {
        const t = b.next;
        b.bp.frequency.setTargetAtTime(rand(500, 1400 + flow * 2200), t, 0.015);
        b.g.gain.setTargetAtTime(chance(0.75) ? rand(0.5, 1.4) : 0.1, t, 0.02);
        b.next += rand(0.035, 0.14) * lerp(1.4, 0.7, flow);
      }
    }
  }
  character() { glide(this.bg.gain, 0.35 + this.ch * 0.4, this.now, 1); }
}

export class Fire extends Continuous {
  start(t) {
    const { ctx } = this;
    const b = this.keep(noiseSrc(this, 'brown', t));
    const lp = this.keep(filter(ctx, 'lowpass', 380, 0.7));
    this.roar = this.keep(gain(ctx, 0.45));
    b.connect(lp).connect(this.roar).connect(this.bus);
    this.nextFlicker = t;
  }
  schedule(now, horizon) {
    if (now >= this.nextFlicker) {
      glide(this.roar.gain, rand(0.3, 0.6), now, rand(0.2, 0.8));
      this.nextFlicker = now + rand(0.3, 1.2);
    }
    const rate = 2 + this.ch * 18;
    this.events(now, horizon, () => expRand(1 / rate), (t) => {
      this.crackle(t, chance(0.12));
      if (chance(0.25)) this.crackle(t + rand(0.01, 0.05), false);
    });
  }
  crackle(t, pop) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.white;
    const dur = pop ? rand(0.01, 0.03) : rand(0.002, 0.009);
    const bp = filter(ctx, pop ? 'bandpass' : 'highpass', pop ? rand(600, 1400) : rand(1500, 4500), pop ? 1.5 : 0.7);
    const g = gain(ctx, 0);
    pluckEnv(g.gain, t, pop ? rand(0.5, 0.9) : rand(0.08, 0.5), 0.0005, dur);
    const pan = makePanner(ctx, rand(-0.6, 0.6));
    s.connect(bp).connect(g).connect(pan).connect(this.bus);
    s.start(t, rand(0, 3), dur + 0.02);
    disposeOnEnd(s, [s, bp, g, pan]);
    if (pop) this.note(t, 900, pan.pan ? pan.pan.value : 0, 0.3, 'fire');
  }
}

export class Night extends Continuous {
  start(t) {
    const { ctx } = this;
    this.crickets = [];
    for (let i = 0; i < 4; i++) {
      const f = rand(3900, 5200);
      const o = this.keep(osc(ctx, 'sine', f));
      const o2 = this.keep(osc(ctx, 'sine', f * 1.5 + rand(-40, 40)));
      const g2 = this.keep(gain(ctx, 0.12));
      const g = this.keep(gain(ctx, 0));
      const pan = this.keep(makePanner(ctx, rand(-0.9, 0.9)));
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(pan).connect(this.bus);
      o.start(t); o2.start(t);
      this.crickets.push({ g, next: t + rand(0, 2), rate: rand(0.45, 1.1), pulses: randi(2, 4), vol: rand(0.04, 0.1) });
    }
  }
  schedule(now, horizon) {
    const active = 1 + Math.round(this.ch * 3);
    this.crickets.forEach((c, i) => {
      if (c.next < now - 1) c.next = now + rand(0, 1);
      while (c.next < horizon) {
        const t = c.next;
        if (i < active && !(c.resting > t)) {
          for (let p = 0; p < c.pulses; p++) {
            const pt = t + p * 0.045;
            c.g.gain.setValueAtTime(0, pt);
            c.g.gain.linearRampToValueAtTime(c.vol, pt + 0.008);
            c.g.gain.linearRampToValueAtTime(0, pt + 0.028);
          }
          if (chance(0.03)) c.resting = t + rand(3, 10);
        }
        c.next += c.rate * rand(0.92, 1.08);
      }
    });
  }
}

export class Birds extends Layer {
  interval() { return expRand(lerp(9, 1.2, this.ch) / this.rate); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => this.song(t));
  }
  song(t) {
    const { ctx } = this;
    const o = osc(ctx, 'sine', 3000);
    const g = gain(ctx, 0);
    const pan = makePanner(ctx, rand(-0.9, 0.9));
    o.connect(g).connect(pan).connect(this.bus);
    const vol = rand(0.03, 0.09);
    const kind = pick(['whistle', 'trill', 'chirp', 'chirp', 'coo', 'whistle']);
    let e = t;
    const f = o.frequency;
    const blip = (at, f0, f1, dur, v = vol) => {
      f.setValueAtTime(f0, at);
      f.exponentialRampToValueAtTime(f1, at + dur);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + Math.min(0.02, dur / 3));
      g.gain.setValueAtTime(v, at + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, at + dur);
    };
    if (kind === 'whistle') {
      const base = rand(2000, 3400);
      for (let i = 0, n = randi(1, 3); i < n; i++) {
        const d = rand(0.18, 0.45);
        blip(e, base * rand(0.9, 1.1), base * pick([0.8, 1.25, 1.1, 0.7]), d);
        e += d + rand(0.08, 0.25);
      }
    } else if (kind === 'trill') {
      const base = rand(3200, 4600);
      for (let i = 0, n = randi(6, 14); i < n; i++) {
        blip(e, base * (1 - i * 0.015), base * 0.9 * (1 - i * 0.015), 0.035, vol * 0.8);
        e += 0.055;
      }
    } else if (kind === 'chirp') {
      for (let i = 0, n = randi(2, 4); i < n; i++) {
        blip(e, rand(1800, 2600), rand(3600, 5000), rand(0.05, 0.09));
        e += rand(0.12, 0.2);
      }
    } else {
      const base = rand(480, 640);
      const pat = [[0.35, 1], [0.6, 1.12], [0.4, 1], [0.4, 0.96]];
      for (const [d, m] of pat) {
        blip(e, base * m, base * m * 0.97, d, vol * 1.6);
        e += d + 0.08;
      }
    }
    o.start(t);
    o.stop(e + 0.1);
    disposeOnEnd(o, [o, g, pan]);
    this.note(t, 3000, pan.pan ? pan.pan.value : 0, 0.2, 'birds');
    return this.interval() + (e - t);
  }
}

export class Thunder extends Layer {
  interval() { return lerp(70, 16, this.ch) * rand(0.6, 1.5); }
  schedule(now, horizon) {
    if (this.nextT == null) this.nextT = now + rand(3, 10);
    this.events(now, horizon, () => this.interval(), (t) => this.rumble(t));
  }
  rumble(t) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.brown;
    s.loop = true;
    const lp = filter(ctx, 'lowpass', 900, 0.6);
    lp.frequency.setValueAtTime(rand(700, 1300), t);
    lp.frequency.exponentialRampToValueAtTime(rand(110, 200), t + 3);
    const g = gain(ctx, 0);
    const peak = rand(0.5, 1);
    const len = rand(6, 12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rand(0.1, 0.6));
    let at = t + 0.8;
    // rolling after-rumbles
    for (let i = 0; i < randi(2, 4); i++) {
      g.gain.linearRampToValueAtTime(peak * rand(0.3, 0.6), at);
      at += rand(0.6, 1.8);
      g.gain.linearRampToValueAtTime(peak * rand(0.5, 0.9), at);
      at += rand(0.3, 1);
    }
    g.gain.linearRampToValueAtTime(0, t + len);
    const pan = makePanner(ctx, rand(-0.7, 0.7));
    s.connect(lp).connect(g).connect(pan).connect(this.bus);
    s.start(t, rand(0, 5));
    s.stop(t + len + 0.2);
    disposeOnEnd(s, [s, lp, g, pan]);
    this.note(t, 60, pan.pan ? pan.pan.value : 0, 1.4, 'thunder');
  }
}

/* ───────────────────────────── Mind ───────────────────────────── */

export class Binaural extends Continuous {
  beat() {
    const c = this.ch;
    return c < 0.33 ? lerp(1.5, 4, c / 0.33) : c < 0.66 ? lerp(4, 8, (c - 0.33) / 0.33) : lerp(8, 13, (c - 0.66) / 0.34);
  }
  carrier() { return this.h.hz(0, 3); }
  start(t) {
    const { ctx } = this;
    const f = this.carrier(), b = this.beat();
    this.l = this.keep(osc(ctx, 'sine', f - b / 2));
    this.r = this.keep(osc(ctx, 'sine', f + b / 2));
    const pl = this.keep(makePanner(ctx, -1));
    const pr = this.keep(makePanner(ctx, 1));
    const g = this.keep(gain(ctx, 0.5));
    this.l.connect(pl).connect(g);
    this.r.connect(pr).connect(g);
    g.connect(this.bus);
    this.l.start(t); this.r.start(t);
  }
  retune(t) {
    const f = this.carrier(), b = this.beat();
    glide(this.l.frequency, f - b / 2, t, 1.5);
    glide(this.r.frequency, f + b / 2, t, 1.5);
  }
  character() { this.retune(this.now); }
  onKey(t) { if (this.running) this.retune(t); }
}

/* ───────────────────────────── Catalogue ───────────────────────────── */

export const GROUPS = [
  { id: 'harmony', name: 'Harmony' },
  { id: 'melody', name: 'Melody' },
  { id: 'nature', name: 'Nature' },
  { id: 'mind', name: 'Mind' },
];

export const LAYERS = [
  { id: 'drone',   cls: Drone,   group: 'harmony', name: 'Drone',        ch: 'Brightness', gain: 0.25, rev: 0.45 },
  { id: 'pad',     cls: Pad,     group: 'harmony', name: 'Pads',         ch: 'Warmth',     gain: 0.85,  rev: 0.8, dly: 0.1 },
  { id: 'choir',   cls: Choir,   group: 'harmony', name: 'Choir',        ch: 'Vowel',      gain: 0.55,  rev: 1.0 },
  { id: 'shimmer', cls: Shimmer, group: 'harmony', name: 'Shimmer',      ch: 'Density',    gain: 1.4,  rev: 1.1, dly: 0.4 },
  { id: 'bells',   cls: Bells,   group: 'melody',  name: 'Bells',        ch: 'Density',    gain: 1.1, rev: 0.9, dly: 0.55 },
  { id: 'keys',    cls: Keys,    group: 'melody',  name: 'Kalimba',      ch: 'Density',    gain: 1.3,  rev: 0.7, dly: 0.45 },
  { id: 'flute',   cls: Flute,   group: 'melody',  name: 'Flute',        ch: 'Activity',   gain: 1.4, rev: 0.9, dly: 0.35 },
  { id: 'bowls',   cls: Bowls,   group: 'melody',  name: 'Singing Bowls', ch: 'Frequency', gain: 2.0,  rev: 0.7, dly: 0.1 },
  { id: 'pulse',   cls: Pulse,   group: 'melody',  name: 'Heartbeat',    ch: 'Tempo',      gain: 0.55,  rev: 0.25 },
  { id: 'rain',    cls: Rain,    group: 'nature',  name: 'Rain',         ch: 'Intensity',  gain: 0.7,  rev: 0.2 },
  { id: 'ocean',   cls: Ocean,   group: 'nature',  name: 'Ocean',        ch: 'Swell',      gain: 0.85,  rev: 0.25 },
  { id: 'stream',  cls: Stream,  group: 'nature',  name: 'Stream',       ch: 'Flow',       gain: 1.1,  rev: 0.3 },
  { id: 'wind',    cls: Wind,    group: 'nature',  name: 'Wind',         ch: 'Gusts',      gain: 1.3, rev: 0.3 },
  { id: 'fire',    cls: Fire,    group: 'nature',  name: 'Fire',         ch: 'Crackle',    gain: 0.75,  rev: 0.15 },
  { id: 'birds',   cls: Birds,   group: 'nature',  name: 'Birdsong',     ch: 'Activity',   gain: 1.5,  rev: 0.7, dly: 0.15 },
  { id: 'night',   cls: Night,   group: 'nature',  name: 'Crickets',     ch: 'Chorus',     gain: 3.0,  rev: 0.5 },
  { id: 'thunder', cls: Thunder, group: 'nature',  name: 'Distant Thunder', ch: 'Frequency', gain: 0.8, rev: 0.6 },
  { id: 'binaural', cls: Binaural, group: 'mind',  name: 'Binaural Beat', ch: 'Delta · Theta · Alpha', gain: 0.18, rev: 0 },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
