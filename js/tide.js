/*
 * The tide: an arranger for listening. A scene's parts don't all play all
 * the time. The ground stays; melodies, halos, bass, drums and weather come
 * and go, phrase by phrase, so the music breathes the way a live ambient set
 * does, and a long listen keeps finding new combinations of the same few
 * sounds.
 *
 * When things change follows 1/f ("pink") noise, summed over time scales
 * an octave apart (Voss–McCartney). Natural sounds and most music have
 * this shape: small changes often, big ones rarely, never a pattern you can
 * count. Each part has a threshold on that tide; it plays while the tide is
 * above it. Thresholds come from the scene's genome, so a melodic piece
 * keeps its tune in more often and a restless one moves more.
 */
import { clamp } from './util.js';

const THRESHOLD = {
  bed: -1, texture: 0.22, texture2: 0.46, lead: 0.34, answer: 0.56, halo: 0.6, bed2: 0.5, bass: 0.4, kit: 0.36,
};
const ROWS = 5;

export class Tide {
  // host: { get state() }
  constructor(engine, host) {
    this.e = engine;
    this.host = host;
    this.active = false;
    engine.on('bar', (b) => this.onBar(b));
  }

  start() {
    this.active = true;
    this.phrase = -1;
    this.rows = Array.from({ length: ROWS }, () => Math.random());
    this.own = {};
    this.since = {};
    this.level = null;
    // the opening: only the ground and the weather; the rest arrives in time
    const roles = this.host.state.roles || {};
    const th = this.thresholds();
    for (const [id, role] of Object.entries(roles)) {
      const l = this.e.layers[id];
      if (l && th[role] != null) l.setPresence(th[role] < 0.25 ? 1 : 0, 1.5);
      this.since[id] = 0;
    }
  }

  stop() {
    this.active = false;
    for (const l of Object.values(this.e.layers)) l.setPresence(1, 4);
  }

  // A part the listener switched on by hand is theirs; the tide leaves it be.
  release(id) {
    this.e.layers[id]?.setPresence(1, 2);
    if (this.since) delete this.since[id];
  }

  get genome() { return this.host.state.genome || {}; }

  thresholds() {
    const G = this.genome;
    const t = { ...THRESHOLD };
    const melody = G.melody ?? 0.5;
    t.lead -= (melody - 0.5) * 0.25;
    t.answer -= (melody - 0.5) * 0.15;
    t.texture -= ((G.nature ?? 0.5) - 0.5) * 0.3;
    t.kit -= ((G.pulse ?? 0.5) - 0.5) * 0.3;
    t.bass -= ((G.pulse ?? 0.5) - 0.5) * 0.25;
    return t;
  }

  onBar({ bar, t, dur }) {
    if (!this.active || !this.e.ctx) return;
    // phrases of about twenty seconds, on a bar line
    const bars = [2, 4, 8, 16].reduce((a, b) => (Math.abs(b * dur - 20) < Math.abs(a * dur - 20) ? b : a));
    if (bar % bars !== 0) return;
    this.phrase++;
    const n = this.phrase;
    const G = this.genome;
    const change = G.change ?? 0.5;
    // restless pieces refresh their fast rows every phrase, patient ones less often
    const slow = Math.round((1 - change) * 2);
    for (let k = 0; k < ROWS; k++) if (n % (2 ** (k + slow)) === 0) this.rows[k] = Math.random();
    const pink = this.rows.reduce((a, b) => a + b, 0) / ROWS;
    const depth = 1.3 + change * 1.4;
    let tide = 0.5 + (pink - 0.5) * depth;
    // an opening: the ground first, then the rest, over a few phrases
    tide = Math.min(tide, 0.3 + n * 0.22);
    this.level = tide;

    const roles = this.host.state.roles || {};
    const th = this.thresholds();
    const phraseS = bars * dur;
    const moves = [];
    const kit = Object.keys(roles).filter((id) => roles[id] === 'kit' && this.e.layers[id]?.on);
    for (const [id, role] of Object.entries(roles)) {
      const l = this.e.layers[id];
      if (!l || !l.on || th[role] == null || th[role] < 0) continue; // the ground stays
      if (role === 'kit' && id !== kit[0]) continue;
      // each part hears the tide with a little of its own current
      if (!(id in this.own) || Math.random() < 0.25) this.own[id] = Math.random();
      const here = tide * 0.78 + this.own[id] * 0.22;
      const on = l.presence > 0;
      let want = on ? here > th[role] - 0.05 : here > th[role] + 0.05;
      const held = n - (this.since[id] ?? 0);
      // nothing stays away too long, and nothing but the ground plays forever
      const core = role === 'lead' || role === 'kit' || role === 'bass';
      if (!on && held >= (core ? 2 : 4)) want = true;
      // the opening: one phrase of ground, then the tune and the beat arrive
      if (n === 1 && (role === 'lead' || role === 'kit')) want = true;
      if (on && held >= Math.round(16 - change * 10) && role !== 'texture') want = false;
      if (want === on) continue;
      if (n === 0) continue; // the first phrase is the ground alone
      if (held < 2 && n > 1) continue; // stay at least two phrases
      moves.push({ id, want, margin: Math.abs(here - th[role]) + (held > 3 ? 0.2 : 0) });
    }
    // no more than two parts change at once, the clearest cases first
    moves.sort((a, b) => b.margin - a.margin);
    for (const m of moves.slice(0, n === 1 ? 3 : 2)) {
      this.e.layers[m.id].setPresence(m.want ? 1 : 0, clamp(phraseS * (m.want ? 0.5 : 0.7), 3, 16), t);
      this.since[m.id] = n;
    }
    // the drums move as one kit
    if (kit.length > 1) {
      const lead = this.e.layers[kit[0]];
      for (const id of kit.slice(1)) if (this.e.layers[id].presence !== lead.presence) this.e.layers[id].setPresence(lead.presence, 4, t);
    }
    // never silence: if nothing tonal is playing, bring the lead or bed back
    const tonal = Object.keys(roles).filter((id) => ['bed', 'bed2', 'halo', 'lead', 'answer'].includes(roles[id]) && this.e.layers[id]?.on);
    if (tonal.length && !tonal.some((id) => this.e.layers[id].presence > 0)) {
      const back = tonal.find((id) => roles[id] === 'lead') || tonal[0];
      this.e.layers[back].setPresence(1, 6, t);
      this.since[back] = n;
    }
  }
}
