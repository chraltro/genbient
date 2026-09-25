// Scales, tuning, chord construction, progressions and voice leading.
import { weighted, pick, chance, clamp } from './util.js';
import { progressionsFor } from './progressions.js';

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
    this.opts = { prog: 'loop', complexity: 0.4, sus: 0.2, inversions: 0.25, loopLen: 4, song: false };
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
    // song chords stay clear: fewer suspensions and inversions
    const song = this.opts.song;
    if (this.len >= 6 && chance(song ? sus * 0.3 : sus)) tones[1] = deg + (chance(0.5) ? 1 : 3);
    let bass = deg;
    if (chance(song ? inversions * 0.4 : inversions)) bass = pick(tones.slice(1, 3));
    if (this.opts.prog === 'pedal') bass = 0;
    return { deg, tones, bass };
  }

  get tones() { return this.chord.tones; }

  // Best guess at the next chord's root, for bass lines that lead into it:
  // knows about a queued part and the song's own verse/chorus turns.
  peekDegree() {
    const s = this.opts.song && this.song;
    if (s) {
      if (s.queued && s.queued !== s.part) return s[s.queued].degrees[0];
      const next = (this.loopPos + 1) % this.loop.length;
      if (next === 0 && !s.locked && s.passes + 1 >= 2) return s[s.part === 'verse' ? 'chorus' : 'verse'].degrees[0];
    }
    if (this.opts.prog === 'loop' && this.loop.length) return this.loop[(this.loopPos + 1 + this.loop.length) % this.loop.length];
    return 0;
  }

  // The arranger says which part comes next, a bar before it starts.
  queuePart(part) {
    if (!this.song && !this.newSong()) return;
    this.song.queued = part;
  }

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

  // Song chords: a verse and a chorus from the library, played as written.
  newSong() {
    let list = progressionsFor(this.mode, this.len);
    // in a running song sections are 16 bars of four-bar chords: 2 or 4 chords fit whole
    if (this.opts.fourBar) list = list.filter((p) => p.degrees.length === 2 || p.degrees.length === 4).concat(list.length ? [] : list);
    if (!list.length) { this.song = null; return false; }
    const verse = pick(list);
    const others = list.filter((p) => p !== verse);
    const chorus = others.length ? pick(others) : verse;
    const rest = others.filter((p) => p !== chorus);
    const bridge = rest.length ? pick(rest) : chorus;
    // start at the top of the verse on the next chord change
    this.song = { verse, chorus, bridge, part: 'verse', passes: -1, locked: false };
    this.loop = [...verse.degrees];
    this.loopPos = -1;
    return true;
  }

  // The running arranger decides the part: verse, chorus or bridge. The
  // new part starts from its first chord at the next change.
  setPart(part) {
    if (!this.song && !this.newSong()) return;
    this.song.locked = true;
    this.song.queued = null;
    if (this.song.part === part) return;
    this.song.part = part;
    this.loop = [...this.song[part].degrees];
    this.loopPos = -1;
  }

  get songInfo() {
    return this.opts.song && this.song ? { verse: this.song.verse.name, chorus: this.song.chorus.name, bridge: this.song.bridge.name, part: this.song.part } : null;
  }

  newLoop() {
    if (this.opts.song && this.newSong()) return;
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
        if (!this.loop.length || this.loop.some((d) => d >= n) || (this.opts.song && !this.song)) this.newLoop();
        if (this.opts.song && this.song) {
          // verse twice, chorus twice, and round again; never rewritten
          this.loopPos = (this.loopPos + 1) % this.loop.length;
          if (this.loopPos === 0 && !this.song.locked && ++this.song.passes >= 2) {
            this.song.passes = 0;
            this.song.part = this.song.part === 'verse' ? 'chorus' : 'verse';
            this.loop = [...this.song[this.song.part].degrees];
          }
          return this.loop[this.loopPos];
        }
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
    this.song = null;
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
  voice(tones, prev, { center = 57, spread = 0.5, lead = true, count = tones.length, floor = 0 } = {}) {
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
    // nothing below the floor: low chord tones turn to mud against the bass
    for (let i = 0; i < out.length; i++) while (out[i] < floor) out[i] += 12;
    out.sort((a, b) => a - b);
    for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) out[i] += 12;
    return out;
  }

  label() { return `${NOTE_NAMES[this.root]} ${MODES[this.mode].name}`; }
}
