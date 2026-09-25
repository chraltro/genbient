// Weather, water, fire and creatures, built from shaped noise and sines.
import { lerp, rand, randi, pick, chance, expRand, glide, makePanner, osc, gain, filter, disposeOnEnd, pluckEnv } from '../util.js';
import { R, C } from '../params.js';
import { Layer, Continuous, noiseSrc, common, DENSITY } from './base.js';

const panOf = (p) => (p.pan ? p.pan.value : 0);

/* ─── Rain ─── */
const SURFACES = { open: [1, 1, 0.025], glass: [1.5, 0.6, 0.015], leaves: [0.6, 1.4, 0.04], roof: [2.2, 1.2, 0.06] };
export class Rain extends Continuous {
  static schema = [
    ...common({ vol: 0.5, tone: 0.95, rev: 0.2, dly: 0, dlyGen: [0, 0.05], revGen: [0.1, 0.4] }),
    R('intensity', 'Intensity', 0, 1, 0.5),
    R('drops', 'Droplets', 0, 1, 0.5),
    R('dropPitch', 'Droplet pitch', 0, 1, 0.5),
    R('hiss', 'Hiss', 0, 1, 0.4),
    C('surface', 'Surface', [['open', 'Open air'], ['glass', 'Glass'], ['leaves', 'Leaves'], ['roof', 'Tin roof']], 'open'),
  ];
  start(t) {
    const { ctx } = this;
    const src = this.keep(noiseSrc(this, 'pink', t));
    this.hp = this.keep(filter(ctx, 'highpass', 350));
    this.lp = this.keep(filter(ctx, 'lowpass', this.cut()));
    this.body = this.keep(gain(ctx, 0.3 + this.p.intensity * 0.7));
    src.connect(this.hp).connect(this.lp).connect(this.body).connect(this.bus);
    const hiss = this.keep(noiseSrc(this, 'white', t));
    const hbp = this.keep(filter(ctx, 'highpass', 5000));
    this.hg = this.keep(gain(ctx, this.p.hiss * 0.18));
    hiss.connect(hbp).connect(this.hg).connect(this.bus);
  }
  cut() { return 1500 + this.p.intensity * 6500; }
  param(id) {
    if (id === 'intensity') { glide(this.lp.frequency, this.cut(), this.now, 1); glide(this.body.gain, 0.3 + this.p.intensity * 0.7, this.now, 1); }
    if (id === 'hiss') glide(this.hg.gain, this.p.hiss * 0.18, this.now, 0.5);
  }
  schedule(now, horizon) {
    const rate = 1 + this.p.drops * 26;
    this.events(now, horizon, () => expRand(1 / rate), (t) => this.drop(t));
  }
  drop(t) {
    const { ctx, p } = this;
    const [pm, dm, dec] = SURFACES[p.surface] || SURFACES.open;
    const f = rand(1200, 4200) * pm * (0.6 + p.dropPitch * 0.8);
    const o = osc(ctx, 'sine', f);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * rand(1.3, 2.2), t + 0.02);
    const g = gain(ctx, 0);
    pluckEnv(g.gain, t, rand(0.01, 0.05) * dm, 0.001, dec);
    const pan = makePanner(ctx, rand(-1, 1));
    o.connect(g).connect(pan).connect(this.bus);
    o.start(t); o.stop(t + dec + 0.03);
    disposeOnEnd(o, [o, g, pan]);
  }
}

/* ─── Ocean ─── */
export class Ocean extends Continuous {
  static schema = [
    ...common({ vol: 0.6, tone: 0.9, rev: 0.25, dly: 0, dlyGen: [0, 0.05], revGen: [0.1, 0.4] }),
    R('swell', 'Wave size', 0, 1, 0.5),
    R('period', 'Wave period', 5, 18, 10, { fmt: (v) => `${v.toFixed(0)} s` }),
    R('foam', 'Foam', 0, 1, 0.5),
    R('sync', 'Breathe with tempo', 0, 1, 0, { gen: [0, 0.3], hint: 'lock waves to the bar' }),
  ];
  start(t) {
    const { ctx } = this;
    const b = this.keep(noiseSrc(this, 'brown', t));
    this.lp = this.keep(filter(ctx, 'lowpass', 400, 0.5));
    this.swell = this.keep(gain(ctx, 0.2));
    b.connect(this.lp).connect(this.swell).connect(this.bus);
    const w = this.keep(noiseSrc(this, 'pink', t));
    this.flp = this.keep(filter(ctx, 'bandpass', 2500, 0.6));
    this.fg = this.keep(gain(ctx, 0.02));
    w.connect(this.flp).connect(this.fg).connect(this.bus);
    this.nextT = t + 0.1;
  }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.T, (t) => {
      const size = lerp(0.4, 1, this.p.swell) * rand(0.7, 1.1);
      let T = this.p.period * rand(0.8, 1.25);
      if (chance(this.p.sync)) T = this.e.barSeconds * Math.max(1, Math.round(T / this.e.barSeconds));
      this.T = T;
      const rise = T * rand(0.38, 0.5);
      const { swell: g, lp, fg } = this;
      for (const prm of [g.gain, lp.frequency, fg.gain]) prm.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0.18 + 0.75 * size, t, rise / 2.5);
      lp.frequency.setTargetAtTime(500 + 1600 * size, t, rise / 2.5);
      fg.gain.setTargetAtTime(0.02, t, rise / 2);
      g.gain.setTargetAtTime(0.14, t + rise, (T - rise) / 3);
      lp.frequency.setTargetAtTime(320, t + rise, (T - rise) / 3);
      fg.gain.setTargetAtTime(0.3 * size * this.p.foam, t + rise - 0.3, 0.4);
      fg.gain.setTargetAtTime(0.015, t + rise + 0.8, (T - rise) / 3.5);
      this.note(t + rise, 120, rand(-0.3, 0.3), 0.8 * size, 'ocean');
    });
  }
  get T() { return this._T ?? 10; }
  set T(v) { this._T = v; }
}

/* ─── Stream ─── */
export class Stream extends Continuous {
  static schema = [
    ...common({ vol: 0.5, tone: 0.9, rev: 0.3, dly: 0, dlyGen: [0, 0.05] }),
    R('flow', 'Flow', 0, 1, 0.5),
    R('babble', 'Babble', 0, 1, 0.5, { hint: 'bubbly ↔ rushing' }),
    R('depth', 'Depth', 0, 1, 0.5),
  ];
  start(t) {
    const { ctx } = this;
    const body = this.keep(noiseSrc(this, 'pink', t));
    const blp = this.keep(filter(ctx, 'bandpass', 700, 0.5));
    this.bg = this.keep(gain(ctx, 0.2 + this.p.depth * 0.6));
    body.connect(blp).connect(this.bg).connect(this.bus);
    this.babbles = [];
    for (let i = 0; i < 4; i++) {
      const src = this.keep(noiseSrc(this, 'white', t));
      const bp = this.keep(filter(ctx, 'bandpass', rand(600, 2500), this.q()));
      const g = this.keep(gain(ctx, 0.9));
      const pan = this.keep(makePanner(ctx, rand(-0.8, 0.8)));
      src.connect(bp).connect(g).connect(pan).connect(this.bus);
      this.babbles.push({ bp, g, next: t });
    }
  }
  q() { return lerp(22, 4, this.p.babble); }
  param(id) {
    if (id === 'depth') glide(this.bg.gain, 0.2 + this.p.depth * 0.6, this.now, 1);
    if (id === 'babble') for (const b of this.babbles) glide(b.bp.Q, this.q(), this.now, 0.5);
  }
  schedule(now, horizon) {
    const flow = this.p.flow;
    for (const b of this.babbles) {
      if (b.next < now - 1) b.next = now;
      while (b.next < horizon) {
        const t = b.next;
        b.bp.frequency.setTargetAtTime(rand(500, 1400 + flow * 2200), t, 0.015);
        b.g.gain.setTargetAtTime(chance(0.75) ? rand(0.5, 1.4) : 0.1, t, 0.02);
        b.next += rand(0.035, 0.14) * lerp(1.4, 0.7, flow);
      }
    }
  }
}

/* ─── Wind ─── */
export class Wind extends Continuous {
  static schema = [
    ...common({ vol: 0.5, tone: 0.9, rev: 0.3, dly: 0, dlyGen: [0, 0.05] }),
    R('gusts', 'Gusts', 0, 1, 0.5),
    R('pitch', 'Pitch', 0, 1, 0.4),
    R('whistle', 'Whistle', 0, 1, 0.3),
    R('speed', 'Changeability', 0, 1, 0.5),
  ];
  start(t) {
    const { ctx } = this;
    const a = this.keep(noiseSrc(this, 'pink', t));
    const b = this.keep(noiseSrc(this, 'brown', t));
    this.bp = this.keep(filter(ctx, 'bandpass', 500, 0.9));
    this.gust = this.keep(gain(ctx, 0.5));
    a.connect(this.bp);
    b.connect(this.bp);
    this.bp.connect(this.gust).connect(this.bus);
    this.wh = this.keep(filter(ctx, 'bandpass', 1100, 14));
    this.wg = this.keep(gain(ctx, 0));
    a.connect(this.wh).connect(this.wg).connect(this.bus);
  }
  schedule(now, horizon) {
    const k = lerp(2, 0.5, this.p.speed);
    this.events(now, horizon, () => rand(1.5, 4.5) * k, (t) => {
      const { gusts, pitch, whistle } = this.p;
      const f = rand(160, 300 + pitch * 1200);
      glide(this.bp.frequency, f, t, rand(1, 2.5) * k);
      glide(this.bp.Q, rand(0.6, 1.8 + gusts * 2), t, 2 * k);
      glide(this.gust.gain, rand(0.25, 0.45 + gusts * 0.9), t, rand(0.8, 2.2) * k);
      glide(this.wh.frequency, f * rand(2, 3.2), t, 2 * k);
      glide(this.wg.gain, chance(0.5) ? rand(0.3, 1.2) * whistle : 0, t, 2.2 * k);
    });
  }
}

/* ─── Fire ─── */
export class Fire extends Continuous {
  static schema = [
    ...common({ vol: 0.55, tone: 0.9, rev: 0.15, dly: 0, dlyGen: [0, 0.05], revGen: [0.05, 0.3] }),
    R('crackle', 'Crackle', 0, 1, 0.5),
    R('roar', 'Roar', 0, 1, 0.5),
    R('pops', 'Pops', 0, 1, 0.35),
  ];
  start(t) {
    const { ctx } = this;
    const b = this.keep(noiseSrc(this, 'brown', t));
    const lp = this.keep(filter(ctx, 'lowpass', 380, 0.7));
    this.roarG = this.keep(gain(ctx, 0.45));
    b.connect(lp).connect(this.roarG).connect(this.bus);
    this.nextFlicker = t;
  }
  schedule(now, horizon) {
    if (now >= this.nextFlicker) {
      glide(this.roarG.gain, rand(0.3, 0.6) * this.p.roar * 1.6, now, rand(0.2, 0.8));
      this.nextFlicker = now + rand(0.3, 1.2);
    }
    const rate = 1 + this.p.crackle * 20;
    this.events(now, horizon, () => expRand(1 / rate), (t) => {
      this.crackle(t, chance(this.p.pops * 0.3));
      if (chance(0.25)) this.crackle(t + rand(0.01, 0.05), false);
    });
  }
  crackle(t, pop) {
    const { ctx } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.white;
    const dur = pop ? rand(0.01, 0.03) : rand(0.002, 0.009);
    const bp = filter(ctx, pop ? 'bandpass' : 'highpass', pop ? rand(600, 1400) : rand(1500, 4500), pop ? 1.5 : 0.7);
    const g = gain(ctx, 0);
    pluckEnv(g.gain, t, pop ? rand(0.5, 0.9) : rand(0.08, 0.5), 0.0005, dur);
    const pan = makePanner(ctx, rand(-0.6, 0.6));
    s.connect(bp).connect(g).connect(pan).connect(this.bus);
    s.start(t, rand(0, 3), dur + 0.02);
    disposeOnEnd(s, [s, bp, g, pan]);
    if (pop) this.note(t, 900, panOf(pan), 0.3, 'fire');
  }
}

/* ─── Birdsong ─── */
export class Birds extends Layer {
  static schema = [
    ...common({ vol: 0.5, tone: 0.95, rev: 0.7, dly: 0.15 }),
    DENSITY(0.5),
    C('species', 'Species', [['mixed', 'Mixed'], ['whistle', 'Whistlers'], ['trill', 'Trillers'], ['chirp', 'Chirpers'], ['coo', 'Doves'], ['owl', 'Owls']], 'mixed'),
    R('distance', 'Distance', 0, 1, 0.35),
    R('pitch', 'Pitch', 0.6, 1.5, 1, { fmt: (v) => `×${v.toFixed(2)}` }),
  ];
  interval() { return expRand(lerp(12, 1, this.dens)); }
  schedule(now, horizon) {
    this.events(now, horizon, () => this.interval(), (t) => this.song(t));
  }
  song(t) {
    const { ctx, p } = this;
    const o = osc(ctx, 'sine', 3000);
    const g = gain(ctx, 0);
    const lp = filter(ctx, 'lowpass', lerp(12000, 2500, p.distance));
    const pan = makePanner(ctx, rand(-0.9, 0.9));
    o.connect(g).connect(lp).connect(pan).connect(this.bus);
    const vol = rand(0.03, 0.09) * lerp(1, 0.45, p.distance);
    const kind = p.species === 'mixed' ? pick(['whistle', 'trill', 'chirp', 'chirp', 'coo', 'whistle']) : p.species;
    const k = p.pitch;
    let e = t;
    const f = o.frequency;
    const blip = (at, f0, f1, dur, v = vol) => {
      f.setValueAtTime(f0 * k, at);
      f.exponentialRampToValueAtTime(f1 * k, at + dur);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(v, at + Math.min(0.02, dur / 3));
      g.gain.setValueAtTime(v, at + dur * 0.7);
      g.gain.linearRampToValueAtTime(0, at + dur);
    };
    if (kind === 'whistle') {
      const base = rand(2000, 3400);
      for (let i = 0, n = randi(1, 3); i < n; i++) {
        const d = rand(0.18, 0.45);
        blip(e, base * rand(0.9, 1.1), base * pick([0.8, 1.25, 1.1, 0.7]), d);
        e += d + rand(0.08, 0.25);
      }
    } else if (kind === 'trill') {
      const base = rand(3200, 4600);
      for (let i = 0, n = randi(6, 14); i < n; i++) {
        blip(e, base * (1 - i * 0.015), base * 0.9 * (1 - i * 0.015), 0.035, vol * 0.8);
        e += 0.055;
      }
    } else if (kind === 'chirp') {
      for (let i = 0, n = randi(2, 4); i < n; i++) {
        blip(e, rand(1800, 2600), rand(3600, 5000), rand(0.05, 0.09));
        e += rand(0.12, 0.2);
      }
    } else if (kind === 'owl') {
      const base = rand(330, 420);
      for (const [d, m, gap] of [[0.5, 1, 0.3], [0.25, 1.04, 0.1], [0.7, 0.97, 0]]) {
        blip(e, base * m, base * m * 0.95, d, vol * 2.2);
        e += d + gap;
      }
    } else {
      const base = rand(480, 640);
      for (const [d, m] of [[0.35, 1], [0.6, 1.12], [0.4, 1], [0.4, 0.96]]) {
        blip(e, base * m, base * m * 0.97, d, vol * 1.6);
        e += d + 0.08;
      }
    }
    o.start(t);
    o.stop(e + 0.1);
    disposeOnEnd(o, [o, g, lp, pan]);
    this.note(t, 3000, panOf(pan), 0.2, 'birds');
    return this.interval() + (e - t);
  }
}

/* ─── Crickets & frogs ─── */
export class Night extends Continuous {
  static schema = [
    ...common({ vol: 0.5, tone: 0.95, rev: 0.5, dly: 0.05 }),
    R('chorus', 'Crickets', 0, 1, 0.6),
    R('rate', 'Chirp rate', 0, 1, 0.5),
    R('pitch', 'Pitch', 0, 1, 0.5),
    R('frogs', 'Frogs', 0, 1, 0.2),
  ];
  start(t) {
    const { ctx } = this;
    this.crickets = [];
    for (let i = 0; i < 4; i++) {
      const f = rand(3900, 5200) * (0.75 + this.p.pitch * 0.5);
      const o = this.keep(osc(ctx, 'sine', f));
      const o2 = this.keep(osc(ctx, 'sine', f * 1.5 + rand(-40, 40)));
      const g2 = this.keep(gain(ctx, 0.12));
      const g = this.keep(gain(ctx, 0));
      const pan = this.keep(makePanner(ctx, rand(-0.9, 0.9)));
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(pan).connect(this.bus);
      o.start(t); o2.start(t);
      this.crickets.push({ o, o2, g, next: t + rand(0, 2), rate: rand(0.45, 1.1), pulses: randi(2, 4), vol: rand(0.04, 0.1) });
    }
    this.frogT = t + rand(1, 4);
  }
  param(id) {
    if (id === 'pitch') for (const c of this.crickets) {
      const f = rand(3900, 5200) * (0.75 + this.p.pitch * 0.5);
      glide(c.o.frequency, f, this.now, 0.3);
      glide(c.o2.frequency, f * 1.5, this.now, 0.3);
    }
  }
  schedule(now, horizon) {
    const active = Math.round(this.p.chorus * 4);
    const rk = lerp(1.6, 0.6, this.p.rate);
    this.crickets.forEach((c, i) => {
      if (c.next < now - 1) c.next = now + rand(0, 1);
      while (c.next < horizon) {
        const t = c.next;
        if (i < active && !(c.resting > t)) {
          for (let k = 0; k < c.pulses; k++) {
            const pt = t + k * 0.045;
            c.g.gain.setValueAtTime(0, pt);
            c.g.gain.linearRampToValueAtTime(c.vol, pt + 0.008);
            c.g.gain.linearRampToValueAtTime(0, pt + 0.028);
          }
          if (chance(0.03)) c.resting = t + rand(3, 10);
        }
        c.next += c.rate * rk * rand(0.92, 1.08);
      }
    });
    // frogs that were silent for a while start fresh instead of catching up
    if (this.frogT < now - 1) this.frogT = now + rand(0.5, 3);
    while (this.p.frogs > 0.02 && this.frogT < horizon) {
      this.croak(Math.max(this.frogT, now));
      this.frogT += expRand(lerp(8, 1.2, this.p.frogs));
    }
  }
  croak(t) {
    const { ctx } = this;
    const f = rand(110, 240);
    const o = osc(ctx, 'sawtooth', f);
    const bp = filter(ctx, 'bandpass', f * rand(3, 5), 3);
    const g = gain(ctx, 0);
    const pan = makePanner(ctx, rand(-0.8, 0.8));
    const n = randi(1, 3);
    for (let i = 0; i < n; i++) pluckEnv(g.gain, t + i * 0.22, 0.12, 0.03, 0.15);
    o.connect(bp).connect(g).connect(pan).connect(this.bus);
    o.start(t); o.stop(t + n * 0.22 + 0.2);
    disposeOnEnd(o, [o, bp, g, pan]);
  }
}

/* ─── Distant thunder ─── */
export class Thunder extends Layer {
  static schema = [
    ...common({ vol: 0.6, tone: 0.8, rev: 0.6, dly: 0, dlyGen: [0, 0.05] }),
    R('frequency', 'Frequency', 0, 1, 0.3),
    R('distance', 'Distance', 0, 1, 0.5),
    R('length', 'Length', 0, 1, 0.5, { fmt: (v) => `${(5 + v * 10).toFixed(0)} s` }),
  ];
  interval() { return lerp(80, 14, this.p.frequency) * rand(0.6, 1.5); }
  schedule(now, horizon) {
    if (this.nextT == null) this.nextT = now + rand(3, 10);
    this.events(now, horizon, () => this.interval(), (t) => this.rumble(t));
  }
  rumble(t) {
    const { ctx, p } = this;
    const s = ctx.createBufferSource();
    s.buffer = this.e.noise.brown;
    s.loop = true;
    const lp = filter(ctx, 'lowpass', 900, 0.6);
    lp.frequency.setValueAtTime(rand(700, 1300) * lerp(1.4, 0.4, p.distance), t);
    lp.frequency.exponentialRampToValueAtTime(rand(110, 200), t + 3);
    const g = gain(ctx, 0);
    const peak = rand(0.5, 1) * lerp(1.1, 0.5, p.distance);
    const len = (5 + p.length * 10) * rand(0.8, 1.2);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + rand(0.1, 0.6) + p.distance * 0.8);
    let at = t + 0.8 + p.distance * 0.8;
    for (let i = 0; i < randi(2, 4); i++) {
      g.gain.linearRampToValueAtTime(peak * rand(0.3, 0.6), at);
      at += rand(0.6, 1.8);
      g.gain.linearRampToValueAtTime(peak * rand(0.5, 0.9), at);
      at += rand(0.3, 1);
    }
    g.gain.linearRampToValueAtTime(0, t + Math.max(len, at - t + 1));
    const pan = makePanner(ctx, rand(-0.7, 0.7));
    s.connect(lp).connect(g).connect(pan).connect(this.bus);
    s.start(t, rand(0, 5));
    s.stop(t + Math.max(len, at - t + 1) + 0.2);
    disposeOnEnd(s, [s, lp, g, pan]);
    this.note(t, 60, panOf(pan), 1.4, 'thunder');
  }
}
