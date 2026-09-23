// Curated scenes, colour palettes and the seeded scene generator.
import { LAYERS } from './layers.js';
import { MODES } from './theory.js';
import { seeded, clamp } from './util.js';

export const PALETTES = {
  abyss:   { bg: ['#01060f', '#062235'], orbs: ['#0e6a86', '#173f9a', '#159c94', '#2b2f7a'], accent: '#8fe3f0' },
  aurora:  { bg: ['#020910', '#08202a'], orbs: ['#18b07c', '#6040c0', '#2a86b0', '#0f7a5f'], accent: '#9ff5cc' },
  dusk:    { bg: ['#10061a', '#2a0e2a'], orbs: ['#c24a72', '#e8904f', '#5e2a88', '#8e3060'], accent: '#ffbf98' },
  forest:  { bg: ['#020c07', '#0b2215'], orbs: ['#2f8a4a', '#8aac3a', '#1d6a52', '#c9a64a'], accent: '#d2edaa' },
  ember:   { bg: ['#0d0402', '#261006'], orbs: ['#d04a1e', '#f0942e', '#8a221a', '#b85e1e'], accent: '#ffca88' },
  glacier: { bg: ['#040a14', '#10233c'], orbs: ['#5fa8e0', '#a9d8f4', '#3b6fc0', '#7fc6d8'], accent: '#e0f4ff' },
  lotus:   { bg: ['#0e0512', '#26102c'], orbs: ['#d87aac', '#9a6ad8', '#f0a8bc', '#6a3a92'], accent: '#ffcce4' },
  cosmos:  { bg: ['#03020c', '#100a2c'], orbs: ['#4a30c0', '#b83aa4', '#1f44a8', '#7c30dc'], accent: '#d4b4ff' },
  sand:    { bg: ['#0e0904', '#2a1b0c'], orbs: ['#d0a060', '#b0703c', '#e8c890', '#80603c'], accent: '#f8dcb0' },
  mist:    { bg: ['#06090b', '#18222a'], orbs: ['#6a9098', '#90a8b0', '#4a6e80', '#a8bcb4'], accent: '#e2eef0' },
  night:   { bg: ['#01040e', '#081428'], orbs: ['#1c4078', '#246660', '#3c2c78', '#0f5078'], accent: '#b0ccff' },
};

const L = (on, vol, ch) => ({ on, vol, ch });

function scene(name, tagline, palette, root, mode, g, layers, extra = {}) {
  const out = {
    name, tagline, palette, root, mode, a4: 440, just: false,
    pace: g[0], evolve: g[1], bright: g[2], space: g[3], layers: {}, ...extra,
  };
  for (const def of LAYERS) out.layers[def.id] = layers[def.id] ? L(true, ...layers[def.id]) : L(false, 0.6, 0.5);
  return out;
}

export const PRESETS = [
  scene('Still Water', 'slow tides under a sleeping sky', 'abyss', 2, 'dorian', [0.35, 0.5, 0.45, 0.75],
    { drone: [0.55, 0.35], pad: [0.7, 0.4], bells: [0.45, 0.3], ocean: [0.6, 0.4], shimmer: [0.35, 0.35] }),
  scene('Forest Dawn', 'first light through wet leaves', 'forest', 7, 'majpent', [0.55, 0.45, 0.65, 0.55],
    { pad: [0.5, 0.55], keys: [0.55, 0.45], birds: [0.6, 0.5], stream: [0.5, 0.45], wind: [0.25, 0.2] }),
  scene('Temple', 'bronze, incense, stone', 'sand', 9, 'insen', [0.3, 0.35, 0.5, 0.8],
    { bowls: [0.8, 0.5], drone: [0.55, 0.3], choir: [0.35, 0.2], flute: [0.3, 0.35] }),
  scene('Rain on Glass', 'a long afternoon indoors', 'mist', 5, 'lydian', [0.4, 0.5, 0.5, 0.6],
    { pad: [0.6, 0.35], rain: [0.7, 0.55], keys: [0.4, 0.3], thunder: [0.35, 0.3] }),
  scene('Aurora', 'light folding over the ice', 'aurora', 4, 'lydian', [0.4, 0.6, 0.7, 0.85],
    { pad: [0.7, 0.6], shimmer: [0.6, 0.55], choir: [0.4, 0.5], wind: [0.3, 0.35], bells: [0.3, 0.25] }),
  scene('Night Garden', 'warm air, a thousand small voices', 'night', 0, 'aeolian', [0.45, 0.4, 0.5, 0.6],
    { drone: [0.4, 0.3], night: [0.6, 0.6], keys: [0.35, 0.25], pad: [0.45, 0.35], flute: [0.35, 0.3] }),
  scene('Hearth', 'a fire that never needs tending', 'ember', 9, 'dorian', [0.35, 0.4, 0.45, 0.5],
    { fire: [0.75, 0.5], drone: [0.4, 0.3], pad: [0.45, 0.3], rain: [0.3, 0.25] }),
  scene('Deep Space', 'drifting past the last planet', 'cosmos', 11, 'lydian', [0.3, 0.65, 0.55, 0.95],
    { drone: [0.65, 0.45], pad: [0.6, 0.5], shimmer: [0.5, 0.45], pulse: [0.3, 0.2], choir: [0.3, 0.1] }),
  scene('Snowfall', 'the hush of everything covered', 'glacier', 3, 'majpent', [0.45, 0.45, 0.7, 0.8],
    { keys: [0.5, 0.35], shimmer: [0.5, 0.4], wind: [0.4, 0.3], bells: [0.3, 0.25], pad: [0.45, 0.5] }),
  scene('Lotus', 'petals on a slow current', 'lotus', 6, 'hirajoshi', [0.4, 0.45, 0.6, 0.7],
    { flute: [0.5, 0.45], bowls: [0.4, 0.35], pad: [0.5, 0.45], stream: [0.35, 0.3] }),
  scene('Deep Sleep', 'delta waves and distant surf', 'night', 2, 'aeolian', [0.2, 0.3, 0.25, 0.7],
    { drone: [0.5, 0.2], pad: [0.5, 0.15], ocean: [0.45, 0.3], binaural: [0.45, 0.1] }),
  scene('Desert Wind', 'dunes singing under the moon', 'dusk', 4, 'hijaz', [0.4, 0.5, 0.55, 0.7],
    { drone: [0.55, 0.45], wind: [0.6, 0.6], flute: [0.45, 0.5], bells: [0.2, 0.2] }),
  scene('Cathedral', 'voices held in old stone', 'cosmos', 7, 'ionian', [0.3, 0.5, 0.5, 1],
    { choir: [0.65, 0.55], pad: [0.4, 0.35], bells: [0.3, 0.2], drone: [0.35, 0.3] }),
  scene('Monsoon', 'heavy rain, warm earth', 'forest', 10, 'minpent', [0.5, 0.55, 0.5, 0.55],
    { rain: [0.8, 0.85], thunder: [0.55, 0.55], drone: [0.4, 0.4], bowls: [0.35, 0.3] }),
];

/* ───────────────────────── Procedural scenes ───────────────────────── */

const MOODS = [
  { name: 'oceanic',   palettes: ['abyss', 'night', 'glacier'], modes: ['dorian', 'aeolian', 'lydian', 'majpent'],
    likes: { ocean: 3, drone: 2, pad: 3, shimmer: 2, bells: 1.5, wind: 1, choir: 1 } },
  { name: 'sylvan',    palettes: ['forest', 'mist', 'aurora'], modes: ['majpent', 'ionian', 'mixolydian', 'yo', 'dorian'],
    likes: { birds: 3, stream: 3, keys: 2.5, pad: 2, flute: 2, wind: 1, rain: 1 } },
  { name: 'sacred',    palettes: ['sand', 'ember', 'cosmos'], modes: ['insen', 'hirajoshi', 'hijaz', 'phrygian', 'dorian'],
    likes: { bowls: 3, drone: 3, choir: 2, flute: 1.5, bells: 1.5, fire: 1 } },
  { name: 'celestial', palettes: ['cosmos', 'aurora', 'night', 'lotus'], modes: ['lydian', 'whole', 'ionian', 'majpent'],
    likes: { shimmer: 3, pad: 3, choir: 2, drone: 2, bells: 2, pulse: 1, binaural: 1 } },
  { name: 'stormy',    palettes: ['mist', 'night', 'abyss'], modes: ['aeolian', 'phrygian', 'dorian', 'minpent'],
    likes: { rain: 3, thunder: 2.5, wind: 2, drone: 2, pad: 2, keys: 1 } },
  { name: 'nocturne',  palettes: ['night', 'dusk', 'lotus'], modes: ['aeolian', 'dorian', 'minpent', 'hirajoshi'],
    likes: { night: 3, keys: 2, pad: 2, flute: 2, drone: 1.5, stream: 1 } },
  { name: 'warm',      palettes: ['ember', 'dusk', 'sand'], modes: ['mixolydian', 'dorian', 'majpent', 'ionian'],
    likes: { fire: 3, pad: 2, keys: 2, drone: 2, rain: 1.5, pulse: 1 } },
];

const ADJ = ['Silent', 'Hollow', 'Amber', 'Silver', 'Distant', 'Velvet', 'Tidal', 'Drifting', 'Luminous', 'Quiet',
  'Ancient', 'Soft', 'Evening', 'Morning', 'Glass', 'Moss', 'Salt', 'Cloud', 'Ember', 'Low', 'Slow', 'Pale',
  'Hidden', 'Golden', 'Blue', 'Northern', 'Sleeping', 'Weightless', 'Faint', 'Deep', 'Wandering', 'Still'];
const NOUN = ['Harbor', 'Canopy', 'Meadow', 'Orbit', 'Monastery', 'Lagoon', 'Tide', 'Cathedral', 'Valley',
  'Garden', 'Current', 'Horizon', 'Lantern', 'Glacier', 'Reverie', 'Driftwood', 'Nebula', 'Grove', 'Shoreline',
  'Hours', 'Fields', 'Echoes', 'Rooms', 'Pines', 'Lanterns', 'Waters', 'Embers', 'Clouds', 'Island', 'Hollow',
  'Moon', 'Delta', 'Cloister', 'Estuary', 'Aurora', 'Sanctuary'];
const TAG_A = ['breathing', 'drifting', 'unfolding', 'dissolving', 'turning', 'resting', 'glowing', 'wandering', 'settling'];
const TAG_B = ['slowly', 'without end', 'in the half-light', 'far from anywhere', 'under soft rain', 'beyond the tide line',
  'at the edge of sleep', 'in no hurry', 'like weather', 'with the stars'];

function name(r) {
  const a = r.pick(ADJ);
  let n = r.pick(NOUN);
  while (n === a) n = r.pick(NOUN);
  return r.chance(0.18) ? `${r.pick(NOUN)} of ${n}` : `${a} ${n}`;
}

export function generateScene(seed) {
  const r = seeded(seed);
  const mood = r.pick(MOODS);
  const keys = Object.keys(mood.likes);
  const layers = {};
  for (const def of LAYERS) layers[def.id] = L(false, 0.6, 0.5);

  const tonal = ['drone', 'pad', 'choir', 'shimmer'];
  const count = r.int(3, 6);
  const chosen = new Set();
  // Always anchor with something tonal so the scene has a harmonic floor.
  const anchors = keys.filter((k) => tonal.includes(k));
  if (anchors.length) chosen.add(r.weighted(anchors, anchors.map((k) => mood.likes[k])));
  let guard = 0;
  while (chosen.size < count && guard++ < 50) {
    const pool = r.chance(0.85) ? keys : LAYERS.map((l) => l.id);
    chosen.add(r.weighted(pool, pool.map((k) => mood.likes[k] || 0.4)));
  }
  for (const id of chosen) {
    const weight = mood.likes[id] || 0.5;
    layers[id] = L(true, clamp(r.float(0.3, 0.55) + weight * 0.06, 0.2, 0.85), r.float(0.15, 0.75));
  }
  if (layers.binaural.on) layers.binaural.vol = r.float(0.25, 0.45);
  if (layers.thunder.on) layers.thunder.ch = r.float(0.1, 0.5);

  const mode = r.pick(mood.modes);
  return {
    name: name(r),
    tagline: `${r.pick(TAG_A)} ${r.pick(TAG_B)}`,
    palette: r.pick(mood.palettes),
    root: r.int(0, 11),
    mode: MODES[mode] ? mode : 'dorian',
    a4: r.chance(0.3) ? 432 : 440,
    just: r.chance(0.25),
    pace: r.float(0.2, 0.65),
    evolve: r.float(0.3, 0.75),
    bright: r.float(0.35, 0.75),
    space: r.float(0.5, 0.95),
    layers,
    seed,
  };
}

// Journey mode: a gentle step away from the current scene, not a jump.
export function mutateScene(s, seed) {
  const r = seeded(seed);
  const next = structuredClone(s);
  const on = LAYERS.filter((l) => next.layers[l.id].on).map((l) => l.id);
  const off = LAYERS.filter((l) => !next.layers[l.id].on && l.id !== 'binaural').map((l) => l.id);
  if (on.length > 2 && r.chance(0.7)) next.layers[r.pick(on)].on = false;
  if (off.length && (on.length < 5 || r.chance(0.5))) {
    const id = r.pick(off);
    next.layers[id] = L(true, r.float(0.3, 0.6), r.float(0.2, 0.7));
  }
  for (const id of on) {
    const l = next.layers[id];
    l.vol = clamp(l.vol + r.float(-0.12, 0.12), 0.15, 0.9);
    l.ch = clamp(l.ch + r.float(-0.2, 0.2), 0, 1);
  }
  if (!LAYERS.some((l) => ['drone', 'pad', 'choir', 'shimmer'].includes(l.id) && next.layers[l.id].on)) {
    next.layers.pad = L(true, 0.5, r.float(0.2, 0.6));
  }
  if (r.chance(0.5)) next.root = (next.root + r.pick([5, 7])) % 12;
  if (r.chance(0.3)) next.mode = r.pick(Object.keys(MODES).filter((m) => m !== 'whole'));
  if (r.chance(0.5)) next.palette = r.pick(Object.keys(PALETTES));
  next.bright = clamp(next.bright + r.float(-0.12, 0.12), 0.2, 0.85);
  next.pace = clamp(next.pace + r.float(-0.1, 0.1), 0.1, 0.8);
  next.name = name(r);
  next.tagline = `${r.pick(TAG_A)} ${r.pick(TAG_B)}`;
  return next;
}

/* ───────────────────────── Share links ───────────────────────── */

const pct = (v) => Math.round(v * 100);

export function encodeScene(s) {
  const data = {
    n: s.name, t: s.tagline, p: s.palette, r: s.root, m: s.mode, a: s.a4, j: s.just ? 1 : 0,
    g: [s.pace, s.evolve, s.bright, s.space].map(pct),
    l: LAYERS.filter((d) => s.layers[d.id].on).map((d) => [d.id, pct(s.layers[d.id].vol), pct(s.layers[d.id].ch)]),
  };
  const json = JSON.stringify(data);
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeScene(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = JSON.parse(new TextDecoder().decode(bytes));
    const layers = {};
    for (const def of LAYERS) layers[def.id] = L(false, 0.6, 0.5);
    for (const [id, v, c] of d.l || []) if (layers[id]) layers[id] = L(true, clamp(v / 100, 0, 1), clamp(c / 100, 0, 1));
    const [pace, evolve, bright, space] = (d.g || []).map((x) => clamp(x / 100, 0, 1));
    return {
      name: String(d.n || 'Shared Scene').slice(0, 48),
      tagline: String(d.t || 'a gift from a friend').slice(0, 80),
      palette: PALETTES[d.p] ? d.p : 'abyss',
      root: clamp(d.r | 0, 0, 11),
      mode: MODES[d.m] ? d.m : 'dorian',
      a4: d.a === 432 ? 432 : 440,
      just: !!d.j,
      pace: pace ?? 0.5, evolve: evolve ?? 0.5, bright: bright ?? 0.6, space: space ?? 0.6,
      layers,
    };
  } catch {
    return null;
  }
}
