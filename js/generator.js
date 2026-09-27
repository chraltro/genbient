/*
 * The composer: from a point in the musical genome (genome.js) to a scene.
 *
 * Nothing here is a template. A genome is realised by principles:
 *   · sounds are chosen by how well their character (brightness, touch,
 *     material, register) fits what the piece asks for, then shaped
 *     continuously from the genome, so no two uses of a sound are the same;
 *   · how many voices play is held to what a listener can follow (about
 *     three to four streams at once);
 *   · every setting of tempo, harmony, melody, space and colour is a function
 *     of the genome, not a pick from a list;
 *   · drum patterns are chosen by measured syncopation, not by name.
 * Then a critic listens (in principle) to many realisations of the same seed
 * and keeps the one that best meets what research says makes music pleasant:
 * a clear figure on a ground, voices that don't mask each other, a rate of
 * events that suits the tempo of feeling, grooves that are neither square
 * nor chaotic, sounds that belong together, and a mix that isn't mud.
 * The same seed always gives the same scene.
 */
import { LAYERS, LAYER_BY_ID } from './layers/index.js';
import { MODES } from './theory.js';
import { GLOBAL_PARAMS, METERS, defaults } from './params.js';
import { seeded, clamp, lerp } from './util.js';
import { euclid } from './composer.js';
import { PRESETS } from './sounds.js';
import { DIM_IDS, ANCHORS, ANCHOR_BY_ID, sampleGenome, nudge } from './genome.js';

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const bump = (x, c, w) => Math.exp(-((x - c) ** 2) / (2 * w * w));
const mix = (a, b, k) => a + (b - a) * k;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

// Choose among options by score, with seeded noise: the best usually wins,
// close seconds often do. temp sets how adventurous the choice is.
function choose(r, items, score, temp = 0.15) {
  let best = null;
  let bestV = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (!Number.isFinite(s)) continue;
    const u = Math.max(1e-9, r.next());
    const v = s / temp - Math.log(-Math.log(u));
    if (v > bestV) { bestV = v; best = it; }
  }
  return best;
}

/* ─────────────────────────── the sound library ───────────────────────────
 * Each designed sound, described by what a listener hears:
 *   b brightness · a attack (0 swells, 1 struck) · o material (0 electronic,
 *   1 acoustic) · reg register (0 deep, 1 high) · x how exotic it sounds.
 *   Pads count as fairly acoustic: in ambient music they read as air, not
 *   as machines. roles: what each can do.
 */
const V = (id, roles, b, a, o, reg, x = 0.1) => { const [layer, name] = id.split('.'); return { id, layer, name, roles: roles.split(' '), b, a, o, reg, x }; };
export const VOICES = [
  V('pad.warm', 'bed', 0.35, 0.1, 0.45, 0.45),
  V('pad.glass', 'bed halo', 0.6, 0.15, 0.35, 0.55),
  V('pad.air', 'bed halo', 0.55, 0.05, 0.45, 0.6),
  V('pad.velvet', 'bed', 0.2, 0.1, 0.5, 0.4),
  V('pad.organ', 'bed', 0.35, 0.2, 0.6, 0.45),
  V('pad.hollow', 'bed', 0.4, 0.15, 0.25, 0.45, 0.35),
  V('pad.analog', 'bed', 0.5, 0.2, 0.05, 0.45),
  V('drone.deep', 'bed', 0.2, 0.05, 0.3, 0.15, 0.2),
  V('drone.choral', 'bed', 0.3, 0.05, 0.5, 0.3, 0.3),
  V('drone.tanpura', 'bed', 0.5, 0.1, 0.85, 0.3, 0.75),
  V('drone.hum', 'bed', 0.1, 0.05, 0.3, 0.1),
  V('drone.space', 'bed', 0.4, 0.05, 0, 0.3, 0.6),
  V('strings.section', 'bed', 0.45, 0.25, 0.9, 0.5),
  V('strings.cello', 'bed', 0.3, 0.3, 0.95, 0.3),
  V('strings.high', 'bed halo', 0.6, 0.2, 0.9, 0.75),
  V('strings.distant', 'bed', 0.35, 0.1, 0.85, 0.5),
  V('choir.ooh', 'bed halo', 0.3, 0.1, 0.9, 0.55, 0.25),
  V('choir.aah', 'bed halo', 0.5, 0.1, 0.9, 0.6, 0.3),
  V('choir.monks', 'bed', 0.2, 0.05, 0.95, 0.25, 0.5),
  V('shimmer.glints', 'halo', 0.75, 0.35, 0.2, 0.9, 0.2),
  V('shimmer.aurora', 'halo', 0.65, 0.15, 0.2, 0.85),
  V('piano.felt', 'lead answer', 0.3, 0.7, 0.8, 0.5),
  V('piano.grand', 'lead answer', 0.55, 0.8, 0.75, 0.5),
  V('piano.upright', 'lead', 0.45, 0.8, 0.85, 0.5),
  V('keys.kalimba', 'lead answer', 0.55, 0.9, 0.9, 0.6),
  V('keys.music_box', 'lead answer', 0.8, 0.95, 0.6, 0.85),
  V('bells.glass', 'lead answer halo', 0.7, 0.75, 0.3, 0.8),
  V('bells.temple', 'lead answer', 0.45, 0.7, 0.6, 0.6, 0.45),
  V('bells.chime', 'answer', 0.8, 0.85, 0.5, 0.85),
  V('bells.soft', 'lead answer', 0.35, 0.6, 0.4, 0.65),
  V('marimba.soft', 'lead answer', 0.35, 0.85, 1, 0.5),
  V('marimba.wood', 'lead answer', 0.55, 0.95, 1, 0.5),
  V('arp.pluck', 'lead answer', 0.5, 0.9, 0.2, 0.55),
  V('arp.sequence', 'answer', 0.7, 0.95, 0, 0.5, 0.2),
  V('arp.glass', 'lead answer', 0.55, 0.75, 0.15, 0.65),
  V('flute.flute', 'lead answer', 0.5, 0.35, 0.9, 0.7),
  V('flute.shakuhachi', 'lead', 0.35, 0.35, 1, 0.55, 0.65),
  V('flute.ocarina', 'lead answer', 0.4, 0.35, 0.8, 0.65),
  V('bowls.tibetan', 'lead answer', 0.4, 0.6, 0.95, 0.45, 0.6),
  V('harp.harp', 'lead answer', 0.5, 0.8, 0.95, 0.6),
  V('harp.nylon', 'lead answer', 0.35, 0.8, 0.9, 0.45),
  V('harp.steel', 'lead answer', 0.65, 0.85, 0.8, 0.5),
  V('harp.koto', 'lead answer', 0.7, 0.85, 0.95, 0.55, 0.6),
];

// The world outside: w element (0 fire … 1 sea), life, and the light it belongs to.
const N = (id, w, life, light, x = {}) => { const [layer, name] = id.split('.'); return { id, layer, name, w, life, light, ...x }; };
export const NATURE = [
  N('rain.gentle', 0.75, 0.1, 0.5), N('rain.steady', 0.8, 0.05, 0.3), N('rain.roof', 0.72, 0.05, 0.4, { indoor: 1 }),
  N('rain.window', 0.75, 0.05, 0.45, { indoor: 1 }), N('ocean.calm', 1, 0.1, 0.6), N('ocean.waves', 0.95, 0.1, 0.55),
  N('stream.brook', 0.6, 0.5, 0.65), N('stream.river', 0.62, 0.3, 0.5), N('wind.breeze', 0.45, 0.1, 0.6),
  N('wind.high', 0.42, 0, 0.75), N('fire.hearth', 0, 0.1, 0.45, { indoor: 1 }), N('birds.dawn', 0.4, 1, 0.8),
  N('birds.distant', 0.4, 0.7, 0.65), N('birds.owls', 0.35, 0.6, 0.15), N('night.crickets', 0.3, 0.8, 0.2),
  N('night.pond', 0.6, 0.85, 0.25),
];

// Anchors may lean toward sounds that make their name true. A lean is a
// nudge in the fit, not a rule: a Forest can still be played on a piano.
const LEAN = {
  airport: { piano: 0.5 }, rainpiano: { piano: 0.9, rain: 0.8 }, sacred: { bowls: 0.6, drone: 0.5 },
  celestial: { choir: 0.4, shimmer: 0.3 }, oceanic: { ocean: 0.9 }, sylvan: { birds: 0.7, stream: 0.3 },
  stormy: { rain: 0.8, thunder: 1 }, nocturne: { night: 0.6, piano: 0.3 }, hearth: { fire: 1 },
  glacial: { wind: 0.6, bells: 0.3 }, space: { drone: 0.4 }, pulse: { marimba: 0.6 }, postrock: { strings: 0.5, harp: 0.5 },
  downtempo: { piano: 0.2 }, lofi: { piano: 0.7, rain: 0.3 }, ritual: { flute: 0.5, drone: 0.4 }, sleep: { ocean: 0.3 },
};

// Where each scale sits between dark and bright, familiar and strange.
const MODE_AT = {
  lydian: [0.95, 0.35], ionian: [0.8, 0], majpent: [0.75, 0.05], mixolydian: [0.65, 0.15], yo: [0.65, 0.45],
  dorian: [0.5, 0.1], minpent: [0.4, 0.1], melodic: [0.45, 0.45], aeolian: [0.3, 0.05], harmonic: [0.2, 0.5],
  hirajoshi: [0.3, 0.65], phrygian: [0.15, 0.45], insen: [0.25, 0.7], hijaz: [0.2, 0.8], whole: [0.7, 1.2],
};

// Palettes by lightness of mood, warmth and hue family.
const PALETTE_AT = {
  slate: [0.4, 0.45, 0], tide: [0.45, 0.1, 0.8], moss: [0.45, 0.55, 0.5], ember: [0.35, 0.95, 0], dusk: [0.35, 0.7, 0.2],
  sand: [0.55, 0.8, 0], fog: [0.55, 0.4, 0.3], night: [0.15, 0.3, 0.4], plum: [0.35, 0.55, 0.3], rose: [0.45, 0.75, 0.1],
  jade: [0.55, 0.35, 0.6], paper: [0.9, 0.7, 0], frost: [0.9, 0.15, 0.5],
};

const ROLE_LEVEL = { bed: 0.52, bed2: 0.36, halo: 0.34, lead: 0.5, answer: 0.38, bass: 0.5, texture: 0.44, texture2: 0.3 };
const KIT_LEVEL = { kick: 0.58, handdrum: 0.46, shaker: 0.36, wood: 0.38, pulse: 0.42 };

/* ─────────────────────────── rhythm by measurement ───────────────────────────
 * Syncopation after Longuet-Higgins & Lee: a note on a weak position followed
 * by silence on a stronger one. Normalised per note, 0 is square, ~1 is very
 * off-beat. Research on groove (Witek et al. 2014) finds the pleasure and the
 * urge to move peak at a medium degree.
 */
function metricWeights(steps, groups) {
  if (steps === 16) return [0, -4, -3, -4, -2, -4, -3, -4, -1, -4, -3, -4, -2, -4, -3, -4];
  const w = [];
  const starts = new Set();
  let acc = 0;
  for (const g of groups) { starts.add(acc); acc += g; }
  for (let i = 0; i < steps; i++) w.push(i === 0 ? 0 : starts.has(i) ? -1 : i % 2 === 0 ? -3 : -4);
  return w;
}
export function syncopation(pat, W) {
  const n = pat.length;
  const on = [];
  for (let i = 0; i < n; i++) if (pat[i]) on.push(i);
  if (on.length < 1) return 0;
  let s = 0;
  for (let k = 0; k < on.length; k++) {
    const i = on[k];
    const j = on[(k + 1) % on.length] + (k + 1 === on.length ? n : 0);
    let strongest = -Infinity;
    for (let x = i + 1; x < j; x++) strongest = Math.max(strongest, W[x % n]);
    if (strongest > W[i]) s += strongest - W[i];
  }
  return s / (on.length * 4);
}

// A drum part: the Euclidean pattern whose syncopation lands nearest what's wanted.
function drumPart(r, { steps, groups, hits, target, downbeat = false, avoid = null, temp = 0.05 }) {
  const W = metricWeights(steps, groups);
  const cands = [];
  for (const h of hits) {
    for (let rot = 0; rot < steps; rot++) {
      const pat = euclid(steps, h, rot);
      if (downbeat && !pat[0]) continue;
      if (avoid && pat.filter((x, i) => x && avoid[i]).length > h / 2) continue;
      cands.push({ h, rot, pat, s: syncopation(pat, W) });
    }
  }
  return choose(r, cands, (c) => -Math.abs(c.s - target), temp);
}

/* ─────────────────────────── shaping sounds ───────────────────────────
 * After a preset is chosen it is bent toward the genome, so brightness,
 * softness, age and space are continuous, not a choice of four.
 */
const MORPH = {
  pad: (p, G) => { p.bright = mix(p.bright, 0.12 + G.bright * 0.6, 0.55); p.attack = mix(p.attack, lerp(9, 1.5, G.attack), 0.4); p.detune = mix(p.detune, 0.25 + G.age * 0.5, 0.4); p.movement = mix(p.movement, 0.15 + G.change * 0.6, 0.5); },
  // a drone's sub is felt, not heard: kept in proportion so it can't swallow the mix
  drone: (p, G) => { p.bright = mix(p.bright, 0.18 + G.bright * 0.45, 0.5); p.motion = mix(p.motion, 0.1 + G.change * 0.6, 0.5); p.detune = mix(p.detune, 0.2 + G.age * 0.5, 0.3); p.sub = Math.min(mix(p.sub, 0.15 + (1 - G.register) * 0.3, 0.6), 0.45); p.octUp = Math.max(p.octUp, 0.25); },
  strings: (p, G) => { p.bow = mix(p.bow, 0.2 + G.bright * 0.5, 0.5); p.vibrato = mix(p.vibrato, 0.15 + G.organic * 0.35, 0.4); p.attack = mix(p.attack, lerp(8, 1.5, G.attack), 0.35); },
  choir: (p, G) => { p.vowel = mix(p.vowel, G.bright * 0.8, 0.45); p.vowelDrift = mix(p.vowelDrift, 0.1 + G.change * 0.5, 0.5); },
  shimmer: (p, G) => { p.sparkle = mix(p.sparkle, G.bright * 0.3, 0.5); p.length = mix(p.length, 1 - G.pace, 0.4); },
  piano: (p, G) => { p.felt = mix(p.felt, 0.9 - G.bright * 0.75, 0.5); p.detune = mix(p.detune, G.age * 0.45, 0.5); p.noise = mix(p.noise, 0.05 + G.age * 0.35, 0.5); p.decay = mix(p.decay, 3 + G.space * 5, 0.4); },
  keys: (p, G) => { p.tine = mix(p.tine, 0.2 + G.bright * 0.7, 0.5); p.decay = mix(p.decay, 1.4 + G.space * 2.5, 0.4); },
  bells: (p, G) => { p.bright = mix(p.bright, 0.2 + G.bright * 0.6, 0.5); p.decay = mix(p.decay, 3 + G.space * 6, 0.5); },
  marimba: (p, G) => { p.hardness = mix(p.hardness, 0.1 + G.attack * G.bright * 0.9, 0.5); p.decay = mix(p.decay, 0.5 + G.space * 0.8, 0.4); },
  arp: (p, G, r) => {
    p.wave = G.organic > 0.6 ? r.pick(['triangle', 'sine']) : G.organic < 0.3 && G.bright > 0.4 ? r.pick(['sawtooth', 'square', 'triangle']) : p.wave;
    p.reso = mix(p.reso, (1 - G.organic) * 0.45, 0.5); p.pluck = mix(p.pluck, 0.2 + G.attack * 0.6, 0.5);
    p.rate = G.pace > 0.65 ? r.pick([1, 2]) : G.pace < 0.3 ? r.pick([2, 4]) : 2;
  },
  flute: (p, G) => { p.breath = mix(p.breath, 0.1 + G.organic * G.age * 0.6, 0.4); p.vibrato = mix(p.vibrato, 0.2 + G.organic * 0.3, 0.4); p.phrase = Math.round(mix(p.phrase, 3 + G.melody * 5, 0.5)); },
  harp: (p, G) => { p.bright = mix(p.bright, 0.15 + G.bright * 0.7, 0.5); p.decay = mix(p.decay, 2 + G.space * 5, 0.4); p.damp = mix(p.damp, 0.6 - G.bright * 0.4, 0.3); },
  bowls: (p, G) => { p.quant = mix(p.quant, G.pulse, 0.6); p.beating = mix(p.beating, 0.3 + G.strange * 0.5, 0.4); },
};

// What's left after each instrument's calibration: some presets of the same
// instrument are simply louder or softer than others (dB, measured).
const TRIM = { 'harp.nylon': 4, 'harp.harp': -1, 'harp.koto': 4, 'bells.temple': -4.5, 'bells.chime': -1, 'arp.sequence': 6, 'arp.glass': -2.5, 'pad.analog': 4.5, 'pad.glass': -2.5,
  'pad.air': 3, 'flute.ocarina': -3, 'flute.shakuhachi': 2, 'drone.deep': 1.5, 'bass.pulse': 3, 'bass.funk': -2.5, 'bass.dub': -1.5,
  'birds.owls': -6, 'wind.breeze': 1.5 };
const trim = (id) => Math.pow(10, (TRIM[id] || 0) / 40); // level goes as vol squared

// A preset with a touch of seeded variation, then shaped by the genome.
function sound(r, id, preset, G) {
  const def = LAYER_BY_ID[id];
  const p = defaults(def.schema);
  for (const [k, v] of Object.entries(preset || {})) {
    const prm = def.schema.find((x) => x.id === k);
    if (!prm) continue;
    p[k] = prm.type === 'range' && prm.step < 1 && !['oct', 'vol'].includes(k) ? clamp(v * r.float(0.93, 1.07), prm.min, prm.max) : v;
  }
  MORPH[id]?.(p, G, r);
  // everything sits in the same room and light
  p.tone = mix(p.tone, 0.5 + G.bright * 0.45, 0.35);
  p.rev = mix(p.rev, 0.25 + G.space * 0.75, 0.45);
  if ('dly' in p && def.group === 'melody') p.dly = mix(p.dly, 0.05 + G.space * 0.3 + G.repeat * 0.15, 0.4);
  for (const prm of def.schema) if (prm.type === 'range') p[prm.id] = clamp(prm.step >= 1 ? Math.round(p[prm.id]) : p[prm.id], prm.min, prm.max);
  return p;
}

/* ─────────────────────────── the plan: who plays ─────────────────────────── */

// How strange the piece is, as heard: the first half of the dial barely
// registers, because familiar sounds and scales are most of what people enjoy.
const oddness = (G) => smooth(0.3, 1, G.strange);

function roleTarget(role, G) {
  const t = roleBase(role, G);
  t.x = 0.1 + oddness(G) * 0.7;
  if (role === 'bed' || role === 'bed2' || role === 'halo') t.ow = 0.8; // a bed's material matters less than its colour
  return t;
}
function roleBase(role, G) {
  switch (role) {
    case 'bed': return { b: 0.05 + G.bright * 0.75, a: 0.05, o: G.organic, reg: 0.2 + G.register * 0.45 };
    case 'bed2': return { b: 0.1 + G.bright * 0.75, a: 0.1, o: G.organic, reg: 0.35 + G.register * 0.45 };
    case 'halo': return { b: 0.45 + G.bright * 0.45, a: 0.2, o: G.organic, reg: 0.85 };
    case 'lead': return { b: G.bright, a: 0.3 + G.attack * 0.7, o: G.organic, reg: 0.3 + G.register * 0.55, ow: 1 };
    case 'answer': return { b: G.bright, a: 0.3 + G.attack * 0.7, o: G.organic, reg: 0.3 + G.register * 0.55, ow: 1 };
  }
  return { b: 0.5, a: 0.5, o: 0.5, reg: 0.5 };
}

// Some sounds are simply more loved and more versatile: a small prior.
const APPEAL = { 'harp.nylon': 0.45, 'harp.harp': 0.35, 'piano.felt': 0.6, 'piano.grand': 0.5, 'piano.upright': 0.3, 'keys.kalimba': 0.4, 'marimba.soft': 0.35, 'bells.glass': 0.3, 'flute.flute': 0.25, 'arp.glass': 0.2, 'pad.warm': 0.4, 'pad.air': 0.3, 'strings.section': 0.3, 'strings.distant': 0.2, 'choir.ooh': 0.2 };

function fitVoice(v, t, lean) {
  const d = 1.0 * (v.b - t.b) ** 2 + 1.2 * (v.a - t.a) ** 2 + (t.ow ?? 1.5) * (v.o - t.o) ** 2 + 0.8 * (v.reg - t.reg) ** 2 + 1.2 * (v.x - t.x) ** 2;
  return -d + (lean?.[v.layer] || 0) * 0.12 + (APPEAL[v.id] || 0) * 0.06;
}

// How a melodic voice plays, by fit to the genome.
const BEHAVIOUR = {
  loops: (G) => 2 * (G.repeat - 0.6) + (0.4 - G.pulse) + 0.8 * (0.45 - G.motion) + 0.5 * (0.45 - G.pace),
  // a groove wants a hook: tunes gain as the pulse grows
  motif: (G) => 2 * (G.melody - 0.4) + 0.3 - Math.abs(G.repeat - 0.65) + 0.35 * Math.max(0, G.pulse - 0.3),
  sparse: (G) => 2 * (0.35 - G.melody) + (0.35 - G.density),
  walk: (G) => 1.5 * (0.55 - G.repeat) + (G.melody - 0.3) - 0.45,
  chords: (G) => 1.5 * (G.tension - 0.5) + (G.motion - 0.5) + 0.5 * (G.pulse - 0.3) - 0.15,
  arp: (G) => 0.9 * (G.pace - 0.5) + (G.repeat - 0.5) + 0.3 * (G.pulse - 0.3) - 0.15,
  euclid: (G) => 2 * (G.pulse - 0.4) + (G.repeat - 0.5),
};
const stylesOf = (id) => LAYER_BY_ID[id].schema.find((x) => x.id === 'style')?.options.map((o) => o[0]) || null;

// Which parts the piece has, held to what a listener can follow.
function plan(r, G, beat) {
  const want = [];
  const add = (role, w) => { if (w > 0 && r.chance(clamp(w, 0, 1))) want.push({ role, w }); };
  // the ground is not optional: without it a melody or a beat has nothing to stand on
  add('lead', smooth(0.08, 0.4, G.melody) * 0.95 + 0.05);
  add('bass', beat ? 0.9 : clamp(G.pulse * 0.6 + G.motion * 0.35 + (0.5 - G.register) * 0.5 + G.density * 0.2 - 0.25, 0, 0.85));
  add('halo', clamp(G.light * 0.45 + G.space * 0.35 + G.register * 0.35 - 0.45 + G.voices * 0.3, 0, 0.8));
  add('answer', clamp(G.voices * G.melody * 1.4 + G.density * 0.2 - 0.1, 0, 0.85));
  add('bed2', clamp(G.voices * 0.7 + G.density * 0.3 - 0.45, 0, 0.6));
  // a stream budget: one to four musical voices (drums count as one)
  const budget = 1 + Math.round(G.voices * 3.2);
  const room = Math.max(1, budget - (beat ? 1 : 0) + (want.some((x) => x.role === 'bass') ? 1 : 0));
  want.sort((a, b) => b.w - a.w);
  return ['bed', ...want.slice(0, Math.max(0, room - 1)).map((x) => x.role)];
}

/* ─────────────────────────── realising a genome ─────────────────────────── */

function globals(r, G, beat, bpm) {
  const g = defaults(GLOBAL_PARAMS);
  g.beat = beat;
  g.bpm = bpm ? Math.round(bpm) : Math.round(clamp(44 + G.pace * 62 + G.pulse * 14 + r.float(-3, 3), 40, 132));
  // meters: plain four most of the time; lilts and odd meters as things get strange
  const odd = oddness(G);
  // with a beat, four almost always: grooves live in four
  const meters = [['4/4', (1.4 - odd * 0.6) * (beat ? 4 : 1)], ['3/4', 0.12 + (1 - G.pulse) * 0.15 + G.melody * 0.08], ['6/8', 0.1 + G.sync * 0.15], ['5/4', odd * 0.35 - 0.05], ['7/8', odd * 0.3 - 0.08]];
  g.meter = choose(r, meters, ([, w]) => Math.log(Math.max(1e-3, w)), 1)[0];
  g.swing = G.pulse > 0.35 ? clamp((G.sync - 0.35) * 0.55 + G.age * 0.12, 0, 0.45) : 0.04;
  g.humanize = clamp(0.08 + G.organic * 0.25 + (1 - G.pulse) * 0.2, 0.05, 0.55);
  g.velvar = 0.3 + G.organic * 0.25;
  g.density = 0.15 + G.density * 0.6;

  // harmony: how often the ground moves, and how coloured it is
  const bar = (METERS[g.meter].steps * 60) / g.bpm / 4;
  const chordSecs = lerp(30, 5, G.motion);
  g.chordBars = [1, 2, 4, 8].reduce((a, b) => (Math.abs(Math.log(b * bar / chordSecs)) < Math.abs(Math.log(a * bar / chordSecs)) ? b : a));
  g.song = false;
  if (G.motion < 0.14) g.prog = 'still';
  else if (G.motion < 0.3) g.prog = odd > 0.3 || r.chance(0.5) ? 'pedal' : 'two';
  else if (G.motion < 0.55) { g.prog = odd > 0.5 ? 'drift' : 'loop'; g.loopLen = r.pick([2, 3, 4]); }
  else {
    const opts = [['song', 1.3 - odd * 1.5], ['loop', 0.6], ['func', G.tension * 0.8 - 0.1], ['circle', (G.tension + G.motion) * 0.4 - 0.4], ['drift', odd * 0.7 - 0.1], ['random', odd - 0.6]];
    const pick = choose(r, opts, ([, w]) => Math.log(Math.max(1e-3, w)), 1)[0];
    g.song = pick === 'song';
    g.prog = pick === 'song' ? 'loop' : pick;
    g.loopLen = 4;
  }
  g.complexity = clamp(0.08 + G.tension * 0.85, 0, 1);
  g.sus = clamp(0.08 + 0.35 * bump(G.tension, 0.3, 0.2) + odd * 0.1, 0, 0.6);
  g.inversions = 0.05 + G.motion * 0.3;
  g.spread = 0.35 + G.space * 0.35;
  g.lead = true;
  g.modulate = !g.song && G.motion > 0.3 ? G.change * 0.12 : 0;

  // melody
  g.repetition = 0.4 + G.repeat * 0.58;
  g.rests = clamp(lerp(0.72, 0.18, G.density * 0.6 + G.pace * 0.4), 0.1, 0.8);
  g.motifBars = G.melody > 0.62 ? 4 : G.repeat > 0.7 && G.pace > 0.4 ? 2 : r.pick([2, 4]);
  g.tension = 0.06 + G.tension * 0.4;
  g.leap = 0.1 + G.melody * 0.2 + odd * 0.15;
  g.range = 0.25 + G.melody * 0.45;
  g.callResponse = false;

  // space
  g.revSize = 0.25 + G.space * 0.72;
  g.revMix = 0.3 + G.space * 0.52;
  g.revPre = 0.05 + G.space * 0.3;
  g.revDamp = 0.75 - G.bright * 0.45;
  g.dlyMix = 0.1 + G.space * 0.25 + G.repeat * 0.15;
  g.dlyFb = 0.2 + G.space * 0.3 + (1 - G.pace) * 0.1;
  g.dlyDiv = beat ? r.pick([0.75, 0.5, 0.75, 1]) : r.pick([0.75, 1, 1.5]);
  g.dlyTone = 0.3 + G.bright * 0.4;
  g.dlySpread = 0.5 + G.space * 0.4;
  // the memory cloud blooms in slow, spacious pieces; bright ones shimmer
  g.cloud = clamp(G.space * 0.55 + (1 - G.pace) * 0.25 + G.change * 0.1 - 0.3, 0, 0.6);
  g.shimmer = clamp(G.light * 0.45 + G.register * 0.2 + G.space * 0.2 - 0.35, 0, 0.6);

  // colour
  g.bright = clamp(0.3 + G.bright * 0.45 + (G.light - 0.5) * 0.1, 0.2, 0.85);
  g.lowcut = r.float(0.03, 0.1);
  g.warmth = 0.05 + G.age * 0.65;
  g.wow = G.age * G.age * 0.55;
  g.chorus = 0.05 + (1 - G.organic) * 0.3 + G.change * 0.08;
  g.drift = 0.08 + G.change * 0.3;
  g.evolve = 0.06 + G.change * 0.22;
  g.pump = beat && G.organic < 0.55 && G.pulse > 0.6 ? 0.08 + (1 - G.organic) * 0.15 : 0;
  g.touchMode = 'both';
  return g;
}

function kit(r, G, g, layers, roles) {
  const { steps, groups } = METERS[g.meter];
  const on = (id, p) => { layers[id] = { on: true, p: { ...defaults(LAYER_BY_ID[id].schema), ...p } }; roles[id] = 'kit'; };
  const lvl = (id) => KIT_LEVEL[id] * lerp(0.85, 1.05, G.pulse);
  // three families of drum, chosen by fit: machine, kit (brushes and a soft
  // kick) and hands
  const fam = choose(r, ['machine', 'kit', 'hands'], (f) => (f === 'machine' ? 2 * (0.55 - G.organic) + (G.pulse - 0.5)
    : f === 'kit' ? G.age + 0.5 * G.tension + 0.5 * (G.organic - 0.4) - 0.3
      : 2 * (G.organic - 0.55) + oddness(G) + 0.5 * G.nature - 0.5 * G.age), 0.2);
  const organic = fam === 'hands';
  // A very slow pulse is a heartbeat, not a drum kit.
  if (G.pace < 0.22) {
    on('pulse', { every: G.pace < 0.1 ? 2 : 1, pitch: 0.3 + G.register * 0.3, second: r.float(0.4, 0.7), decay: 0.6 + (1 - G.pace) * 0.4, vol: lvl('pulse') });
    return;
  }
  // the low anchor: kick for electronic, a hand drum for acoustic
  const four = G.pace > 0.72 && G.sync < 0.5;
  const low = drumPart(r, { steps, groups, hits: four ? [steps / 4] : G.density > 0.5 ? [2, 3, 4] : [1, 2, 3], target: G.sync * 0.35, downbeat: true });
  if (organic) {
    on('handdrum', { steps, hits: low.h + (G.density > 0.5 ? 2 : 1), rotate: low.rot, prob: 0.95, ghost: 0.1 + G.density * 0.25, pitch: lerp(110, 200, G.register), slap: 0.1 + G.sync * 0.4, decay: 0.3 + G.space * 0.25, tuned: r.chance(0.5), vol: lvl('handdrum') });
  } else {
    on('kick', { steps, hits: low.h, rotate: low.rot, prob: 1, ghost: 0.05 + G.sync * 0.1, pitch: lerp(44, 58, G.register), decay: 0.3 + (1 - G.pace) * 0.25, punch: 0.3 + G.attack * 0.4, click: 0.1 + G.bright * 0.3, vol: lvl('kick') });
  }
  const parts = 1 + Math.round(G.density * 1.6 + G.pulse * 0.6 + r.float(-0.3, 0.3));
  // time: shaker or hats, the busiest part
  if (parts >= 2 || G.pace > 0.5) {
    const hits = G.pace > 0.7 ? [8, 16] : G.density > 0.55 ? [6, 8] : [4, 8];
    const tp = drumPart(r, { steps, groups, hits: hits.map((h) => Math.min(h, steps)), target: 0.1 + G.sync * 0.5 });
    const kind = organic ? r.pick(['shaker', 'seeds']) : fam === 'kit' ? r.pick(['brush', 'brush', 'shaker']) : r.pick(['hat', 'hat', 'shaker']);
    on('shaker', { steps, hits: tp.h, rotate: tp.rot, prob: 0.9, ghost: 0.15 + G.sync * 0.3, kind, decay: 0.6 + G.space * 0.6, open: kind === 'hat' ? G.sync * 0.2 : 0, color: G.bright, vol: lvl('shaker') });
  }
  // colour: a backbeat or a clave, where the syncopation lives
  if (parts >= 3 || (G.pulse > 0.7 && G.density > 0.4)) {
    const backbeat = !organic && G.sync < 0.65 && steps === 16;
    const cp = backbeat ? { h: 2, rot: 4 } : drumPart(r, { steps, groups, hits: [3, 5], target: 0.35 + G.sync * 0.5, avoid: euclid(steps, low.h, low.rot) });
    const kind = backbeat ? 'rim' : organic ? r.pick(['clave', 'block']) : r.pick(['rim', 'tick', 'clave']);
    on('wood', { steps, hits: cp.h, rotate: cp.rot, prob: 1, ghost: 0.05 + G.sync * 0.1, kind, pitch: lerp(0.8, 1.2, G.register), decay: 0.8 + G.space * 0.5, vol: lvl('wood') });
  }
}

function bassFor(r, G, beat) {
  const opts = [
    ['held', 3 * (0.4 - G.pulse)],
    ['roots', 0.3 - Math.abs(G.pulse - 0.5)],
    ['rootfifth', 0.2 - Math.abs(G.pulse - 0.55) + (1 - G.strange) * 0.1],
    ['pulse', 1.5 * (G.repeat - 0.6) + (G.pulse - 0.5) - 0.3],
    ['synco', 1.5 * (G.sync - 0.5) + (G.pulse - 0.5)],
    ['walk', 1.5 * (G.organic - 0.6) + 1.5 * (G.tension - 0.5) + (G.motion - 0.5)],
    ['broken', (G.melody - 0.5) + 0.5 * (0.5 - G.pulse) - 0.4],
  ];
  // A bass line is felt more than followed: in this music it moves one to
  // three times a second. The rolling sixteenth grooves (drive, psy) belong
  // to running, not to listening, so they aren't offered here.
  if (beat) {
    opts.push(['dub', 1.5 * (G.space - 0.5) + 1.5 * (0.45 - G.light) + (G.pulse - 0.5) + 0.5 * (0.5 - G.pace)]);
    opts.push(['funk', 2 * (G.sync - 0.5) + (G.organic - 0.5) + (G.tension - 0.4) - 0.2]);
  }
  const [pat] = choose(r, opts, ([, s]) => s, 0.25);
  const groove = ['dub', 'funk'].includes(pat);
  const preset = groove ? PRESETS.bass[pat === 'funk' ? 'funk' : 'dub'] : pat === 'held' ? PRESETS.bass.held : pat === 'pulse' ? PRESETS.bass.pulse : pat === 'walk' ? PRESETS.bass.walk : PRESETS.bass.roots;
  const p = sound(r, 'bass', preset, G);
  if (groove) { p.pattern = 'groove'; p.bstyle = pat; p.busy = 0.1 + G.density * 0.3; } else p.pattern = pat;
  if (!groove) p.wave = G.organic > 0.55 ? r.pick(['triangle', 'sine', 'triangle']) : r.pick(['sawtooth', 'triangle', 'square']);
  p.drive = clamp((1 - G.organic) * 0.3 * G.pulse + G.age * 0.1, 0, 0.4);
  p.glide = clamp(G.strange * 0.25, 0, 0.4);
  p.tone = clamp(0.4 + G.bright * 0.35, 0.35, 0.8);
  return p;
}

function natureFor(r, G, lean, layers, roles) {
  const n = G.nature < 0.22 ? 0 : G.nature < 0.62 ? 1 : G.nature < 0.85 ? (r.chance(0.4) ? 2 : 1) : 2;
  const taken = [];
  for (let k = 0; k < n; k++) {
    const pick = choose(r, NATURE.filter((x) => !taken.includes(x.layer)), (x) => {
      let s = -2.2 * (x.w - G.water) ** 2 - 1.2 * (x.life - G.life) ** 2 - 1.0 * (x.light - G.light) ** 2 + (lean?.[x.layer] || 0) * 0.2;
      if (x.indoor) s -= G.nature > 0.8 ? 0.15 : 0; // wild places are outside
      if (k > 0) s += 0.1 * (x.life > 0.5 !== taken.some((l) => ['birds', 'night'].includes(l)) ? 1 : 0); // a second layer adds life or weather, not more of the same
      return s;
    }, 0.06);
    if (!pick) break;
    taken.push(pick.layer);
    const p = sound(r, pick.layer, PRESETS[pick.layer][pick.name], G);
    p.vol = (k === 0 ? ROLE_LEVEL.texture : ROLE_LEVEL.texture2) * lerp(0.75, 1.15, G.nature) * trim(pick.id);
    layers[pick.layer] = { on: true, p };
    roles[pick.layer] = k === 0 ? 'texture' : 'texture2';
  }
  // weather has thunder when it is dark and restless
  if (taken.includes('rain') && G.light < 0.35 && (G.tension > 0.45 || (lean?.thunder || 0) > 0) && r.chance(0.7)) {
    const p = sound(r, 'thunder', PRESETS.thunder.distant, G);
    p.vol = ROLE_LEVEL.texture2;
    layers.thunder = { on: true, p };
    roles.thunder = 'texture2';
  }
  // for very still, sparse pieces a soft noise bed, rarely a binaural hum
  if (G.pace < 0.1 && G.density < 0.2 && G.nature < 0.4 && r.chance(0.5)) {
    const p = sound(r, 'noise', PRESETS.noise.brown, G);
    p.vol = 0.3;
    layers.noise = { on: true, p };
    roles.noise = 'texture2';
  } else if (G.strange > 0.6 && G.pace < 0.25 && G.voices < 0.45 && r.chance(0.25)) {
    const p = sound(r, 'binaural', G.pace < 0.1 ? PRESETS.binaural.delta : PRESETS.binaural.theta, G);
    p.vol = 0.3;
    layers.binaural = { on: true, p };
    roles.binaural = 'texture2';
  }
}

function realise(r, G, { beat, lean, bpm }) {
  const g = globals(r, G, beat, bpm);
  const layers = {};
  const roles = {};
  const voices = {};
  for (const def of LAYERS) layers[def.id] = { on: false, p: defaults(def.schema) };
  const parts = plan(r, G, beat);
  const used = new Set();
  let leadV = null;
  let leadStyle = null;
  for (const role of parts) {
    if (role === 'bass') {
      layers.bass = { on: true, p: bassFor(r, G, beat) };
      layers.bass.p.vol = ROLE_LEVEL.bass * r.float(0.94, 1.04) * trim(`bass.${layers.bass.p.pattern === 'groove' ? layers.bass.p.bstyle : layers.bass.p.pattern}`);
      roles.bass = 'bass';
      used.add('bass');
      continue;
    }
    const cap = role === 'bed2' ? 'bed' : role;
    let t = roleTarget(role, G);
    // an answer sits apart from the lead: another register, another touch
    if (role === 'answer' && leadV) t = { ...t, reg: leadV.reg > 0.6 ? leadV.reg - 0.25 : leadV.reg + 0.25 };
    const v = choose(r, VOICES.filter((x) => x.roles.includes(cap) && !used.has(x.layer)), (x) => fitVoice(x, t, lean), 0.035);
    if (!v) continue;
    used.add(v.layer);
    const p = sound(r, v.layer, PRESETS[v.layer][v.name], G);
    p.vol = ROLE_LEVEL[role] * r.float(0.94, 1.04) * trim(v.id);
    if (role === 'halo' && 'oct' in p && v.layer !== 'shimmer') p.oct = Math.max(p.oct, v.layer === 'bells' ? 0 : 1);
    const def = LAYER_BY_ID[v.layer];
    if (def.group === 'melody') {
      if ('oct' in p && (role === 'lead' || role === 'answer')) {
        const want = role === 'answer' ? t.reg : 0.3 + G.register * 0.55;
        p.oct = clamp(Math.round((want - v.reg) * 3.2), -1, 1);
      }
      if ('density' in p) p.density = clamp(0.15 + G.density * 0.6, 0.1, 0.85) * (role === 'lead' ? 1 : 0.8);
      const styles = stylesOf(v.layer);
      if (styles) {
        // loops drift free of the bar; against a beat they just sound lost
        const avail = styles.filter((s) => BEHAVIOUR[s] && (s !== 'euclid' || beat) && (s !== 'loops' || !beat));
        p.style = choose(r, avail, (s) => BEHAVIOUR[s](G) - (role === 'answer' && s === leadStyle && s !== 'motif' && s !== 'loops' ? 0.4 : 0), 0.25);
      }
      if (role === 'lead') { leadV = v; leadStyle = p.style ?? v.layer; }
    }
    layers[v.layer] = { on: true, p };
    roles[v.layer] = role;
    voices[v.layer] = v.id;
  }
  // two motif melodies trade phrases instead of talking over each other
  const singers = Object.keys(roles).filter((id) => layers[id].p.style === 'motif');
  if (singers.length > 1) g.callResponse = true;
  if (beat) kit(r, G, g, layers, roles);
  natureFor(r, G, lean, layers, roles);
  return { g, layers, roles, voices };
}

/* ─────────────────────────── the critic ───────────────────────────
 * Scores a realisation on principles, each 0 to 1. None of them names a
 * style; they are about how people hear.
 */
const VOICE_BY_ID = Object.fromEntries(VOICES.map((v) => [v.id, v]));

// Notes per second a layer adds, roughly.
function eventRate(id, p, g) {
  const step = 60 / g.bpm / 4;
  const { steps, groups } = METERS[g.meter];
  const barS = steps * step;
  const d = clamp((p.density ?? 0.5) * (0.35 + g.density * 1.3), 0, 1);
  const def = LAYER_BY_ID[id];
  if (def.group === 'rhythm') {
    // a steady pattern is predictable, so it carries little news
    if (id === 'pulse') return (4 / (p.every || 1)) / barS * 0.3;
    return ((p.hits || 0) * (p.steps ? steps / p.steps : 1) * (p.prob ?? 1)) / barS * (id === 'shaker' ? 0.08 : 0.2);
  }
  if (id === 'bowls') return 1 / lerp(34, 6, d);
  if (id === 'flute') { const n = p.phrase || 5; return n / (n * 4 * step * 1.3 + 16 * step * (1 + g.rests * 4) + (4 * step) / (0.05 + d * 0.3)); }
  if (id === 'arp') return (16 / (p.rate || 2)) * (0.35 + d * 0.65) / (16 * step) * 0.7;
  switch (p.style) {
    case 'loops': return (2 + Math.round(d * 3)) / 13;
    case 'motif': return ((0.15 + d * 0.75) * 0.45 * (1 - g.rests * 0.3)) / step;
    case 'sparse': return (groups.length * (0.1 + d * 0.4)) / barS;
    case 'walk': return (groups.length * (0.25 + d * 0.6) + groups.length * d * 0.35 + steps / 2 * d * 0.08) / barS;
    case 'chords': return (1 + groups.length * d * 0.5) / barS;
    case 'arp': return (16 / (p.rate || 2)) * (0.35 + d * 0.65) / (16 * step) * 0.7;
    case 'euclid': return ((p.hits || 5) * (0.5 + d * 0.5)) / barS;
  }
  return 0;
}

const natureCount = (ids) => ids.filter((id) => LAYER_BY_ID[id].group === 'nature').length;

export function critic(G, real) {
  const { g, layers, roles, voices } = real;
  const ids = Object.keys(roles);
  const tonal = ids.filter((id) => voices[id]).map((id) => {
    const v = VOICE_BY_ID[voices[id]];
    return { id, role: roles[id], v, reg: v.reg + (layers[id].p.oct || 0) * 0.22 };
  });
  const beds = tonal.filter((x) => ['bed', 'bed2', 'halo'].includes(x.role));
  const lead = tonal.find((x) => x.role === 'lead');
  const s = {};

  // 1. streams: as many voices as asked for, never more than can be followed
  const streams = tonal.length + (roles.bass ? 1 : 0) + (g.beat ? 1 : 0);
  const want = 1 + G.voices * 3.4 + (g.beat ? 1 : 0);
  s.streams = Math.exp(-((streams - want) ** 2) / 4) * (streams > 5 ? 0.5 : 1);

  // 2. masking: sustained sounds in the same register blur; a lead inside the bed disappears
  let mask = 0;
  for (let i = 0; i < beds.length; i++) for (let j = i + 1; j < beds.length; j++) if (Math.abs(beds[i].reg - beds[j].reg) < 0.14) mask += 0.25;
  if (lead) for (const b of beds) if (Math.abs(b.reg - lead.reg) < 0.08 && b.v.a < 0.3) mask += 0.15;
  const lows = tonal.filter((x) => x.reg < 0.28).length + (roles.bass ? 1 : 0);
  if (lows > 1) mask += 0.3 * (lows - 1);
  s.masking = clamp(1 - mask, 0, 1);

  // 3. figure and ground: the lead's touch should stand out from the bed
  if (lead && beds.length) s.figure = 0.35 + 0.65 * smooth(0.05, 0.45, lead.v.a - mean(beds.map((b) => b.v.a)));
  else s.figure = lead || beds.length ? 0.75 : 0.3;

  // 4. belonging: the sounds share a material, unless the genome asks for a mix
  const os = tonal.map((x) => x.v.o);
  const allow = 0.1 + (1 - Math.abs(G.organic - 0.5) * 2) * 0.25;
  s.coherence = clamp(1 - Math.max(0, std(os) - allow) * 2.5, 0, 1);

  // 5. brightness: near what was asked, and never a pile of glassy sounds
  const bs = tonal.map((x) => x.v.b);
  const glassy = bs.filter((b) => b > 0.68).length;
  s.bright = clamp(1 - Math.abs(mean(bs) - (0.1 + G.bright * 0.75)) * 1.5 - Math.max(0, glassy - 1) * 0.25, 0, 1);

  // 6. information rate: how much happens should suit the pace of the feeling
  // (Berlyne: pleasure peaks at a moderate complexity for the listener's state)
  // chord changes and the world outside count as events too
  const chordSecs = g.prog === 'still' ? 40 : g.chordBars * (METERS[g.meter].steps * 60) / g.bpm / 4;
  let rate = (beds.length ? 1 / chordSecs : 0) + natureCount(ids) * 0.04;
  for (const id of ids) if (layers[id].on) rate += eventRate(id, layers[id].p, g);
  const target = 0.18 * Math.pow(18, G.pace) * (0.65 + G.density * 0.7) * (1 + G.pulse * 0.5);
  s.rate = Math.exp(-(Math.log(Math.max(0.02, rate) / target) ** 2) / (2 * 0.55 * 0.55));

  // 7. groove: a low anchor, a tempo you can move to, syncopation in the sweet middle
  if (g.beat) {
    const { steps, groups } = METERS[g.meter];
    const W = metricWeights(steps, groups);
    const drums = ['kick', 'handdrum', 'wood', 'shaker'].filter((id) => roles[id] === 'kit');
    const sy = drums.map((id) => syncopation(euclid(steps, layers[id].p.hits, layers[id].p.rotate), W));
    const sync = mean(sy);
    const anchor = roles.kick || roles.handdrum || roles.pulse || roles.bass;
    s.groove = (anchor ? 1 : 0.5) * (0.4 + 0.6 * bump(sync, 0.12 + G.sync * 0.3, 0.2)) * (g.bpm >= 66 && g.bpm <= 132 ? 1 : 0.8);
  } else s.groove = 1;

  // 8. mud: long reverb on many sustained voices, densely played
  const sus = beds.length + (layers.drone.on ? 0.5 : 0);
  s.clarity = clamp(1 - Math.max(0, sus * g.revMix * (0.6 + g.density) - 1.4) * 0.6, 0, 1);

  // 9. harmony and behaviour: loops need slow ground, chords need moving ground
  let fit = 1;
  for (const x of tonal) {
    const st = layers[x.id].p.style;
    if (st === 'loops' && g.prog !== 'still' && chordSecs < 10) fit -= 0.2;
    if (st === 'chords' && (g.prog === 'still' || g.prog === 'pedal')) fit -= 0.3;
    if (st === 'arp' && g.bpm < 56) fit -= 0.15;
  }
  s.harmony = clamp(fit, 0, 1);

  // 10. fidelity: the result should be what the genome describes
  const natureN = natureCount(ids);
  const wantN = G.nature < 0.22 ? 0 : G.nature < 0.62 ? 1 : 1.6;
  s.fidelity = clamp(1 - Math.abs(mean(os) - G.organic) * 0.8 - Math.abs(natureN - wantN) * 0.2 - (lead ? Math.abs(lead.v.a - (0.3 + G.attack * 0.7)) * 0.5 : 0), 0, 1);

  const W8 = { streams: 1, masking: 1.2, figure: 1, coherence: 0.8, bright: 0.6, rate: 1.4, groove: 1, clarity: 0.8, harmony: 0.8, fidelity: 1 };
  let tot = 0;
  let wsum = 0;
  for (const [k, w] of Object.entries(W8)) { tot += Math.log(Math.max(0.02, s[k])) * w; wsum += w; }
  return { score: Math.exp(tot / wsum), parts: s };
}

/* ─────────────────────────── composing ─────────────────────────── */

const clamp01 = (v) => clamp(v, 0, 1);

export function nearestAnchor(G, withHidden = false) {
  let best = null;
  let bd = Infinity;
  for (const a of ANCHORS) {
    if (a.hidden && !withHidden) continue;
    const ks = Object.keys(a.at);
    const d = ks.reduce((s, k) => s + (G[k] - a.at[k]) ** 2, 0) / ks.length;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export const packGenome = (G) => DIM_IDS.map((k) => Math.round(clamp01(G[k] ?? 0.5) * 100));
export const unpackGenome = (arr) => (Array.isArray(arr) && arr.length === DIM_IDS.length && arr.every(Number.isFinite)
  ? Object.fromEntries(DIM_IDS.map((k, i) => [k, clamp01(arr[i] / 100)])) : null);

/*
 * compose(seed, { mood, energy, rhythm, shape, genome, candidates })
 *   mood:   an anchor to start near (omit to start anywhere)
 *   rhythm: true wants a beat, false none, undefined lets the genome decide
 *   shape:  dimensions the listener has fixed, { pace: 0.2, … }
 *   genome: realise exactly this genome (rerolls, journeys)
 *   lean:   qualities to lean toward softly, { light: 0.8 }
 *   bpm:    a tempo to compose around
 */
export function compose(seed, opts = {}) {
  const r = seeded((seed ^ 0x5bd1e995) >>> 0);
  const anchor = ANCHOR_BY_ID[opts.mood] || null;
  const fixed = { ...(opts.shape || {}) };
  if (opts.rhythm === false) fixed.pulse = Math.min(fixed.pulse ?? 1, 0.3);
  let G;
  if (opts.genome) G = { ...opts.genome, ...fixed };
  else if (anchor) G = sampleGenome(r, { anchor, fixed, energy: opts.energy });
  else {
    // anywhere: half the time near a named place, loosely; half the time free
    const free = r.chance(0.5);
    const a = free ? null : r.pick(ANCHORS.filter((x) => !x.hidden));
    G = sampleGenome(r, { anchor: a, fixed, energy: opts.energy, spread: 0.24 });
  }
  // a soft lean (the time of day, say): a pull, never a rule
  for (const [k, v] of Object.entries(opts.lean || {})) if (!(k in fixed) && G[k] != null) G[k] += (v - G[k]) * 0.35;
  if (opts.rhythm === true || opts.rhythm === 'force') G.pulse = Math.max(G.pulse, 0.55);
  // a chosen tempo lifts the pace part of the way: over a quick beat a piece
  // can still feel unhurried (deep house lives at 120 with sparse melodies)
  if (opts.bpm) { G.pace = Math.max(G.pace, clamp((opts.bpm - 44 - G.pulse * 14) / 62, 0, 1) * 0.6); fixed.pace = G.pace; }
  if (opts.rhythm === false) G.pulse = Math.min(G.pulse, 0.3);
  const beatOf = (x) => (opts.rhythm === false ? false : opts.rhythm ? true : x.pulse >= 0.5);
  const lean = anchor ? LEAN[anchor.id] : null;

  // many realisations, one kept: the critic's choice
  const n = opts.candidates ?? 16;
  let best = null;
  for (let i = 0; i < n; i++) {
    const Gi = i === 0 || opts.genome ? G : nudge(r, G, 0.05, fixed);
    const ri = seeded((seed * 31 + i * 7919) >>> 0);
    const real = realise(ri, Gi, { beat: beatOf(Gi), lean, bpm: opts.bpm });
    const c = critic(Gi, real);
    if (!best || c.score > best.score) best = { ...real, G: Gi, score: c.score, parts: c.parts, i };
  }
  const G1 = best.G;
  const mode = choose(r, Object.keys(MODE_AT).filter((m) => MODES[m]), (m) => -((MODE_AT[m][0] - G1.light) ** 2) * 3 - ((MODE_AT[m][1] - oddness(G1)) ** 2) * 5, 0.05);
  const palette = choose(r, Object.keys(PALETTE_AT), (k) => {
    const [l, w, hue] = PALETTE_AT[k];
    const warm = clamp01(0.3 + (1 - G1.water) * 0.4 + G1.age * 0.3 - (1 - G1.light) * 0.1);
    const cool = clamp01(G1.water * 0.6 + G1.life * 0.3);
    return -((l - (0.15 + G1.light * 0.55 + (G1.light > 0.72 && G1.space > 0.6 ? 0.2 : 0))) ** 2) * 3 - ((w - warm) ** 2) * 2 - ((hue - cool) ** 2);
  }, 0.08);
  return {
    genome: G1,
    mood: anchor ? anchor.id : nearestAnchor(G1).id,
    g: best.g,
    layers: best.layers,
    roles: best.roles,
    voices: best.voices,
    mode,
    palette,
    root: G1.register < 0.3 ? r.int(0, 6) : G1.register > 0.7 ? r.int(5, 11) : r.int(0, 11),
    just: G1.motion < 0.25 && G1.organic > 0.6 && r.chance(0.3),
    a4: r.chance(0.1) ? 432 : 440,
    energy: clamp01(G1.pace * 0.4 + G1.pulse * 0.35 + G1.density * 0.25),
    score: best.score,
    parts: best.parts,
  };
}
