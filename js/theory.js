// Scales, tuning and a slowly wandering harmony.
import { weighted } from './util.js';

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const MODES = {
  ionian:     { name: 'Major',       steps: [0, 2, 4, 5, 7, 9, 11] },
  lydian:     { name: 'Lydian',      steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { name: 'Mixolydian',  steps: [0, 2, 4, 5, 7, 9, 10] },
  dorian:     { name: 'Dorian',      steps: [0, 2, 3, 5, 7, 9, 10] },
  aeolian:    { name: 'Minor',       steps: [0, 2, 3, 5, 7, 8, 10] },
  phrygian:   { name: 'Phrygian',    steps: [0, 1, 3, 5, 7, 8, 10] },
  hijaz:      { name: 'Hijaz',       steps: [0, 1, 4, 5, 7, 8, 10] },
  majpent:    { name: 'Pentatonic',  steps: [0, 2, 4, 7, 9] },
  minpent:    { name: 'Minor Pent.', steps: [0, 3, 5, 7, 10] },
  yo:         { name: 'Yo',          steps: [0, 2, 5, 7, 9] },
  hirajoshi:  { name: 'Hirajoshi',   steps: [0, 2, 3, 7, 8] },
  insen:      { name: 'In Sen',      steps: [0, 1, 5, 7, 10] },
  whole:      { name: 'Whole Tone',  steps: [0, 2, 4, 6, 8, 10] },
};

// 5-limit just intonation ratios, relative to the tonic.
const JUST = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];

export class Harmony {
  constructor() {
    this.root = 2;
    this.mode = 'dorian';
    this.a4 = 440;
    this.just = false;
    this.chord = 0;
  }

  get steps() { return MODES[this.mode].steps; }
  get len() { return this.steps.length; }

  // Semitone offset of scale degree d (any integer; wraps into octaves).
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

  chordDegrees(size = 3, c = this.chord) {
    const out = [];
    for (let i = 0; i < size; i++) out.push(c + i * 2);
    return out;
  }

  isChordTone(d) {
    const n = this.len;
    const pc = ((d % n) + n) % n;
    return this.chordDegrees(3).some((c) => ((c % n) + n) % n === pc);
  }

  // A chord is "stable" if its root and fifth form a perfect fifth.
  stability(c) {
    const i = this.semis(c + 4) - this.semis(c);
    return i === 7 ? 1 : 0.2;
  }

  nextChord() {
    const n = this.len;
    const cands = [];
    const weights = [];
    for (let c = 0; c < n; c++) {
      if (c === this.chord) continue;
      let w = this.stability(c);
      if (c === 0) w *= this.chord === 0 ? 0 : 2.4;
      if (n >= 7 && (c === 3 || c === 5)) w *= 1.6; // IV and vi-like colours
      if (n >= 7 && c === 4) w *= 1.2;
      cands.push(c);
      weights.push(w);
    }
    this.chord = weighted(cands, weights);
    return this.chord;
  }

  label() { return `${NOTE_NAMES[this.root]} ${MODES[this.mode].name}`; }
}
