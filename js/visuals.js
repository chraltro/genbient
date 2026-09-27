// The music drawn as its own landscape. Every line is a moment of what you
// just heard: the spectrum of the sound, low notes at the centre, high ones
// toward the edges, mirrored like the pulsar plot on Unknown Pleasures. New
// moments rise at the front and recede toward a horizon, so a melody reads
// as a ridge travelling away and a beat as a pulse running back through the
// field. How the land is drawn follows the piece's character: its pace sets
// the scroll, its space the depth, its material smooth curves or cut lines,
// its strangeness a warp. A finger bends the land beneath it; the sleep
// breath swells it. Strokes and flat fills only, and a capped frame rate,
// which keeps phones cool.
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

const F_LO = 45, F_HI = 9000;
const NEUTRAL = { pace: 0.35, space: 0.6, organic: 0.6, strange: 0.2, density: 0.45, pulse: 0.3 };

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
    this.ch = { ...NEUTRAL };
    this.chTarget = { ...NEUTRAL };
    this.level = 0;
    this.pulse = 0;
    this.live = 0; // how much of the field is real sound (vs. resting noise)
    this.breath = null;
    this.busy = false; // a sheet covers most of the screen
    this.t = rand(0, 100);
    this.phase = 0; // progress toward the next line
    this.rows = [];
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
    return !this.engine.playing && !this.fingers.size && !this.breath && !this.trails.length && settled && this.live < 0.01;
  }

  setQuality(q) { this.quality = QUALITY[q] || QUALITY.balanced; this.resize(); }
  setParams(vp) { Object.assign(this.vp, vp); }
  setPalette(id) { this.target = toRGB(PALETTES[id] || PALETTES.slate); }
  // the piece's character (its genome) shapes how the land is drawn
  setCharacter(G) { this.chTarget = { ...NEUTRAL, ...(G || {}) }; }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.quality.dpr);
    this.dpr = dpr;
    this.W = innerWidth;
    this.H = innerHeight;
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
    this.rows = [];
    this.makeGrid();
  }

  makeGrid() {
    const P = this.quality.points;
    this.xs = new Float32Array(P);
    this.freqAt = new Float32Array(P);
    this.env = new Float32Array(P);
    this.cur = new Float32Array(P);
    this.raw = new Float32Array(P);
    this.db = new Float32Array(P);
    this.rest = new Float32Array(P);
    this.heat = new Float32Array(P);
    this.ys = new Float32Array(P);
    this.sx = new Float32Array(P);
    for (let k = 0; k < P; k++) {
      const u = k / (P - 1);
      this.xs[k] = u;
      const d = (u - 0.5) / 0.3;
      this.env[k] = Math.exp(-d * d);
    }
    this.mapFreqs();
  }

  // where each point of a line listens: mirrored (lows at the centre) or, in
  // strange pieces, one sweep from low on the left to high on the right
  mapFreqs() {
    const P = this.quality.points;
    this.mirror = this.ch.strange < 0.72;
    for (let k = 0; k < P; k++) {
      const u = k / (P - 1);
      const w = this.mirror ? Math.abs(u * 2 - 1) : u;
      this.freqAt[k] = F_LO * Math.pow(F_HI / F_LO, Math.pow(w, 0.9));
    }
    // half the spacing between points, as a fraction of frequency
    const perPoint = Math.log2(F_HI / F_LO) / ((this.mirror ? P / 2 : P) - 1);
    this.band = (Math.pow(2, perPoint / 2) - 1);
  }

  get lineCount() { return Math.max(10, Math.round(lerp(16, 46, this.vp.vMotes) * lerp(0.8, 1.15, this.ch.density) * this.quality.lines)); }
  get top() { return this.H * 0.3; }
  get bottom() { return this.H * 0.88; }

  note(ev) { if (this.pending.length < 80) this.pending.push(ev); }

  // Finger input, in CSS pixels.
  touch(id, x, y, down) {
    if (down === false) {
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

  // A note lights its pitch on the newest line, and the light travels back with it.
  spawn(ev) {
    if (ev.kind === 'drum') { this.pulse = Math.min(1, this.pulse + ev.v * 0.6); return; }
    if (ev.kind === 'touch' || !ev.f) return;
    const P = this.quality.points;
    const w = clamp(Math.log(Math.max(F_LO, ev.f) / F_LO) / Math.log(F_HI / F_LO), 0, 1);
    const places = this.mirror ? [0.5 - w / 2, 0.5 + w / 2] : [w];
    const v = clamp(ev.v || 0.5, 0.1, 1.4) * lerp(0.4, 1.2, this.vp.vRipples);
    for (const c of places) {
      for (let k = 0; k < P; k++) {
        const d = (this.xs[k] - c) / 0.035;
        this.heat[k] = Math.min(1.5, this.heat[k] + v * Math.exp(-d * d));
      }
    }
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

  // The newest line: what the music sounds like now (or, at rest, a slow swell).
  listen() {
    const P = this.quality.points;
    const eng = this.engine;
    const spec = eng.spec;
    const live = this.live;
    let bins = null;
    if (spec && live > 0.001) {
      bins = this.bins && this.bins.length === spec.frequencyBinCount ? this.bins : (this.bins = new Float32Array(spec.frequencyBinCount));
      spec.getFloatFrequencyData(bins);
    }
    const hzPerBin = eng.ctx ? eng.ctx.sampleRate / (spec?.fftSize || 2048) : 23.4;
    const t = this.t;
    for (let k = 0; k < P; k++) {
      const x = this.xs[k] * this.W;
      // the resting field: slow overlapping swells
      const n = 0.5 + 0.5 * (Math.sin(x * 0.009 + t * 0.35) * 0.45 + Math.sin(x * 0.023 - t * 0.27) * 0.25 + Math.sin(x * 0.004 + t * 0.12) * 0.3);
      let v = n * 0.35 * (0.3 + this.env[k]);
      if (bins) {
        const f = this.freqAt[k];
        // between bins, not snapped to them: the lows have few bins and would step
        const b = Math.min(bins.length - 2, Math.max(1, f / hzPerBin));
        const i0 = Math.floor(b);
        const at = (i) => Math.max(-140, bins[i] || -140); // silence reads as -Infinity
        // each point hears its whole band, so a note between points still shows
        let db = lerp(at(i0), at(i0 + 1), b - i0);
        const w = Math.floor(b * this.band);
        for (let i = Math.max(1, i0 - w); i <= Math.min(bins.length - 1, i0 + w); i++) db = Math.max(db, at(i));
        // music falls ~4 dB an octave: tilt it back so highs are drawn too
        this.db[k] = db + 4 * Math.log2(f / 300);
      } else this.db[k] = NaN;
      this.rest[k] = v;
    }
    // notes are peaks above their neighbourhood: lift them, so a melody reads as a ridge
    for (let k = 0; k < P; k++) {
      let v = this.rest[k];
      const db = this.db[k];
      if (Number.isFinite(db)) {
        let around = 0, n = 0;
        for (let j = Math.max(0, k - 3); j <= Math.min(P - 1, k + 3); j++) if (Number.isFinite(this.db[j])) { around += this.db[j]; n++; }
        const peak = Math.max(0, db - around / n);
        // a soft knee, so loud lows round off instead of flattening into a plateau
        const lin = Math.max(0, (db + 92) / 60) + peak / 14;
        const s = (1 - Math.exp(-lin * lin * 2.2)) * (0.4 + 0.6 * this.env[k]);
        v = lerp(v, s, live);
      }
      // the front edge moves quickly up and settles slowly, like a meter
      if (!Number.isFinite(v)) v = 0;
      this.raw[k] = v > this.raw[k] ? lerp(this.raw[k], v, 0.55) : lerp(this.raw[k], v, 0.12);
    }
    // a little smoothing along the line: land, not a bar graph
    for (let k = 0; k < P; k++) this.cur[k] = (this.raw[Math.max(0, k - 1)] + 2 * this.raw[k] + this.raw[Math.min(P - 1, k + 1)]) / 4;
  }

  advance(dt, playing, sample) {
    const ch = this.ch, tg = this.chTarget;
    const kc = 1 - Math.exp(-dt * 0.5);
    for (const key in tg) ch[key] = lerp(ch[key] ?? tg[key], tg[key], kc);
    if (this.mirror !== ch.strange < 0.72) this.mapFreqs();
    // how fast the land moves back: the piece's pace, the listener's motion setting
    const speed = (this.reduced ? 0.3 : 1) * (playing ? 1 : 0.25) * lerp(0.35, 1.8, this.vp.vMotion);
    this.t += dt * speed;
    const rowEvery = lerp(0.95, 0.3, ch.pace);
    this.phase += (dt * speed) / rowEvery;
    const k = 1 - Math.exp(-dt * 0.8);
    const c = this.col, tgc = this.target;
    c.bg = mixc(c.bg, tgc.bg, k);
    c.ink = mixc(c.ink, tgc.ink, k);
    c.accent = mixc(c.accent, tgc.accent, k);
    this.live = lerp(this.live, playing ? 1 : 0, 1 - Math.exp(-dt * (playing ? 1.2 : 0.5)));
    if (sample) {
      const lv = this.engine.level();
      this.level = lerp(this.level, lv, lv > this.level ? 0.3 : 0.06);
      this.listen();
    }
    this.pulse *= Math.exp(-dt * 4);
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
    // a new line leaves the front edge and starts its way back
    const L = this.lineCount;
    while (this.phase >= 1) {
      this.phase -= 1;
      this.rows.unshift({ v: Float32Array.from(this.cur), heat: Float32Array.from(this.heat), pulse: this.pulse });
      if (this.rows.length > L + 1) this.rows.length = L + 1;
      this.heat.fill(0);
    }
    // fill an empty field at first so it never starts bare
    if (!this.rows.length) for (let i = 0; i <= L; i++) this.rows.push({ v: Float32Array.from(this.cur), heat: new Float32Array(this.quality.points), pulse: 0 });
    if (this.rows[0]?.v.length !== this.quality.points) this.rows = [];
  }

  draw() {
    const { g, dpr, W, H, col, vp, ch } = this;
    const P = this.quality.points;
    const L = this.lineCount;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = rgba(col.bg, 1);
    g.fillRect(0, 0, W, H);
    if (!this.rows.length) return;

    let breathAmp = 1, spread = 1;
    if (this.breath) {
      breathAmp = lerp(0.35, 1.9, this.breath.scale);
      spread = lerp(0.92, 1.04, this.breath.scale);
    }
    const mid = (this.top + this.bottom) / 2;
    const horizon = mid - (mid - this.top) * spread;
    const front = mid + (this.bottom - mid) * spread;
    // depth: a vast piece recedes far, a close one sits almost flat
    const persp = lerp(0.6, 4.5, ch.space);
    const sFar = 1 / (1 + persp);
    const widthFar = lerp(0.92, 0.5, ch.space);
    const gap = (front - horizon) / (L - 1);
    const amp = gap * (1.2 + vp.vGlow * 4.5) * breathAmp;
    const smooth = ch.organic > 0.45;
    const warp = Math.max(0, ch.strange - 0.35) * 0.05 * W;
    const fingers = [...this.fingers.values()];
    const depthFade = vp.vRings;
    g.lineJoin = 'round';
    g.lineWidth = lerp(0.6, 1.8, vp.vOrb);
    const cx = W / 2;
    const ys = this.ys, sx = this.sx;

    // back to front, each line hiding what's behind it
    for (let i = L; i >= 0; i--) {
      const row = i === 0 ? { v: this.cur, heat: this.heat, pulse: this.pulse } : this.rows[i - 1];
      if (!row) continue;
      // the front edge stays put; every older line is on its way back
      const d = i === 0 ? 0 : clamp((i - 1 + this.phase) / L, 0, 1); // 0 front, 1 horizon
      const s = 1 / (1 + d * persp);
      const near = (s - sFar) / (1 - sFar); // 1 front, 0 horizon
      const base = horizon + (front - horizon) * near;
      const wScale = lerp(widthFar, 1, near);
      const a = amp * Math.pow(near, 0.8) * (1 + row.pulse * 0.5);
      let heat = 0;
      for (let k = 0; k < P; k++) {
        const x0 = this.xs[k] * W;
        let x = cx + (x0 - cx) * wScale;
        if (warp) x += Math.sin(i * 0.5 + this.xs[k] * 6 + this.t * 0.2) * warp * near;
        let y = row.v[k] * a;
        for (const f of fingers) {
          const dy = (f.y - base) / (gap * 2.5);
          const dx = (x - f.x) / (W * 0.09);
          y += H * 0.05 * vp.vTrails * f.a * Math.exp(-dx * dx - dy * dy);
        }
        sx[k] = x;
        ys[k] = base - y;
        heat = Math.max(heat, row.heat[k]);
      }
      for (const f of fingers) heat = Math.max(heat, Math.exp(-(((f.y - base) / (gap * 2)) ** 2)) * 0.8 * f.a);
      this.trace(sx, ys, P, smooth);
      g.lineTo(sx[P - 1], base + 3);
      g.lineTo(sx[0], base + 3);
      g.closePath();
      g.fillStyle = rgba(col.bg, 1);
      g.fill();
      this.trace(sx, ys, P, smooth);
      // lines fade in as they leave the front edge and out at the horizon
      const leaving = i === 0 ? 1 : clamp((i - 1 + this.phase) / 0.6, 0, 1);
      const alpha = lerp(1 - depthFade * 0.8, 1, near) * 0.9 * clamp((1 - d) / 0.08, 0, 1) * leaving;
      // where notes were played the line is lit, and the light recedes with it
      g.strokeStyle = rgba(mixc(col.ink, col.accent, clamp(heat * 0.75, 0, 1)), alpha);
      g.stroke();
    }
    this.drawTrails();
  }

  // One line: soft curves for acoustic pieces, straight cuts for electronic ones.
  trace(xs, ys, P, smooth) {
    const g = this.g;
    g.beginPath();
    g.moveTo(xs[0], ys[0]);
    if (!smooth) { for (let k = 1; k < P; k++) g.lineTo(xs[k], ys[k]); return; }
    for (let k = 1; k < P - 1; k++) g.quadraticCurveTo(xs[k], ys[k], (xs[k] + xs[k + 1]) / 2, (ys[k] + ys[k + 1]) / 2);
    g.lineTo(xs[P - 1], ys[P - 1]);
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
