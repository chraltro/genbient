// Audio engine: master chain, generated reverb, ping-pong delay, the
// look-ahead scheduler and the slow evolution of harmony over time.
import { Harmony } from './theory.js';
import { LAYERS } from './layers.js';
import { clamp, lerp, rand, chance, pick, glide, gain, filter, makePanner } from './util.js';

const LOOKAHEAD = 1.6; // seconds of audio scheduled ahead of the clock

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
  // crossfade the loop seam so looping noise never clicks
  const fade = Math.floor(ctx.sampleRate * 0.05);
  for (const d of [w, p, b]) {
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
  }
  return { white, pink, brown };
}

function makeImpulse(ctx, seconds = 7) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // the tail gets darker as it decays, like a real hall
      const k = 0.08 + 0.85 * Math.pow(1 - t, 2);
      lp += (Math.random() * 2 - 1 - lp) * k;
      const onset = Math.min(1, i / (rate * 0.02));
      d[i] = lp * Math.pow(1 - t, 2.6) * onset;
    }
  }
  return buf;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.layers = {};
    this.handlers = {};
    this.playing = false;
    this.params = { pace: 0.5, evolve: 0.5, bright: 0.6, space: 0.6, volume: 0.85 };
    this.harmony = new Harmony();
  }

  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, data) { for (const fn of this.handlers[ev] || []) fn(data); }
  notify(note) { this.emit('note', note); }

  get rate() { return lerp(0.55, 1.8, this.params.pace); }
  get time() { return this.ctx ? this.ctx.currentTime : 0; }

  // Must be called synchronously inside a user gesture (iOS).
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    try { this.ctx = new AC({ latencyHint: 'playback' }); } catch { this.ctx = new AC(); }
    // Play through the iOS silent switch, like a music app.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    const ctx = this.ctx;

    this.master = gain(ctx, 0);
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 3.5;
    this.comp.attack.value = 0.03;
    this.comp.release.value = 0.5;
    this.tone = filter(ctx, 'lowpass', 12000, 0.5);
    this.lowcut = filter(ctx, 'highpass', 28, 0.7);
    this.mix = gain(ctx, 1);
    this.drive = gain(ctx, 1.5); // a little extra level for phone speakers; the compressor catches peaks
    this.mix.connect(this.lowcut).connect(this.tone).connect(this.drive).connect(this.comp).connect(this.master).connect(ctx.destination);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.master.connect(this.analyser);
    this.scope = new Float32Array(this.analyser.fftSize);

    this.dryIn = gain(ctx, 1);
    this.dryIn.connect(this.mix);

    this.revIn = gain(ctx, 1);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.revOut = gain(ctx, 0.8);
    this.revIn.connect(this.reverb).connect(this.revOut).connect(this.mix);

    // Stereo ping-pong delay with darkening feedback.
    this.dlyIn = gain(ctx, 1);
    this.dL = ctx.createDelay(4);
    this.dR = ctx.createDelay(4);
    const fbL = filter(ctx, 'lowpass', 2600), fbR = filter(ctx, 'lowpass', 2600);
    this.fbGL = gain(ctx, 0.42);
    this.fbGR = gain(ctx, 0.42);
    const pL = makePanner(ctx, -0.75), pR = makePanner(ctx, 0.75);
    this.dlyOut = gain(ctx, 0.55);
    this.dlyIn.connect(this.dL);
    this.dL.connect(fbL).connect(this.fbGL).connect(this.dR);
    this.dR.connect(fbR).connect(this.fbGR).connect(this.dL);
    this.dL.connect(pL).connect(this.dlyOut);
    this.dR.connect(pR).connect(this.dlyOut);
    this.dlyOut.connect(this.mix);
    const dlyToRev = gain(ctx, 0.5);
    this.dlyOut.connect(dlyToRev).connect(this.revIn);

    this.noise = makeNoise(ctx);
    this.waves = {
      flute: ctx.createPeriodicWave(new Float32Array([0, 1, 0.32, 0.12, 0.06, 0.02]), new Float32Array(6)),
    };

    for (const def of LAYERS) this.layers[def.id] = new def.cls(this, def);

    this.applyGlobals(true);
    this.nextChordAt = ctx.currentTime + rand(14, 24);
    this.nextDriftAt = ctx.currentTime + 4;
    this.startClock();
  }

  // A worker-driven clock keeps scheduling when the tab is backgrounded.
  startClock() {
    const tick = () => this.tick();
    try {
      const src = 'let id;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.clock = new Worker(url);
      this.clock.onmessage = tick;
      this.clock.postMessage(100);
    } catch {
      setInterval(tick, 100);
    }
  }

  tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    if (now >= this.nextChordAt) this.advanceHarmony(now + 0.05);

    for (const id in this.layers) {
      const l = this.layers[id];
      if (l.running) {
        try { l.schedule(now, horizon); } catch (err) { console.error(id, err); }
      }
    }

    // The whole mix breathes: slow drift of the master tone.
    if (now >= this.nextDriftAt) {
      const e = this.params.evolve;
      const base = this.toneHz();
      glide(this.tone.frequency, base * rand(1 - 0.35 * e, 1 + 0.2 * e), now, rand(3, 8));
      this.nextDriftAt = now + rand(6, 14);
    }
  }

  chordInterval() { return lerp(55, 14, this.params.evolve) * rand(0.75, 1.3); }

  advanceHarmony(t) {
    const h = this.harmony;
    const e = this.params.evolve;
    if (e > 0.55 && chance((e - 0.55) * 0.25)) {
      h.root = (h.root + pick([5, 7, 5, 7, 3, 9])) % 12;
      h.chord = 0;
      for (const id in this.layers) this.layers[id].onKey(t);
      this.emit('key', h);
    } else {
      h.nextChord();
      for (const id in this.layers) this.layers[id].onChord(t);
    }
    this.nextChordAt = t + this.chordInterval();
    this.emit('chord', h);
  }

  toneHz() { return 700 * Math.pow(26, this.params.bright); }

  applyGlobals(immediate = false) {
    if (!this.ctx) return;
    const { space, pace } = this.params;
    const t = this.ctx.currentTime;
    const tc = immediate ? 0.01 : 1.2;
    glide(this.tone.frequency, this.toneHz(), t, tc);
    glide(this.revOut.gain, 0.15 + space * 1.1, t, tc);
    glide(this.dryIn.gain, 1 - space * 0.4, t, tc);
    const beat = 60 / lerp(50, 84, pace);
    glide(this.dL.delayTime, beat * 0.75, t, immediate ? 0.01 : 2);
    glide(this.dR.delayTime, beat * 1.125, t, immediate ? 0.01 : 2);
    glide(this.fbGL.gain, 0.3 + space * 0.25, t, tc);
    glide(this.fbGR.gain, 0.3 + space * 0.25, t, tc);
  }

  // Bring the engine in line with a scene. Everything crossfades.
  apply(scene, { fade = 4 } = {}) {
    Object.assign(this.params, {
      pace: scene.pace, evolve: scene.evolve, bright: scene.bright, space: scene.space,
    });
    if (!this.ctx) return;
    this.applyGlobals();
    const h = this.harmony;
    const keyChanged = h.root !== scene.root || h.mode !== scene.mode || h.a4 !== scene.a4 || h.just !== !!scene.just;
    if (keyChanged) {
      Object.assign(h, { root: scene.root, mode: scene.mode, a4: scene.a4, just: !!scene.just, chord: 0 });
      const t = this.ctx.currentTime + 0.05;
      for (const id in this.layers) this.layers[id].onKey(t);
      this.nextChordAt = t + this.chordInterval();
    }
    for (const id in this.layers) {
      const l = this.layers[id];
      const s = scene.layers[id];
      if (s && s.on) {
        l.vol = s.vol;
        if (l.ch !== s.ch) l.setCharacter(s.ch);
        l.enable(fade);
      } else {
        if (s) { l.vol = s.vol; l.ch = s.ch; }
        l.disable(fade);
      }
    }
  }

  async play() {
    this.init();
    const ctx = this.ctx;
    clearTimeout(this.suspendTimer);
    // Unlock iOS output with a silent blip inside the gesture.
    const b = ctx.createBufferSource();
    b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    b.connect(ctx.destination);
    b.start();
    if (ctx.state !== 'running') await ctx.resume();
    this.playing = true;
    glide(this.master.gain, this.params.volume, ctx.currentTime, 1.0);
  }

  pause() {
    if (!this.ctx) return;
    this.playing = false;
    glide(this.master.gain, 0, this.ctx.currentTime, 0.4);
    clearTimeout(this.suspendTimer);
    this.suspendTimer = setTimeout(() => { if (!this.playing) this.ctx.suspend(); }, 1800);
  }

  setVolume(v) {
    this.params.volume = v;
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
