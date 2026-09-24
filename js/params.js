// Parameter schema. Every customisable control in Genbient is declared once
// here (or on its layer); the UI renders from it, the generator randomises
// from it, and share links encode it.
import { clamp } from './util.js';

export const pct = (v) => `${Math.round(v * 100)}%`;

// range: continuous slider. `gen` narrows what the generator picks.
export const R = (id, label, min, max, def, x = {}) => ({ id, label, type: 'range', min, max, def, step: x.step ?? (max - min) / 100, fmt: x.fmt ?? pct, ...x });
// choice: chips. options = [[value, label], ...]
export const C = (id, label, options, def, x = {}) => ({ id, label, type: 'choice', options, def, ...x });
// toggle: switch.
export const T = (id, label, def, x = {}) => ({ id, label, type: 'toggle', def, ...x });

export function defaults(schema) {
  const out = {};
  for (const p of schema) out[p.id] = p.def;
  return out;
}

export function sanitize(p, v) {
  if (p.type === 'range') {
    const n = Number(v);
    return Number.isFinite(n) ? clamp(n, p.min, p.max) : p.def;
  }
  if (p.type === 'choice') return p.options.some((o) => o[0] === v) ? v : p.def;
  return typeof v === 'boolean' ? v : !!v;
}

export function fill(obj = {}, schema) {
  const out = {};
  for (const p of schema) out[p.id] = p.id in obj ? sanitize(p, obj[p.id]) : p.def;
  return out;
}

// r: seeded rng. Params flagged `keep` are left alone (e.g. levels chosen elsewhere).
export function randomize(schema, r, base = {}) {
  const out = { ...base };
  for (const p of schema) {
    if (p.keep) { if (!(p.id in out)) out[p.id] = p.def; continue; }
    if (p.type === 'range') {
      const [lo, hi] = p.gen || [p.min, p.max];
      let v = r.float(lo, hi);
      if (p.step >= 1) v = Math.round(v);
      else v = Math.round(v / p.step) * p.step;
      out[p.id] = clamp(v, p.min, p.max);
    } else if (p.type === 'choice') {
      const opts = p.gen ? p.options.filter((o) => p.gen.includes(o[0])) : p.options;
      out[p.id] = r.pick(opts)[0];
    } else {
      out[p.id] = r.chance(p.gen ?? 0.5);
    }
  }
  return out;
}

// Compact numeric encoding for share links (schema order).
export function pack(obj, schema) {
  return schema.map((p) => {
    const v = obj[p.id];
    if (p.type === 'range') return Math.round(((v - p.min) / (p.max - p.min || 1)) * 1000);
    if (p.type === 'choice') return Math.max(0, p.options.findIndex((o) => o[0] === v));
    return v ? 1 : 0;
  });
}

export function unpack(arr = [], schema) {
  const out = {};
  schema.forEach((p, i) => {
    const n = arr[i];
    if (n == null) { out[p.id] = p.def; return; }
    if (p.type === 'range') {
      let v = p.min + (n / 1000) * (p.max - p.min);
      if (p.step >= 1) v = Math.round(v);
      out[p.id] = clamp(v, p.min, p.max);
    } else if (p.type === 'choice') out[p.id] = (p.options[n] || p.options[0])[0];
    else out[p.id] = !!n;
  });
  return out;
}

/* ───────────────────────── Global parameters ───────────────────────── */

const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)) + ' Hz';

export const METERS = {
  '4/4': { steps: 16, groups: [4, 4, 4, 4] },
  '3/4': { steps: 12, groups: [4, 4, 4] },
  '5/4': { steps: 20, groups: [4, 4, 4, 4, 4] },
  '6/8': { steps: 12, groups: [6, 6] },
  '7/8': { steps: 14, groups: [4, 4, 6] },
  '9/8': { steps: 18, groups: [6, 6, 6] },
};

export const GLOBAL_SECTIONS = [
  {
    id: 'time', title: 'Tempo & groove', params: [
      R('bpm', 'Tempo', 40, 140, 72, { step: 1, fmt: (v) => `${v} bpm`, gen: [52, 96] }),
      C('meter', 'Meter', Object.keys(METERS).map((m) => [m, m]), '4/4', { gen: ['4/4', '4/4', '3/4', '6/8', '5/4', '7/8'] }),
      R('swing', 'Swing', 0, 0.7, 0.1, { gen: [0, 0.35] }),
      R('humanize', 'Humanise', 0, 1, 0.35, { gen: [0.15, 0.6], hint: 'timing looseness' }),
      R('velvar', 'Dynamics', 0, 1, 0.45, { gen: [0.2, 0.7], hint: 'soft and loud notes' }),
      R('density', 'Density', 0, 1, 0.5, { gen: [0.3, 0.7], hint: 'how much happens' }),
    ],
  },
  {
    id: 'harmony', title: 'Harmony', params: [
      C('prog', 'Progression', [['loop', 'Looping'], ['drift', 'Modal drift'], ['func', 'Functional'], ['circle', 'Circle of fifths'],
        ['pedal', 'Pedal point'], ['two', 'Two-chord sway'], ['random', 'Wandering'], ['still', 'Static']], 'loop'),
      C('chordBars', 'Chord length', [[1, '1 bar'], [2, '2 bars'], [4, '4 bars'], [8, '8 bars']], 2, { gen: [1, 2, 2, 4] }),
      R('complexity', 'Chord colour', 0, 1, 0.4, { gen: [0.1, 0.8], hint: 'triads → 7ths → 9ths' }),
      R('sus', 'Suspensions', 0, 1, 0.2, { gen: [0, 0.5] }),
      R('spread', 'Voicing spread', 0, 1, 0.5),
      T('lead', 'Smooth voice leading', true, { gen: 0.85 }),
      R('inversions', 'Inversions', 0, 1, 0.25, { gen: [0, 0.5] }),
      R('loopLen', 'Loop length', 2, 8, 4, { step: 1, fmt: (v) => `${v} chords` }),
      R('modulate', 'Key changes', 0, 1, 0.1, { gen: [0, 0.35] }),
      C('modType', 'Modulation', [['fifth', 'By fifths'], ['relative', 'Relative'], ['parallel', 'Parallel'], ['mediant', 'Mediant'], ['step', 'Step up']], 'fifth'),
    ],
  },
  {
    id: 'melody', title: 'Melody', params: [
      C('motifBars', 'Motif length', [[1, '1 bar'], [2, '2 bars'], [4, '4 bars']], 2),
      R('repetition', 'Repetition', 0, 1, 0.65, { gen: [0.4, 0.9], hint: 'fresh ideas ↔ familiar' }),
      R('tension', 'Tension', 0, 1, 0.3, { gen: [0.1, 0.55], hint: 'notes outside the chord' }),
      R('range', 'Range', 0, 1, 0.5),
      R('leap', 'Leaps', 0, 1, 0.3, { gen: [0.1, 0.5] }),
      R('rests', 'Breathing room', 0, 1, 0.4, { gen: [0.2, 0.7], hint: 'silence between phrases' }),
      T('callResponse', 'Call & response', false, { gen: 0.35 }),
    ],
  },
  {
    id: 'space', title: 'Space', params: [
      R('revSize', 'Reverb size', 0, 1, 0.65, { gen: [0.35, 1] }),
      R('revDamp', 'Reverb darkness', 0, 1, 0.5),
      R('revPre', 'Pre-delay', 0, 1, 0.2, { fmt: (v) => `${Math.round(v * 150)} ms` }),
      R('revMix', 'Reverb level', 0, 1, 0.6, { gen: [0.4, 0.9] }),
      C('dlyDiv', 'Echo time', [[0.25, '1/16'], [0.5, '1/8'], [0.75, '1/8 dotted'], [0.667, '1/4 triplet'], [1, '1/4'], [1.5, '1/4 dotted'], [2, '1/2']], 0.75),
      R('dlyFb', 'Echo repeats', 0, 0.9, 0.45, { gen: [0.2, 0.65] }),
      R('dlyTone', 'Echo tone', 0, 1, 0.5),
      R('dlyMix', 'Echo level', 0, 1, 0.5, { gen: [0.25, 0.7] }),
      R('dlySpread', 'Echo width', 0, 1, 0.75),
    ],
  },
  {
    id: 'colour', title: 'Colour', params: [
      R('bright', 'Brightness', 0, 1, 0.6, { gen: [0.35, 0.8], fmt: (v) => hz(700 * Math.pow(26, v)) }),
      R('lowcut', 'Low cut', 0, 1, 0.08, { gen: [0, 0.3], fmt: (v) => hz(20 * Math.pow(15, v)) }),
      R('warmth', 'Tape warmth', 0, 1, 0.25, { gen: [0, 0.6] }),
      R('wow', 'Tape wobble', 0, 1, 0.1, { gen: [0, 0.4] }),
      R('chorus', 'Chorus', 0, 1, 0.2, { gen: [0, 0.6] }),
      R('pump', 'Sidechain pump', 0, 1, 0, { gen: [0, 0.3] }),
      R('drift', 'Filter drift', 0, 1, 0.4),
      R('evolve', 'Evolution', 0, 1, 0.45, { gen: [0.25, 0.75], hint: 'sounds slowly reshape themselves' }),
    ],
  },
  {
    id: 'touch', title: 'Touch', params: [
      C('touchMode', 'Touch does', [['both', 'Play & sculpt'], ['play', 'Play notes'], ['sculpt', 'Sculpt sound'], ['off', 'Nothing']], 'both', { keep: true }),
      C('touchVoice', 'Touch instrument', [['glass', 'Glass'], ['voice', 'Voice'], ['bell', 'Bell'], ['pluck', 'Pluck'], ['warm', 'Warm']], 'glass'),
      C('touchNotes', 'Notes', [['chord', 'Chord tones'], ['scale', 'Whole scale'], ['penta', 'Five notes']], 'scale', { keep: true }),
      R('touchRange', 'Range', 1, 4, 2, { step: 1, fmt: (v) => `${v} oct`, keep: true }),
      R('touchGlide', 'Glide', 0, 1, 0.35, { keep: true }),
      R('touchLevel', 'Touch level', 0, 1, 0.6, { keep: true }),
      R('touchEcho', 'Touch echo', 0, 1, 0.5, { keep: true }),
      R('touchSculpt', 'Sculpt depth', 0, 1, 0.6, { keep: true, hint: 'how far a finger bends the mix' }),
    ],
  },
];

export const VISUAL_PARAMS = [
  R('vMotion', 'Motion', 0, 1, 0.45),
  R('vMotes', 'Lines', 0, 1, 0.5, { fmt: (v) => `${Math.round(14 + v * 30)}` }),
  R('vGlow', 'Swell', 0, 1, 0.4),
  R('vRipples', 'Note response', 0, 1, 0.6),
  R('vTrails', 'Touch response', 0, 1, 0.7),
  R('vOrb', 'Line weight', 0, 1, 0.35),
  R('vRings', 'Depth fade', 0, 1, 0.6),
  R('vGrain', 'Grain', 0, 1, 0.3),
];

export const GLOBAL_PARAMS = GLOBAL_SECTIONS.flatMap((s) => s.params);
export const GLOBAL_BY_ID = Object.fromEntries(GLOBAL_PARAMS.map((p) => [p.id, p]));
