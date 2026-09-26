/*
 * The sound vocabulary: designed starting points per instrument. The
 * generator picks among them by how they fit a piece (see VOICES in
 * generator.js), then shapes them continuously from the genome, so a preset
 * is where a sound starts, not what it is.
 */

export const PRESETS = {
  pad: {
    warm: { timbre: 'warm', voices: 4, bright: 0.38, attack: 5, release: 8, detune: 0.45, movement: 0.35, motion: 0.3, tone: 0.8, rev: 0.75 },
    glass: { timbre: 'glass', voices: 4, bright: 0.55, attack: 3, release: 7, detune: 0.3, movement: 0.5, motion: 0.2, tone: 0.85, rev: 0.8 },
    air: { timbre: 'air', voices: 5, bright: 0.5, attack: 7, release: 10, detune: 0.5, movement: 0.6, motion: 0.4, tone: 0.85, rev: 0.85 },
    velvet: { timbre: 'warm', voices: 3, bright: 0.22, attack: 6, release: 9, detune: 0.5, movement: 0.3, motion: 0.2, tone: 0.7, rev: 0.7 },
    organ: { timbre: 'organ', voices: 4, bright: 0.3, attack: 2.5, release: 6, detune: 0.15, movement: 0.2, motion: 0.1, tone: 0.75, rev: 0.7 },
    hollow: { timbre: 'hollow', voices: 4, bright: 0.35, attack: 4, release: 8, detune: 0.6, movement: 0.5, motion: 0.45, tone: 0.8, rev: 0.8 },
    analog: { timbre: 'analog', voices: 4, bright: 0.42, attack: 3.5, release: 7, detune: 0.55, movement: 0.3, motion: 0.5, tone: 0.8, rev: 0.65 },
  },
  drone: {
    deep: { wave: 'triangle', bright: 0.25, detune: 0.35, fifth: 0.4, octUp: 0.2, sub: 0.6, motion: 0.3, reso: 0.1, oct: 0, rev: 0.5 },
    choral: { wave: 'sawtooth', bright: 0.28, detune: 0.55, fifth: 0.6, octUp: 0.35, sub: 0.35, motion: 0.4, reso: 0.15, oct: 0, rev: 0.55 },
    tanpura: { wave: 'sawtooth', bright: 0.45, detune: 0.3, fifth: 0.9, octUp: 0.5, sub: 0.3, motion: 0.3, reso: 0.3, oct: 0, rev: 0.45 },
    hum: { wave: 'sine', bright: 0.2, detune: 0.2, fifth: 0.3, octUp: 0.15, sub: 0.8, motion: 0.2, reso: 0, oct: 0, rev: 0.4 },
    space: { wave: 'sawtooth', bright: 0.35, detune: 0.7, fifth: 0.5, octUp: 0.6, sub: 0.4, motion: 0.7, reso: 0.45, oct: 0, rev: 0.8 },
  },
  strings: {
    section: { voices: 4, ensemble: 0.6, bow: 0.4, vibrato: 0.35, attack: 4, release: 7, oct: 0, rev: 0.75 },
    cello: { voices: 2, ensemble: 0.3, bow: 0.35, vibrato: 0.45, attack: 3, release: 6, oct: -1, rev: 0.7 },
    high: { voices: 3, ensemble: 0.7, bow: 0.55, vibrato: 0.3, attack: 5, release: 8, oct: 1, rev: 0.85 },
    distant: { voices: 4, ensemble: 0.8, bow: 0.25, vibrato: 0.2, attack: 7, release: 10, oct: 0, rev: 0.95, tone: 0.7 },
  },
  choir: {
    ooh: { vowel: 0.15, vowelDrift: 0.3, voices: 3, vibrato: 0.35, vibRate: 4.8, attack: 6, release: 9, oct: 0, rev: 0.95 },
    aah: { vowel: 0.55, vowelDrift: 0.4, voices: 4, vibrato: 0.45, vibRate: 5, attack: 5, release: 9, oct: 0, rev: 0.95 },
    monks: { vowel: 0.25, vowelDrift: 0.2, voices: 3, vibrato: 0.15, vibRate: 4, attack: 7, release: 10, oct: -1, rev: 0.9 },
  },
  shimmer: {
    glints: { density: 0.4, length: 0.4, harm: 0.15, sparkle: 0.1, rev: 1, dly: 0.4 },
    aurora: { density: 0.6, length: 0.8, harm: 0.25, sparkle: 0.2, rev: 1, dly: 0.5 },
  },
  piano: {
    felt: { felt: 0.8, decay: 5, noise: 0.2, detune: 0.06, roll: 0.3, rev: 0.6, dly: 0.15 },
    grand: { felt: 0.25, decay: 7, noise: 0.05, detune: 0.03, roll: 0.2, rev: 0.55, dly: 0.1 },
    upright: { felt: 0.5, decay: 4, noise: 0.35, detune: 0.3, roll: 0.4, rev: 0.45, dly: 0.1 },
  },
  keys: {
    kalimba: { decay: 2.5, tine: 0.5, warmth: 0.6, rev: 0.55, dly: 0.25 },
    music_box: { decay: 1.6, tine: 0.8, warmth: 0.3, oct: 1, rev: 0.6, dly: 0.3 },
  },
  bells: {
    glass: { metal: 'glass', bright: 0.5, decay: 6, rev: 0.8, dly: 0.3 },
    temple: { metal: 'bell', bright: 0.35, decay: 8, rev: 0.85, dly: 0.2 },
    chime: { metal: 'chime', bright: 0.6, decay: 5, rev: 0.8, dly: 0.35 },
    soft: { metal: 'soft', bright: 0.4, decay: 5, rev: 0.75, dly: 0.25 },
  },
  marimba: {
    soft: { hardness: 0.3, decay: 1, rev: 0.45, dly: 0.2 },
    wood: { hardness: 0.6, decay: 0.7, rev: 0.35, dly: 0.15 },
  },
  arp: {
    pluck: { wave: 'triangle', shape: 'updown', rate: 2, octaves: 2, gate: 0.5, pluck: 0.5, reso: 0.2, rev: 0.5, dly: 0.35 },
    sequence: { wave: 'sawtooth', shape: 'up', rate: 1, octaves: 2, gate: 0.35, pluck: 0.6, reso: 0.3, rev: 0.4, dly: 0.3 },
    glass: { wave: 'sine', shape: 'converge', rate: 2, octaves: 2, gate: 0.6, pluck: 0.4, reso: 0.1, rev: 0.7, dly: 0.45 },
  },
  flute: {
    flute: { voice: 'flute', breath: 0.3, vibrato: 0.35, glide: 0.2, phrase: 5, rev: 0.7, dly: 0.2 },
    shakuhachi: { voice: 'shaku', breath: 0.55, vibrato: 0.25, glide: 0.35, phrase: 4, rev: 0.75, dly: 0.15 },
    ocarina: { voice: 'ocarina', breath: 0.2, vibrato: 0.3, glide: 0.15, phrase: 5, rev: 0.65, dly: 0.25 },
  },
  bowls: {
    tibetan: { decay: 1.1, beating: 0.5, hardness: 0.3, quant: 0.3, rev: 0.8 },
  },
  bass: {
    held: { pattern: 'held', wave: 'triangle', length: 0.9, glide: 0.1, pluck: 0.2, drive: 0.05, oct: 0 },
    roots: { pattern: 'roots', wave: 'triangle', length: 0.7, glide: 0.1, pluck: 0.35, drive: 0.1, oct: 0 },
    pulse: { pattern: 'pulse', wave: 'sawtooth', length: 0.5, glide: 0.05, pluck: 0.5, drive: 0.15, oct: 0 },
    dub: { pattern: 'groove', bstyle: 'dub', busy: 0.45, pluck: 0.5, drive: 0, tone: 0.75, oct: 0 },
    funk: { pattern: 'groove', bstyle: 'funk', busy: 0.55, pluck: 0.5, drive: 0, tone: 0.75, oct: 0 },
    walk: { pattern: 'walk', wave: 'triangle', length: 0.75, glide: 0.05, pluck: 0.4, drive: 0.1, oct: 0 },
  },
  rain: {
    gentle: { intensity: 0.35, drops: 0.3, hiss: 0.4, surface: 'leaves' },
    steady: { intensity: 0.6, drops: 0.45, hiss: 0.55, surface: 'open' },
    roof: { intensity: 0.5, drops: 0.6, hiss: 0.35, surface: 'roof' },
    window: { intensity: 0.4, drops: 0.55, hiss: 0.3, surface: 'glass' },
  },
  ocean: { calm: { swell: 0.4, period: 12, foam: 0.3 }, waves: { swell: 0.65, period: 9, foam: 0.5 } },
  stream: { brook: { flow: 0.45, babble: 0.55, depth: 0.4 }, river: { flow: 0.7, babble: 0.35, depth: 0.7 } },
  wind: { breeze: { gusts: 0.35, pitch: 0.45, whistle: 0.15, speed: 0.35 }, high: { gusts: 0.6, pitch: 0.6, whistle: 0.35, speed: 0.5 } },
  fire: { hearth: { crackle: 0.5, roar: 0.35, pops: 0.35 } },
  birds: { dawn: { density: 0.55, species: 'mixed', distance: 0.3 }, distant: { density: 0.35, species: 'whistle', distance: 0.6 }, owls: { density: 0.25, species: 'owl', distance: 0.5 } },
  night: { crickets: { chorus: 0.6, rate: 0.5, pitch: 0.5, frogs: 0.15 }, pond: { chorus: 0.4, rate: 0.45, pitch: 0.45, frogs: 0.5 } },
  thunder: { distant: { frequency: 0.35, distance: 0.7, length: 0.6 } },
  noise: { brown: { color: 'brown', sweep: 0.25, sweepRate: 0.2 }, pink: { color: 'pink', sweep: 0.3, sweepRate: 0.25 } },
  binaural: { theta: { beat: 6, carrier: 0.4, pulse: 0 }, alpha: { beat: 10, carrier: 0.5, pulse: 0 }, delta: { beat: 3, carrier: 0.3, pulse: 0 } },
};
