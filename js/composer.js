// Musical building blocks: Euclidean rhythms, motifs that repeat and
// develop, and arpeggio shapes.
import { rand, pick, chance, clamp, weighted } from './util.js';

// Evenly distribute `pulses` hits over `steps` (Bjorklund-equivalent).
export function euclid(steps, pulses, rotate = 0) {
  steps = Math.max(1, Math.round(steps));
  pulses = clamp(Math.round(pulses), 0, steps);
  const out = new Array(steps).fill(false);
  for (let i = 0; i < steps; i++) {
    out[(i + Math.round(rotate)) % steps] = Math.floor((i * pulses) / steps) !== Math.floor(((i - 1) * pulses) / steps) || (i === 0 && pulses > 0);
  }
  return out;
}

// Metric weight of a step inside a bar (1 = downbeat).
export function accent(stepInBar, groups) {
  if (stepInBar === 0) return 1;
  let acc = 0;
  for (const g of groups) {
    if (stepInBar === acc) return 0.8;
    acc += g;
  }
  return stepInBar % 2 === 0 ? 0.5 : 0.3;
}

/*
 * A motif is a short phrase measured in 16th steps.
 * notes: [{ s: step, len: steps, d: scale degree, v: velocity, snap }]
 * Degrees are in the key; notes marked snap land on the nearest chord tone,
 * so the tune stays itself as the harmony moves under it.
 *
 * It is written the way memorable melodies tend to be built:
 *   · rhythm first: one bar's rhythmic cell, repeated (sometimes varied),
 *     with the last bar thinned so the phrase can land;
 *   · an arch: most folk and popular melodies rise and then fall back
 *     (Huron, Sweet Anticipation), with some bowls and falling lines;
 *   · Narmour's implication–realisation: small steps tend to continue in
 *     the same direction, a leap is followed by a step back the other way;
 *   · closure: the last note is the home chord, approached by step.
 */
function rhythmCell(barLen, groups, density) {
  const p = 0.15 + density * 0.7;
  const on = [];
  for (let s = 0; s < barLen; s++) {
    const w = accent(s, groups);
    const prob = w >= 0.8 ? p * 1.15 : w >= 0.5 ? p * 0.6 : p * 0.22;
    if (Math.random() < prob) on.push(s);
  }
  if (!on.includes(0) && chance(0.75)) on.unshift(0);
  if (on.length < 2) return [0, groups[0] * (groups.length > 2 ? 2 : 1)].filter((x) => x < barLen);
  return on;
}

export function makeMotif({ steps = 32, groups = [4, 4, 4, 4], density = 0.5, range = 0.5, leap = 0.3, tension = 0.3 }) {
  const barLen = groups.reduce((a, b) => a + b, 0);
  const bars = Math.max(1, Math.round(steps / barLen));
  const cell = rhythmCell(barLen, groups, density);
  const alt = chance(0.5) ? rhythmCell(barLen, groups, density) : cell;
  let onsets = [];
  for (let b = 0; b < bars; b++) {
    let c = b % 2 === 1 && chance(0.35) ? alt : cell;
    // the last bar lands: keep what comes before its middle
    if (b === bars - 1 && bars > 1) c = c.filter((x) => x < barLen / 2 + 1).slice(0, 3);
    onsets.push(...c.map((x) => x + b * barLen));
  }
  onsets = [...new Set(onsets)].filter((x) => x < steps).sort((a, b) => a - b);
  if (onsets.length < 2) onsets = [0, Math.floor(steps / 2)];

  // the shape the line leans toward, in scale degrees
  const span = Math.round(2 + range * 6);
  const shape = pick(['arch', 'arch', 'arch', 'bowl', 'fall', 'rise']);
  const peakAt = rand(0.45, 0.7);
  const contour = (x) => {
    const a = x < peakAt ? x / peakAt : 1 - (x - peakAt) / (1 - peakAt);
    if (shape === 'arch') return a * span;
    if (shape === 'bowl') return (1 - a) * span * 0.6 - span * 0.3;
    if (shape === 'fall') return (1 - x) * span;
    return x * span * 0.8;
  };
  let d = shape === 'fall' ? pick([4, 5, 7]) : shape === 'bowl' ? pick([2, 4]) : pick([0, 0, 2, 4]);
  let prev = 0;
  const notes = onsets.map((s, i) => {
    const next = onsets[i + 1] ?? steps;
    const strong = accent(s % barLen, groups) >= 0.8;
    if (i > 0) {
      const want = contour(s / steps);
      const opts = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
      const w = opts.map((iv) => {
        const size = Math.abs(iv);
        let x = size === 0 ? 0.5 : size === 1 ? 1.6 : size === 2 ? 1.1 : size <= 3 ? 0.35 + leap * 0.6 : leap * 0.5;
        if (Math.abs(prev) >= 3) x *= Math.sign(iv) === -Math.sign(prev) && size <= 2 ? 3 : 0.3; // gap-fill
        else if (prev !== 0 && Math.sign(iv) === Math.sign(prev)) x *= 1.4; // process continues
        x *= Math.exp(-((d + iv - want) ** 2) / (2 * 2.2 * 2.2)); // lean on the contour
        return x;
      });
      const iv = weighted(opts, w);
      prev = iv;
      d = clamp(d + iv, -3, span + 2);
    }
    return { s, len: Math.max(1, next - s), d, v: strong ? rand(0.85, 1) : rand(0.5, 0.8), snap: strong || !chance(tension) };
  });
  // closure: home, reached by step where possible
  const last = notes[notes.length - 1];
  const home = [0, 2, 4, 7].reduce((a, b) => (Math.abs(b - notes[Math.max(0, notes.length - 2)].d) < Math.abs(a - notes[Math.max(0, notes.length - 2)].d) ? b : a));
  last.d = chance(0.7) ? home : 0;
  last.snap = true;
  last.v = Math.max(last.v, 0.8);
  // sometimes the second half answers the first a step away (a sequence)
  if (bars >= 2 && chance(0.25)) {
    const half = steps / 2;
    const first = notes.filter((n) => n.s < half);
    const shift = pick([-1, 1, 2, -2]);
    for (const n of notes) {
      if (n.s < half || n === last) continue;
      const src = first.find((f) => f.s === n.s - half);
      if (src) n.d = src.d + shift;
    }
  }
  return { steps, notes };
}

// Develop a motif: small, recognisable changes.
export function vary(m, amount = 0.4) {
  const notes = m.notes.map((n) => ({ ...n }));
  const ops = Math.max(1, Math.round(amount * 3));
  for (let k = 0; k < ops; k++) {
    const i = Math.floor(Math.random() * notes.length);
    const op = Math.random();
    if (op < 0.4) notes[i].d += pick([-1, 1, 2, -2]);
    else if (op < 0.55 && notes.length > 2) notes.splice(i, 1);
    else if (op < 0.75) {
      const n = notes[i];
      if (n.len >= 2) {
        const half = Math.floor(n.len / 2);
        notes.splice(i + 1, 0, { s: n.s + half, len: n.len - half, d: n.d + pick([-1, 1]), v: n.v * 0.8, snap: false });
        n.len = half;
      }
    } else if (op < 0.9) {
      const shift = pick([-2, 2, 4, -3]);
      notes.forEach((n) => { n.d += shift; });
    } else {
      // inversion of the contour around the first note
      const d0 = notes[0].d;
      notes.forEach((n) => { n.d = d0 - (n.d - d0); });
    }
  }
  return { steps: m.steps, notes };
}

/*
 * A loop after Eno's Music for Airports: a few notes, close together, then
 * a long silence, repeating on a length (in grid steps) that is prime, so
 * two loops share no common period and drift in and out of phase for a very
 * long time. Degrees are in the key, not the chord.
 */
const PRIMES = [17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137];
export function makeLoop({ stepSecs, density = 0.5, taken = [] }) {
  const want = rand(13, 27) / stepSecs;
  const free = PRIMES.filter((p) => !taken.includes(p));
  const len = free.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  const n = 1 + Math.round(clamp(density, 0, 1) * 3);
  const notes = [];
  let s = Math.floor(rand(0, len * 0.4));
  let d = pick([0, 2, 4, 4, 1, 5]);
  for (let i = 0; i < n && s < len - 2; i++) {
    notes.push({ s, d, v: rand(0.6, 0.95), len: pick([6, 8, 12]), snap: chance(0.5) });
    s += pick([2, 3, 4, 4, 6, 8]);
    d = clamp(d + pick([-2, -1, 1, 2, 3, -3]), -2, 7);
  }
  return { len, notes };
}

// A small change to a loop, the kind that keeps a listener half-noticing.
export function nudgeLoop(loop) {
  const notes = loop.notes.map((n) => ({ ...n }));
  const n = pick(notes);
  const op = Math.random();
  if (op < 0.5) n.d = clamp(n.d + pick([-2, -1, 1, 2]), -2, 7);
  else if (op < 0.8) n.s = clamp(n.s + pick([-2, -1, 1, 2]), 0, loop.len - 1);
  else if (notes.length > 1 && op < 0.9) notes.splice(notes.indexOf(n), 1);
  else if (notes.length < 4) notes.push({ ...n, s: (n.s + pick([3, 4, 6])) % loop.len, d: n.d + pick([-2, 2, 3]) });
  return { len: loop.len, notes };
}

// Arpeggio index sequence over `n` notes.
export function arpSequence(shape, n) {
  const up = [...Array(n).keys()];
  switch (shape) {
    case 'down': return [...up].reverse();
    case 'updown': return n > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    case 'converge': {
      const out = [];
      for (let i = 0, j = n - 1; i <= j; i++, j--) { out.push(i); if (i !== j) out.push(j); }
      return out;
    }
    case 'pinky': return up.slice(0, -1).flatMap((i) => [i, n - 1]);
    case 'thumb': return up.slice(1).flatMap((i) => [0, i]);
    case 'random': return up.map(() => Math.floor(Math.random() * n));
    case 'up':
    default: return up;
  }
}
