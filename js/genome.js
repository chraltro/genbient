/*
 * The musical genome: what a piece is, as a point in a continuous space.
 *
 * Each dimension is something a listener actually hears and that research on
 * music perception ties to enjoyment: arousal (pace, pulse, density),
 * expectation (repetition against novelty, harmonic motion, syncopation),
 * mood (light, tension), auditory scene (voices, register, attack, timbre)
 * and place (space, nature, age). A scene is one point; the space between
 * points is where the new music is. Values run 0 to 1.
 */

export const DIMS = [
  { id: 'pace', name: 'Pace', words: ['still', 'slow', 'unhurried', 'walking', 'moving'] },
  { id: 'pulse', name: 'Pulse', words: ['free time', 'a hint of pulse', 'gently pulsing', 'a groove', 'driving'] },
  { id: 'sync', name: 'Syncopation', words: ['square', 'steady', 'lilting', 'syncopated', 'off-kilter'] },
  { id: 'density', name: 'Density', words: ['spare', 'sparse', 'flowing', 'full', 'busy'] },
  { id: 'light', name: 'Light', words: ['dark', 'dusky', 'warm', 'bright', 'radiant'] },
  { id: 'tension', name: 'Tension', words: ['pure', 'open', 'coloured', 'rich', 'restless'] },
  { id: 'motion', name: 'Chords', words: ['one chord', 'drifting', 'slowly turning', 'song-like', 'moving'] },
  { id: 'strange', name: 'Strangeness', words: ['familiar', 'plain', 'tinted', 'foreign', 'otherworldly'] },
  { id: 'voices', name: 'Voices', words: ['a single voice', 'two voices', 'a few voices', 'several voices', 'a crowd'] },
  { id: 'melody', name: 'Melody', words: ['no tune', 'fragments', 'phrases', 'melodic', 'singing'] },
  { id: 'repeat', name: 'Repetition', words: ['ever-new', 'wandering', 'developing', 'returning', 'looping'] },
  { id: 'register', name: 'Register', words: ['deep', 'low', 'middle', 'high', 'airborne'] },
  { id: 'bright', name: 'Brightness', words: ['muffled', 'soft', 'clear', 'bright', 'glassy'] },
  { id: 'attack', name: 'Touch', words: ['swelling', 'soft', 'rounded', 'plucked', 'struck'] },
  { id: 'organic', name: 'Material', words: ['electronic', 'synthetic', 'mixed', 'acoustic', 'wooden'] },
  { id: 'space', name: 'Space', words: ['up close', 'in a room', 'in a hall', 'in a cathedral', 'in endless space'] },
  { id: 'age', name: 'Age', words: ['pristine', 'clean', 'warm', 'worn', 'old tape'] },
  { id: 'nature', name: 'Nature', words: ['indoors', 'a trace of weather', 'outdoors', 'immersed', 'wild'] },
  { id: 'water', name: 'Element', words: ['fire', 'earth', 'air', 'rain', 'sea'] },
  { id: 'life', name: 'Life', words: ['lifeless', 'quiet', 'alive', 'teeming', 'wild'] },
  { id: 'change', name: 'Change', words: ['unchanging', 'patient', 'evolving', 'restless', 'shifting'] },
];
export const DIM_IDS = DIMS.map((d) => d.id);
export const DIM_BY_ID = Object.fromEntries(DIMS.map((d) => [d.id, d]));

export const word = (id, v) => { const w = DIM_BY_ID[id].words; return w[Math.min(w.length - 1, Math.floor(v * w.length))]; };

/*
 * Named starting points: places in the space worth starting from. Only the
 * dimensions that define them are fixed; everything else is explored, so
 * "near Airports" can still land somewhere nobody wrote down.
 */
export const ANCHORS = [
  { id: 'airport', name: 'Airports', blurb: 'a few notes on long loops that drift in and out of phase',
    at: { pace: 0.2, pulse: 0.05, density: 0.25, light: 0.72, tension: 0.3, motion: 0.1, repeat: 0.95, melody: 0.45, attack: 0.72, organic: 0.8, space: 0.85, nature: 0.1, strange: 0.1, voices: 0.35, strange: 0.2, organic: 0.6 } },
  { id: 'rainpiano', name: 'Rain Piano', blurb: 'a piano by a window in the rain',
    at: { pace: 0.3, pulse: 0.1, light: 0.4, motion: 0.65, melody: 0.65, attack: 0.72, organic: 0.9, nature: 0.6, water: 0.75, life: 0.1, space: 0.45, strange: 0.1, voices: 0.35 } },
  { id: 'sacred', name: 'Meditation', blurb: 'a drone, singing bowls and a lot of space',
    at: { pace: 0.08, pulse: 0.05, density: 0.15, motion: 0.05, voices: 0.2, melody: 0.2, repeat: 0.9, register: 0.3, organic: 0.8, space: 0.95, strange: 0.45, nature: 0.2 } },
  { id: 'celestial', name: 'Celestial', blurb: 'voices and light, slowly turning',
    at: { pace: 0.2, pulse: 0.05, light: 0.85, tension: 0.4, motion: 0.35, register: 0.7, bright: 0.7, attack: 0.25, space: 0.95, nature: 0.05, strange: 0.15, organic: 0.55 } },
  { id: 'oceanic', name: 'Ocean', blurb: 'the sea and something warm to float on',
    at: { pace: 0.2, light: 0.6, motion: 0.3, attack: 0.4, nature: 0.8, water: 0.95, life: 0.1, space: 0.75, strange: 0.15 } },
  { id: 'sylvan', name: 'Forest', blurb: 'birdsong, water and wood',
    at: { pace: 0.45, light: 0.7, organic: 0.95, attack: 0.8, nature: 0.8, life: 0.9, water: 0.5, strange: 0.15 } },
  { id: 'stormy', name: 'Storm', blurb: 'rain, far thunder and a dark heart',
    at: { light: 0.2, tension: 0.55, nature: 0.9, water: 0.8, life: 0.05, bright: 0.3, space: 0.6, strange: 0.2 } },
  { id: 'nocturne', name: 'Nocturne', blurb: 'after midnight, crickets outside',
    at: { pace: 0.3, light: 0.3, melody: 0.65, organic: 0.85, nature: 0.55, life: 0.8, water: 0.3, bright: 0.35, strange: 0.15 } },
  { id: 'hearth', name: 'Hearth', blurb: 'a fire and a warm room',
    at: { pace: 0.35, light: 0.6, age: 0.6, organic: 0.85, nature: 0.6, water: 0.02, life: 0.3, space: 0.3, strange: 0.1 } },
  { id: 'glacial', name: 'Glacial', blurb: 'ice, wind and high glass',
    at: { pace: 0.15, pulse: 0.05, light: 0.75, register: 0.8, bright: 0.8, attack: 0.5, nature: 0.6, water: 0.45, life: 0.02, space: 0.9, strange: 0.2, organic: 0.5 } },
  { id: 'space', name: 'Deep Space', blurb: 'a vast slow drone and far signals',
    at: { pace: 0.12, pulse: 0.05, register: 0.25, organic: 0.1, space: 1, nature: 0.02, strange: 0.55, repeat: 0.85, density: 0.2 } },
  { id: 'pulse', name: 'Minimal Pulse', blurb: 'interlocking patterns that shift against each other',
    at: { pace: 0.7, pulse: 0.5, sync: 0.55, density: 0.65, repeat: 0.95, voices: 0.6, attack: 0.9, space: 0.35, nature: 0.05 } },
  { id: 'postrock', name: 'Swell', blurb: 'music that builds and falls like weather',
    at: { pace: 0.45, light: 0.55, motion: 0.7, melody: 0.7, voices: 0.6, change: 0.8, space: 0.7, organic: 0.75, strange: 0.1, nature: 0.15, pulse: 0.45 } },
  { id: 'downtempo', name: 'Downtempo', blurb: 'a slow heavy groove in the night',
    at: { pace: 0.5, pulse: 0.8, sync: 0.5, light: 0.3, tension: 0.5, organic: 0.35, register: 0.35, space: 0.6, age: 0.4, nature: 0.15, strange: 0.3 } },
  { id: 'lofi', name: 'Lo-fi', blurb: 'dusty chords and a lazy beat',
    at: { pace: 0.45, pulse: 0.75, sync: 0.6, tension: 0.8, motion: 0.8, age: 0.9, organic: 0.75, space: 0.3, nature: 0.35, strange: 0.1, voices: 0.5, melody: 0.55 } },
  { id: 'ritual', name: 'Ritual', blurb: 'hand drums around a fire',
    at: { pace: 0.6, pulse: 0.8, sync: 0.65, organic: 1, strange: 0.6, motion: 0.1, nature: 0.4, water: 0.05 } },
  { id: 'sleep', name: 'Sleep', blurb: 'almost nothing, warm and low',
    at: { pace: 0.02, pulse: 0, density: 0.05, voices: 0.1, melody: 0.1, register: 0.25, bright: 0.2, light: 0.4, change: 0.1, space: 0.7, nature: 0.5, strange: 0.1, life: 0.1, water: 0.8, attack: 0.3 } },
  { id: 'run', name: 'Running', blurb: 'a steady beat to run to', hidden: true,
    at: { pace: 0.9, pulse: 0.9, sync: 0.3, density: 0.55, motion: 0.65, melody: 0.6, change: 0.8, space: 0.3, nature: 0.1, strange: 0.1, organic: 0.5 } },
];
export const ANCHOR_BY_ID = Object.fromEntries(ANCHORS.map((a) => [a.id, a]));

// Mid-heavy draws: extremes are possible but the middle is common.
const draw = (r) => (r.next() + r.next() + r.next()) / 3 * 1.3 - 0.15;
const gauss = (r) => (r.next() + r.next() + r.next() + r.next() - 2) * 0.87;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/*
 * A genome near an anchor (or anywhere), with any dimensions the listener
 * fixed kept exactly. Some dimensions lean on each other, the way music does:
 * a groove raises the pace a little, a crowd of voices needs some density.
 */
export function sampleGenome(r, { anchor, fixed = {}, energy, spread = 0.13 } = {}) {
  const g = {};
  for (const id of DIM_IDS) {
    const a = anchor?.at?.[id];
    g[id] = clamp01(a != null ? a + gauss(r) * spread : draw(r));
  }
  if (energy != null) {
    // energy is a quick way to lean the whole thing calmer or livelier
    for (const [id, k] of [['pace', 0.6], ['pulse', 0.5], ['density', 0.5]]) if (anchor?.at?.[id] == null) g[id] = clamp01(g[id] * (1 - k) + energy * k);
  }
  if (anchor?.at?.pace == null) g.pace = clamp01(g.pace * 0.7 + g.pulse * 0.3);
  if (anchor?.at?.density == null) g.density = clamp01(g.density * 0.75 + g.voices * 0.15 + g.pace * 0.1);
  Object.assign(g, fixed);
  return g;
}

// Jitter a genome a little: near neighbours for exploring and for candidates.
export function nudge(r, g, amount, fixed = {}) {
  const out = {};
  for (const id of DIM_IDS) out[id] = id in fixed ? fixed[id] : clamp01(g[id] + gauss(r) * amount);
  return out;
}
