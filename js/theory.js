// Scales, tuning, chord construction, progressions and voice leading.
import { weighted, pick, chance, clamp } from './util.js';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const MODES = {
  ionian:     { name: 'Major',       steps: [0, 2, 4, 5, 7, 9, 11], parallel: 'aeolian' },
  lydian:     { name: 'Lydian',      steps: [0, 2, 4, 6, 7, 9, 11], parallel: 'dorian' },
  mixolydian: { name: 'Mixolydian',  steps: [0, 2, 4, 5, 7, 9, 10], parallel: 'dorian' },
  dorian:     { name: 'Dorian',      steps: [0, 2, 3, 5, 7, 9, 10], parallel: 'mixolydian' },
  aeolian:    { name: 'Minor',       steps: [0, 2, 3, 5, 7, 8, 10], parallel: 'ionian' },
  phrygian:   { name: 'Phrygian',    steps: [0, 1, 3, 5, 7, 8, 10], parallel: 'hijaz' },
  hijaz:      { name: 'Hijaz',       steps: [0, 1, 4, 5, 7, 8, 10], parallel: 'phrygian' },
  harmonic:   { name: 'Harm. Minor', steps: [0, 2, 3, 5, 7, 8, 11], parallel: 'ionian' },
  melodic:    { name: 'Mel. Minor',  steps: [0, 2, 3, 5, 7, 9, 11], parallel: 'ionian' },
  majpent:    { name: 'Pentatonic',  steps: [0, 2, 4, 7, 9], parallel: 'minpent' },
  minpent:    { name: 'Minor Pent.', steps: [0, 3, 5, 7, 10], parallel: 'majpent' },
  yo:         { name: 'Yo',          steps: [0, 2, 5, 7, 9], parallel: 'insen' },
  hirajoshi:  { name: 'Hirajoshi',   steps: [0, 2, 3, 7, 8], parallel: 'majpent' },
  insen:      { name: 'In Sen',      steps: [0, 1, 5, 7, 10], parallel: 'yo' },
  whole:      { name: 'Whole Tone',  steps: [0, 2, 4, 6, 8, 10], parallel: 'lydian' },
};

// 5-limit just intonation ratios, relative to the tonic.
const JUST = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

export class Harmony {
  constructor() {
    this.root = 2;
    this.mode = 'dorian';
    this.a4 = 440;
    this.just = false;
    this.opts = { prog: 'loop', complexity: 0.4, sus: 0.2, inversions: 0.25, loopLen: 4 };
    this.loop = [];
    this.loopPos = 0;
    this.chord = this.build(0);
  }

  get steps() { return MODES[this.mode].steps; }
  get len() { return this.steps.length; }

  semis(d) {
    const n = this.len;
    const o = Math.floor(d / n);
    return this.steps[((d % n) + n) % n] + 12 * o;
  }

  midi(d, oct) { return 12 * (oct + 1) + this.root + this.semis(d); }

  freq(m) {
    if (!this.just) return this.a4 * Math.pow(2, (m - 69) / 12);
    const rel = m - this.root;
    const pc = ((rel % 12) + 12) % 12;
    const oct = Math.floor(rel / 12);
    return this.a4 * Math.pow(2, (this.root - 69) / 12) * JUST[pc] * Math.pow(2, oct);
  }

  hz(d, oct) { return this.freq(this.midi(d, oct)); }
  pc(d) { const n = this.len; return ((d % n) + n) % n; }

  // Build a chord on scale degree `deg`: stacked thirds (every other scale
  // step), grown to 7ths/9ths by complexity, optionally suspended.
  build(deg) {
    const { complexity, sus, inversions } = this.opts;
    const size = 3 + (complexity > 0.35 ? 1 : 0) + (complexity > 0.72 ? 1 : 0);
    let tones = [];
    for (let i = 0; i < size; i++) tones.push(deg + i * 2);
    if (this.len >= 6 && chance(sus)) tones[1] = deg + (chance(0.5) ? 1 : 3);
    let bass = deg;
    if (chance(inversions)) bass = pick(tones.slice(1, 3));
    if (this.opts.prog === 'pedal') bass = 0;
    return { deg, tones, bass };
  }

  get tones() { return this.chord.tones; }

  isChordTone(d) {
    const pc = this.pc(d);
    return this.chord.tones.some((t) => this.pc(t) === pc);
  }

  nearestChordTone(d) {
    for (let k = 0; k < this.len; k++) {
      if (this.isChordTone(d - k)) return d - k;
      if (this.isChordTone(d + k)) return d + k;
    }
    return d;
  }

  stability(c) {
    const i = this.semis(c + 4) - this.semis(c);
    return i === 7 ? 1 : 0.15;
  }

  candidates(exclude) {
    const n = this.len;
    const cands = [], weights = [];
    for (let c = 0; c < n; c++) {
      if (c === exclude) continue;
      let w = this.stability(c);
      if (n >= 7 && (c === 3 || c === 5)) w *= 1.7;
      if (n >= 7 && c === 4) w *= 1.3;
      if (c === 0) w *= 1.4;
      cands.push(c);
      weights.push(w);
    }
    return [cands, weights];
  }

  newLoop() {
    const L = Math.round(clamp(this.opts.loopLen, 2, 8));
    const loop = [0];
    while (loop.length < L) {
      const [c, w] = this.candidates(loop[loop.length - 1]);
      loop.push(weighted(c, w));
    }
    this.loop = loop;
    this.loopPos = 0;
  }

  nextDegree(repetition = 0.7) {
    const n = this.len;
    const cur = this.chord.deg;
    switch (this.opts.prog) {
      case 'still': return 0;
      case 'pedal':
      case 'drift': {
        const [c, w] = this.candidates(cur);
        if (cur !== 0) w[c.indexOf(0)] *= 2;
        return weighted(c, w);
      }
      case 'func': {
        // tonic → predominant → dominant → tonic, with some freedom
        const T = [0, 5, 2].filter((d) => d < n), S = [3, 1].filter((d) => d < n), D = [4, 6].filter((d) => d < n);
        const inT = T.includes(cur), inS = S.includes(cur);
        const pool = inT ? (chance(0.8) ? S : D) : inS ? (chance(0.75) ? D : T) : (chance(0.85) ? T : S);
        const opts = pool.filter((d) => d !== cur && this.stability(d) > 0.5);
        return opts.length ? pick(opts) : 0;
      }
      case 'circle': return (cur + (n >= 7 ? 3 : 2)) % n;
      case 'two': {
        if (this.partner == null || this.partner >= n) this.partner = pick(n >= 7 ? [3, 5, 1, 4] : [1, 2, 3]);
        return cur === 0 ? this.partner : 0;
      }
      case 'random': return Math.floor(Math.random() * n);
      case 'loop':
      default: {
        if (!this.loop.length || this.loop.some((d) => d >= n)) this.newLoop();
        this.loopPos = (this.loopPos + 1) % this.loop.length;
        if (this.loopPos === 0 && !chance(repetition)) {
          // vary one chord of the loop, occasionally rebuild it entirely
          if (chance(0.3)) this.newLoop();
          else {
            const i = 1 + Math.floor(Math.random() * (this.loop.length - 1));
            const [c, w] = this.candidates(this.loop[i - 1]);
            this.loop[i] = weighted(c, w);
          }
        }
        return this.loop[this.loopPos];
      }
    }
  }

  advance(repetition) {
    this.chord = this.build(this.nextDegree(repetition));
    return this.chord;
  }

  setKey(root, mode) {
    this.root = root;
    if (mode) this.mode = mode;
    this.loop = [];
    this.chord = this.build(0);
  }

  // Returns [root, mode] for a modulation.
  modulation(type) {
    const r = this.root;
    const hasMajorThird = this.steps.includes(4) && !this.steps.includes(3);
    switch (type) {
      case 'relative': {
        if (hasMajorThird) return [(r + 9) % 12, pick(['aeolian', 'dorian'])];
        return [(r + 3) % 12, pick(['ionian', 'lydian', 'mixolydian'])];
      }
      case 'parallel': return [r, MODES[this.mode].parallel || this.mode];
      case 'mediant': return [(r + pick([4, 8, 3, 9])) % 12, this.mode];
      case 'step': return [(r + 2) % 12, this.mode];
      case 'fifth':
      default: return [(r + pick([7, 5])) % 12, this.mode];
    }
  }

  // Place chord tones around a centre with optional voice leading from the
  // previous voicing. Returns sorted MIDI notes.
  voice(tones, prev, { center = 57, spread = 0.5, lead = true, count = tones.length } = {}) {
    const width = 5 + spread * 14;
    const out = [];
    for (let i = 0; i < count; i++) {
      const d = tones[i % tones.length] + (i >= tones.length ? this.len : 0);
      const target = lead && prev && prev.length ? prev[Math.min(i, prev.length - 1)] : center + (i - (count - 1) / 2) * (2.5 + spread * 5);
      let best = null;
      for (let o = 1; o <= 6; o++) {
        const m = this.midi(d, o);
        if (m < center - width - 7 || m > center + width + 7) continue;
        if (best == null || Math.abs(m - target) < Math.abs(best - target)) best = m;
      }
      if (best == null) best = this.midi(d, Math.floor(center / 12) - 1);
      out.push(best);
    }
    out.sort((a, b) => a - b);
    for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) out[i] += 12;
    return out;
  }

  label() { return `${NOTE_NAMES[this.root]} ${MODES[this.mode].name}`; }
}
