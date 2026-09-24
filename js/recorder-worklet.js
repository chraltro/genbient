// Runs on the audio thread: turns the mix into interleaved 16-bit PCM in
// blocks and hands them to the page, tracking the peak as it goes.
class GenbientRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.size = 8192; // frames per block
    this.buf = new Int16Array(this.size * 2);
    this.n = 0;
    this.peak = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.on = true; this.n = 0; this.peak = 0; }
      if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage({ done: true, peak: this.peak }); }
    };
  }

  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n * 2);
    this.port.postMessage({ pcm: out, peak: this.peak }, [out.buffer]);
    this.n = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!this.on || !input || !input.length) return true;
    const L = input[0], R = input[1] || input[0];
    for (let i = 0; i < L.length; i++) {
      const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
      const a = Math.abs(l), b = Math.abs(r);
      if (a > this.peak) this.peak = a;
      if (b > this.peak) this.peak = b;
      this.buf[this.n * 2] = l * 32767;
      this.buf[this.n * 2 + 1] = r * 32767;
      if (++this.n === this.size) this.flush();
    }
    return true;
  }
}

registerProcessor('genbient-recorder', GenbientRecorder);
