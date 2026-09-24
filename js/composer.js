// Musical building blocks: Euclidean rhythms, motifs that repeat and
// develop, and arpeggio shapes.
import { rand, pick, chance, clamp } from './util.js';

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
 * A motif is a short rhythmic/melodic cell measured in 16th steps.
 * notes: [{ s: step, len: steps, d: degree offset, v: velocity }]
 * Degree offsets are relative to the current chord root, so the same motif
 * follows the harmony as it moves.
 */
export function makeMotif({ steps = 32, groups = [4, 4, 4, 4], density = 0.5, range = 0.5, leap = 0.3, tension = 0.3 }) {
  const barLen = groups.reduce((a, b) => a + b, 0);
  const onsets = [];
  const p = 0.15 + density * 0.75;
  for (let s = 0; s < steps; s++) {
    const w = accent(s % barLen, groups);
    const prob = w >= 0.8 ? p * 1.1 : w >= 0.5 ? p * 0.6 : p * 0.25;
    if (Math.random() < prob) onsets.push(s);
  }
  if (onsets.length < 2) onsets.splice(0, onsets.length, 0, Math.floor(steps / 2));
  if (!onsets.includes(0) && chance(0.7)) onsets.unshift(0);
  const span = Math.round(2 + range * 7);
  let d = pick([0, 2, 4, 0]);
  const notes = onsets.map((s, i) => {
    const next = onsets[i + 1] ?? steps;
    const strong = accent(s % barLen, groups) >= 0.8;
    if (i > 0) {
      const jump = chance(leap) ? pick([-4, -3, 3, 4, 5, -5]) : pick([-2, -1, -1, 1, 1, 2]);
      d = clamp(d + jump, -span / 2, span);
    }
    return { s, len: Math.max(1, next - s), d: Math.round(d), v: strong ? rand(0.85, 1) : rand(0.5, 0.8), snap: strong || !chance(tension) };
  });
  // gravitate the final note home
  const last = notes[notes.length - 1];
  if (chance(0.6)) { last.d = pick([0, 2, 4]); last.snap = true; }
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
