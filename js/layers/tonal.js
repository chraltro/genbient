// Harmonic layers: sustained chords and the bass that anchors them.
import { clamp, lerp, rand, pick, chance, glide, makePanner, osc, gain, filter, disposeOnEnd, swellEnv } from '../util.js';
import { R, C, T } from '../params.js';
import { Layer, Sustained, common, OCT, DENSITY } from './base.js';
import { euclid, accent } from '../composer.js';

const sec = (v) => `${v.toFixed(1)} s`;
const WAVES = [['sawtooth', 'Saw'], ['triangle', 'Triangle'], ['square', 'Square'], ['sine', 'Sine']];

/* ─── Drone ─── */
export class Drone extends Layer {
  static schema = [
    ...common({ vol: 0.55, tone: 0.75, rev: 0.45, dly: 0 }),
    OCT(0),
    C('wave', 'Waveform', WAVES, 'sawtooth'),
    R('bright', 'Brightness', 0, 1, 0.35, { gen: [0.15, 0.6] }),
    R('detune', 'Detune', 0, 1, 0.4),
    R('fifth', 'Fifth', 0, 1, 0.5),
    R('octUp', 'Octave above', 0, 1, 0.35),
    R('sub', 'Sub', 0, 1, 0.5),
    R('motion', 'Filter motion', 0, 1, 0.4),
    R('reso', 'Resonance', 0, 1, 0.2, { gen: [0, 0.5] }),
    T('follow', 'Follow chords', false, { gen: 0.3 }),
  ];
  cutoff() { return 120 + this.p.bright * this.p.bright * 2400; }
  start(t) { this.voice = this.makeVoice(t, 7); }
  rootDeg() { return this.p.follow ? this.h.chord.bass : 0; }
  makeVoice(t, attack) {
    const { ctx, p } = this;
    const f = this.h.hz(this.rootDeg(), 2 + p.oct);
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const filt = filter(ctx, 'lowpass', this.cutoff(), 0.7 + p.reso * 9);
    const lfo = osc(ctx, 'sine', rand(0.015, 0.04));
    const lfoG = gain(ctx, this.cutoff() * p.motion * 0.8);
    lfo.connect(lfoG).connect(filt.frequency);
    const det = p.detune * 16;
    const parts = [
      [p.wave, f, -det, 0.28], [p.wave, f, det, 0.28], ['sine', f / 2, 0, 0.55 * p.sub],
      [p.wave, f * 1.5, det / 2, 0.22 * p.fifth], ['triangle', f * 2, -det / 2, 0.25 * p.octUp], ['sine', f * 3, 2, 0.04],
    ];
    const srcs = [lfo];
    const nodes = [out, filt, lfoG, lfo];
    for (const [type, fr, d, g] of parts) {
      if (g <= 0.001) continue;
      const o = osc(ctx, type, fr, d);
      const dr = osc(ctx, 'sine', rand(0.03, 0.09));
      const dg = gain(ctx, rand(2, 5));
      dr.connect(dg).connect(o.detune);
      const gg = gain(ctx, g * (type === 'square' ? 0.6 : 1));
      o.connect(gg).connect(filt);
      o.start(t); dr.start(t);
      srcs.push(o, dr);
      nodes.push(o, gg, dr, dg);
    }
    lfo.start(t);
    filt.connect(out).connect(this.bus);
    return { out, filt, lfoG, srcs, nodes, deg: this.rootDeg() };
  }
  param(id) {
    const v = this.voice;
    if (!v) return;
    if (id === 'bright' || id === 'motion') {
      glide(v.filt.frequency, this.cutoff(), this.now, 0.5);
      glide(v.lfoG.gain, this.cutoff() * this.p.motion * 0.8, this.now, 0.5);
    } else if (id === 'reso') glide(v.filt.Q, 0.7 + this.p.reso * 9, this.now, 0.3);
    else if (id !== 'follow') {
      clearTimeout(this.rebuildT);
      this.rebuildT = setTimeout(() => this.onKey(this.now + 0.05, 2), 250);
    }
  }
  release(v, t, dur) {
    glide(v.out.gain, 0, t, dur / 4);
    for (const s of v.srcs) s.stop(t + dur + 0.5);
    disposeOnEnd(v.srcs[0], v.nodes);
  }
  onChord(t) { if (this.p.follow && this.voice && this.voice.deg !== this.rootDeg()) this.onKey(t); }
  onKey(t, fade = 8) {
    if (!this.running) return;
    const old = this.voice;
    this.voice = this.makeVoice(t, fade);
    if (old) this.release(old, t, fade + 2);
  }
  stop() {
    if (this.voice) this.release(this.voice, this.now, 0.3);
    this.voice = null;
  }
}

/* ─── Pads ─── */
const TIMBRES = {
  warm: [['sawtooth', 1, 0.07], ['triangle', 1, 0.12]],
  glass: [['sine', 1, 0.14], ['triangle', 2, 0.05], ['sine', 3, 0.02]],
  analog: [['sawtooth', 1, 0.075], ['sawtooth', 1, 0.075]],
  hollow: [['square', 1, 0.05], ['triangle', 1, 0.1]],
  organ: [['sine', 1, 0.12], ['sine', 2, 0.06], ['sine', 3, 0.035], ['sine', 4, 0.015]],
  air: [['triangle', 1, 0.1], ['sine', 2, 0.04]],
};

export class Pad extends Sustained {
  static schema = [
    ...common({ vol: 0.6, tone: 0.85, rev: 0.8, dly: 0.1 }),
    OCT(0),
    C('timbre', 'Timbre', Object.keys(TIMBRES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), 'warm'),
    R('voices', 'Voices', 3, 6, 4, { step: 1, fmt: (v) => `${v}` }),
    R('bright', 'Brightness', 0, 1, 0.45, { gen: [0.2, 0.75] }),
    R('attack', 'Attack', 0.5, 12, 5, { fmt: sec, gen: [2, 9] }),
    R('release', 'Release', 1, 16, 8, { fmt: sec, gen: [4, 12] }),
    R('detune', 'Detune', 0, 1, 0.45),
    R('movement', 'Movement', 0, 1, 0.4, { hint: 'notes swell independently' }),
    R('motion', 'Filter motion', 0, 1, 0.35),
  ];
  cutoff() { return 300 + this.p.bright * this.p.bright * 4600; }
  makeVoice(t, attack) {
    const { ctx, h, p } = this;
    const notes = h.voice(h.chord.tones, this.prev, { center: 57 + 12 * p.oct, spread: this.g.spread, lead: this.g.lead, count: Math.round(p.voices) });
    this.prev = notes;
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const filt = filter(ctx, 'lowpass', this.cutoff(), 0.6);
    const lfo = osc(ctx, 'sine', rand(0.025, 0.07));
    const lfoG = gain(ctx, this.cutoff() * p.motion * 0.8);
    lfo.connect(lfoG).connect(filt.frequency);
    lfo.start(t);
    const srcs = [lfo];
    const nodes = [out, filt, lfo, lfoG];
    const parts = TIMBRES[p.timbre] || TIMBRES.warm;
    const norm = 4 / Math.max(3, notes.length);
    notes.forEach((m, i) => {
      const f = h.freq(m);
      const pan = makePanner(ctx, (i / Math.max(1, notes.length - 1)) * 1.3 - 0.65);
      const ng = gain(ctx, 1 - p.movement * 0.4);
      const trem = osc(ctx, 'sine', rand(0.04, 0.14));
      const tg = gain(ctx, p.movement * 0.4);
      trem.connect(tg).connect(ng.gain);
      trem.start(t);
      parts.forEach(([type, mult, g], k) => {
        const o = osc(ctx, type, f * mult, (k % 2 ? 1 : -1) * rand(2, 4 + p.detune * 10));
        const gg = gain(ctx, g * norm);
        o.connect(gg).connect(ng);
        o.start(t);
        srcs.push(o);
        nodes.push(o, gg);
      });
      ng.connect(pan).connect(filt);
      srcs.push(trem);
      nodes.push(ng, pan, trem, tg);
    });
    filt.connect(out).connect(this.bus);
    return { out, filt, lfoG, srcs, nodes };
  }
  param(id) {
    if (id === 'bright' || id === 'motion') {
      for (const v of this.voices || []) {
        glide(v.filt.frequency, this.cutoff(), this.now, 0.5);
        glide(v.lfoG.gain, this.cutoff() * this.p.motion * 0.8, this.now, 0.5);
      }
    } else if (['timbre', 'voices', 'detune', 'movement', 'oct'].includes(id)) {
      clearTimeout(this.rebuildT);
      this.rebuildT = setTimeout(() => this.onChord(this.now + 0.05), 300);
    }
  }
}

/* ─── Strings ─── */
export class Strings extends Sustained {
  static schema = [
    ...common({ vol: 0.55, tone: 0.8, rev: 0.75, dly: 0.05 }),
    OCT(0),
    R('voices', 'Voices', 2, 6, 4, { step: 1, fmt: (v) => `${v}` }),
    R('ensemble', 'Ensemble', 0, 1, 0.6, { hint: 'players per note' }),
    R('bow', 'Bow pressure', 0, 1, 0.45, { hint: 'dark ↔ bright' }),
    R('vibrato', 'Vibrato', 0, 1, 0.4),
    R('attack', 'Attack', 0.5, 12, 4, { fmt: sec, gen: [1.5, 8] }),
    R('release', 'Release', 1, 16, 7, { fmt: sec, gen: [3, 11] }),
  ];
  makeVoice(t, attack) {
    const { ctx, h, p } = this;
    const notes = h.voice(h.chord.tones, this.prev, { center: 62 + 12 * p.oct, spread: this.g.spread * 1.2, lead: this.g.lead, count: Math.round(p.voices) });
    this.prev = notes;
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const lp = filter(ctx, 'lowpass', 900 + p.bow * 4000, 0.8);
    const hp = filter(ctx, 'highpass', 180, 0.7);
    const body = filter(ctx, 'peaking', 700, 1.2);
    body.gain.value = 4;
    const vib = osc(ctx, 'sine', rand(4.6, 5.6));
    const vibG = gain(ctx, p.vibrato * 14);
    vib.connect(vibG);
    vib.start(t);
    const srcs = [vib];
    const nodes = [out, lp, hp, body, vib, vibG];
    const players = 1 + Math.round(p.ensemble * 2);
    const norm = 0.16 / Math.sqrt(notes.length * players);
    notes.forEach((m, i) => {
      const f = h.freq(m);
      const pan = makePanner(ctx, (i / Math.max(1, notes.length - 1)) * 1.4 - 0.7);
      for (let k = 0; k < players; k++) {
        const o = osc(ctx, 'sawtooth', f, (k - (players - 1) / 2) * (4 + p.ensemble * 8) + rand(-2, 2));
        vibG.connect(o.detune);
        const gg = gain(ctx, norm);
        o.connect(gg).connect(pan);
        o.start(t);
        srcs.push(o);
        nodes.push(o, gg);
      }
      pan.connect(hp);
      nodes.push(pan);
    });
    hp.connect(body).connect(lp).connect(out).connect(this.bus);
    return { out, srcs, nodes };
  }
  param(id) {
    if (id !== 'attack' && id !== 'release') {
      clearTimeout(this.rebuildT);
      this.rebuildT = setTimeout(() => this.onChord(this.now + 0.05), 300);
    }
  }
}

/* ─── Choir ─── */
const VOWELS = [
  { f: [300, 870, 2240], g: [1, 0.35, 0.12] },  // oo
  { f: [450, 800, 2830], g: [1, 0.5, 0.15] },   // oh
  { f: [730, 1090, 2440], g: [1, 0.55, 0.2] },  // ah
  { f: [530, 1840, 2480], g: [1, 0.4, 0.2] },   // eh
  { f: [290, 2250, 2900], g: [1, 0.3, 0.2] },   // ee
];

export class Choir extends Sustained {
  static schema = [
    ...common({ vol: 0.55, tone: 0.85, rev: 0.95, dly: 0.05 }),
    OCT(0),
    R('vowel', 'Vowel', 0, 1, 0.45, { fmt: (v) => ['oo', 'oh', 'ah', 'eh', 'ee'][Math.round(v * 4)] }),
    R('vowelDrift', 'Vowel drift', 0, 1, 0.4),
    R('voices', 'Voices', 2, 5, 3, { step: 1, fmt: (v) => `${v}` }),
    R('vibrato', 'Vibrato', 0, 1, 0.45),
    R('vibRate', 'Vibrato speed', 3, 7, 4.8, { fmt: (v) => `${v.toFixed(1)} Hz` }),
    R('attack', 'Attack', 0.5, 12, 6, { fmt: sec, gen: [2, 9] }),
    R('release', 'Release', 1, 16, 9, { fmt: sec, gen: [4, 12] }),
  ];
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
    const v = this.vowelAt(this.p.vowel + rand(-1, 1) * this.p.vowelDrift * 0.35);
    this.bank.forEach((b, i) => {
      glide(b.bp.frequency, v.f[i], now, 2.5);
      glide(b.g.gain, v.g[i], now, 2.5);
    });
  }
  param(id) {
    if (id === 'vowel' || id === 'vowelDrift') this.nextVowel = 0;
    else if (id !== 'attack' && id !== 'release') {
      clearTimeout(this.rebuildT);
      this.rebuildT = setTimeout(() => this.onChord(this.now + 0.05), 300);
    }
  }
  makeVoice(t, attack) {
    const { ctx, h, p } = this;
    const notes = h.voice(h.chord.tones, this.prev, { center: 55 + 12 * p.oct, spread: this.g.spread, lead: this.g.lead, count: Math.round(p.voices) });
    this.prev = notes;
    const out = gain(ctx, 0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + attack);
    const vib = osc(ctx, 'sine', p.vibRate * rand(0.94, 1.06));
    const vibG = gain(ctx, p.vibrato * 20);
    vib.connect(vibG);
    vib.start(t);
    const srcs = [vib];
    const nodes = [out, vib, vibG];
    const norm = 3 / Math.max(3, notes.length);
    for (const m of notes) {
      const f = h.freq(m);
      for (let k = 0; k < 3; k++) {
        const o = osc(ctx, 'sawtooth', f, (k - 1) * rand(6, 11));
        const gg = gain(ctx, 0.3 * norm);
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

/* ─── Shimmer ─── */
export class Shimmer extends Layer {
  static schema = [
    ...common({ vol: 0.5, tone: 0.95, rev: 1, dly: 0.4 }),
    OCT(0),
    DENSITY(0.5),
    R('length', 'Swell length', 0, 1, 0.5, { fmt: (v) => `${(4 + v * 12).toFixed(0)} s` }),
    R('harm', 'Overtone', 0, 1, 0.25),
    R('sparkle', 'Sparkle', 0, 1, 0.3, { hint: 'tremolo glint' }),
  ];
  interval() { return Math.max(0.3, -Math.log(1 - Math.random() * 0.999) * lerp(7, 1, this.dens)); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => this.glint(t));
  }
  glint(t) {
    const { ctx, h, p } = this;
    const d = pick(h.chord.tones) + (chance(0.3) ? h.len : 0);
    const f = h.hz(d, 6 + p.oct - (chance(0.4) ? 1 : 0));
    const L = 4 + p.length * 12;
    const a = L * rand(0.25, 0.4), hold = L * rand(0.05, 0.25), r = L - a - hold;
    const amp = gain(ctx, 0);
    swellEnv(amp.gain, t, rand(0.04, 0.09), a, hold, r);
    const o1 = osc(ctx, 'sine', f);
    const o2 = osc(ctx, 'sine', f * 2.002);
    const g2 = gain(ctx, p.harm * 0.6);
    const trem = osc(ctx, 'sine', rand(3, 8));
    const tg = gain(ctx, p.sparkle * 0.5);
    const tn = gain(ctx, 1 - p.sparkle * 0.5);
    trem.connect(tg).connect(tn.gain);
    const pan = makePanner(ctx, rand(-0.9, 0.9));
    o1.connect(amp);
    o2.connect(g2).connect(amp);
    amp.connect(tn).connect(pan).connect(this.bus);
    const end = t + L + 0.1;
    for (const o of [o1, o2, trem]) { o.start(t); o.stop(end); }
    disposeOnEnd(o1, [o1, o2, g2, amp, pan, trem, tg, tn]);
    this.note(t + a * 0.7, f, pan.pan ? pan.pan.value : 0, 0.35, 'shimmer');
  }
}

/* ─── Bass ─── */
export class Bass extends Layer {
  static schema = [
    ...common({ vol: 0.55, tone: 0.55, rev: 0.2, dly: 0, toneGen: [0.35, 0.7], revGen: [0.05, 0.35], dlyGen: [0, 0.1] }),
    OCT(0),
    C('pattern', 'Pattern', [['held', 'Held'], ['roots', 'Roots'], ['rootfifth', 'Root & fifth'], ['pulse', 'Pulse'],
      ['synco', 'Syncopated'], ['walk', 'Walking'], ['broken', 'Broken chord']], 'roots'),
    C('wave', 'Waveform', [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'], ['square', 'Square']], 'triangle'),
    R('length', 'Note length', 0.1, 1, 0.7),
    R('glide', 'Glide', 0, 1, 0.15, { gen: [0, 0.4] }),
    R('pluck', 'Pluck', 0, 1, 0.35, { hint: 'filter snap on each note' }),
    R('drive', 'Drive', 0, 1, 0.15, { gen: [0, 0.4] }),
  ];
  start() { this.lastF = null; this.walk = 0; }
  onStep(info) {
    const { p, h } = this;
    const a = accent(info.sib, info.groups);
    const barStart = info.sib === 0;
    const len = (steps) => steps * info.dur * p.length;
    const root = h.chord.bass;
    let deg = null, steps = 4;
    switch (p.pattern) {
      case 'held':
        if (info.chordStart) { deg = root; steps = info.spb * this.g.chordBars; }
        break;
      case 'roots':
        if (barStart) { deg = root; steps = info.spb / 2; } else if (a >= 0.8 && chance(this.dens * 0.6)) { deg = root; }
        break;
      case 'rootfifth':
        if (a >= 0.8) { deg = (this.alt = !this.alt) ? root : root + 4; }
        break;
      case 'pulse':
        if (info.sib % 2 === 0 && chance(0.55 + this.dens * 0.45)) { deg = chance(0.15) ? root + h.len : root; steps = 2; }
        break;
      case 'synco': {
        const pat = euclid(info.spb, Math.max(3, Math.round(info.spb / 3)), 0);
        if (pat[info.sib]) { deg = chance(0.2) ? root + h.len : root; steps = 3; }
        break;
      }
      case 'walk':
        if (a >= 0.8) {
          this.walk = barStart ? 0 : this.walk + pick([1, 1, 2, -1]);
          deg = root + this.walk;
        }
        break;
      case 'broken':
        if (info.sib % 2 === 0) {
          const seq = [0, 2, 4, h.len, 4, 2];
          deg = h.chord.deg + seq[(info.sib / 2) % seq.length];
          steps = 2;
        }
        break;
    }
    if (deg == null) return;
    this.play(this.e.human(info.t), h.hz(deg, 2 + p.oct), this.vel(0.6 + a * 0.4), Math.max(0.12, len(steps)));
  }
  play(t, f, v, dur) {
    const { ctx, p } = this;
    const o = osc(ctx, p.wave, f);
    if (this.lastF && p.glide > 0.02) {
      o.frequency.setValueAtTime(this.lastF, t);
      o.frequency.exponentialRampToValueAtTime(f, t + p.glide * 0.18);
    }
    this.lastF = f;
    const sub = osc(ctx, 'sine', f);
    const subG = gain(ctx, p.wave === 'sine' ? 0 : 0.5);
    const lp = filter(ctx, 'lowpass', 300, 2 + p.pluck * 4);
    const peak = 300 + p.pluck * 2400;
    lp.frequency.setValueAtTime(peak, t);
    lp.frequency.setTargetAtTime(160 + (1 - p.pluck) * 400, t + 0.01, 0.08 + (1 - p.pluck) * 0.3);
    const shaper = this.e.shaper(p.drive);
    const amp = gain(ctx, 0);
    const lvl = 0.5 * v * (p.wave === 'square' ? 0.6 : p.wave === 'sawtooth' ? 0.75 : 1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(lvl, t + 0.012);
    amp.gain.setTargetAtTime(lvl * 0.7, t + 0.05, 0.2);
    amp.gain.setTargetAtTime(0, t + dur, 0.08);
    o.connect(lp);
    sub.connect(subG).connect(lp);
    lp.connect(shaper).connect(amp).connect(this.bus);
    const end = t + dur + 0.6;
    o.start(t); sub.start(t); o.stop(end); sub.stop(end);
    disposeOnEnd(o, [o, sub, subG, lp, shaper, amp]);
    if (v > 0.8) this.note(t, f, 0, 0.4, 'bass');
  }
}
