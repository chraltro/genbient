// Records the mix as lossless PCM and writes a WAV any podcast editor opens.
// The tap sits after the compressor and before the master volume, so the
// clip's level doesn't depend on how loud the phone happens to be set.

const MAX_SECONDS = 15 * 60;

export class Recorder {
  constructor(engine) {
    this.e = engine;
    this.recording = false;
    this.chunks = [];
    this.frames = 0;
    this.peak = 0;
  }

  get seconds() { return this.e.ctx ? this.frames / this.e.ctx.sampleRate : 0; }
  get maxSeconds() { return MAX_SECONDS; }

  // one node for the life of the page, even if Rec is tapped twice quickly
  ensureNode() {
    this.ready ||= this.makeNode().catch((err) => { this.ready = null; throw err; });
    return this.ready;
  }

  async makeNode() {
    const ctx = this.e.ctx;
    const sink = ctx.createGain();
    sink.gain.value = 0; // keeps the node pulled by the graph without adding sound
    sink.connect(ctx.destination);
    if (ctx.audioWorklet) {
      await ctx.audioWorklet.addModule(new URL('./recorder-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(ctx, 'genbient-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
      this.node.port.onmessage = (ev) => this.receive(ev.data);
    } else {
      // older browsers: the same thing on the main thread
      const sp = ctx.createScriptProcessor(4096, 2, 2);
      sp.onaudioprocess = (ev) => {
        if (!this.recording) return;
        const L = ev.inputBuffer.getChannelData(0), R = ev.inputBuffer.getChannelData(1);
        const out = new Int16Array(L.length * 2);
        let peak = this.peak;
        for (let i = 0; i < L.length; i++) {
          const l = Math.max(-1, Math.min(1, L[i])), r = Math.max(-1, Math.min(1, R[i]));
          peak = Math.max(peak, Math.abs(l), Math.abs(r));
          out[i * 2] = l * 32767;
          out[i * 2 + 1] = r * 32767;
        }
        this.receive({ pcm: out, peak });
      };
      this.node = sp;
    }
    this.e.comp.connect(this.node);
    this.node.connect(sink);
  }

  receive(msg) {
    if (msg.pcm) {
      if (this.seconds >= MAX_SECONDS) return;
      this.chunks.push(msg.pcm);
      this.frames += msg.pcm.length / 2;
    }
    if (msg.peak != null) this.peak = Math.max(this.peak, msg.peak);
    if (msg.done && this.onDone) { const f = this.onDone; this.onDone = null; f(); }
  }

  async start() {
    await this.ensureNode();
    this.chunks = [];
    this.frames = 0;
    this.peak = 0;
    this.recording = true;
    this.node.port?.postMessage('start');
  }

  // Resolves once the audio thread has handed over its last block.
  stop() {
    this.recording = false;
    if (!this.node || !this.node.port) return Promise.resolve();
    return new Promise((resolve) => {
      this.onDone = resolve;
      this.node.port.postMessage('stop');
      setTimeout(() => { if (this.onDone) { this.onDone = null; resolve(); } }, 1500);
    });
  }

  // Build the WAV: optional peak levelling and fades, plus title metadata.
  // Works on the recorded blocks in place so a long take isn't copied
  // three times over (that alone can get a tab killed on a phone).
  toWav({ normalize = true, fade = true, title = 'Genbient', comment = '' } = {}) {
    const sr = this.e.ctx.sampleRate;
    const frames = this.frames;
    const target = Math.pow(10, -1 / 20); // -1 dBFS
    const g = normalize && this.peak > 0.001 ? Math.min(target / this.peak, 8) : 1;
    const fadeFrames = fade ? Math.min(Math.floor(sr * 1.5), Math.floor(frames / 4)) : 0;
    let i = 0;
    for (const c of this.chunks) {
      for (let j = 0; j < c.length; j += 2, i++) {
        let k = g;
        if (i < fadeFrames) k *= i / fadeFrames;
        else if (i >= frames - fadeFrames) k *= (frames - 1 - i) / fadeFrames;
        if (k !== 1) {
          c[j] = Math.max(-32768, Math.min(32767, Math.round(c[j] * k)));
          c[j + 1] = Math.max(-32768, Math.min(32767, Math.round(c[j + 1] * k)));
        }
      }
    }
    const blob = encodeWav(this.chunks, frames, sr, { INAM: title, ISFT: 'Genbient', ICMT: comment });
    this.chunks = [];
    return blob;
  }
}

function encodeWav(chunks, frames, sampleRate, info) {
  const enc = new TextEncoder();
  const infoParts = Object.entries(info).filter(([, v]) => v).map(([id, v]) => {
    let bytes = enc.encode(String(v) + '\0');
    if (bytes.length % 2) { const b = new Uint8Array(bytes.length + 1); b.set(bytes); bytes = b; }
    return { id, bytes };
  });
  const infoSize = 4 + infoParts.reduce((n, p) => n + 8 + p.bytes.length, 0);
  const dataBytes = frames * 4;
  const size = 12 + 24 + (8 + infoSize) + 8 + dataBytes;
  const buf = new ArrayBuffer(size - dataBytes); // header only; the audio blocks follow as they are
  const v = new DataView(buf);
  let p = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (x) => { v.setUint32(p, x, true); p += 4; };
  const u16 = (x) => { v.setUint16(p, x, true); p += 2; };
  str('RIFF'); u32(size - 8); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(2); u32(sampleRate); u32(sampleRate * 4); u16(4); u16(16);
  str('LIST'); u32(infoSize); str('INFO');
  for (const { id, bytes } of infoParts) { str(id); u32(bytes.length); new Uint8Array(buf, p, bytes.length).set(bytes); p += bytes.length; }
  str('data'); u32(dataBytes);
  return new Blob([buf, ...chunks], { type: 'audio/wav' });
}
