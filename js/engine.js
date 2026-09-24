// Audio engine: tempo transport, harmony, master effects, evolution and the
// hooks the touch instrument uses.
import { Harmony } from './theory.js';
import { LAYERS } from './layers/index.js';
import { GLOBAL_PARAMS, METERS, defaults } from './params.js';
import { accent } from './composer.js';
import { Touch } from './touch.js';
import { clamp, lerp, rand, chance, pick, glide, gain, filter, makePanner, osc } from './util.js';

const LOOKAHEAD = 1.4;

function makeNoise(ctx, seconds = 6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const mk = () => ctx.createBuffer(1, len, ctx.sampleRate);
  const white = mk(), pink = mk(), brown = mk();
  const w = white.getChannelData(0), p = pink.getChannelData(0), b = brown.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x * 0.5;
    b0 = 0.99886 * b0 + x * 0.0555179; b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852; b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522; b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (const d of [w, p, b]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return { white, pink, brown };
}

function makeImpulse(ctx, seconds, damp) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = (0.04 + 0.9 * (1 - damp * 0.8)) * Math.pow(1 - t, 1 + damp * 2) + 0.02;
      lp += (Math.random() * 2 - 1 - lp) * k;
      const onset = Math.min(1, i / (rate * 0.015));
      d[i] = lp * Math.pow(1 - t, 2.4) * onset;
    }
  }
  return buf;
}

const curves = new Map();
function satCurve(amount) {
  const key = Math.round(amount * 20);
  if (curves.has(key)) return curves.get(key);
  const k = 1 + key / 20 * 5;
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  curves.set(key, c);
  return c;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.layers = {};
    this.handlers = {};
    this.playing = false;
    this.g = defaults(GLOBAL_PARAMS);
    this.volume = 0.85;
    this.harmony = new Harmony();
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, data) { for (const fn of this.handlers[ev] || []) fn(data); }
  notify(note) { this.emit('note', note); }

  get time() { return this.ctx ? this.ctx.currentTime : 0; }
  get meter() { return METERS[this.g.meter] || METERS['4/4']; }
  get stepDur() { return 60 / this.g.bpm / 4; }
  get barSeconds() { return this.meter.steps * this.stepDur; }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC({ latencyHint: 'playback' }); } catch { this.ctx = new AC(); }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    const ctx = this.ctx;

    // master chain
    this.mix = gain(ctx, 1);
    this.lowcut = filter(ctx, 'highpass', 30, 0.7);
    this.tone = filter(ctx, 'lowpass', 12000, 0.5);
    this.sculpt = filter(ctx, 'lowpass', 20000, 0.5);
    this.arr = filter(ctx, 'lowpass', 20000, 0.8); // swept by the running arranger
    this.warm = ctx.createWaveShaper();
    this.warm.oversample = 'none';
    this.warmOut = gain(ctx, 1);
    this.wow = ctx.createDelay(0.1);
    this.wow.delayTime.value = 0.012;
    this.wowLfo = osc(ctx, 'sine', 0.55);
    this.wowG = gain(ctx, 0);
    this.flut = osc(ctx, 'sine', 6.2);
    this.flutG = gain(ctx, 0);
    this.wowLfo.connect(this.wowG).connect(this.wow.delayTime);
    this.flut.connect(this.flutG).connect(this.wow.delayTime);
    this.wowLfo.start(); this.flut.start();

    // chorus: dry + two modulated delays spread left/right
    this.chIn = gain(ctx, 1);
    this.chOut = gain(ctx, 1);
    this.chWet = gain(ctx, 0);
    this.chIn.connect(this.chOut);
    for (const [base, rate, pan] of [[0.013, 0.27, -0.8], [0.019, 0.33, 0.8]]) {
      const d = ctx.createDelay(0.1);
      d.delayTime.value = base;
      const l = osc(ctx, 'sine', rate);
      const lg = gain(ctx, 0.003);
      l.connect(lg).connect(d.delayTime);
      l.start();
      const p = makePanner(ctx, pan);
      this.chIn.connect(d).connect(p).connect(this.chWet);
    }
    this.chWet.connect(this.chOut);

    this.drive = gain(ctx, 0.95);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.03;
    this.comp.release.value = 0.5;
    this.master = gain(ctx, 0);
    this.mix.connect(this.lowcut).connect(this.tone).connect(this.sculpt).connect(this.arr).connect(this.warm).connect(this.warmOut)
      .connect(this.wow).connect(this.chIn);
    this.chOut.connect(this.drive).connect(this.comp).connect(this.master).connect(ctx.destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.master.connect(this.analyser);
    this.scope = new Float32Array(this.analyser.fftSize);

    this.dryIn = gain(ctx, 1);
    this.dryIn.connect(this.mix);
    this.pumpIn = gain(ctx, 1);
    this.pumpIn.connect(this.dryIn);

    // reverb: two convolvers so size changes crossfade instead of clicking
    this.revIn = gain(ctx, 1);
    this.pre = ctx.createDelay(0.5);
    this.revOut = gain(ctx, 0.8);
    this.revIn.connect(this.pre);
    this.convs = [0, 1].map(() => {
      const c = ctx.createConvolver();
      const g = gain(ctx, 0);
      c.connect(g).connect(this.revOut);
      return { c, g, live: false };
    });
    this.revActive = 0;
    this.revOut.connect(this.mix);

    // tempo-synced ping-pong echo
    this.dlyIn = gain(ctx, 1);
    this.dL = ctx.createDelay(4);
    this.dR = ctx.createDelay(4);
    this.fbL = filter(ctx, 'lowpass', 2600);
    this.fbR = filter(ctx, 'lowpass', 2600);
    this.fbGL = gain(ctx, 0.42);
    this.fbGR = gain(ctx, 0.42);
    this.pL = makePanner(ctx, -0.75);
    this.pR = makePanner(ctx, 0.75);
    this.dlyOut = gain(ctx, 0.55);
    this.dlyIn.connect(this.dL);
    this.dL.connect(this.fbL).connect(this.fbGL).connect(this.dR);
    this.dR.connect(this.fbR).connect(this.fbGR).connect(this.dL);
    this.dL.connect(this.pL).connect(this.dlyOut);
    this.dR.connect(this.pR).connect(this.dlyOut);
    this.dlyOut.connect(this.mix);
    this.dlyToRev = gain(ctx, 0.45);
    this.dlyOut.connect(this.dlyToRev).connect(this.revIn);

    this.noise = makeNoise(ctx);
    const pw = (re) => ctx.createPeriodicWave(new Float32Array([0, ...re]), new Float32Array(re.length + 1));
    this.waves = {
      flute: pw([1, 0.32, 0.12, 0.06, 0.02]),
      shaku: pw([1, 0.5, 0.25, 0.18, 0.1, 0.06]),
      ocarina: pw([1, 0.08, 0.03]),
      whistle: pw([1, 0.02]),
    };

    for (const def of LAYERS) this.layers[def.id] = new def.cls(this, def);
    this.touch = new Touch(this);

    this.step = 0;
    this.sib = 0;
    this.bar = -1;
    this.nextStep = ctx.currentTime + 0.2;
    this.nextDriftAt = ctx.currentTime + 4;
    this.nextEvolveAt = ctx.currentTime + 30;
    this.applyGlobals(true);
    this.startClock();
  }

  startClock() {
    const tick = () => this.tick();
    try {
      const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.clock = new Worker(url);
      this.clock.onmessage = tick;
      this.clock.postMessage(80);
    } catch {
      setInterval(tick, 80);
    }
  }

  /* ─── transport ─── */

  tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;
    if (this.nextStep < now - 0.3) this.nextStep = now + 0.05;

    let guard = 0;
    while (this.nextStep < horizon && guard++ < 256) this.runStep();

    for (const id in this.layers) {
      const l = this.layers[id];
      if (l.running) {
        try { l.schedule(now, horizon); } catch (err) { console.error(id, err); }
      }
    }

    if (now >= this.nextDriftAt) {
      const d = this.g.drift;
      glide(this.tone.frequency, this.toneHz() * rand(1 - 0.4 * d, 1 + 0.25 * d), now, rand(3, 8));
      this.nextDriftAt = now + rand(6, 14);
    }
    if (now >= this.nextEvolveAt) {
      this.evolve();
      this.nextEvolveAt = now + lerp(90, 12, this.g.evolve) * rand(0.6, 1.4);
    }
  }

  runStep() {
    const m = this.meter;
    const dur = this.stepDur;
    if (this.sib >= m.steps) this.sib = 0;
    const sib = this.sib;
    let chordStart = false;
    if (sib === 0) {
      this.bar++;
      this.emit('bar', { bar: this.bar, t: this.nextStep, dur: m.steps * dur, beat: m.groups[0] * dur, step: dur });
      // in half-time a musical bar spans two drum bars
      const cb = this.g.chordBars * (this.g.halfTime ? 2 : 1);
      if (this.bar > 0 && this.bar % cb === 0) {
        this.advanceHarmony(this.nextStep);
        chordStart = true;
      } else if (this.bar === 0) chordStart = true;
    }
    const swing = sib % 2 === 1 ? this.g.swing * dur * 0.66 : 0;
    const info = {
      t: this.nextStep + swing, step: Math.max(0, this.bar) * m.steps + sib, sib, bar: this.bar,
      spb: m.steps, groups: m.groups, dur, chordStart,
    };
    this.stepT = this.nextStep;
    if (this.g.beat && this.g.pump > 0 && accent(sib, m.groups) >= 0.8 && !this.layers.kick.on) this.duck(info.t, 0.8);
    // Half-time: drums keep the full tempo; everything musical hears a clock
    // running at half speed, so chords, bass and melodies stay unhurried.
    let slow = info;
    if (this.g.halfTime) {
      const hStep = Math.floor(info.step / 2);
      slow = info.step % 2 ? null : { ...info, step: hStep, sib: hStep % m.steps, dur: dur * 2, t: this.nextStep };
    }
    for (const id in this.layers) {
      const l = this.layers[id];
      if (!l.running) continue;
      const li = l.def.group === 'rhythm' ? info : slow;
      if (!li) continue;
      try { l.onStep(li); } catch (err) { console.error(id, err); }
    }
    this.sib = sib + 1;
    this.nextStep += dur;
  }

  // Humanised time: never early, a little late.
  human(t) { return t + Math.random() * this.g.humanize * 0.02; }

  // In half-time (running) all musical events snap to the beat grid.
  get locked() { return !!this.g.halfTime; }

  nextBeat(t) {
    const dur = this.stepDur;
    const g0 = this.meter.groups[0];
    const toBeat = (g0 - (this.sib % g0)) % g0;
    const t0 = this.nextStep + toBeat * dur;
    const beat = g0 * dur;
    return t <= t0 ? t0 : t0 + Math.ceil((t - t0) / beat) * beat;
  }

  duck(t, v = 1) {
    const a = this.g.pump * v;
    if (a <= 0.01) return;
    const p = this.pumpIn.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(1 - a * 0.75, t + 0.01);
    p.setTargetAtTime(1, t + 0.03, this.stepDur * 1.4);
  }

  shaper(amount) {
    const s = this.ctx.createWaveShaper();
    s.curve = satCurve(clamp(amount, 0, 1));
    return s;
  }

  /* ─── harmony ─── */

  syncHarmonyOpts() {
    const g = this.g;
    Object.assign(this.harmony.opts, { prog: g.prog, complexity: g.complexity, sus: g.sus, inversions: g.inversions, loopLen: g.loopLen });
  }

  advanceHarmony(t) {
    const h = this.harmony;
    const loopStart = h.opts.prog !== 'loop' || h.loopPos === h.loop.length - 1;
    if (loopStart && chance(this.g.modulate * 0.35)) {
      const [root, mode] = h.modulation(this.g.modType);
      h.setKey(root, mode);
      for (const id in this.layers) this.layers[id].onKey(t);
      this.emit('key', h);
    } else {
      h.advance(this.g.repetition);
      for (const id in this.layers) this.layers[id].onChord(t);
    }
    this.emit('chord', h);
  }

  /* ─── evolution: sounds slowly reshape themselves ─── */

  evolve() {
    const e = this.g.evolve;
    if (e < 0.02) return;
    const live = Object.values(this.layers).filter((l) => l.on);
    if (!live.length) return;
    const l = pick(live);
    const skip = new Set(['vol', 'pan', 'oct', 'steps', 'hits', 'rotate', 'prob', 'ghost', 'voices', 'octaves', 'phrase', 'beat', 'pattern']);
    const cands = l.def.schema.filter((p) => p.type === 'range' && !skip.has(p.id));
    const n = chance(e) ? 2 : 1;
    for (let i = 0; i < n && cands.length; i++) {
      const p = pick(cands);
      const span = p.max - p.min;
      const v = clamp(l.p[p.id] + rand(-1, 1) * span * (0.06 + e * 0.14), p.min, p.max);
      this.emit('evolve', { layer: l.id, id: p.id, value: v });
    }
    if (chance(e * 0.4)) {
      const gp = pick(['bright', 'density', 'spread', 'complexity', 'revMix', 'chorus']);
      const v = clamp(this.g[gp] + rand(-0.1, 0.1) * (0.5 + e), 0, 1);
      this.emit('evolve', { global: true, id: gp, value: v });
    }
  }

  /* ─── globals ─── */

  toneHz() { return 700 * Math.pow(26, this.g.bright); }

  setGlobal(id, v) {
    this.g[id] = v;
    if (!this.ctx) return;
    if (['prog', 'complexity', 'sus', 'inversions', 'loopLen'].includes(id)) {
      this.syncHarmonyOpts();
      if (id === 'prog' || id === 'loopLen') this.harmony.loop = [];
    }
    this.applyGlobals(false, id);
  }

  applyGlobals(immediate = false, only = null) {
    if (!this.ctx) return;
    const g = this.g;
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.01 : 0.4;
    const is = (...ids) => !only || ids.includes(only);
    if (is('bright')) glide(this.tone.frequency, this.toneHz(), t, tc);
    if (is('lowcut')) glide(this.lowcut.frequency, 20 * Math.pow(15, g.lowcut), t, tc);
    if (is('warmth')) {
      this.warm.curve = g.warmth > 0.02 ? satCurve(g.warmth * 0.7) : null;
      glide(this.warmOut.gain, 1 - g.warmth * 0.15, t, tc);
    }
    if (is('wow')) {
      glide(this.wowG.gain, g.wow * 0.0025, t, tc);
      glide(this.flutG.gain, g.wow * 0.00025, t, tc);
    }
    if (is('chorus')) glide(this.chWet.gain, g.chorus * 0.8, t, tc);
    if (is('revMix')) glide(this.revOut.gain, 0.1 + g.revMix * 1.2, t, tc);
    if (is('revPre')) glide(this.pre.delayTime, g.revPre * 0.15, t, tc);
    if (is('revSize', 'revDamp')) this.rebuildReverb(immediate);
    if (is('bpm', 'dlyDiv', 'dlySpread')) {
      const q = 60 / g.bpm;
      const dt = clamp(q * g.dlyDiv, 0.05, 3.9);
      glide(this.dL.delayTime, dt, t, immediate ? 0.01 : 1.2);
      glide(this.dR.delayTime, clamp(dt * lerp(1, 1.5, g.dlySpread), 0.05, 3.9), t, immediate ? 0.01 : 1.2);
      if (this.pL.pan) glide(this.pL.pan, -g.dlySpread, t, tc);
      if (this.pR.pan) glide(this.pR.pan, g.dlySpread, t, tc);
    }
    if (is('dlyFb')) { glide(this.fbGL.gain, g.dlyFb, t, tc); glide(this.fbGR.gain, g.dlyFb, t, tc); }
    if (is('dlyTone')) { const f = 600 * Math.pow(12, g.dlyTone); glide(this.fbL.frequency, f, t, tc); glide(this.fbR.frequency, f, t, tc); }
    if (is('dlyMix')) glide(this.dlyOut.gain, g.dlyMix * 1.1, t, tc);
    if (is('touchLevel', 'touchEcho', 'touchVoice')) this.touch.configure();
  }

  rebuildReverb(immediate) {
    clearTimeout(this.revTimer);
    const run = () => {
      const { revSize, revDamp } = this.g;
      const key = `${revSize.toFixed(2)}:${revDamp.toFixed(2)}`;
      if (key === this.revKey) return;
      this.revKey = key;
      const next = 1 - this.revActive;
      const a = this.convs[this.revActive], b = this.convs[next];
      // Convolution is the most expensive thing in the graph: keep the
      // impulse modest and only ever run one reverb once a crossfade ends.
      b.c.buffer = makeImpulse(this.ctx, 1.2 + revSize * 4.8, revDamp);
      if (!b.live) { this.pre.connect(b.c); b.live = true; }
      const t = this.ctx.currentTime;
      glide(b.g.gain, 1, t, immediate ? 0.01 : 0.4);
      glide(a.g.gain, 0, t, immediate ? 0.01 : 0.4);
      this.revActive = next;
      clearTimeout(this.revRetire);
      this.revRetire = setTimeout(() => {
        if (a.live && this.convs[this.revActive] !== a) { try { this.pre.disconnect(a.c); } catch { /* not connected */ } a.live = false; }
      }, immediate ? 50 : 2500);
    };
    if (immediate) run(); else this.revTimer = setTimeout(run, 250);
  }

  // Bring the engine in line with a scene. Everything crossfades.
  apply(scene, { fade = 4 } = {}) {
    this.g = { ...this.g, ...scene.g };
    this.syncHarmonyOpts();
    if (!this.ctx) return;
    this.applyGlobals();
    const h = this.harmony;
    const keyChanged = h.root !== scene.root || h.mode !== scene.mode || h.a4 !== scene.a4 || h.just !== !!scene.just;
    for (const id in this.layers) {
      const s = scene.layers[id];
      if (s) this.layers[id].setAll(s.p);
    }
    if (keyChanged) {
      h.a4 = scene.a4;
      h.just = !!scene.just;
      h.setKey(scene.root, scene.mode);
      const t = this.ctx.currentTime + 0.05;
      for (const id in this.layers) this.layers[id].onKey(t);
    }
    for (const id in this.layers) {
      const l = this.layers[id];
      if (scene.layers[id] && scene.layers[id].on) l.enable(fade);
      else l.disable(fade);
    }
  }

  async play() {
    this.init();
    const ctx = this.ctx;
    clearTimeout(this.suspendTimer);
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    b.connect(ctx.destination);
    b.start();
    if (ctx.state !== 'running') await ctx.resume();
    this.playing = true;
    glide(this.master.gain, this.volume, ctx.currentTime, 1.0);
  }

  pause() {
    if (!this.ctx) return;
    this.playing = false;
    glide(this.master.gain, 0, this.ctx.currentTime, 0.4);
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => { if (!this.playing) this.ctx.suspend(); }, 1800);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && this.playing) glide(this.master.gain, v, this.ctx.currentTime, 0.15);
  }

  fadeOut(seconds) {
    if (this.ctx) glide(this.master.gain, 0, this.ctx.currentTime, seconds / 4);
  }

  level() {
    if (!this.analyser || !this.playing) return 0;
    const d = this.scope;
    if (this.analyser.getFloatTimeDomainData) this.analyser.getFloatTimeDomainData(d);
    let s = 0;
    for (let i = 0; i < d.length; i++) s += d[i] * d[i];
    return clamp(Math.sqrt(s / d.length) * 4, 0, 1);
  }
}
