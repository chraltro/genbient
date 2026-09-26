// The soundscape drawn as a field of ridge lines, like ink on a score.
// Notes lift the line nearest their pitch and the lift travels outward;
// a finger bends the lines beneath it; breathing swells the whole field.
// Drawing is strokes and flat fills only (no gradients, no blur) and the
// frame rate is capped, which keeps phones cool.
import { PALETTES } from './scenes.js';
import { VISUAL_PARAMS, defaults } from './params.js';
import { clamp, lerp, rand } from './util.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const toRGB = (p) => ({ bg: hex(p.bg), ink: hex(p.ink), accent: hex(p.accent) });

export const QUALITY = {
  saver: { fps: 20, dpr: 1, lines: 0.6, points: 48 },
  balanced: { fps: 30, dpr: 1.5, lines: 1, points: 64 },
  smooth: { fps: 60, dpr: 2, lines: 1, points: 84 },
};

export class Visuals {
  constructor(canvas, engine) {
    this.c = canvas;
    this.g = canvas.getContext('2d', { alpha: false });
    this.engine = engine;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.col = toRGB(PALETTES.slate);
    this.target = toRGB(PALETTES.slate);
    this.vp = defaults(VISUAL_PARAMS);
    this.quality = QUALITY.balanced;
    this.level = 0;
    this.pulse = 0;
    this.breath = null;
    this.busy = false; // a sheet covers most of the screen
    this.t = rand(0, 100);
    this.bumps = [];
    this.pending = [];
    this.fingers = new Map();
    this.drawing = false; // Simple mode: fingers leave fading colour trails
    this.trails = [];
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    this.lastDraw = 0;
    // at rest (paused, no fingers, colours settled) the loop naps between frames
    const loop = (ts) => {
      this.frame(ts);
      if (this.resting()) setTimeout(() => requestAnimationFrame(loop), 140);
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  resting() {
    const c = this.col, tg = this.target;
    const settled = ['bg', 'ink'].every((k) => Math.abs(c[k][0] - tg[k][0]) + Math.abs(c[k][1] - tg[k][1]) + Math.abs(c[k][2] - tg[k][2]) < 1.5);
    return !this.engine.playing && !this.fingers.size && !this.breath && !this.trails.length && settled;
  }

  setQuality(q) { this.quality = QUALITY[q] || QUALITY.balanced; this.resize(); }
  setParams(vp) { Object.assign(this.vp, vp); }
  setPalette(id) { this.target = toRGB(PALETTES[id] || PALETTES.slate); }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.quality.dpr);
    this.dpr = dpr;
    this.W = innerWidth;
    this.H = innerHeight;
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
  }

  get lineCount() { return Math.max(8, Math.round(lerp(14, 44, this.vp.vMotes) * this.quality.lines)); }
  get top() { return this.H * 0.3; }
  get bottom() { return this.H * 0.86; }

  lineForFreq(f) {
    const fy = clamp((Math.log2(Math.max(40, f)) - 5.5) / 7, 0, 1);
    return Math.round((1 - fy) * (this.lineCount - 1));
  }

  note(ev) { if (this.pending.length < 80) this.pending.push(ev); }

  // Finger input, in CSS pixels.
  touch(id, x, y, down) {
    if (down === false) {
      const f = this.fingers.get(id);
      if (f) this.addBump(f.x, this.lineAtY(f.y), 0.6, 'touch');
      this.fingers.delete(id);
      if (this.stroke) delete this.stroke[id];
      return;
    }
    const prev = this.fingers.get(id);
    this.fingers.set(id, { x, y, a: prev ? prev.a : 0 });
    if (this.drawing) {
      // one stroke per finger; colour follows pitch: warm and low on the left, cool and high on the right
      if (!prev || !this.stroke?.[id]) (this.stroke ||= {})[id] = { pts: [], hue: 20 + (x / this.W) * 220 };
      const s = this.stroke[id];
      s.pts.push({ x, y, t: performance.now() });
      if (s.pts.length === 1) this.trails.push(s);
      if (this.trails.length > 24) this.trails.shift();
    }
  }

  lineAtY(y) {
    const L = this.lineCount;
    return clamp(Math.round(((y - this.top) / (this.bottom - this.top)) * (L - 1)), 0, L - 1);
  }

  addBump(x, line, v, kind) {
    this.bumps.push({ x, line, v, age: 0, kind });
    if (this.bumps.length > 48) this.bumps.shift();
  }

  spawn(ev) {
    if (ev.kind === 'drum') { this.pulse = Math.min(1, this.pulse + ev.v * 0.6); return; }
    if (ev.kind === 'touch') return; // the finger already shapes the field
    const big = { bowls: 1, thunder: 1, ocean: 1, pulse: 1 }[ev.kind];
    const x = this.W / 2 + (ev.pan || 0) * this.W * 0.36 + rand(-0.04, 0.04) * this.W;
    this.addBump(x, this.lineForFreq(ev.f), clamp(ev.v || 0.5, 0.1, 1.6) * (big ? 1.6 : 1), ev.kind);
  }

  frame(ts) {
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    const playing = this.engine.playing;
    // Cap the frame rate: full rate only when it matters.
    let fps = this.quality.fps;
    if (!playing && !this.fingers.size) fps = Math.min(fps, 12);
    if (this.busy) fps = Math.min(fps, 10);
    if (this.reduced) fps = Math.min(fps, 15);
    const draw = ts - this.lastDraw >= 1000 / fps - 2;
    this.advance(dt, playing, draw);
    if (!draw) return;
    this.lastDraw = ts;
    this.draw();
  }

  advance(dt, playing, sample) {
    const speed = (this.reduced ? 0.3 : 1) * (playing ? 1 : 0.35) * lerp(0.15, 2.2, this.vp.vMotion);
    this.t += dt * speed;
    const k = 1 - Math.exp(-dt * 0.8);
    const c = this.col, tg = this.target;
    c.bg = mixc(c.bg, tg.bg, k);
    c.ink = mixc(c.ink, tg.ink, k);
    c.accent = mixc(c.accent, tg.accent, k);
    if (sample) {
      const lv = this.engine.level();
      this.level = lerp(this.level, lv, lv > this.level ? 0.3 : 0.06);
    }
    this.pulse *= Math.exp(-dt * 4);
    for (const b of this.bumps) b.age += dt;
    if (this.bumps.length && this.bumps[0].age > 6) this.bumps = this.bumps.filter((b) => b.age < 6);
    for (const f of this.fingers.values()) f.a = Math.min(1, f.a + dt * 4);
    const eng = this.engine;
    if (eng.ctx) {
      const now = eng.ctx.currentTime;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const ev = this.pending[i];
        if (ev.t <= now + 0.02) {
          this.pending.splice(i, 1);
          if (now - ev.t < 1.5) this.spawn(ev);
        }
      }
    }
  }

  draw() {
    const { g, dpr, W, H, col, vp } = this;
    const L = this.lineCount;
    const P = this.quality.points;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = rgba(col.bg, 1);
    g.fillRect(0, 0, W, H);

    let breathAmp = 1, spread = 1;
    if (this.breath) {
      breathAmp = lerp(0.35, 1.9, this.breath.scale);
      spread = lerp(0.92, 1.04, this.breath.scale);
    }
    const mid = (this.top + this.bottom) / 2;
    const top = mid - (mid - this.top) * spread;
    const bottom = mid + (this.bottom - mid) * spread;
    const gap = (bottom - top) / (L - 1);
    const amp = gap * (0.6 + vp.vGlow * 2.2) * (1 + this.level * 2.5 + this.pulse * 0.8) * breathAmp;
    const react = H * 0.07 * (0.2 + vp.vRipples);
    const t = this.t;
    const sigmaW = W * 0.3;
    const xs = new Float32Array(P);
    const env = new Float32Array(P);
    for (let k = 0; k < P; k++) {
      xs[k] = (k / (P - 1)) * W;
      const d = (xs[k] - W / 2) / sigmaW;
      env[k] = Math.exp(-d * d);
    }
    const ys = new Float32Array(P);
    const fingers = [...this.fingers.values()];
    const touchAmt = vp.vTrails;
    const depth = vp.vRings;
    g.lineJoin = 'round';
    g.lineWidth = lerp(0.6, 1.8, vp.vOrb);

    for (let i = 0; i < L; i++) {
      const base = top + i * gap;
      let heat = 0;
      const lineBumps = this.bumps.filter((b) => Math.abs(b.line - i) <= 2);
      for (let k = 0; k < P; k++) {
        const x = xs[k];
        const n = 0.5 + 0.5 * (Math.sin(x * 0.009 + t * 0.35 + i * 0.73) * 0.45
          + Math.sin(x * 0.023 - t * 0.27 + i * 1.31) * 0.25 + Math.sin(x * 0.004 + t * 0.12 + i * 0.21) * 0.3);
        let y = n * amp * (0.25 + env[k]);
        for (const b of lineBumps) {
          const near = b.line === i ? 1 : Math.abs(b.line - i) === 1 ? 0.45 : 0.15;
          const s = 16 + b.age * 55;
          const fade = Math.exp(-b.age * 0.9) * b.v * near;
          const dl = x - (b.x - b.age * 70), dr = x - (b.x + b.age * 70);
          y += react * fade * (Math.exp(-(dl * dl) / (2 * s * s)) + Math.exp(-(dr * dr) / (2 * s * s))) * 0.6;
        }
        for (const f of fingers) {
          const dy = (f.y - base) / (gap * 2.5);
          const dx = (x - f.x) / (W * 0.09);
          y += H * 0.05 * touchAmt * f.a * Math.exp(-dx * dx - dy * dy);
        }
        ys[k] = base - y;
      }
      for (const b of lineBumps) if (b.line === i) heat += Math.exp(-b.age * 1.2) * b.v;
      for (const f of fingers) heat += Math.exp(-(((f.y - base) / (gap * 2)) ** 2)) * 0.8 * f.a;
      // occlude the lines behind, then draw the ridge
      g.beginPath();
      g.moveTo(xs[0], ys[0]);
      for (let k = 1; k < P; k++) g.lineTo(xs[k], ys[k]);
      // only the band a ridge can rise through needs covering, not the whole screen below
      g.lineTo(W, base + 3);
      g.lineTo(0, base + 3);
      g.closePath();
      g.fillStyle = rgba(col.bg, 1);
      g.fill();
      g.beginPath();
      g.moveTo(xs[0], ys[0]);
      for (let k = 1; k < P; k++) g.lineTo(xs[k], ys[k]);
      const d = i / (L - 1);
      const alpha = lerp(1 - depth * 0.75, 1, d) * 0.85;
      g.strokeStyle = rgba(mixc(col.ink, col.accent, clamp(heat * 0.8, 0, 1)), alpha);
      g.stroke();
    }
    this.drawTrails();
  }

  // Colour a finger leaves behind in Simple mode, fading over a few seconds.
  drawTrails() {
    if (!this.trails.length) return;
    const { g } = this;
    const now = performance.now();
    const light = this.col.bg[0] + this.col.bg[1] + this.col.bg[2] > 380;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const s of this.trails) {
      while (s.pts.length && now - s.pts[0].t > 3500) s.pts.shift();
      for (let k = 1; k < s.pts.length; k++) {
        const a = s.pts[k - 1], b = s.pts[k];
        const life = 1 - (now - b.t) / 3500;
        const hue = s.hue + k * 1.5;
        g.strokeStyle = `hsla(${hue % 360}, 80%, ${light ? 45 : 62}%, ${Math.max(0, life) * 0.85})`;
        g.lineWidth = 3 + life * 7;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
        g.stroke();
      }
    }
    this.trails = this.trails.filter((s) => s.pts.length);
  }
}
