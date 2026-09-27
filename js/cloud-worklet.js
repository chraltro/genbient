/*
 * The memory cloud: the music remembers itself. The last twelve seconds of
 * what's playing are kept, and overlapping grains of that past are sung
 * back, soft-edged, from wherever they fall: some at pitch, some an octave
 * up (a shimmer), now and then an octave down. It is how tape loops and
 * shimmer reverbs make ambient music bloom, made from the piece itself, so
 * it always belongs to it.
 */
class Cloud extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'shimmer', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'density', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'reach', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.len = Math.floor(sampleRate * 12);
    this.L = new Float32Array(this.len);
    this.R = new Float32Array(this.len);
    this.w = 0;
    this.filled = 0;
    this.grains = [];
    this.wait = 0;
  }

  spawn(shimmer, reach) {
    const sr = sampleRate;
    const r = Math.random();
    const ratio = r < shimmer * 0.6 ? 2 : r > 0.97 ? 0.5 : 1;
    const len = Math.floor(sr * (0.25 + Math.random() * 0.65) * (ratio === 2 ? 0.8 : 1));
    // reach back into the past, far enough that a faster grain never overtakes the present
    const most = Math.min(this.filled - 1, sr * (1 + reach * 10));
    const least = len * ratio + sr * 0.3;
    if (most <= least) return;
    const back = least + Math.random() * (most - least);
    const pan = Math.random() * 1.6 - 0.8;
    const lvl = ratio === 2 ? 0.55 : ratio === 0.5 ? 0.7 : 1;
    const step = (Math.PI * 2) / len;
    this.grains.push({
      r: (this.w - back + this.len) % this.len, pos: 0, len, ratio, c: 1, s: 0, cd: Math.cos(step), sd: Math.sin(step),
      gl: lvl * Math.cos((pan + 1) * Math.PI / 4), gr: lvl * Math.sin((pan + 1) * Math.PI / 4),
    });
  }

  process(inputs, outputs, p) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    const inp = inputs[0];
    const iL = inp && inp[0], iR = (inp && inp[1]) || iL;
    const { L, R, len } = this;
    let w = this.w;
    for (let i = 0; i < n; i++) {
      L[w] = iL ? iL[i] : 0;
      R[w] = iR ? iR[i] : 0;
      w = w + 1 === len ? 0 : w + 1;
    }
    this.w = w;
    this.filled = Math.min(len, this.filled + n);

    const amount = p.amount[0];
    oL.fill(0);
    if (oR !== oL) oR.fill(0);
    if (amount < 0.001 && !this.grains.length) return true;

    // new grains, a few to a dozen a second
    const rate = 3 + p.density[0] * 11;
    this.wait -= n;
    while (amount >= 0.001 && this.wait <= 0 && this.grains.length < 24) {
      this.spawn(p.shimmer[0], p.reach[0]);
      this.wait += (sampleRate / rate) * (0.5 + Math.random());
    }
    if (this.wait <= 0) this.wait = sampleRate / rate;

    // overlapping grains add up; keep the cloud about as loud whatever its density
    const g = (amount * 2.5) / Math.sqrt(1 + rate * 0.55);
    for (const gr of this.grains) {
      const count = Math.min(n, gr.len - gr.pos);
      // the window (a raised cosine) by rotation, and the read head by addition:
      // no trigonometry or division per sample
      let c = gr.c, sn = gr.s;
      const { cd, sd, ratio } = gr;
      let r = gr.r;
      const gl = g * gr.gl, grr = g * gr.gr;
      for (let i = 0; i < count; i++) {
        const env = 0.5 - 0.5 * c;
        const i0 = r | 0, fr = r - i0, i1 = i0 + 1 === len ? 0 : i0 + 1;
        oL[i] += (L[i0] + (L[i1] - L[i0]) * fr) * env * gl;
        oR[i] += (R[i0] + (R[i1] - R[i0]) * fr) * env * grr;
        const c2 = c * cd - sn * sd;
        sn = sn * cd + c * sd;
        c = c2;
        r += ratio;
        if (r >= len) r -= len;
      }
      gr.c = c; gr.s = sn; gr.r = r;
      gr.pos += count;
    }
    this.grains = this.grains.filter((gr) => gr.pos < gr.len);
    return true;
  }
}

registerProcessor('genbient-cloud', Cloud);
