// Procedural scene generation. A scene is the complete state of the
// instrument; everything in it can be generated, rerolled per section,
// mutated over time, and shared as a link.
import { LAYERS } from './layers/index.js';
import { MODES } from './theory.js';
import { GLOBAL_PARAMS, GLOBAL_SECTIONS, defaults, fill, pack, unpack } from './params.js';
import { seeded, clamp } from './util.js';
import { ANCHORS, ANCHOR_BY_ID, nudge } from './genome.js';
import { compose, packGenome, unpackGenome } from './generator.js';

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

// Moods are named places in the genome (js/genome.js), good places to start.
export const MOODS = ANCHORS.map((a) => ({ id: a.id, name: a.name, blurb: a.blurb, hidden: !!a.hidden }));
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

/* ─────────────────────────── the composer ───────────────────────────
 * Scenes come from generator.js: a point in the musical genome, realised by
 * principles and chosen by a critic. Moods are named places in that space.
 */
const TOUCH_FOR = { harp: 'pluck', piano: 'pluck', bells: 'bell', keys: 'bell', marimba: 'pluck', flute: 'voice', bowls: 'glass', arp: 'glass' };

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
  Object.assign(g, { revSize: Math.min(g.revSize, 0.35), revMix: Math.min(g.revMix, 0.45), revPre: Math.max(g.revPre, 0.5), bright: Math.max(g.bright, 0.78), drift: 0, cloud: Math.min(g.cloud ?? 0, 0.1), shimmer: 0 });
  // Harmony you can run to: a four-chord loop, a chord every four steps'
  // worth of bars (about six seconds), no surprise key changes. The running
  // arranger moves to a new loop and a neighbouring key every few minutes.
  Object.assign(g, { prog: 'loop', loopLen: 4, chordBars: 2, repetition: 1, modulate: 0 });
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
    const { revSize, revMix, revPre, bright, drift, pump, cloud, shimmer } = next.g;
    next.preRun = { revSize, revMix, revPre, bright, drift, pump, cloud, shimmer };
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

/*
 * opts: mood (an anchor to start near), energy, rhythm (true, false or
 * undefined to let the piece decide), shape (dimensions to hold), genome (a
 * whole genome to realise), bpm (for running).
 */
export function generateScene(seed, opts = {}) {
  const r = seeded(seed);
  const mood = opts.mood === 'run' ? 'run' : opts.mood;
  const c = compose(seed, { mood, energy: opts.energy, rhythm: mood === 'run' ? true : opts.rhythm, shape: opts.shape, genome: opts.genome, lean: opts.lean, bpm: mood === 'run' ? undefined : opts.tempo });
  const g = c.g;
  const lead = LAYERS.find((d) => c.roles[d.id] === 'lead');
  if (lead && TOUCH_FOR[lead.id]) g.touchVoice = TOUCH_FOR[lead.id];
  if (mood === 'run') makeRunnable(g, c.layers, r, opts.bpm);
  return {
    v: 2,
    name: makeName(r),
    tagline: makeTag(r),
    mood: mood === 'run' ? 'run' : c.mood,
    energy: c.energy,
    seed,
    palette: c.palette,
    root: c.root,
    mode: c.mode,
    a4: c.a4,
    just: c.just,
    g,
    layers: c.layers,
    roles: c.roles,
    genome: c.genome,
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
  // the same piece in character (its genome), realised afresh
  const fresh = generateScene(seed, { mood: state.mood, genome: state.genome, energy: state.energy, bpm: state.g.bpm, rhythm: !!state.g.beat, ...opts });
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
  if (!LAYERS.some((d) => next.layers[d.id].on)) {
    const bed = LAYERS.find((d) => fresh.layers[d.id].on && d.group === 'harmony') || LAYERS.find((d) => fresh.layers[d.id].on);
    next.layers[bed.id] = fresh.layers[bed.id];
  }
  next.roles = { ...(state.roles || {}) };
  for (const def of LAYERS) {
    if (!next.layers[def.id].on) delete next.roles[def.id];
    else if (next.layers[def.id] === fresh.layers[def.id] && fresh.roles[def.id]) next.roles[def.id] = fresh.roles[def.id];
  }
  next.name = fresh.name;
  next.tagline = fresh.tagline;
  return next;
}

// Journey mode: a step through the genome to a neighbouring piece, in a
// related key, so the drift feels like an album moving on rather than a
// channel changing. A chosen mood keeps pulling the walk back toward it.
export function mutateScene(s, seed, shape = {}) {
  const r = seeded(seed);
  let G = s.genome ? nudge(r, s.genome, 0.09) : null;
  const home = ANCHOR_BY_ID[s.mood];
  if (G && home) for (const [k, v] of Object.entries(home.at)) G[k] = G[k] + (v - G[k]) * 0.25;
  if (G) Object.assign(G, shape); // what the listener holds, stays
  if (G && s.g.beat) G.pulse = Math.max(G.pulse, 0.55);
  const next = generateScene(seed, { mood: s.mood, genome: G || undefined, rhythm: !!s.g.beat, bpm: s.g.bpm });
  if (!G) next.mood = s.mood;
  next.root = (s.root + r.pick([0, 5, 7, 7, 5, 2, 10])) % 12;
  if (r.chance(0.5)) next.mode = s.mode;
  if (r.chance(0.6)) next.palette = s.palette;
  if (s.mood === 'run') {
    next.g.bpm = s.g.bpm;
    for (const id of ['kick', 'shaker']) next.layers[id] = structuredClone(s.layers[id]);
  }
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
    kids: typeof s?.kids === 'string' ? s.kids.slice(0, 12) : undefined,
    preRun: s?.preRun && typeof s.preRun === 'object'
      ? Object.fromEntries(['revSize', 'revMix', 'revPre', 'bright', 'drift', 'pump', 'cloud', 'shimmer'].filter((k) => Number.isFinite(s.preRun[k])).map((k) => [k, clamp(s.preRun[k], 0, 1)]))
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
    roles: {},
    genome: s?.genome && typeof s.genome === 'object' ? unpackGenome(packGenome(s.genome)) : undefined,
  };
  for (const def of LAYERS) {
    const l = s?.layers?.[def.id];
    out.layers[def.id] = { on: !!l?.on, p: fill(l?.p, def.schema) };
    const role = s?.roles?.[def.id];
    if (out.layers[def.id].on && typeof role === 'string' && /^[a-z0-9]{1,10}$/.test(role)) out.roles[def.id] = role;
  }
  return out;
}

const b64 = {
  enc: (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

// Roles travel in share links as one digit per layer.
const ROLES = [null, 'bed', 'bed2', 'halo', 'lead', 'answer', 'bass', 'texture', 'texture2', 'kit'];
const ROLE_CODE = Object.fromEntries(ROLES.map((r, i) => [r, i]).filter(([r]) => r));

function sceneData(s) {
  return {
    v: 2, n: s.name, t: s.tagline, mo: s.mood, e: Math.round(s.energy * 100), p: s.palette, r: s.root, m: s.mode,
    pm: s.prevMood, sd: s.seed, pr: s.preRun, k: s.kids,
    gn: s.genome ? packGenome(s.genome) : undefined,
    ro: s.roles && Object.keys(s.roles).length ? LAYERS.map((d) => ROLE_CODE[s.roles[d.id]] ?? 0).join('') : undefined,
    a: s.a4, j: s.just ? 1 : 0,
    g: pack(s.g, GLOBAL_PARAMS),
    l: LAYERS.map((d, i) => (s.layers[d.id].on ? [i, ...pack(s.layers[d.id].p, d.schema)] : null)).filter(Boolean),
  };
}

export function encodeScene(s) {
  return b64.enc(JSON.stringify(sceneData(s)));
}

export function decodeScene(str) {
  try {
    return fromData(JSON.parse(b64.dec(str)));
  } catch {
    return null;
  }
}

/*
 * Share links: the same data, deflated, behind a readable slug of the
 * scene's name: "#amber-harbor.z…". Roughly a third of the old length.
 * Old "#s=…" links still open.
 */
const bytesToB64 = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64ToBytes = (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
export const slug = (name) => String(name || 'scene').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'scene';

export async function shareCode(s) {
  const json = JSON.stringify(sceneData(s));
  if (typeof CompressionStream === 'undefined') return `s=${b64.enc(json)}`;
  const z = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return `${slug(s.name)}.z${bytesToB64(z)}`;
}

export async function decodeShare(hash) {
  const old = hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (old) return decodeScene(old[1]);
  const m = hash.match(/\.z([A-Za-z0-9_-]+)/);
  if (!m || typeof DecompressionStream === 'undefined') return null;
  try {
    const raw = await pipe(b64ToBytes(m[1]), new DecompressionStream('deflate-raw'));
    return fromData(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    return null;
  }
}

function fromData(d) {
  try {
    if (!d || d.v !== 2) return null;
    const layers = {};
    for (const def of LAYERS) layers[def.id] = { on: false, p: defaults(def.schema) };
    for (const [i, ...vals] of d.l || []) {
      const def = LAYERS[i];
      if (def) layers[def.id] = { on: true, p: unpack(vals, def.schema) };
    }
    return normalize({
      name: d.n, tagline: d.t, mood: d.mo, energy: (d.e ?? 30) / 100, palette: d.p, root: d.r, mode: d.m,
      prevMood: d.pm, seed: d.sd, preRun: d.pr, kids: d.k,
      genome: unpackGenome(d.gn) || undefined,
      roles: typeof d.ro === 'string' ? Object.fromEntries(LAYERS.map((def, i) => [def.id, ROLES[+d.ro[i]]]).filter(([, v]) => v)) : undefined,
      a4: d.a, just: d.j, g: unpack(d.g, GLOBAL_PARAMS), layers,
    });
  } catch {
    return null;
  }
}
