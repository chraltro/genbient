// Procedural scene generation. A scene is the complete state of the
// instrument; everything in it can be generated, rerolled per section,
// mutated over time, and shared as a link.
import { LAYERS, LAYER_BY_ID, TONAL_ANCHORS } from './layers/index.js';
import { MODES } from './theory.js';
import { GLOBAL_PARAMS, GLOBAL_SECTIONS, defaults, fill, randomize, pack, unpack } from './params.js';
import { seeded, clamp, lerp } from './util.js';

// Each palette is ink on a ground, plus one accent used sparingly.
export const PALETTES = {
  slate: { name: 'Slate', bg: '#0f1417', ink: '#cdd6d6', accent: '#e0a458' },
  tide:  { name: 'Tide',  bg: '#0b1419', ink: '#c6d8de', accent: '#6fb7c9' },
  moss:  { name: 'Moss',  bg: '#11150f', ink: '#d0d6c2', accent: '#d9b44a' },
  ember: { name: 'Ember', bg: '#161010', ink: '#e8d6c4', accent: '#e2583e' },
  dusk:  { name: 'Dusk',  bg: '#15111a', ink: '#ddd0dc', accent: '#e8957a' },
  sand:  { name: 'Sand',  bg: '#17130d', ink: '#eadcc4', accent: '#c8763a' },
  fog:   { name: 'Fog',   bg: '#121516', ink: '#d4dadb', accent: '#9fb8a8' },
  night: { name: 'Night', bg: '#0a0d14', ink: '#c4cbe0', accent: '#d8c07a' },
  plum:  { name: 'Plum',  bg: '#120f17', ink: '#d8d0e6', accent: '#e0795a' },
  rose:  { name: 'Rose',  bg: '#170f10', ink: '#efd9d6', accent: '#d4574b' },
  jade:  { name: 'Jade',  bg: '#0c1513', ink: '#cfe3dc', accent: '#5fb39a' },
  paper: { name: 'Paper', bg: '#ebe5d8', ink: '#2b2724', accent: '#b8432f', light: true },
  frost: { name: 'Frost', bg: '#e9eef0', ink: '#24303a', accent: '#3d78ad', light: true },
};
const PALETTE_ALIAS = { abyss: 'tide', aurora: 'jade', forest: 'moss', glacier: 'frost', lotus: 'plum', cosmos: 'plum', mist: 'fog' };
export const paletteId = (id) => (PALETTES[id] ? id : PALETTES[PALETTE_ALIAS[id]] ? PALETTE_ALIAS[id] : 'slate');

export const MOODS = [
  { id: 'oceanic', name: 'Oceanic', palettes: ['tide', 'night', 'frost', 'jade'], modes: ['dorian', 'aeolian', 'lydian', 'majpent'], energy: [0.05, 0.4],
    likes: { ocean: 3, drone: 2, pad: 3, shimmer: 2, bells: 1.5, wind: 1, choir: 1, strings: 1, bass: 1, marimba: 0.8 } },
  { id: 'sylvan', name: 'Forest', palettes: ['moss', 'fog', 'jade', 'paper'], modes: ['majpent', 'ionian', 'mixolydian', 'yo', 'dorian'], energy: [0.15, 0.55],
    likes: { birds: 3, stream: 3, keys: 2.5, pad: 2, flute: 2, wind: 1, rain: 1, marimba: 1.5, wood: 1.2, handdrum: 1 } },
  { id: 'sacred', name: 'Sacred', palettes: ['sand', 'ember', 'plum'], modes: ['insen', 'hirajoshi', 'hijaz', 'phrygian', 'dorian'], energy: [0, 0.35],
    likes: { bowls: 3, drone: 3, choir: 2.5, flute: 1.5, bells: 1.5, fire: 1, pulse: 1, strings: 1 } },
  { id: 'celestial', name: 'Celestial', palettes: ['plum', 'jade', 'night', 'plum'], modes: ['lydian', 'ionian', 'majpent', 'lydian'], energy: [0, 0.45],
    likes: { shimmer: 3, pad: 3, choir: 2, drone: 2, bells: 2, strings: 2, arp: 1.5, binaural: 1 } },
  { id: 'stormy', name: 'Storm', palettes: ['fog', 'night', 'tide'], modes: ['aeolian', 'phrygian', 'dorian', 'minpent', 'harmonic'], energy: [0.1, 0.5],
    likes: { rain: 3, thunder: 2.5, wind: 2, drone: 2, pad: 2, piano: 1.5, strings: 1.5, bass: 1 } },
  { id: 'nocturne', name: 'Nocturne', palettes: ['night', 'dusk', 'plum'], modes: ['aeolian', 'dorian', 'minpent', 'hirajoshi', 'melodic'], energy: [0.1, 0.5],
    likes: { night: 3, piano: 2.5, keys: 1.5, pad: 2, flute: 2, drone: 1.5, stream: 1, bass: 1 } },
  { id: 'hearth', name: 'Hearth', palettes: ['ember', 'slate', 'sand', 'paper'], modes: ['mixolydian', 'dorian', 'majpent', 'ionian'], energy: [0.1, 0.5],
    likes: { fire: 3, piano: 2, pad: 2, keys: 2, drone: 1.5, rain: 1.5, pulse: 1, strings: 1 } },
  { id: 'downtempo', name: 'Downtempo', palettes: ['dusk', 'plum', 'rose', 'jade', 'night'], modes: ['dorian', 'aeolian', 'minpent', 'mixolydian', 'melodic'], energy: [0.55, 0.9],
    likes: { kick: 3, shaker: 2.5, bass: 3, pad: 2.5, arp: 2, piano: 2, keys: 1.5, marimba: 1.5, handdrum: 1.2, wood: 1, rain: 1 } },
  { id: 'ritual', name: 'Ritual', palettes: ['ember', 'sand', 'moss'], modes: ['phrygian', 'hijaz', 'insen', 'minpent', 'dorian'], energy: [0.45, 0.85],
    likes: { handdrum: 3, drone: 3, wood: 2, flute: 2, bowls: 1.5, fire: 1.5, shaker: 1.5, choir: 1, pulse: 1 } },
  { id: 'lofi', name: 'Lo-fi', palettes: ['rose', 'paper', 'fog', 'sand'], modes: ['dorian', 'ionian', 'mixolydian', 'aeolian'], energy: [0.45, 0.8],
    likes: { piano: 3, kick: 2.5, shaker: 2, bass: 2.5, rain: 2, keys: 1.5, pad: 1.5, wood: 1 }, g: { warmth: [0.4, 0.8], wow: [0.25, 0.6], bright: [0.3, 0.55], swing: [0.2, 0.45], complexity: [0.5, 0.95] } },
  { id: 'glacial', name: 'Glacial', palettes: ['frost', 'fog', 'tide', 'slate'], modes: ['lydian', 'majpent', 'ionian', 'yo'], energy: [0, 0.3],
    likes: { strings: 2.5, shimmer: 2.5, pad: 2, wind: 2, bells: 1.5, keys: 1.5, drone: 1.5, noise: 0.8 } },
  { id: 'run', name: 'Running', palettes: ['ember', 'slate', 'paper', 'dusk'], modes: ['dorian', 'aeolian', 'minpent', 'mixolydian', 'ionian'], energy: [0.85, 0.95],
    likes: { kick: 4, shaker: 3, bass: 3, arp: 2.5, pad: 2, handdrum: 1.5, strings: 1.2, keys: 1, wood: 0.8, rain: 0.5 },
    g: { meter: '4/4', swing: [0, 0.04], humanize: [0.03, 0.12], evolve: [0.1, 0.25], chordBars: 2, rests: [0.25, 0.5], density: [0.35, 0.55] } },
  { id: 'sleep', name: 'Sleep', palettes: ['night', 'tide', 'fog'], modes: ['aeolian', 'dorian', 'majpent', 'lydian'], energy: [0, 0.15],
    likes: { drone: 3, pad: 3, ocean: 2, noise: 2, binaural: 2, rain: 1.5, strings: 1, bowls: 1.5, piano: 1, shimmer: 1.2 }, g: { bright: [0.15, 0.4], bpm: [44, 60], density: [0.1, 0.35], chordBars: [4, 8] } },
];
export const MOOD_BY_ID = Object.fromEntries(MOODS.map((m) => [m.id, m]));

const ADJ = ['Silent', 'Hollow', 'Amber', 'Silver', 'Distant', 'Velvet', 'Tidal', 'Drifting', 'Luminous', 'Quiet',
  'Ancient', 'Soft', 'Evening', 'Morning', 'Glass', 'Moss', 'Salt', 'Cloud', 'Ember', 'Low', 'Slow', 'Pale',
  'Hidden', 'Golden', 'Blue', 'Northern', 'Sleeping', 'Weightless', 'Faint', 'Deep', 'Wandering', 'Still',
  'Copper', 'Indigo', 'Warm', 'Lucid', 'Open', 'Tender', 'Midnight', 'Lantern', 'Paper', 'Cedar'];
const NOUN = ['Harbor', 'Canopy', 'Meadow', 'Orbit', 'Monastery', 'Lagoon', 'Tide', 'Cathedral', 'Valley',
  'Garden', 'Current', 'Horizon', 'Lantern', 'Glacier', 'Reverie', 'Driftwood', 'Nebula', 'Grove', 'Shoreline',
  'Hours', 'Fields', 'Echoes', 'Rooms', 'Pines', 'Lanterns', 'Waters', 'Embers', 'Clouds', 'Island', 'Hollow',
  'Moon', 'Delta', 'Cloister', 'Estuary', 'Aurora', 'Sanctuary', 'Station', 'Weather', 'Rituals', 'Streets', 'Tapes'];
const TAG_A = ['breathing', 'drifting', 'unfolding', 'dissolving', 'turning', 'resting', 'glowing', 'wandering', 'settling', 'swaying', 'humming'];
const TAG_B = ['slowly', 'without end', 'in the half-light', 'far from anywhere', 'under soft rain', 'beyond the tide line',
  'at the edge of sleep', 'in no hurry', 'like weather', 'with the stars', 'in time with you', 'after midnight'];

function makeName(r) {
  const a = r.pick(ADJ);
  let n = r.pick(NOUN);
  while (n === a) n = r.pick(NOUN);
  const plural = NOUN.filter((x) => x.endsWith('s'));
  return r.chance(0.18) ? `${r.pick(NOUN.filter((x) => !x.endsWith('s')))} of ${r.pick(plural)}` : `${a} ${n}`;
}
const makeTag = (r) => `${r.pick(TAG_A)} ${r.pick(TAG_B)}`;

const offLayer = (def) => ({ on: false, p: defaults(def.schema) });

function layerParams(def, r, vol) {
  const p = randomize(def.schema, r, defaults(def.schema));
  p.vol = vol;
  return p;
}

function chooseLayers(r, mood, energy, rhythmMode) {
  const likes = mood.likes;
  const chosen = new Set();
  const w = (id) => likes[id] || 0.3;
  const byGroup = (g) => LAYERS.filter((l) => l.group === g).map((l) => l.id);

  const anchors = TONAL_ANCHORS;
  chosen.add(r.weighted(anchors, anchors.map((id) => w(id) + 0.2)));
  if (r.chance(0.45)) chosen.add(r.weighted(anchors, anchors.map((id) => w(id))));

  const rhythm = byGroup('rhythm');
  if (rhythmMode !== false && (rhythmMode === 'force' || r.chance(clamp(energy * 1.3, 0, 0.95)))) {
    const n = 1 + Math.round(energy * 2.2 * r.float(0.5, 1));
    const pool = [...rhythm];
    for (let i = 0; i < n && pool.length; i++) {
      const id = r.weighted(pool, pool.map((x) => w(x)));
      chosen.add(id);
      pool.splice(pool.indexOf(id), 1);
    }
    if (energy > 0.5 && r.chance(0.7)) chosen.add('bass');
  }
  const melody = byGroup('melody');
  const nm = energy < 0.12 ? r.int(0, 1) : r.int(1, 2);
  for (let i = 0; i < nm; i++) chosen.add(r.weighted(melody, melody.map((id) => w(id))));

  const texture = [...byGroup('nature'), ...byGroup('mind')];
  const nt = r.chance(0.8) ? r.int(1, 2) : 0;
  for (let i = 0; i < nt; i++) chosen.add(r.weighted(texture, texture.map((id) => w(id) * (id === 'binaural' ? 0.4 : 1))));
  // seven layers at most: past that the mix turns to soup. Weather goes first, then extra percussion.
  // the mood's least-loved textures go first, so a storm keeps its rain
  const order = [...[...texture].sort((a, b) => w(a) - w(b)), 'wood', 'handdrum', 'pulse', 'shaker'];
  for (const id of order) if (chosen.size > 7 && chosen.has(id)) chosen.delete(id);
  return chosen;
}

function applyMoodBias(g, mood, r, energy) {
  g.bpm = Math.round(clamp(lerp(50, 104, energy) + r.float(-8, 8), 40, 190));
  g.density = clamp(lerp(0.25, 0.75, energy) + r.float(-0.12, 0.12), 0, 1);
  if (energy < 0.3) g.swing = Math.min(g.swing, 0.15);
  for (const [k, v] of Object.entries(mood.g || {})) {
    g[k] = Array.isArray(v) ? (Number.isInteger(v[0]) && v[0] > 1 ? r.int(v[0], v[1]) : r.float(v[0], v[1])) : v;
  }
  if (typeof g.chordBars === 'number' && ![1, 2, 4, 8].includes(g.chordBars)) g.chordBars = g.chordBars > 5 ? 8 : 4;
  g.touchMode = 'both';
}

// Running needs a beat you can step to: kick on every beat, hats on the
// off-beats, a pulsing bass, all at the chosen cadence and never skipping.
export const CADENCES = [150, 155, 160, 165, 170, 175, 180];
function makeRunnable(g, layers, r, bpm) {
  g.bpm = bpm || r.pick([160, 165, 170]);
  g.meter = '4/4';
  g.beat = true;
  g.halfTime = true;
  g.pump = r.float(0.3, 0.4);
  // a tight room: short reverb, echoes that don't blur the steps, bright enough for the hats
  Object.assign(g, { revSize: Math.min(g.revSize, 0.35), revMix: Math.min(g.revMix, 0.45), revPre: Math.max(g.revPre, 0.5), bright: Math.max(g.bright, 0.78), drift: 0 });
  // Harmony you can run to: one repeating four-chord loop, each chord held
  // for about twenty seconds, no key changes, no surprises.
  Object.assign(g, { prog: 'loop', loopLen: 4, chordBars: 8, repetition: 1, modulate: 0 });
  // Everything on the step grid: no swing, no looseness, straight echoes.
  Object.assign(g, { swing: 0, humanize: 0.02, dlyDiv: r.pick([0.5, 0.5, 1, 0.25]) });
  g.density = Math.min(g.density, 0.5);
  const on = (id, p) => { layers[id] = { on: true, p: { ...layers[id].p, ...p } }; };
  on('kick', { vol: 0.62, rev: 0, dly: 0, steps: 16, hits: 4, rotate: 0, prob: 1, ghost: 0, punch: r.float(0.5, 0.8), click: r.float(0.3, 0.6), decay: r.float(0.25, 0.4), pitch: r.float(46, 58) });
  on('shaker', { vol: 0.48, tone: 0.95, rev: 0.1, dly: 0, steps: 16, hits: 4, rotate: 2, prob: 1, ghost: 0.12, kind: r.pick(['hat', 'shaker', 'hat']), decay: r.float(0.6, 1.2), open: r.float(0, 0.15) });
  on('bass', { vol: 0.5, pattern: r.pick(['pulse', 'pulse', 'roots', 'synco']), glide: r.float(0, 0.15) });
  if (layers.handdrum.on) Object.assign(layers.handdrum.p, { prob: 1, steps: 16 });
  layers.binaural.on = false;
}

export function runify(state, cadence, seed) {
  const next = structuredClone(state);
  if (next.mood !== 'run') {
    next.prevMood = next.mood;
    // remember the room, to give it back when the run ends
    const { revSize, revMix, revPre, bright, drift, pump } = next.g;
    next.preRun = { revSize, revMix, revPre, bright, drift, pump };
  }
  next.mood = 'run';
  makeRunnable(next.g, next.layers, seeded(seed), cadence);
  // makeRunnable assumes a freshly generated scene; keep the user's other choices
  return next;
}

// Leave running mode: drop the running beat, keep everything else.
export function unrun(state) {
  const next = structuredClone(state);
  next.mood = MOOD_BY_ID[next.prevMood] ? next.prevMood : 'oceanic';
  next.g.halfTime = false;
  next.g.bpm = Math.round(clamp(next.g.bpm / 2, 50, 96));
  next.layers.kick.on = false;
  next.layers.shaker.on = false;
  if (next.preRun) Object.assign(next.g, next.preRun);
  delete next.preRun;
  return next;
}

export function generateScene(seed, opts = {}) {
  const r = seeded(seed);
  // Running is opt-in: it never turns up by chance in an ambient session.
  const mood = MOOD_BY_ID[opts.mood] || r.pick(MOODS.filter((m) => m.id !== 'run'));
  const energy = opts.energy ?? r.float(...mood.energy);
  const g = randomize(GLOBAL_PARAMS, r, defaults(GLOBAL_PARAMS));
  applyMoodBias(g, mood, r, energy);

  const chosen = chooseLayers(r, mood, energy, opts.rhythm);
  g.beat = opts.rhythm !== false;
  const layers = {};
  for (const def of LAYERS) {
    if (!chosen.has(def.id)) { layers[def.id] = offLayer(def); continue; }
    const like = mood.likes[def.id] || 0.5;
    let vol = clamp(r.float(0.35, 0.6) + like * 0.05, 0.2, 0.85);
    if (def.group === 'rhythm') vol *= lerp(0.7, 1.05, energy);
    if (def.id === 'binaural') vol = r.float(0.25, 0.45);
    layers[def.id] = { on: true, p: layerParams(def, r, vol) };
  }
  // a little more drive in rhythmic moods
  if (layers.kick.on && energy > 0.6) layers.kick.p.hits = r.pick([4, 4, 3, 2]);
  // two melodies take turns instead of talking over each other
  if (LAYERS.filter((d) => d.group === 'melody' && layers[d.id].on).length > 1) g.callResponse = true;
  if (layers.bass.on) layers.bass.p.oct = 0;
  if (mood.id === 'run') makeRunnable(g, layers, r, opts.bpm);

  return {
    v: 2,
    name: makeName(r),
    tagline: makeTag(r),
    mood: mood.id,
    energy,
    seed,
    palette: r.pick(mood.palettes),
    root: r.int(0, 11),
    mode: r.pick(mood.modes.filter((m) => MODES[m])),
    a4: r.chance(0.25) ? 432 : 440,
    just: r.chance(0.2),
    g,
    layers,
  };
}

/* ─── section rerolls: regenerate one aspect, keep the rest ─── */

export const SECTIONS = [
  { id: 'harmony', name: 'Harmony', hint: 'key, scale, chords' },
  { id: 'rhythm', name: 'Rhythm', hint: 'tempo, groove, drums' },
  { id: 'melody', name: 'Melody', hint: 'instruments & motifs' },
  { id: 'texture', name: 'Texture', hint: 'weather & nature' },
  { id: 'sound', name: 'Sound', hint: 'space, tone, effects' },
  { id: 'palette', name: 'Colours', hint: 'visual palette' },
];

const secIds = (id) => (GLOBAL_SECTIONS.find((s) => s.id === id)?.params || []).map((p) => p.id);

export function rerollSection(state, section, seed, opts = {}) {
  const fresh = generateScene(seed, { mood: state.mood, energy: state.energy, bpm: state.g.bpm, rhythm: state.g.beat === false ? false : undefined, ...opts });
  const next = structuredClone(state);
  const copyG = (ids) => ids.forEach((id) => { next.g[id] = fresh.g[id]; });
  const copyGroup = (groups) => {
    for (const def of LAYERS) if (groups.includes(def.group)) next.layers[def.id] = fresh.layers[def.id];
  };
  switch (section) {
    case 'harmony':
      Object.assign(next, { root: fresh.root, mode: fresh.mode, a4: fresh.a4, just: fresh.just });
      copyG(secIds('harmony'));
      break;
    case 'rhythm':
      copyG(secIds('time').filter((id) => id !== 'beat'));
      copyGroup(['rhythm']);
      next.layers.bass = fresh.layers.bass;
      break;
    case 'melody':
      copyG(secIds('melody'));
      copyGroup(['melody']);
      break;
    case 'texture':
      copyGroup(['nature', 'mind']);
      break;
    case 'sound':
      copyG([...secIds('space'), ...secIds('colour')]);
      for (const def of LAYERS) {
        const f = fresh.layers[def.id].p;
        for (const k of ['tone', 'rev', 'dly', 'pan']) next.layers[def.id].p[k] = f[k];
      }
      break;
    case 'palette':
      next.palette = fresh.palette === state.palette ? seeded(seed + 1).pick(Object.keys(PALETTES)) : fresh.palette;
      return next;
  }
  if (!LAYERS.some((d) => next.layers[d.id].on)) next.layers.pad = fresh.layers.pad.on ? fresh.layers.pad : { on: true, p: layerParams(LAYER_BY_ID.pad, seeded(seed), 0.5) };
  next.name = fresh.name;
  next.tagline = fresh.tagline;
  return next;
}

// Journey mode: a gentle step away from the current scene, not a jump.
export function mutateScene(s, seed) {
  const r = seeded(seed);
  const next = structuredClone(s);
  const on = LAYERS.filter((l) => next.layers[l.id].on).map((l) => l.id);
  const off = LAYERS.filter((l) => !next.layers[l.id].on && l.id !== 'binaural' && !(l.group === 'rhythm' && next.g.beat === false)).map((l) => l.id);
  if (on.length > 2 && r.chance(0.7)) next.layers[r.pick(on)].on = false;
  if (off.length && (on.length < 5 || r.chance(0.5))) {
    const id = r.pick(off);
    next.layers[id] = { on: true, p: layerParams(LAYER_BY_ID[id], r, r.float(0.3, 0.6)) };
  }
  for (const id of on) {
    const def = LAYER_BY_ID[id];
    const p = next.layers[id].p;
    for (const prm of def.schema) {
      if (prm.type !== 'range' || prm.keep || !r.chance(0.3)) continue;
      const span = prm.max - prm.min;
      let v = clamp(p[prm.id] + r.float(-0.15, 0.15) * span, prm.min, prm.max);
      if (prm.step >= 1) v = Math.round(v);
      p[prm.id] = v;
    }
  }
  if (!TONAL_ANCHORS.some((id) => next.layers[id].on)) next.layers.pad = { on: true, p: layerParams(LAYER_BY_ID.pad, r, 0.5) };
  if (r.chance(0.5)) next.root = (next.root + r.pick([5, 7])) % 12;
  if (r.chance(0.25)) next.mode = r.pick(Object.keys(MODES).filter((m) => m !== 'whole'));
  if (r.chance(0.5)) next.palette = r.pick(Object.keys(PALETTES));
  next.g.bright = clamp(next.g.bright + r.float(-0.1, 0.1), 0.2, 0.85);
  // a running scene keeps its cadence and its beat; everything else may drift
  if (s.mood !== 'run') next.g.bpm = Math.round(clamp(next.g.bpm + r.float(-6, 6), 40, 200));
  else for (const id of ['kick', 'shaker']) next.layers[id] = structuredClone(s.layers[id]);
  next.name = makeName(r);
  next.tagline = makeTag(r);
  return next;
}

/* ─── curated starting points: named seeds through the same generator ─── */

export const STARTS = [
  { name: 'Still Water', mood: 'oceanic', seed: 1107, energy: 0.1 },
  { name: 'Forest Dawn', mood: 'sylvan', seed: 2203, energy: 0.35 },
  { name: 'Temple', mood: 'sacred', seed: 3319, energy: 0.15 },
  { name: 'Night Drive', mood: 'downtempo', seed: 4421, energy: 0.75 },
  { name: 'Aurora', mood: 'celestial', seed: 5501, energy: 0.2 },
  { name: 'Monsoon', mood: 'stormy', seed: 6607, energy: 0.35 },
  { name: 'Hearth', mood: 'hearth', seed: 7717, energy: 0.3 },
  { name: 'Fire Circle', mood: 'ritual', seed: 8803, energy: 0.7 },
  { name: 'Rainy Tapes', mood: 'lofi', seed: 9901, energy: 0.6 },
  { name: 'Snowfall', mood: 'glacial', seed: 1013, energy: 0.1 },
  { name: 'Deep Sleep', mood: 'sleep', seed: 1123, energy: 0.02 },
  { name: 'Long Run', mood: 'run', seed: 1301, energy: 0.9 },
  { name: 'Moth Hour', mood: 'nocturne', seed: 1229, energy: 0.3 },
];

export function startScene(s) {
  const scene = generateScene(s.seed, { mood: s.mood, energy: s.energy });
  scene.name = s.name;
  return scene;
}

/* ─── normalising & share links ─── */

export function normalize(s) {
  const out = {
    v: 2,
    name: String(s?.name || 'Untitled').slice(0, 48),
    tagline: String(s?.tagline || '').slice(0, 80),
    mood: MOOD_BY_ID[s?.mood] ? s.mood : 'oceanic',
    prevMood: MOOD_BY_ID[s?.prevMood] ? s.prevMood : undefined,
    preRun: s?.preRun && typeof s.preRun === 'object'
      ? Object.fromEntries(['revSize', 'revMix', 'revPre', 'bright', 'drift', 'pump'].filter((k) => Number.isFinite(s.preRun[k])).map((k) => [k, clamp(s.preRun[k], 0, 1)]))
      : undefined,
    energy: clamp(Number(s?.energy) || 0.3, 0, 1),
    seed: s?.seed >>> 0,
    palette: paletteId(s?.palette),
    root: clamp((s?.root | 0), 0, 11),
    mode: MODES[s?.mode] ? s.mode : 'dorian',
    a4: s?.a4 === 432 ? 432 : 440,
    just: !!s?.just,
    g: fill(s?.g, GLOBAL_PARAMS),
    layers: {},
  };
  for (const def of LAYERS) {
    const l = s?.layers?.[def.id];
    out.layers[def.id] = { on: !!l?.on, p: fill(l?.p, def.schema) };
  }
  return out;
}

const b64 = {
  enc: (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

export function encodeScene(s) {
  const data = {
    v: 2, n: s.name, t: s.tagline, mo: s.mood, e: Math.round(s.energy * 100), p: s.palette, r: s.root, m: s.mode,
    pm: s.prevMood, sd: s.seed, pr: s.preRun,
    a: s.a4, j: s.just ? 1 : 0,
    g: pack(s.g, GLOBAL_PARAMS),
    l: LAYERS.map((d, i) => (s.layers[d.id].on ? [i, ...pack(s.layers[d.id].p, d.schema)] : null)).filter(Boolean),
  };
  return b64.enc(JSON.stringify(data));
}

export function decodeScene(str) {
  try {
    const d = JSON.parse(b64.dec(str));
    if (d.v !== 2) return null;
    const layers = {};
    for (const def of LAYERS) layers[def.id] = { on: false, p: defaults(def.schema) };
    for (const [i, ...vals] of d.l || []) {
      const def = LAYERS[i];
      if (def) layers[def.id] = { on: true, p: unpack(vals, def.schema) };
    }
    return normalize({
      name: d.n, tagline: d.t, mood: d.mo, energy: (d.e ?? 30) / 100, palette: d.p, root: d.r, mode: d.m,
      prevMood: d.pm, seed: d.sd, preRun: d.pr,
      a4: d.a, just: d.j, g: unpack(d.g, GLOBAL_PARAMS), layers,
    });
  } catch {
    return null;
  }
}
