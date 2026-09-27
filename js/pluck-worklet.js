/*
 * Plucked strings by physical model (Karplus–Strong, extended): a burst of
 * noise, the pluck, circulates in a delay line one period long; a gentle
 * low-pass in the loop takes the highs out first, as a real string loses
 * them, so every note starts bright and mellows as it rings. The brightness
 * of the pluck, how fast the highs fade and how long the string rings are
 * the instrument: harp, nylon guitar, steel string, koto.
 *
 * Notes arrive as messages { t, f, v, bright, decay, damp, pan } with t in
 * AudioContext time, and start on the exact sample.
 */
class Pluck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.queue = [];
    this.port.onmessage = (e) => { if (this.queue.length < 64) this.queue.push(e.data); };
  }

  start(note, offset) {
    const sr = sampleRate;
    // the loop's low-pass delays the wave a little; take that off the length, or the string plays flat
    // a high string goes round its loop many more times a second than a low one,
    // so it loses less each time round: every string mellows at a similar rate
    const b = (0.05 + note.damp * 0.7) * Math.min(1, Math.max(0.12, 180 / note.f));
    const damp = 1 - b;
    const w0 = (2 * Math.PI * note.f) / sr;
    const lag = Math.atan2(b * Math.sin(w0), 1 - b * Math.cos(w0)) / w0;
    const D = Math.max(2, sr / note.f - lag);
    const size = Math.ceil(D) + 3;
    const buf = new Float32Array(size);
    // the pluck: noise, softened by how bright the attack is, and by the hand
    let lp = 0;
    const a = 0.15 + note.bright * 0.8;
    const len = Math.ceil(D);
    for (let i = 0; i < len; i++) {
      lp += a * ((Math.random() * 2 - 1) - lp);
      buf[i] = lp;
    }
    // take out what's left of the average, so a string never thumps
    let m = 0;
    for (let i = 0; i < len; i++) m += buf[i];
    m /= len;
    // a short string holds a short burst: give it the same energy as a long one
    const lift = Math.min(4, Math.sqrt(200 / len));
    for (let i = 0; i < len; i++) buf[i] = (buf[i] - m) * note.v * Math.max(1, lift);
    // how much the string loses each trip round: a T60 of `decay` seconds
    const g = Math.pow(10, -3 / (Math.max(0.3, note.decay) * note.f));
    const pan = note.pan ?? 0;
    if (this.voices.length >= 24) this.voices.shift();
    this.voices.push({
      buf, size, D, w: len, g, damp, y: 0,
      gl: Math.cos((pan + 1) * Math.PI / 4), gr: Math.sin((pan + 1) * Math.PI / 4),
      left: Math.ceil(note.decay * 1.3 * sr), offset,
    });
  }

  process(_, outputs) {
    const out = outputs[0];
    const oL = out[0], oR = out[1] || out[0];
    const n = oL.length;
    oL.fill(0);
    if (oR !== oL) oR.fill(0);
    const end = currentTime + n / sampleRate;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (q.t < end) {
        this.queue.splice(i, 1);
        this.start(q, Math.max(0, Math.min(n - 1, Math.round((q.t - currentTime) * sampleRate))));
      }
    }
    for (const v of this.voices) {
      const { buf, size, D } = v;
      for (let i = v.offset; i < n; i++) {
        // read one period back (fractional), filter, feed back
        let r = v.w - D;
        if (r < 0) r += size;
        const i0 = r | 0, fr = r - i0, i1 = i0 + 1 === size ? 0 : i0 + 1;
        const x = buf[i0] + (buf[i1] - buf[i0]) * fr;
        v.y += v.damp * (x - v.y);
        const s = v.y * v.g;
        buf[v.w] = s;
        v.w = v.w + 1 === size ? 0 : v.w + 1;
        oL[i] += x * v.gl;
        oR[i] += x * v.gr;
      }
      v.offset = 0;
      v.left -= n;
    }
    this.voices = this.voices.filter((v) => v.left > 0);
    return true;
  }
}

registerProcessor('genbient-pluck', Pluck);
