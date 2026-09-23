// Living background: drifting colour fields, floating motes, ripples that
// bloom exactly when notes sound, and a breathing orb at the centre.
import { PALETTES } from './scenes.js';
import { clamp, lerp, rand } from './util.js';

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const lighten = (c, t) => mixc(c, [255, 255, 255], t);

function toRGB(p) {
  return { bg: p.bg.map(hex), orbs: p.orbs.map(hex), accent: hex(p.accent) };
}

export class Visuals {
  constructor(canvas, engine) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.low = document.createElement('canvas');
    this.lg = this.low.getContext('2d');
    this.engine = engine;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.col = toRGB(PALETTES.abyss);
    this.target = toRGB(PALETTES.abyss);
    this.level = 0;
    this.energy = 0;
    this.breath = null; // { scale 0..1, progress 0..1 }
    this.orb = { x: 0.5, y: 0.5, r: 100 };
    this.t = rand(0, 100);
    this.blobs = Array.from({ length: 6 }, (_, i) => ({
      ax: rand(0.18, 0.42), ay: rand(0.12, 0.32),
      sx: rand(0.018, 0.045) * (i % 2 ? 1 : -1), sy: rand(0.014, 0.04),
      px: rand(0, 6.28), py: rand(0, 6.28), r: rand(0.5, 0.85), ci: i % 4, a: rand(0.35, 0.6),
    }));
    this.motes = [];
    this.ripples = [];
    this.pending = [];
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    const loop = (ts) => { this.frame(ts); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.W = innerWidth;
    this.H = innerHeight;
    this.c.width = Math.round(this.W * dpr);
    this.c.height = Math.round(this.H * dpr);
    this.low.width = Math.max(8, Math.ceil(this.W / 7));
    this.low.height = Math.max(8, Math.ceil(this.H / 7));
    const n = Math.round(clamp((this.W * this.H) / 9000, 36, 110));
    this.motes = Array.from({ length: n }, () => this.mote(true));
  }

  mote(anywhere) {
    const z = rand(0.25, 1);
    return {
      x: rand(0, 1), y: anywhere ? rand(0, 1) : 1.05,
      z, vy: rand(0.004, 0.012) * z, ph: rand(0, 6.28), sw: rand(0.004, 0.02),
    };
  }

  setOrb(rect) {
    this.orb = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, r: rect.width / 2 };
  }

  setPalette(id) { this.target = toRGB(PALETTES[id] || PALETTES.abyss); }

  note(ev) {
    if (this.pending.length < 60) this.pending.push(ev);
  }

  spawn(ev) {
    const { W, H } = this;
    const fy = clamp((Math.log2(Math.max(40, ev.f)) - 5.5) / 7, 0, 1); // ~45 Hz .. ~5.8 kHz
    const big = { bowls: 1, thunder: 1, ocean: 1, pulse: 1 }[ev.kind];
    const x = W / 2 + (ev.pan || 0) * W * 0.38 + rand(-W, W) * 0.05;
    const y = big ? this.orb.y : lerp(H * 0.8, H * 0.14, fy) + rand(-20, 20);
    const ci = Math.floor(rand(0, 4));
    this.ripples.push({
      x, y, age: 0, kind: ev.kind,
      life: big ? rand(5, 8) : rand(2.5, 4.5),
      max: (big ? 0.55 : 0.12 + 0.12 * (ev.v || 0.5)) * Math.min(W, H) * (ev.kind === 'shimmer' ? 0.6 : 1),
      v: clamp(ev.v || 0.5, 0.1, 1.6), c: ci,
    });
    if (this.ripples.length > 40) this.ripples.shift();
    this.energy = Math.min(1.5, this.energy + (ev.v || 0.3) * 0.25);
  }

  frame(ts) {
    const dt = Math.min(0.1, (ts - this.last) / 1000);
    this.last = ts;
    const e = this.engine;
    const playing = e.playing;
    const speed = (this.reduced ? 0.35 : 1) * (playing ? 1 : 0.45);
    this.t += dt * speed;

    // colours glide toward the target palette
    const k = 1 - Math.exp(-dt * 0.6);
    const c = this.col, tg = this.target;
    c.bg = c.bg.map((v, i) => mixc(v, tg.bg[i], k));
    c.orbs = c.orbs.map((v, i) => mixc(v, tg.orbs[i], k));
    c.accent = mixc(c.accent, tg.accent, k);

    const lv = e.level();
    this.level = lerp(this.level, lv, lv > this.level ? 0.25 : 0.05);
    this.energy *= Math.exp(-dt * 0.8);

    if (e.ctx) {
      const now = e.ctx.currentTime;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const ev = this.pending[i];
        if (ev.t <= now + 0.02) {
          this.pending.splice(i, 1);
          if (now - ev.t < 1.5) this.spawn(ev);
        }
      }
    }

    this.drawField();
    this.drawMotes(dt, speed);
    this.drawRipples(dt);
    this.drawOrb();
  }

  drawField() {
    const { lg, low, col } = this;
    const w = low.width, h = low.height;
    const grad = lg.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgba(col.bg[0], 1));
    grad.addColorStop(1, rgba(col.bg[1], 1));
    lg.globalCompositeOperation = 'source-over';
    lg.fillStyle = grad;
    lg.fillRect(0, 0, w, h);
    lg.globalCompositeOperation = 'lighter';
    const m = Math.max(w, h);
    const lift = 1 + this.level * 0.5 + this.energy * 0.15;
    for (const b of this.blobs) {
      const x = w * (0.5 + b.ax * Math.sin(this.t * b.sx * 6 + b.px));
      const y = h * (0.5 + b.ay * Math.cos(this.t * b.sy * 6 + b.py));
      const r = m * b.r * (0.9 + 0.1 * Math.sin(this.t * 0.2 + b.px));
      const g = lg.createRadialGradient(x, y, 0, x, y, r);
      const cc = col.orbs[b.ci];
      const a = Math.min(0.7, b.a * 0.46 * lift);
      g.addColorStop(0, rgba(cc, a));
      g.addColorStop(0.45, rgba(cc, a * 0.35));
      g.addColorStop(1, rgba(cc, 0));
      lg.fillStyle = g;
      lg.fillRect(0, 0, w, h);
    }
    // vignette keeps the edges deep and the eye on the centre
    lg.globalCompositeOperation = 'source-over';
    const v = lg.createRadialGradient(w / 2, h * 0.52, Math.min(w, h) * 0.25, w / 2, h * 0.52, m * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, rgba(col.bg[0], 0.75));
    lg.fillStyle = v;
    lg.fillRect(0, 0, w, h);
    const { g: ctx, c } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(low, 0, 0, c.width, c.height);
  }

  drawMotes(dt, speed) {
    const { g, dpr, W, H, col } = this;
    g.globalCompositeOperation = 'lighter';
    const lift = 1 + this.level * 2 + this.energy;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.y -= m.vy * dt * speed * (1 + this.level * 2);
      m.ph += dt * speed * 0.6;
      if (m.y < -0.05) this.motes[i] = this.mote(false);
      const x = (m.x + Math.sin(m.ph) * m.sw) * W * dpr;
      const y = m.y * H * dpr;
      const tw = 0.5 + 0.5 * Math.sin(m.ph * 2.3 + m.x * 40);
      const a = clamp(0.06 + 0.28 * tw * m.z * lift, 0, 0.7);
      const r = (0.6 + m.z * 1.4) * dpr;
      g.fillStyle = rgba(lighten(col.accent, 0.3), a);
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
  }

  drawRipples(dt) {
    const { g, dpr, col } = this;
    g.globalCompositeOperation = 'lighter';
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.age += dt;
      const p = r.age / r.life;
      if (p >= 1) { this.ripples.splice(i, 1); continue; }
      const ease = 1 - Math.pow(1 - p, 3);
      const rad = r.max * ease * dpr;
      const a = (1 - p) * (1 - p) * 0.5 * Math.min(1, r.v);
      const cc = lighten(mixc(col.accent, col.orbs[r.c], 0.35), 0.15);
      const x = r.x * dpr, y = r.y * dpr;
      // bloom
      if (p < 0.5) {
        const bg = g.createRadialGradient(x, y, 0, x, y, Math.max(1, rad * 0.9));
        bg.addColorStop(0, rgba(cc, a * 0.5 * (1 - p * 2)));
        bg.addColorStop(1, rgba(cc, 0));
        g.fillStyle = bg;
        g.beginPath();
        g.arc(x, y, Math.max(1, rad * 0.9), 0, 6.2832);
        g.fill();
      }
      g.strokeStyle = rgba(cc, a);
      g.lineWidth = (1 + r.v) * dpr * (1 - p * 0.6);
      g.beginPath();
      g.arc(x, y, Math.max(0.5, rad), 0, 6.2832);
      g.stroke();
      if (r.v > 0.9 && p > 0.12) {
        g.strokeStyle = rgba(cc, a * 0.45);
        g.beginPath();
        g.arc(x, y, Math.max(0.5, rad * 0.62), 0, 6.2832);
        g.stroke();
      }
    }
  }

  drawOrb() {
    const { g, dpr, col, orb } = this;
    const x = orb.x * dpr, y = orb.y * dpr;
    let s = 1 + this.level * 0.32 + this.energy * 0.04;
    if (this.breath) s *= lerp(0.78, 1.22, this.breath.scale);
    else if (!this.engine.playing) s *= 1 + 0.035 * Math.sin(this.t * 1.4);
    const R = orb.r * dpr * 0.82 * s;
    const acc = col.accent;
    const core = mixc(col.orbs[0], acc, 0.35);
    g.globalCompositeOperation = 'lighter';

    // outer halo
    const halo = g.createRadialGradient(x, y, R * 0.4, x, y, R * 3.2);
    halo.addColorStop(0, rgba(acc, 0.18 + this.level * 0.25));
    halo.addColorStop(0.4, rgba(core, 0.07));
    halo.addColorStop(1, rgba(core, 0));
    g.fillStyle = halo;
    g.beginPath();
    g.arc(x, y, R * 3.2, 0, 6.2832);
    g.fill();

    // body: a soft glassy sphere lit from above
    g.globalCompositeOperation = 'source-over';
    const body = g.createRadialGradient(x - R * 0.3, y - R * 0.4, R * 0.05, x, y, R);
    body.addColorStop(0, rgba(lighten(acc, 0.55), 0.95));
    body.addColorStop(0.35, rgba(mixc(acc, col.orbs[1], 0.4), 0.75));
    body.addColorStop(0.85, rgba(mixc(col.orbs[1], col.bg[1], 0.3), 0.55));
    body.addColorStop(1, rgba(col.bg[1], 0));
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, R, 0, 6.2832);
    g.fill();

    // slow gyroscope rings
    g.globalCompositeOperation = 'lighter';
    g.lineWidth = 1 * dpr;
    for (let i = 0; i < 3; i++) {
      const rot = this.t * (0.08 + i * 0.05) * (i % 2 ? -1 : 1) + i * 1.1;
      const tilt = 0.28 + 0.2 * Math.sin(this.t * 0.13 + i * 2);
      g.strokeStyle = rgba(lighten(acc, 0.4), 0.13 + this.level * 0.3);
      g.beginPath();
      g.ellipse(x, y, R * (1.18 + i * 0.16), R * (1.18 + i * 0.16) * tilt, rot, 0, 6.2832);
      g.stroke();
    }

    // breathing guide progress
    if (this.breath) {
      g.strokeStyle = rgba(lighten(acc, 0.5), 0.55);
      g.lineWidth = 2 * dpr;
      g.lineCap = 'round';
      g.beginPath();
      const r0 = orb.r * dpr * 1.45;
      g.arc(x, y, r0, -Math.PI / 2, -Math.PI / 2 + 6.2832 * this.breath.progress);
      g.stroke();
      g.strokeStyle = rgba(acc, 0.12);
      g.beginPath();
      g.arc(x, y, r0, 0, 6.2832);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  }
}
