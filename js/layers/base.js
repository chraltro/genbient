// Layer foundations. Every layer owns a small channel strip:
//   voices → bus (level) → filter → pan → mix, with reverb and echo sends.
import { clamp, lerp, rand, pick, chance, glide, makePanner, gain, filter } from '../util.js';
import { R, C, defaults } from '../params.js';
import { makeMotif, vary, arpSequence, euclid, accent } from '../composer.js';

const hz = (v) => { const f = 90 * Math.pow(2, v * 7.8); return f >= 1000 ? `${(f / 1000).toFixed(1)}k Hz` : `${Math.round(f)} Hz`; };
const panFmt = (v) => (Math.abs(v) < 0.03 ? 'centre' : `${Math.round(Math.abs(v) * 100)}% ${v < 0 ? 'L' : 'R'}`);

// Controls every layer shares.
export function common(d = {}) {
  return [
    R('vol', 'Level', 0, 1, d.vol ?? 0.6, { keep: true }),
    R('tone', 'Filter', 0, 1, d.tone ?? 0.9, { fmt: hz, gen: d.toneGen || [0.55, 1] }),
    R('pan', 'Pan', -1, 1, d.pan ?? 0, { fmt: panFmt, gen: [-0.35, 0.35] }),
    R('rev', 'Reverb send', 0, 1, d.rev ?? 0.5, { gen: d.revGen || [0.2, 0.9] }),
    R('dly', 'Echo send', 0, 1, d.dly ?? 0.15, { gen: d.dlyGen || [0, 0.5] }),
  ];
}
export const OCT = (def = 0) => R('oct', 'Octave', -2, 2, def, { step: 1, fmt: (v) => (v > 0 ? `+${v}` : `${v}`), gen: [-1, 1] });
export const STYLE = (opts, def) => C('style', 'Plays', opts, def);
export const DENSITY = (def = 0.5) => R('density', 'Density', 0, 1, def, { gen: [0.2, 0.8] });

export class Layer {
  constructor(engine, def) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.def = def;
    this.id = def.id;
    this.p = defaults(def.schema);
    this.on = false;
    this.running = false;

    const ctx = this.ctx;
    this.bus = gain(ctx, 0);
    this.filt = filter(ctx, 'lowpass', this.toneHz(), 0.5);
    this.panner = makePanner(ctx, this.p.pan);
    this.bus.connect(this.filt).connect(this.panner);
    this.panner.connect(def.group === 'harmony' ? engine.pumpIn : engine.dryIn);
    this.revSend = gain(ctx, (def.revScale ?? 1) * this.p.rev);
    this.panner.connect(this.revSend).connect(engine.revIn);
    this.dlySend = gain(ctx, this.p.dly);
    this.panner.connect(this.dlySend).connect(engine.dlyIn);
  }

  get now() { return this.ctx.currentTime; }
  get h() { return this.e.harmony; }
  get g() { return this.e.g; }
  get level() { return this.def.gain * this.p.vol * this.p.vol; }
  toneHz() { return 90 * Math.pow(2, (this.p.tone ?? 0.9) * 7.8); }
  // Layer density blended with the global density control.
  get dens() { return clamp((this.p.density ?? 0.5) * (0.35 + this.g.density * 1.3), 0, 1); }
  get rate() { return lerp(0.5, 1.7, this.g.density); }

  set(id, v) {
    this.p[id] = v;
    const t = this.now;
    switch (id) {
      case 'vol': if (this.on) glide(this.bus.gain, this.level, t, 0.25); break;
      case 'tone': glide(this.filt.frequency, this.toneHz(), t, 0.2); break;
      case 'pan': if (this.panner.pan) glide(this.panner.pan, v, t, 0.2); break;
      case 'rev': glide(this.revSend.gain, (this.def.revScale ?? 1) * v, t, 0.2); break;
      case 'dly': glide(this.dlySend.gain, v, t, 0.2); break;
      default: if (this.running) this.param(id, v);
    }
  }

  setAll(p) {
    for (const k in p) if (this.p[k] !== p[k]) this.set(k, p[k]);
  }

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

  // Poisson-style free-time event loop.
  events(now, horizon, interval, fire) {
    if (this.nextT == null || this.nextT < now - 1) this.nextT = now + rand(0.3, 2);
    let guard = 0;
    while (this.nextT < horizon && guard++ < 64) {
      const t = this.nextT;
      const next = fire(Math.max(t, now + 0.01));
      this.nextT = t + Math.max(0.02, next ?? interval());
    }
  }

  vel(v = 1) { return v * (1 - this.g.velvar * Math.random() * 0.6); }
  note(t, f, pan, v, kind) { this.e.notify({ t, f, pan: pan ?? this.p.pan, v, kind: kind || this.def.kind || this.id }); }

  start() {}
  stop() {}
  param() {}
  schedule() {}
  onStep() {}
  onChord() {}
  onKey(t) { this.onChord(t); }
}

// A crossfading sustained chord, used by pads, choir and strings.
export class Sustained extends Layer {
  start(t) {
    this.voices = [];
    this.voices.push(this.makeVoice(t, this.p.attack ?? 6));
  }
  onChord(t) {
    if (!this.running) return;
    for (const v of this.voices) this.release(v, t, this.p.release ?? 9);
    this.voices = this.voices.filter((v) => !v.dead);
    this.voices.push(this.makeVoice(t, Math.min(this.p.attack ?? 6, 8)));
  }
  release(v, t, dur) {
    if (v.releasing) return;
    v.releasing = true;
    glide(v.out.gain, 0, t, dur / 4);
    for (const o of v.srcs) o.stop(t + dur + 0.5);
    const nodes = v.nodes;
    v.srcs[0].onended = () => nodes.forEach((n) => { try { n.disconnect(); } catch { /* gone */ } });
    setTimeout(() => { v.dead = true; }, (dur + 1) * 1000);
  }
  stop() {
    for (const v of this.voices || []) this.release(v, this.now, 0.4);
    this.voices = [];
  }
}

// Continuous noise-based layers.
export class Continuous extends Layer {
  keep(...nodes) { (this.nodes ||= []).push(...nodes); return nodes[0]; }
  stop() {
    const t = this.now + 0.2;
    const nodes = this.nodes || [];
    for (const n of nodes) if (n.stop) { try { n.stop(t); } catch { /* not started */ } }
    setTimeout(() => nodes.forEach((n) => n.disconnect()), 600);
    this.nodes = [];
  }
}

export function noiseSrc(layer, type, t) {
  const s = layer.ctx.createBufferSource();
  s.buffer = layer.e.noise[type];
  s.loop = true;
  s.start(t, rand(0, s.buffer.duration));
  return s;
}

/*
 * Melodic layers play on the tempo grid in one of several styles:
 *   motif   – a short phrase that repeats, develops and follows the chords
 *   arp     – chord tones in a pattern at a set rate
 *   walk    – a free melodic random walk on strong beats
 *   sparse  – occasional single chord tones
 *   chords  – full chord strikes (pianos)
 * Subclasses implement play(t, freq, velocity, seconds).
 */
export class Melodic extends Layer {
  start() {
    this.motif = null;
    this.phrase = -1;
    this.resting = false;
    this.walkDeg = 0;
    this.arpI = 0;
  }

  onStep(info) {
    switch (this.p.style) {
      case 'arp': return this.arpStep(info);
      case 'walk': return this.walkStep(info);
      case 'sparse': return this.sparseStep(info);
      case 'chords': return this.chordStep(info);
      default: return this.motifStep(info);
    }
  }

  get octave() { return (this.def.oct ?? 4) + (this.p.oct ?? 0); }

  playDeg(info, d, v, seconds, snap) {
    const h = this.h;
    let deg = h.chord.deg + d;
    if (snap) deg = h.nearestChordTone(deg);
    const f = h.hz(deg, this.octave);
    this.play(this.e.human(info.t), f, this.vel(v), seconds);
  }

  motifStep(info) {
    const g = this.g;
    const len = g.motifBars * info.spb;
    const pos = info.step % len;
    if (pos === 0 || !this.motif) {
      this.phrase++;
      const fresh = !this.motif || this.motif.steps !== len;
      if (fresh || (this.phrase > 0 && !chance(g.repetition))) {
        this.motif = fresh || chance(0.3)
          ? makeMotif({ steps: len, groups: info.groups, density: this.dens, range: g.range, leap: g.leap, tension: g.tension })
          : vary(this.motif, 1 - g.repetition);
        this.index = new Map();
        for (const n of this.motif.notes) {
          if (!this.index.has(n.s)) this.index.set(n.s, []);
          this.index.get(n.s).push(n);
        }
      }
      this.resting = this.phrase > 0 && chance(g.rests * 0.55);
      if (g.callResponse && this.phrase % 2 !== (this.def.side ?? 0)) this.resting = true;
    }
    if (this.resting) return;
    const hits = this.index && this.index.get(pos);
    if (!hits) return;
    for (const n of hits) this.playDeg(info, n.d, n.v, n.len * info.dur * (this.p.legato ?? 1), n.snap);
  }

  arpStep(info) {
    const rate = this.p.rate ?? 2;
    if (info.step % rate !== 0) return;
    if (!chance(0.35 + this.dens * 0.65)) return;
    const h = this.h;
    const span = Math.round(this.p.octaves ?? 2);
    const tones = [];
    for (let o = 0; o < span; o++) for (const d of h.chord.tones) tones.push(d + o * h.len);
    if (!this.seq || this.seqLen !== tones.length || this.seqShape !== this.p.shape) {
      this.seq = arpSequence(this.p.shape ?? 'up', tones.length);
      this.seqLen = tones.length;
      this.seqShape = this.p.shape;
    }
    const d = tones[this.seq[this.arpI++ % this.seq.length] % tones.length];
    const v = accent(info.sib, info.groups) >= 0.8 ? 1 : 0.7;
    this.playDeg(info, d - h.chord.deg, v, rate * info.dur * (this.p.gate ?? 0.8), false);
  }

  walkStep(info) {
    const a = accent(info.sib, info.groups);
    const p = a >= 0.8 ? 0.25 + this.dens * 0.6 : a >= 0.5 ? this.dens * 0.35 : this.dens * 0.08;
    if (!chance(p)) return;
    this.walkDeg = clamp(this.walkDeg + pick([-2, -1, -1, 1, 1, 2, chance(this.g.leap) ? 4 : -3]), -3, 3 + Math.round(this.g.range * 6));
    this.playDeg(info, this.walkDeg, a, info.dur * rand(2, 6), a >= 0.8 || !chance(this.g.tension));
  }

  sparseStep(info) {
    const a = accent(info.sib, info.groups);
    if (a < 0.8 || !chance(0.1 + this.dens * 0.4)) return;
    this.playDeg(info, pick([0, 2, 4, 7, 9]), rand(0.6, 1), info.dur * 8, true);
  }

  chordStep(info) {
    const a = accent(info.sib, info.groups);
    const first = info.sib === 0;
    if (!(first || (a >= 0.8 && chance(this.dens * 0.5)) || (a >= 0.5 && chance(this.dens * 0.12)))) return;
    const h = this.h;
    const notes = h.voice(h.chord.tones, this.lastVoicing, { center: 12 * (this.octave + 1) + 2, spread: this.g.spread, lead: this.g.lead, count: Math.min(4, h.chord.tones.length) });
    this.lastVoicing = notes;
    const t = this.e.human(info.t);
    const roll = this.p.roll ?? 0.3;
    notes.forEach((m, i) => this.play(t + i * roll * 0.06, h.freq(m), this.vel(first ? 0.8 : 0.55), info.dur * 8));
  }
}

/*
 * Drum layers: a Euclidean pattern (steps / hits / rotation) with
 * probability and ghost notes. Subclasses implement hit(t, velocity, ghost).
 */
export function euclidParams(d) {
  return [
    R('steps', 'Pattern length', 2, 32, d.steps ?? 16, { step: 1, fmt: (v) => `${v} steps`, gen: d.stepsGen || [8, 16] }),
    R('hits', 'Hits', 0, 16, d.hits ?? 4, { step: 1, fmt: (v) => `${v}`, gen: d.hitsGen || [2, 6] }),
    R('rotate', 'Rotation', 0, 15, d.rotate ?? 0, { step: 1, fmt: (v) => `${v}`, gen: [0, 7] }),
    R('prob', 'Probability', 0, 1, d.prob ?? 0.9, { gen: [0.6, 1] }),
    R('ghost', 'Ghost notes', 0, 1, d.ghost ?? 0.15, { gen: [0, 0.4] }),
  ];
}

export class Drum extends Layer {
  onStep(info) {
    const { steps, hits, rotate } = this.p;
    const key = `${steps}:${hits}:${rotate}`;
    if (key !== this.patKey) { this.pat = euclid(steps, hits, rotate); this.patKey = key; }
    const i = info.step % this.pat.length;
    const a = accent(info.sib, info.groups);
    const t = this.e.human(info.t);
    if (this.pat[i]) {
      if (chance(clamp(this.p.prob * (0.7 + this.g.density * 0.6), 0, 1))) {
        const v = this.vel(0.65 + a * 0.35);
        this.hit(t, v, false, info);
        if (a >= 0.8) this.note(t, 80, this.p.pan, v * 0.5, 'drum');
      }
    } else if (this.p.ghost > 0 && chance(this.p.ghost * 0.22)) {
      this.hit(t, this.vel(0.22), true, info);
    }
  }
  hit() {}
}
