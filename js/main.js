import { Engine } from './engine.js';
import { Conductor } from './conductor.js';
import { Recorder } from './recorder.js';
import { Visuals } from './visuals.js';
import { LAYERS, LAYER_BY_ID, GROUPS } from './layers/index.js';
import { NOTE_NAMES, MODES } from './theory.js';
import { GLOBAL_SECTIONS, GLOBAL_BY_ID, VISUAL_PARAMS, defaults, fill, randomize } from './params.js';
import {
  PALETTES, MOODS, STARTS, SECTIONS, CADENCES, runify, unrun, generateScene, startScene, rerollSection, mutateScene,
  encodeScene, decodeScene, normalize,
} from './scenes.js';
import { seeded, clamp, lerp } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

const store = {
  get(k, d) { try { const v = localStorage.getItem('genbient:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('genbient:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const prefs = Object.assign(
  { volume: 0.85, journey: 0, breath: 'off', wake: false, mood: 'any', energy: null, filter: 'playing', quality: 'balanced', cadence: 165, runSong: true, runIntensity: 'steady', lite: false, recMax: 0, recFade: true, recLevel: true, intervals: 'off', pushCadence: 0, mode: 'listen' },
  store.get('prefs', {}),
);
prefs.vp = fill(prefs.vp, VISUAL_PARAMS);

const engine = new Engine();
engine.volume = prefs.volume;
const visuals = new Visuals($('#bg'), engine);
visuals.setParams(prefs.vp);
visuals.setQuality(prefs.quality);

let state = loadInitial();
let started = false;
let lastSceneChange = Date.now();

// Messaging apps sometimes glue text onto a link, so only the code itself is read.
function sceneFromHash() {
  const m = location.hash.match(/#s=([A-Za-z0-9_-]+)/);
  if (!m) return undefined;
  history.replaceState(null, '', location.pathname + location.search);
  const s = decodeScene(m[1]);
  if (!s) setTimeout(() => toast('That link couldn\'t be read'), 800);
  return s;
}

addEventListener('hashchange', () => {
  const s = sceneFromHash();
  if (s) { applyScene(s); toast(`Shared scene: ${s.name}`); }
});

function loadInitial() {
  const s = sceneFromHash();
  if (s) { setTimeout(() => toast('Shared soundscape loaded · tap to listen'), 800); return s; }
  const saved = store.get('scene2', null);
  if (saved) return normalize(saved);
  // First visit: something brand new, generated just for this person.
  return generateScene(newSeed(), { mood: 'oceanic', energy: 0.15 });
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.set('scene2', state); store.set('prefs', prefs); }, 300);
}

/* ─────────────────────────── engine events ─────────────────────────── */

engine.on('note', (n) => visuals.note(n));
engine.on('key', (hm) => {
  state.root = hm.root;
  state.mode = hm.mode;
  renderMeta();
  if (openName === 'music') renderSheet();
  save();
});
engine.on('evolve', (ev) => {
  if (ev.global) {
    state.g[ev.id] = ev.value;
    engine.setGlobal(ev.id, ev.value);
    bound.get(`g.${ev.id}`)?.(ev.value);
  } else {
    state.layers[ev.layer].p[ev.id] = ev.value;
    engine.layers[ev.layer].set(ev.id, ev.value);
    bound.get(`${ev.layer}.${ev.id}`)?.(ev.value);
  }
  save();
});

/* ─────────────────────────── scene application ─────────────────────────── */

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function setTheme() {
  const p = PALETTES[state.palette] || PALETTES.slate;
  const bg = hexRgb(p.bg), ink = hexRgb(p.ink);
  const surface = bg.map((c, i) => Math.round(lerp(c, ink[i], p.light ? 0.035 : 0.045)));
  const root = document.documentElement;
  root.style.setProperty('--bg', p.bg);
  root.style.setProperty('--bg-rgb', bg.join(' '));
  root.style.setProperty('--ink-rgb', ink.join(' '));
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--surface', `rgb(${surface.join(' ')})`);
  root.classList.toggle('light', !!p.light);
  $('meta[name="theme-color"]').setAttribute('content', p.bg);
}

function applyScene(next, { fade = 5, animate = true, remember = true } = {}) {
  if (remember && booted) remember_(state);
  state = normalize(next);
  savedId = null;
  lastSceneChange = Date.now();
  visuals.setPalette(state.palette);
  setTheme();
  if (started) engine.apply(state, { fade });
  else engine.g = { ...engine.g, ...state.g };
  renderTitle(animate);
  syncConductor(true);
  renderModes();
  renderPanel();
  updateMediaSession();
  renderTitleActions();
  if (openName) renderSheet();
  save();
}

function renderTitle(animate) {
  const t = $('#title');
  const write = () => {
    $('#scene-name').textContent = state.name;
    $('#scene-tag').textContent = state.tagline || '';
    renderMeta();
  };
  if (!animate) return write();
  t.classList.add('swap');
  setTimeout(() => { write(); t.classList.remove('swap'); }, 650);
}

function renderMeta() {
  const n = LAYERS.filter((l) => state.layers[l.id].on).length;
  const mood = MOODS.find((m) => m.id === state.mood);
  const bits = [mood ? mood.name : null, `${NOTE_NAMES[state.root]} ${MODES[state.mode].name.toLowerCase()}`, `${Math.round(state.g.bpm)} bpm`].filter(Boolean);
  if (state.g.meter !== '4/4') bits.push(state.g.meter);
  bits.push(`${n} ${n === 1 ? 'layer' : 'layers'}`);
  $('#scene-meta').textContent = bits.map((b) => b.replace(/ /g, '\u00a0')).join(' · ');
}

/* ─────────────────────────── play / pause ─────────────────────────── */

const orb = $('#orb');

async function togglePlay() {
  if (engine.playing) {
    keepAlive.pause();
    engine.pause();
    document.body.classList.remove('playing');
    orb.setAttribute('aria-label', 'Play');
    $('#orb-label').textContent = 'resume';
    releaseWake();
    setMediaState('paused');
    return;
  }
  stopPreview();
  engine.init();
  if (!started) {
    started = true;
    document.body.classList.add('started');
    engine.setLite(prefs.lite);
    engine.apply(state, { fade: 6 });
    syncConductor(true);
  }
  keepAlive.play().catch(() => {});
  try {
    await engine.play();
  } catch (err) {
    console.error(err);
    toast('Audio could not start. Tap again.');
    return;
  }
  document.body.classList.add('playing');
  orb.setAttribute('aria-label', 'Pause');
  if (sleepEnd) engine.scheduleSleep((sleepEnd - Date.now()) / 1000);
  if (prefs.wake) requestWake();
  updateMediaSession();
  setMediaState('playing');
  bumpIdle();
}

orb.addEventListener('click', () => {
  if (wakeTap) { wakeTap = false; return; }
  togglePlay();
});


document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (engine.playing && engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume();
  if (engine.playing && prefs.wake) requestWake();
});

/* ─────────────────────────── generate ─────────────────────────── */

function generate() {
  if (running()) { newRunMusic(); toast('New music, same beat', undoAction()); return; }
  const mood = prefs.mood === 'any' ? undefined : prefs.mood;
  applyScene(generateScene(newSeed(), { mood, energy: prefs.energy ?? undefined, rhythm: state.g.beat ? undefined : false }));
  if (!started) togglePlay();
  else toast(state.name, undoAction());
}

/* ─────────────────────────── history & saved scenes ─────────────────────────── */

// Every scene you leave is kept, so Random is never a one-way door.
let booted = false;
let savedId = null;
const history_ = store.get('history', []);
let library = store.get('library', []);

function remember_(s) {
  const code = encodeScene(s);
  if (history_.length && history_[history_.length - 1].code === code) return;
  history_.push({ code, name: s.name, mood: s.mood });
  if (history_.length > 30) history_.shift();
  store.set('history', history_);
}

function back() {
  const prev = history_.pop();
  store.set('history', history_);
  const s = prev && decodeScene(prev.code);
  if (!s) { renderTitleActions(); return toast('Nothing further back'); }
  applyScene(s, { remember: false, fade: 4 });
  toast(`Back to ${s.name}`);
}

const undoAction = () => ({ label: 'Back', fn: back });

function saveScene() {
  if (savedId) return toast('Already saved · find it under Scenes');
  const id = Date.now().toString(36);
  library.unshift({ id, code: encodeScene(state), name: state.name, mood: state.mood, at: Date.now() });
  if (library.length > 200) library.length = 200;
  store.set('library', library);
  savedId = id;
  renderTitleActions();
  if (openName === 'create') renderSheet();
  toast('Saved · find it under Scenes');
}

function loadSaved(entry) {
  const s = decodeScene(entry.code);
  if (!s) return toast('That scene could not be read');
  applyScene(s);
  savedId = entry.id;
  renderTitleActions();
  if (!started) togglePlay();
}

function removeSaved(entry) {
  library = library.filter((x) => x.id !== entry.id);
  store.set('library', library);
  if (savedId === entry.id) savedId = null;
  renderTitleActions();
  toast(`Removed ${entry.name}`, { label: 'Undo', fn: () => { library.unshift(entry); library.sort((a, b) => b.at - a.at); store.set('library', library); if (openName === 'create') renderSheet(); } });
}

function renderTitleActions() {
  $('#btn-back').hidden = !history_.length;
  const b = $('#btn-save');
  b.textContent = savedId ? 'Saved' : 'Save';
  b.classList.toggle('done', !!savedId);
}

$('#btn-back').addEventListener('click', back);
$('#btn-save').addEventListener('click', saveScene);

$('#btn-generate').addEventListener('click', generate);

/* ─────────────────────────── recording ─────────────────────────── */

const recorder = new Recorder(engine);
const recBtn = $('#btn-rec');
let recTimer = null;
let clip = null;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let recBusy = false; // between a tap and the recorder actually starting or stopping

let recStoppedAt = 0;

async function startRecording() {
  // a double tap on stop must not throw away the clip it just made
  if (recBusy || performance.now() - recStoppedAt < 1200) return;
  recBusy = true;
  try {
    if (!engine.playing) await togglePlay();
    if (!engine.ctx || !engine.playing) return;
    discardClip();
    await recorder.start();
  } catch (err) {
    console.error(err);
    toast('Recording isn\'t available in this browser');
    return;
  } finally {
    recBusy = false;
  }
  if (!recorder.recording) return;
  clearInterval(recTimer);
  recBtn.classList.add('rec');
  document.body.classList.add('recording');
  const limit = prefs.recMax || recorder.maxSeconds;
  recTimer = setInterval(() => {
    const s = recorder.seconds;
    recBtn.textContent = mmss(s);
    if (s >= limit) stopRecording();
  }, 250);
  recBtn.textContent = '0:00';
  recBtn.setAttribute('aria-label', 'Stop recording');
  toast(prefs.recMax ? `Recording ${mmss(prefs.recMax)}` : 'Recording · tap again to stop');
}

async function stopRecording() {
  if (!recorder.recording || recBusy) return;
  recBusy = true;
  clearInterval(recTimer);
  await recorder.stop();
  recBusy = false;
  recStoppedAt = performance.now();
  recBtn.classList.remove('rec');
  document.body.classList.remove('recording');
  recBtn.textContent = 'Rec';
  recBtn.setAttribute('aria-label', 'Record a clip');
  const secs = recorder.seconds;
  if (secs < 1) { toast('Too short to keep'); return; }
  const blob = recorder.toWav({
    normalize: prefs.recLevel, fade: prefs.recFade,
    title: state.name, comment: `Recreate this scene: ${location.origin}${location.pathname}#s=${encodeScene(state)}`,
  });
  const safe = state.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  clip = { blob, name: `genbient-${safe}-${stamp}.wav`, secs };
  $('#clip-meta').textContent = `${mmss(secs)} · WAV · ${(blob.size / 1048576).toFixed(1)} MB`;
  $('#clip').hidden = false;
}

async function saveClip() {
  if (!clip) return;
  const file = new File([clip.blob], clip.name, { type: 'audio/wav' });
  // phones: share sheet (Files, AirDrop, Mail); computers: a normal download
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: state.name });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(clip.blob);
  a.download = clip.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast('Clip saved');
}

function discardClip() {
  stopPreview();
  clip = null;
  $('#clip').hidden = true;
}

// Listen back before saving. The live music pauses so the two don't clash.
let preview = null;
function togglePreview() {
  if (preview) return stopPreview();
  if (!clip) return;
  if (engine.playing) togglePlay();
  preview = new Audio(URL.createObjectURL(clip.blob));
  preview.addEventListener('ended', stopPreview);
  preview.play().catch(stopPreview);
  $('#clip-play').textContent = 'Stop';
}
function stopPreview() {
  if (!preview) return;
  preview.pause();
  URL.revokeObjectURL(preview.src);
  preview = null;
  $('#clip-play').textContent = 'Play';
}

recBtn.addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));
$('#clip-save').addEventListener('click', saveClip);
$('#clip-play').addEventListener('click', togglePreview);
$('#clip-discard').addEventListener('click', discardClip);

function recordSection() {
  const sec = section('Record a clip', 'lossless WAV');
  sec.append(h('p', 'note', 'Tap <b>Rec</b> at the top to record what\'s playing. You get a lossless WAV that opens in any podcast editor. The phone\'s volume doesn\'t affect the recording.'));
  const len = h('div', 'choice');
  len.append(h('span', 'choice-label', 'Stop after'));
  len.append(chips([[0, 'When I tap'], [30, '30 s'], [60, '1 min'], [120, '2 min'], [300, '5 min']].map(([v, l]) => ({ value: v, label: l })), prefs.recMax, (v) => { prefs.recMax = v; save(); }));
  sec.append(len);
  const tog = (key, label, sub) => {
    const row = h('button', 'toggle-row small', `<span><b>${label}</b><small>${sub}</small></span><span class="switch${prefs[key] ? ' on' : ''}"></span>`);
    row.addEventListener('click', () => { prefs[key] = !prefs[key]; row.querySelector('.switch').classList.toggle('on', prefs[key]); save(); });
    return row;
  };
  sec.append(tog('recFade', 'Fade in and out', '1.5 seconds at each end'), tog('recLevel', 'Even out the level', 'loudest moment at −1 dB'));
  return sec;
}

/* ─────────────────────────── running ─────────────────────────── */

const running = () => state.mood === 'run';
let currentSection = null;

// The arranger turns a running scene into an evolving song.
const conductor = new Conductor(engine, {
  get state() { return state; },
  setLayer(id, on, p, fade, at) {
    const ls = state.layers[id];
    if (p) Object.assign(ls.p, p);
    ls.on = on;
    if (!started) return;
    const l = engine.layers[id];
    if (p) l.setAll(ls.p);
    if (on) l.enable(fade, at); else l.disable(fade, at);
  },
  onSection(info) {
    currentSection = info;
    refreshViews();
    renderMeta();
    if (openName === 'layers') renderSheet();
    save();
  },
  onKey() {
    state.root = engine.harmony.root;
    renderMeta();
  },
});

function syncConductor(restart) {
  const want = started && running() && prefs.runSong;
  conductor.intensity = runIntensity();
  if (want) {
    // running is strict about time: straight, tight, echoes on the grid
    if (state.g.swing) setGlobal('swing', 0);
    if (state.g.humanize > 0.02) setGlobal('humanize', 0.02);
    if (![0.25, 0.5, 1, 2].includes(state.g.dlyDiv)) setGlobal('dlyDiv', 0.5);
    if (!state.g.halfTime) setGlobal('halfTime', true);
  }
  // a full running band needs a little more headroom than an ambient bed
  if (engine.ctx) engine.drive.gain.setTargetAtTime(want ? 0.75 : 0.95, engine.ctx.currentTime, 0.5);
  if (want && (restart || !conductor.active)) conductor.start();
  else if (!want && conductor.active) conductor.stop();
}
const cadenceViews = new Set();

// Changing cadence only changes the tempo. From an ambient scene, the first
// cadence adds a running beat underneath it instead of replacing it.
function setCadence(v) {
  v = clamp(Math.round(v), 120, 200);
  prefs.cadence = v;
  if (running()) {
    setGlobal('bpm', v);
    if (runPhase === 'push') runBase = v - prefs.pushCadence;
  } else {
    resetRunClock();
    applyScene(runify(state, v, newSeed()), { fade: 2, animate: false });
    toast(`Running beat at ${v} steps a minute`);
  }
  if (!started || !engine.playing) togglePlay();
  refreshViews();
  save();
}

function newRunMusic() {
  const mood = MOODS.find((m) => m.id === state.prevMood) ? state.prevMood : undefined;
  const base = generateScene(newSeed(), { mood, rhythm: false });
  applyScene(runify(base, state.g.bpm, newSeed()));
}

function endRun() {
  const took = runElapsed;
  if (runPhase === 'push') setGlobal('bpm', runBase);
  resetRunClock();
  applyScene(unrun(state), { fade: 3, animate: false });
  if (took > 60) return toast(`Run finished · ${mmss(took)}`);
  toast('Back to ambient');
}

function cadenceControl(views = cadenceViews) {
  const el = h('div', 'cadence');
  const down = h('button', null, '−');
  const out = h('output');
  const up = h('button', null, '+');
  down.setAttribute('aria-label', 'Slower cadence');
  up.setAttribute('aria-label', 'Faster cadence');
  const show = () => { out.textContent = running() ? Math.round(state.g.bpm) : prefs.cadence; };
  down.addEventListener('click', () => setCadence((running() ? state.g.bpm : prefs.cadence) - 1));
  up.addEventListener('click', () => setCadence((running() ? state.g.bpm : prefs.cadence) + 1));
  el.append(down, out, up, h('span', null, 'steps / min'));
  show();
  views.add(show);
  return el;
}

/* ─────────────────────────── modes: Listen · Run · Sleep ─────────────────────────── */

// The three ways people use this sit at the top; each one shows its own
// few controls under the scene name. Deeper settings stay in the dock.
const mode = () => (running() ? 'run' : prefs.mode === 'sleep' ? 'sleep' : 'listen');
const panel = $('#panel');
const panelViews = new Set();
const refreshViews = () => { cadenceViews.forEach((f) => f()); panelViews.forEach((f) => f()); };

function setMode(m) {
  if (m === mode()) return;
  if (m === 'run') return setCadence(prefs.cadence);
  prefs.mode = m;
  if (running()) endRun();
  else { renderModes(); renderPanel(); }
  if (m === 'sleep') toast(sleepEnd ? 'Sleep' : 'Sleep · set a timer below');
  save();
}

function renderModes() {
  const m = mode();
  document.querySelectorAll('.modes [data-mode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === m);
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  });
  document.body.dataset.mode = m;
}
document.querySelectorAll('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

function prow(label, content, extra) {
  const row = h('div', 'prow');
  row.append(h('span', 'prow-label', label), content);
  if (extra) row.append(extra);
  return row;
}

function renderPanel() {
  panel.innerHTML = '';
  panelViews.clear();
  const m = mode();
  const opts = (list) => list.map(([value, label]) => ({ value, label }));
  if (m === 'listen') {
    panel.append(prow('Rhythm', chips(opts([[true, 'On'], [false, 'Off']]), !!state.g.beat, (v) => setRhythm(v), 'pchips')));
    panel.append(prow('Drift', chips(opts([[0, 'Off'], [5, '5 min'], [10, '10'], [20, '20'], [40, '40']]), prefs.journey, setJourney, 'pchips')));
  } else if (m === 'run') {
    const top = h('div', 'prow run-top');
    const tap = h('button', 'chip tap-mini', 'Tap');
    tap.setAttribute('aria-label', 'Tap along with your steps to set the cadence');
    tap.addEventListener('click', () => tapStep());
    top.append(cadenceControl(panelViews), tap);
    panel.append(top);
    const status = h('div', 'run-status');
    const lab = h('span', 'section-label');
    const time = h('span', 'run-time');
    status.append(lab, time);
    panel.append(status);
    panelViews.add(() => {
      lab.textContent = runPhaseLabel() || (conductor.active && currentSection ? currentSection.name.toLowerCase() : prefs.runSong ? 'starting' : 'steady loop');
      time.textContent = runElapsed >= 1 ? mmss(runElapsed) : '0:00';
    });
    const more = h('button', 'text-btn more-btn', 'More');
    more.addEventListener('click', () => openSheet('run'));
    panel.append(prow('Intervals', chips(Object.entries(INTERVALS).map(([id, iv]) => ({ value: id, label: iv ? iv.short : 'Off' })), prefs.intervals, setIntervals, 'pchips'), more));
  } else {
    panel.append(prow('Timer', chips(opts([[0, 'Off'], [15, '15 min'], [30, '30'], [45, '45'], [60, '60'], [90, '90']]), sleepEnd ? sleepMin : 0, setSleep, 'pchips')));
    panel.append(prow('Breathe', chips(Object.entries(BREATHS).map(([id, b]) => ({ value: id, label: b ? b.label : 'Off' })), prefs.breath, setBreath, 'pchips')));
    const st = h('div', 'run-status');
    st.append(h('span', 'timer-status'));
    const calmer = h('button', 'text-btn', 'Sleepier scene');
    calmer.addEventListener('click', () => {
      applyScene(generateScene(newSeed(), { mood: 'sleep', rhythm: false }));
      toast(state.name, undoAction());
      if (!started) togglePlay();
    });
    st.append(calmer);
    panel.append(st);
    updateTimerStatus();
  }
  refreshViews();
}

function setJourney(v) {
  prefs.journey = v;
  lastSceneChange = Date.now();
  save();
  toast(v ? `A new scene drifts in every ${v} min` : 'The scene stays');
}

function setIntervals(v) {
  prefs.intervals = v;
  if (runPhase === 'push' && prefs.pushCadence) setGlobal('bpm', runBase);
  runPhase = 'off';
  tickRun(0);
  conductor.intensity = runIntensity();
  refreshViews();
  save();
  if (v !== 'off') toast(running() && runElapsed < WARMUP ? `Intervals start after the warm-up` : `Intervals on`);
}

/* ─── run clock and intervals ─── */

// Time only counts while the music plays, so pausing at a crossing pauses the run.
let runElapsed = 0;
let runPhase = 'off';
let runBase = 0;
const WARMUP = 300;
const INTERVALS = {
  off: null,
  '1-2': { on: 60, off: 120, label: '1 min push · 2 easy', short: '1 / 2' },
  '2-2': { on: 120, off: 120, label: '2 push · 2 easy', short: '2 / 2' },
  '4-3': { on: 240, off: 180, label: '4 push · 3 easy', short: '4 / 3' },
};

function resetRunClock() {
  runElapsed = 0;
  runPhase = 'off';
  conductor.intensity = runIntensity();
}

function runIntensity() {
  return runPhase === 'push' ? 'push' : runPhase === 'easy' ? 'easy' : prefs.runIntensity;
}

function phaseAt(t) {
  const iv = INTERVALS[prefs.intervals];
  if (!iv) return { phase: 'off' };
  if (t < WARMUP) return { phase: 'warm', left: WARMUP - t };
  const c = (t - WARMUP) % (iv.on + iv.off);
  return c < iv.on ? { phase: 'push', left: iv.on - c } : { phase: 'easy', left: iv.on + iv.off - c };
}

function runPhaseLabel() {
  if (!running() || runPhase === 'off') return '';
  const { left } = phaseAt(runElapsed);
  const name = { warm: 'warm-up', push: 'push', easy: 'easy' }[runPhase];
  return `${name} · ${mmss(left)} left`;
}

function tickRun(dt) {
  if (!running()) { if (runElapsed || runPhase !== 'off') resetRunClock(); return; }
  if (!engine.playing) return;
  runElapsed += dt;
  const { phase } = phaseAt(runElapsed);
  if (phase !== runPhase) {
    const was = runPhase;
    runPhase = phase;
    conductor.intensity = runIntensity();
    if (phase === 'push') {
      runBase = Math.round(state.g.bpm);
      if (prefs.pushCadence) setGlobal('bpm', runBase + prefs.pushCadence);
      conductor.force('peak');
      conductor.cue(true);
      toast('Push');
    } else if (phase === 'easy' && was === 'push') {
      if (prefs.pushCadence) setGlobal('bpm', runBase);
      conductor.force('breakdown');
      conductor.cue(false);
      toast('Easy');
    } else if (phase === 'off' && was === 'push' && prefs.pushCadence) setGlobal('bpm', runBase);
  }
  refreshViews();
}

// Tap tempo: tap along with your footsteps to set the cadence.
const taps = [];
function tapStep(label) {
  const say = (msg) => { if (label) label.textContent = msg; else toast(msg); };
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 1500) taps.length = 0;
  taps.push(now);
  if (taps.length > 9) taps.shift();
  if (taps.length < 4) { say(taps.length === 1 ? 'Tap with each step · 3 more' : `Keep tapping · ${4 - taps.length} more`); return; }
  const iv = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
  const median = iv[Math.floor(iv.length / 2)];
  const cadence = Math.round(60000 / median);
  setCadence(cadence);
  say(`${clamp(cadence, 120, 200)} steps a minute`);
}

function runSection() {
  const run = section('Running', running() ? 'on' : 'steps per minute');
  run.append(h('p', 'note', running()
    ? 'Kick on every step, hats in between. Chords and melodies move at half speed so they stay calm. Changing cadence only changes the tempo.'
    : 'Adds a steady beat under the scene that\'s playing now: kick on every step, hats in between. Most runners land between <b>160 and 180</b>.'));
  run.append(cadenceControl());
  const tap = h('button', 'tap', 'Tap along with your steps<small>tap 4 or more times</small>');
  tap.addEventListener('click', () => tapStep(tap.querySelector('small')));
  run.append(tap);
  run.append(chips(CADENCES.map((c) => ({ value: c, label: String(c) })), running() ? state.g.bpm : null, (v) => setCadence(v), 'scroll'));
  const arr = h('div', 'choice');
  arr.append(h('span', 'choice-label', 'Arrangement'));
  arr.append(chips([{ value: true, label: 'Evolving song' }, { value: false, label: 'Steady loop' }], prefs.runSong, (v) => {
    prefs.runSong = v;
    syncConductor(false);
    if (!v) toast('Steady loop: everything stays as it is');
    refreshViews();
    save();
  }));
  arr.append(h('p', 'note', 'Evolving: instruments take turns, drums change pattern, breakdowns and builds come and go. The kick stays on every step throughout.'));
  run.append(arr);
  const inten = h('div', 'choice');
  inten.append(h('span', 'choice-label', 'Intensity'));
  inten.append(chips([{ value: 'easy', label: 'Easy' }, { value: 'steady', label: 'Steady' }, { value: 'push', label: 'Push' }], prefs.runIntensity, (v) => {
    prefs.runIntensity = v;
    conductor.intensity = runIntensity();
    save();
  }));
  run.append(inten);
  const ivs = h('div', 'choice');
  ivs.append(h('span', 'choice-label', 'Intervals'));
  ivs.append(chips(Object.entries(INTERVALS).map(([id, iv]) => ({ value: id, label: iv ? iv.label : 'Off' })), prefs.intervals, (v) => { setIntervals(v); renderPanel(); }, 'scroll'));
  const pc = h('div', 'choice');
  pc.append(h('span', 'choice-label', 'Cadence during a push'));
  pc.append(chips([[0, 'Same'], [4, '+4'], [8, '+8'], [12, '+12']].map(([v, l]) => ({ value: v, label: l })), prefs.pushCadence, (v) => {
    if (runPhase === 'push') setGlobal('bpm', runBase + v);
    prefs.pushCadence = v;
    save();
  }));
  ivs.append(h('p', 'note', 'After a 5 minute warm-up the music alternates between a push and an easy stretch. Two soft bell notes mark each change: rising for push, falling for easy. The run clock pauses when the music does.'));
  ivs.append(pc);
  run.append(ivs);
  if (running()) {
    const row = h('div', 'row-btns');
    row.style.marginTop = '12px';
    const fresh = h('button', 'btn', 'New music, same beat');
    fresh.addEventListener('click', newRunMusic);
    const nextSec = h('button', 'btn', 'Next section');
    nextSec.addEventListener('click', () => { conductor.skip(); toast('Moving on at the next bar'); });
    if (prefs.runSong) row.append(nextSec);
    const stop = h('button', 'btn', 'End run');
    stop.addEventListener('click', () => { closeSheet(); setMode('listen'); });
    row.append(fresh, stop);
    run.append(row);
  }
  return run;
}


/*
 * iOS suspends Web Audio when the screen locks unless the page is also
 * playing a media element. A looping second of silence keeps the playback
 * session alive (and gives the lock screen its controls) at almost no cost.
 */
const keepAlive = (() => {
  const sr = 8000, n = sr;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, n * 2, true);
  const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  a.loop = true;
  a.setAttribute('playsinline', '');
  // if the system pauses it (a call, CarPlay handing over), pick it back up
  a.addEventListener('pause', () => { if (engine.playing) setTimeout(() => { if (engine.playing) a.play().catch(() => {}); }, 500); });
  return a;
})();

/* ─────────────────────────── rhythm mode ─────────────────────────── */

// Off: drums and heartbeat fall silent, bass holds, and Random makes
// beatless scenes. On: if this scene never had drums, give it some.
function setRhythm(on) {
  state.g.beat = on;
  engine.setGlobal('beat', on);
  const hasDrums = LAYERS.some((d) => d.group === 'rhythm' && state.layers[d.id].on);
  if (on && !hasDrums) {
    const next = rerollSection(state, 'rhythm', newSeed(), { rhythm: 'force', energy: Math.max(state.energy, 0.55) });
    next.name = state.name;
    next.tagline = state.tagline;
    applyScene(next, { fade: 3, animate: false });
  } else { renderPanel(); if (openName) renderSheet(); }
  toast(on ? 'Rhythm on' : 'Rhythm off');
  save();
}

/* ─────────────────────────── touch: the screen is an instrument ─────────────────────────── */

const app = $('#app');
const touches = new Map();
const isControl = (el) => el.closest('button, input, .dock, header, .sheet');

app.addEventListener('pointerdown', (e) => {
  if (isControl(e.target)) return;
  if (!started) togglePlay();
  touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false });
  try { app.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
  engine.init();
  engine.touch.down(e.pointerId, x, y);
  visuals.touch(e.pointerId, e.clientX, e.clientY, true);
});
app.addEventListener('pointermove', (e) => {
  const tt = touches.get(e.pointerId);
  if (!tt) {
    if (e.pointerType === 'mouse') bumpIdle();
    return;
  }
  if (Math.hypot(e.clientX - tt.x0, e.clientY - tt.y0) > 8) tt.moved = true;
  engine.touch.move(e.pointerId, e.clientX / innerWidth, e.clientY / innerHeight);
  visuals.touch(e.pointerId, e.clientX, e.clientY, true);
});
const endTouch = (e) => {
  const tt = touches.get(e.pointerId);
  if (!tt) return;
  touches.delete(e.pointerId);
  engine.touch?.up(e.pointerId);
  visuals.touch(e.pointerId, 0, 0, false);
  // a quick tap (not a gesture) brings the interface back
  if (!tt.moved && performance.now() - tt.t0 < 300) bumpIdle();
};
app.addEventListener('pointerup', endTouch);
app.addEventListener('pointercancel', endTouch);

/* ─────────────────────────── idle fade ─────────────────────────── */

let idleTimer;
let wakeTap = false;
addEventListener('pointerdown', (e) => {
  wakeTap = document.body.classList.contains('idle') && !!e.target.closest('button');
  if (wakeTap) { bumpIdle(); setTimeout(() => { wakeTap = false; }, 600); }
}, { capture: true });
function bumpIdle() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (engine.playing && !openName) document.body.classList.add('idle');
  }, 7000);
}
addEventListener('keydown', bumpIdle, { passive: true });

/* ─────────────────────────── sheets ─────────────────────────── */

const sheet = $('#sheet');
const body = $('#sheet-body');
const backdrop = $('#backdrop');
let openName = null;
const bound = new Map(); // live updaters for controls, keyed "layer.param" or "g.param"

const SHEETS = { create: renderCreate, layers: renderLayers, music: renderMusic, sound: renderSound, run: renderRun };

function renderRun(el) {
  el.append(head('Running', running() ? `${Math.round(state.g.bpm)} steps a minute` : 'off'));
  el.append(runSection());
}

let lastFocus = null;
function openSheet(name) {
  if (openName === name) return closeSheet();
  if (!openName) lastFocus = document.activeElement;
  openName = name;
  renderSheet();
  body.scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  sheet.inert = false;
  app.inert = true;
  sheet.setAttribute('aria-label', { create: 'Scenes', layers: 'Layers', music: 'Music', sound: 'Sound', run: 'Running' }[name]);
  backdrop.classList.add('open');
  requestAnimationFrame(() => { const h2 = body.querySelector('h2'); if (h2) { h2.tabIndex = -1; h2.focus({ preventScroll: true }); } });
  visuals.busy = true;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === name));
  bumpIdle();
}

function closeSheet() {
  openName = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  app.inert = false;
  backdrop.classList.remove('open');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
  visuals.busy = false;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.remove('active'));
  bumpIdle();
}

function renderSheet() {
  if (!openName) return;
  const top = body.scrollTop;
  bound.clear();
  cadenceViews.clear();
  body.innerHTML = '';
  SHEETS[openName](body);
  body.scrollTop = top;
}

document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
backdrop.addEventListener('click', closeSheet);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openName) closeSheet();
  if (e.target.tagName === 'INPUT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' && !openName && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
  const keys = {
    g: generate, n: generate, b: () => history_.length && back(), s: saveScene, r: () => (recorder.recording ? stopRecording() : startRecording()),
    1: () => openSheet('create'), 2: () => openSheet('layers'), 3: () => openSheet('music'), 4: () => openSheet('sound'),
    l: () => setMode('listen'), u: () => setMode('run'), z: () => setMode('sleep'),
  };
  const fn = keys[e.key.toLowerCase()];
  if (fn && (!openName || /\d/.test(e.key))) fn();
});

(() => {
  let y0 = null, dy = 0;
  const grab = $('#grab');
  grab.addEventListener('pointerdown', (e) => {
    y0 = e.clientY; dy = 0;
    sheet.classList.add('dragging');
    grab.setPointerCapture(e.pointerId);
  });
  grab.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (dy > 90) closeSheet();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  grab.addEventListener('click', () => { if (dy < 4) closeSheet(); });
})();

/* ─── building blocks ─── */

const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.8c.7 5 3.3 7.8 8.8 9.2-5.5 1.4-8.1 4.2-8.8 9.2-.7-5-3.3-7.8-8.8-9.2 5.5-1.4 8.1-4.2 8.8-9.2Z"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
};

function head(title, sub) {
  const el = h('div', 'sheet-head');
  el.append(h('h2', null, title));
  if (sub) el.append(h('small', null, sub));
  return el;
}

function section(title, aside, onDice) {
  const el = h('div', 'section');
  const t = h('div', 'section-title');
  t.append(h('span', null, title));
  const right = h('span', 'section-aside');
  if (aside) right.append(h('em', null, aside));
  if (onDice) {
    const d = h('button', 'mini-dice', 'shuffle');
    d.setAttribute('aria-label', `Randomise ${title}`);
    d.addEventListener('click', onDice);
    right.append(d);
  }
  t.append(right);
  el.append(t);
  return el;
}

function chips(options, current, onPick, cls = '') {
  const wrap = h('div', 'chips ' + cls);
  for (const o of options) {
    const b = h('button', 'chip' + (o.value === current ? ' on' : ''), o.label);
    b.setAttribute('aria-pressed', String(o.value === current));
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach((c) => { c.classList.remove('on'); c.setAttribute('aria-pressed', 'false'); });
      b.classList.add('on');
      b.setAttribute('aria-pressed', 'true');
      onPick(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

// Render any schema param as a control. Returns the element; registers a
// live updater under `key` so evolution can move it while visible.
function control(p, value, onChange, key) {
  if (p.type === 'range') {
    const wrap = h('label', 'slider wide');
    const lab = h('span', null, `${esc(p.label)}<em></em>`);
    const em = lab.querySelector('em');
    const input = h('input');
    input.type = 'range';
    input.min = 0; input.max = 1000; input.step = 1;
    input.setAttribute('aria-label', p.label);
    const toPos = (v) => Math.round(((v - p.min) / (p.max - p.min)) * 1000);
    const fromPos = (n) => {
      let v = p.min + (n / 1000) * (p.max - p.min);
      if (p.step >= 1) v = Math.round(v / p.step) * p.step;
      return clamp(v, p.min, p.max);
    };
    const show = (v) => {
      input.style.setProperty('--v', `${((v - p.min) / (p.max - p.min)) * 100}%`);
      em.textContent = p.fmt ? p.fmt(v) : '';
      input.setAttribute('aria-valuetext', em.textContent || String(Math.round(((v - p.min) / (p.max - p.min)) * 100)) + '%');
    };
    input.value = toPos(value);
    show(value);
    input.addEventListener('input', () => { const v = fromPos(+input.value); show(v); onChange(v); });
    if (key) bound.set(key, (v) => { input.value = toPos(v); show(v); });
    wrap.append(lab, input);
    if (p.hint) wrap.title = p.hint;
    return wrap;
  }
  if (p.type === 'choice') {
    const wrap = h('div', 'choice');
    wrap.append(h('span', 'choice-label', esc(p.label)));
    wrap.append(chips(p.options.map(([v, l]) => ({ value: v, label: l })), value, onChange, 'scroll'));
    return wrap;
  }
  const row = h('button', 'toggle-row small', `<span><b>${esc(p.label)}</b></span><span class="switch${value ? ' on' : ''}"></span>`);
  let cur = value;
  row.addEventListener('click', () => {
    cur = !cur;
    row.querySelector('.switch').classList.toggle('on', cur);
    onChange(cur);
  });
  return row;
}

function setGlobal(id, v) {
  if (id === 'beat') return setRhythm(v);
  state.g[id] = v;
  engine.setGlobal(id, v);
  if (id === 'bpm' || id === 'meter') { renderMeta(); refreshViews(); }
  save();
}

function globalSection(sec, el, { dice = true } = {}) {
  const s = section(sec.title, null, dice ? () => {
    const r = seeded(newSeed());
    const fresh = randomize(sec.params, r, { ...state.g });
    for (const p of sec.params) if (!p.keep) setGlobal(p.id, fresh[p.id]);
    renderSheet();
    toast(`New ${sec.title.toLowerCase()}`);
  } : null);
  for (const p of sec.params) s.append(control(p, state.g[p.id], (v) => setGlobal(p.id, v), `g.${p.id}`));
  el.append(s);
}


/* ─── Create ─── */

function renderCreate(el) {
  el.append(head('Scenes', `seed ${state.seed || '–'}`));

  const gen = h('button', 'primary', 'Random scene');
  gen.addEventListener('click', generate);
  el.append(gen);
  el.append(h('p', 'note', 'Every scene is built from a seed: layers, harmony, rhythm, sound and colour. Mood, energy and rhythm steer it.'));

  const mine = section('Saved', library.length ? `${library.length}` : null);
  if (!library.length) mine.append(h('p', 'note', 'Tap <b>Save</b> under a scene\'s name to keep it here. Saved scenes come back exactly as they were.'));
  const ml = h('div', 'starts saved');
  for (const entry of library) {
    const item = h('div', 'saved-item' + (entry.id === savedId ? ' current' : ''));
    const b = h('button', null, `<b>${esc(entry.name)}</b><span>${esc(MOODS.find((m) => m.id === entry.mood)?.name.toLowerCase() || '')}</span>`);
    b.addEventListener('click', () => loadSaved(entry));
    const x = h('button', 'remove', '×');
    x.setAttribute('aria-label', `Remove ${entry.name}`);
    x.addEventListener('click', () => { removeSaved(entry); renderSheet(); });
    item.append(b, x);
    ml.append(item);
  }
  mine.append(ml);
  el.append(mine);

  if (history_.length) {
    const rec = section('Recent', 'tap to go back');
    const rl = h('div', 'starts');
    history_.slice(-6).reverse().forEach((entry) => {
      const b = h('button', null, `<b>${esc(entry.name)}</b><span>${esc(MOODS.find((m) => m.id === entry.mood)?.name.toLowerCase() || '')}</span>`);
      b.addEventListener('click', () => {
        const s2 = decodeScene(entry.code);
        if (!s2) return;
        history_.splice(history_.lastIndexOf(entry), 1);
        applyScene(s2);
        if (!started) togglePlay();
      });
      rl.append(b);
    });
    rec.append(rl);
    el.append(rec);
  }


  const mood = section('Mood');
  mood.append(chips([{ value: 'any', label: 'Any' }, ...MOODS.map((m) => ({ value: m.id, label: m.name }))], prefs.mood, (v) => { prefs.mood = v; save(); }, 'scroll'));
  el.append(mood);

  const en = section('Energy');
  en.append(chips([[null, 'Any'], [0.03, 'Still'], [0.2, 'Calm'], [0.45, 'Flowing'], [0.7, 'Groove'], [0.9, 'Lively']].map(([v, l]) => ({ value: v, label: l })),
    prefs.energy, (v) => { prefs.energy = v; save(); }));
  el.append(en);

  const rr = section('Regenerate one part', 'the rest stays');
  const list = h('div', 'reroll-list');
  for (const s of SECTIONS) {
    const b = h('button', 'reroll', s.name);
    b.title = s.hint;
    b.addEventListener('click', () => {
      applyScene(rerollSection(state, s.id, newSeed()), { fade: 4 });
      toast(`New ${s.name.toLowerCase()}`, undoAction());
    });
    list.append(b);
  }
  const mut = h('button', 'reroll', 'Nudge everything');
  mut.addEventListener('click', () => { applyScene(mutateScene(state, newSeed()), { fade: 6 }); toast('Nudged', undoAction()); });
  list.append(mut);
  rr.append(list);
  el.append(rr);


  const sh = section('Share');
  sh.append(h('p', 'note', 'The link holds <b>every setting</b>. Whoever opens it hears this exact scene.'));
  const row = h('div', 'row-btns');
  const b1 = h('button', 'btn', 'Share…');
  b1.addEventListener('click', share_);
  const b2 = h('button', 'btn', 'Copy link');
  b2.addEventListener('click', copyLink);
  row.append(b1, b2);
  sh.append(row);
  el.append(sh);

  const st = section('Starting points');
  const ul = h('div', 'starts');
  for (const s of STARTS) {
    const b = h('button', s.name === state.name ? 'current' : '', `<b>${esc(s.name)}</b><span>${esc(MOODS.find((m) => m.id === s.mood).name.toLowerCase())}</span>`);
    b.addEventListener('click', () => {
      applyScene(startScene(s));
      if (!started) togglePlay();
    });
    ul.append(b);
  }
  st.append(ul);
  el.append(st);
}

/* ─── Layers ─── */

const expanded = new Set();

function renderLayers(el) {
  const count = () => LAYERS.filter((l) => state.layers[l.id].on).length;
  const hd = head('Layers', `${count()} of ${LAYERS.length} playing`);
  el.append(hd);
  if (prefs.filter === 'playing' && !count()) prefs.filter = 'all';
  el.append(chips([{ value: 'playing', label: 'Playing' }, { value: 'all', label: 'All' }, ...GROUPS.map((g) => ({ value: g.id, label: g.name }))],
    prefs.filter, (v) => { prefs.filter = v; save(); renderSheet(); }, 'scroll filter'));

  const visible = LAYERS.filter((d) => prefs.filter === 'all' || (prefs.filter === 'playing' ? state.layers[d.id].on : d.group === prefs.filter));
  if (prefs.filter === 'playing') {
    const add = h('p', 'note', 'Tap <b>All</b> or a group to add more layers.');
    if (!visible.length) el.append(add);
  }
  for (const def of visible) el.append(layerCard(def, hd, count));
}

function layerCard(def, hd, count) {
  const ls = state.layers[def.id];
  const row = h('div', 'layer' + (ls.on ? ' on' : '') + (expanded.has(def.id) ? ' open' : ''));
  const groupName = GROUPS.find((g) => g.id === def.group).name + (def.group === 'rhythm' && !state.g.beat ? ' · rhythm off' : '');
  const tg = h('button', 'layer-toggle', `<span class="dot"></span><span class="layer-name">${esc(def.name)}<small>${groupName.toLowerCase()}${def.id === 'binaural' ? ' · headphones' : ''}</small></span><span class="switch"></span>`);
  tg.setAttribute('aria-pressed', String(ls.on));
  tg.addEventListener('click', () => {
    ls.on = !ls.on;
    row.classList.toggle('on', ls.on);
    tg.setAttribute('aria-pressed', String(ls.on));
    hd.querySelector('small').textContent = `${count()} of ${LAYERS.length} playing`;
    if (started) { if (ls.on) { engine.layers[def.id].setAll(ls.p); engine.layers[def.id].enable(3); } else engine.layers[def.id].disable(3); }
    renderMeta();
    save();
  });
  const ctl = h('div', 'layer-controls');
  const inner = h('div');
  const setP = (pid, v) => { ls.p[pid] = v; if (started) engine.layers[def.id].set(pid, v); save(); };
  const volP = def.schema.find((p) => p.id === 'vol');
  inner.append(control(volP, ls.p.vol, (v) => setP('vol', v), `${def.id}.vol`));
  const bar = h('div', 'layer-bar');
  const more = h('button', 'more', `${def.schema.length - 1} more controls ${ICON.chevron}`);
  const dice = h('button', 'mini-dice', 'shuffle');
  dice.setAttribute('aria-label', `Randomise ${def.name}`);
  bar.append(more, dice);
  inner.append(bar);
  const params = h('div', 'layer-params');
  const fillParams = () => {
    params.innerHTML = '';
    for (const p of def.schema) {
      if (p.id === 'vol') continue;
      params.append(control(p, ls.p[p.id], (v) => setP(p.id, v), `${def.id}.${p.id}`));
    }
  };
  if (expanded.has(def.id)) fillParams();
  more.addEventListener('click', () => {
    const open = !expanded.has(def.id);
    if (open) { expanded.add(def.id); fillParams(); } else expanded.delete(def.id);
    row.classList.toggle('open', open);
  });
  dice.addEventListener('click', () => {
    const fresh = randomize(def.schema, seeded(newSeed()), { ...ls.p });
    fresh.vol = ls.p.vol;
    for (const k in fresh) setP(k, fresh[k]);
    if (expanded.has(def.id)) fillParams();
    toast(`${def.name} reshaped`);
  });
  inner.append(params);
  ctl.append(inner);
  row.append(tg, ctl);
  return row;
}

/* ─── Music ─── */

function commitKey() {
  if (started) engine.apply(state, { fade: 3 });
  renderMeta();
  save();
}

function renderMusic(el) {
  el.append(head('Music', `${NOTE_NAMES[state.root]} ${MODES[state.mode].name}`));

  const key = section('Key', null, () => { state.root = Math.floor(Math.random() * 12); commitKey(); renderSheet(); });
  key.append(chips(NOTE_NAMES.map((n, i) => ({ value: i, label: n })), state.root, (v) => {
    state.root = v;
    el.querySelector('.sheet-head small').textContent = `${NOTE_NAMES[v]} ${MODES[state.mode].name}`;
    commitKey();
  }, 'keys'));
  el.append(key);

  const mode = section('Scale');
  mode.append(chips(Object.entries(MODES).map(([id, m]) => ({ value: id, label: m.name })), state.mode, (v) => {
    state.mode = v;
    el.querySelector('.sheet-head small').textContent = `${NOTE_NAMES[state.root]} ${MODES[v].name}`;
    commitKey();
  }));
  el.append(mode);

  const tun = section('Tuning');
  tun.append(chips([{ value: 440, label: 'A = 440 Hz' }, { value: 432, label: 'A = 432 Hz' }], state.a4, (v) => { state.a4 = v; commitKey(); }));
  const ji = chips([{ value: false, label: 'Equal temperament' }, { value: true, label: 'Just intonation' }], !!state.just, (v) => { state.just = v; commitKey(); });
  ji.style.marginTop = '8px';
  tun.append(ji);
  el.append(tun);

  for (const id of ['time', 'harmony', 'melody']) globalSection(GLOBAL_SECTIONS.find((s) => s.id === id), el);
}

/* ─── Sound ─── */

function renderSound(el) {
  el.append(head('Sound', 'space, colour, touch'));
  el.append(recordSection());
  const vol = section('Volume');
  vol.append(control({ id: 'volume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    prefs.volume, (v) => { prefs.volume = v; engine.setVolume(v); if (sleepEnd) engine.scheduleSleep((sleepEnd - Date.now()) / 1000); save(); }));
  el.append(vol);
  for (const id of ['space', 'colour']) globalSection(GLOBAL_SECTIONS.find((s) => s.id === id), el);
  const touch = GLOBAL_SECTIONS.find((s) => s.id === 'touch');
  const ts = section('Touch');
  ts.append(h('p', 'note', 'Drag a finger anywhere. <b>Left to right</b> plays notes in key, <b>up and down</b> opens the tone and the space.'));
  for (const p of touch.params) ts.append(control(p, state.g[p.id], (v) => setGlobal(p.id, v), `g.${p.id}`));
  el.append(ts);

  const vs = section('Visuals', null, () => {
    prefs.vp = randomize(VISUAL_PARAMS, seeded(newSeed()), prefs.vp);
    applyVisualPrefs();
    renderSheet();
  });
  for (const p of VISUAL_PARAMS) {
    vs.append(control(p, prefs.vp[p.id], (v) => { prefs.vp[p.id] = v; applyVisualPrefs(); save(); }));
  }
  const pal = h('div', 'palette-row');
  for (const [id, pdef] of Object.entries(PALETTES)) {
    const b = h('button', 'swatch' + (id === state.palette ? ' on' : ''), `<i style="background:${pdef.accent}"></i>${pdef.name}`);
    b.style.background = pdef.bg;
    b.style.color = pdef.ink;
    b.addEventListener('click', () => {
      state.palette = id;
      visuals.setPalette(id);
      setTheme();
      pal.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
      save();
    });
    pal.append(b);
  }
  vs.append(h('span', 'choice-label', 'Palette'), pal);
  el.append(vs);

  const perf = section('Battery');
  perf.append(chips([{ value: 'saver', label: 'Saver' }, { value: 'balanced', label: 'Balanced' }, { value: 'smooth', label: 'Smooth' }], prefs.quality, (v) => {
    prefs.quality = v;
    visuals.setQuality(v);
    save();
  }));
  perf.append(h('p', 'note', 'Saver draws fewer lines at 20 frames a second. The sound is the same.'));
  const lite = h('button', 'toggle-row', `<span><b>Lighter audio</b><small>shorter reverb, no chorus, leaner strings · try this if sound stutters in the car or on an older phone</small></span><span class="switch${prefs.lite ? ' on' : ''}"></span>`);
  lite.addEventListener('click', () => {
    prefs.lite = !prefs.lite;
    lite.querySelector('.switch').classList.toggle('on', prefs.lite);
    engine.setLite(prefs.lite);
    save();
  });
  perf.append(lite);
  el.append(perf);
  screenSection(el);
}

function applyVisualPrefs() {
  visuals.setParams(prefs.vp);
  document.documentElement.style.setProperty('--grain', String(prefs.vp.vGrain * 0.16));
}

/* ─── Rest ─── */

const BREATHS = {
  off: null,
  calm: { label: 'Calm', steps: [['Breathe in', 4, 'in'], ['Breathe out', 6, 'out']] },
  box: { label: 'Box', steps: [['Breathe in', 4, 'in'], ['Hold', 4, 'hold'], ['Breathe out', 4, 'out'], ['Hold', 4, 'hold']] },
  relax: { label: '4 · 7 · 8', steps: [['Breathe in', 4, 'in'], ['Hold', 7, 'hold'], ['Breathe out', 8, 'out']] },
  coherent: { label: 'Coherent', steps: [['Breathe in', 5.5, 'in'], ['Breathe out', 5.5, 'out']] },
};

let sleepEnd = 0;
let sleepMin = 0;
let sleepFading = false;

function setSleep(m) {
  sleepMin = m;
  sleepEnd = m ? Date.now() + m * 60000 : 0;
  sleepFading = false;
  engine.setVolume(prefs.volume);
  if (m) engine.scheduleSleep(m * 60);
  updateTimerStatus();
  toast(m ? `Stops in ${m} min, fading out over the last one` : 'Timer off');
}

function setBreath(v) {
  prefs.breath = v;
  breathStart = performance.now();
  save();
}

function screenSection(el) {
  const sc = section('Screen');
  if ('wakeLock' in navigator) {
    const row = h('button', 'toggle-row', `<span><b>Keep screen awake</b><small>for watching the visuals, or a run with the phone on an armband</small></span><span class="switch${prefs.wake ? ' on' : ''}"></span>`);
    row.addEventListener('click', () => {
      prefs.wake = !prefs.wake;
      row.querySelector('.switch').classList.toggle('on', prefs.wake);
      if (prefs.wake && engine.playing) requestWake(); else releaseWake();
      save();
    });
    sc.append(row);
  }
  sc.append(h('p', 'note', 'The interface fades away while you listen. <b>Tap</b> to bring it back, or <b>drag</b> to play.'));
  el.append(sc);

  const about = section('About');
  const total = LAYERS.reduce((n, d) => n + d.schema.length, 0) + GLOBAL_SECTIONS.reduce((n, s) => n + s.params.length, 0) + VISUAL_PARAMS.length;
  about.append(h('p', 'note', `Nothing here is a recording. ${LAYERS.length} synthesised layers and ${total} controls: chord loops with voice leading, motifs that repeat and develop, Euclidean drum patterns, weather made from filtered noise. Headphones help.`));
  el.append(about);
}

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateTimerStatus() {
  const el = $('.timer-status');
  if (el) el.textContent = sleepEnd ? `stops in ${fmt(sleepEnd - Date.now())}` : 'no timer';
  $('#sleep-left').textContent = sleepEnd ? String(Math.ceil((sleepEnd - Date.now()) / 60000)) : '';
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  tickRun(Math.min(5, (now - lastTick) / 1000));
  lastTick = now;
  if (sleepEnd) {
    const left = sleepEnd - now;
    if (left <= 60000 && !sleepFading && engine.playing) {
      sleepFading = true;
      engine.fadeOut(60);
    }
    if (left <= 0) {
      sleepEnd = 0;
      sleepMin = 0;
      sleepFading = false;
      if (engine.playing) togglePlay();
      engine.setVolume(prefs.volume);
      if (mode() === 'sleep') renderPanel();
    }
    updateTimerStatus();
  }
  if (engine.playing && prefs.journey && !conductor.active && now - lastSceneChange > prefs.journey * 60000) {
    applyScene(mutateScene(state, newSeed()), { fade: 10 });
  }
}, 1000);

/* ─── breathing loop ─── */

let breathStart = performance.now();
const breathText = $('#breath-text');
function breathLoop(ts) {
  const b = mode() === 'sleep' ? BREATHS[prefs.breath] : null;
  if (!b) {
    visuals.breath = null;
    breathText.classList.remove('show');
  } else {
    const total = b.steps.reduce((s, x) => s + x[1], 0);
    let t = ((ts - breathStart) / 1000) % total;
    let i = 0;
    while (t > b.steps[i][1]) { t -= b.steps[i][1]; i++; }
    const [label, dur, kind] = b.steps[i];
    const p = t / dur;
    const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);
    let scale;
    if (kind === 'in') scale = ease(p);
    else if (kind === 'out') scale = 1 - ease(p);
    else scale = i > 0 && b.steps[i - 1][2] === 'in' ? 1 : 0;
    visuals.breath = { scale, progress: p };
    if (breathText.textContent !== label) breathText.textContent = label;
    breathText.classList.add('show');
  }
  requestAnimationFrame(breathLoop);
}
requestAnimationFrame(breathLoop);

/* ─────────────────────────── share ─────────────────────────── */

const shareUrl = () => `${location.origin}${location.pathname}#s=${encodeScene(state)}`;

async function share_() {
  const url = shareUrl();
  if (navigator.share) {
    try {
      await navigator.share({ title: `${state.name} · Genbient`, text: `Listen to “${state.name}”, a generative soundscape`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  copyLink();
}

async function copyLink() {
  const url = shareUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    prompt('Copy this link', url);
  }
}
$('#btn-share').addEventListener('click', share_);

/* ─────────────────────────── system integrations ─────────────────────────── */

let toastTimer;
let toastFn = null;
function toast(msg, action) {
  const t = $('#toast');
  const act = $('#toast-act');
  $('#toast-msg').textContent = msg;
  toastFn = action ? action.fn : null;
  act.hidden = !action;
  if (action) act.textContent = action.label;
  t.classList.toggle('actionable', !!action);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show', 'actionable'); toastFn = null; }, action ? 5000 : 2400);
}
$('#toast-act').addEventListener('click', () => {
  const fn = toastFn;
  toastFn = null;
  $('#toast').classList.remove('show', 'actionable');
  fn?.();
});

let wakeLock = null;
async function requestWake() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (!engine.playing || !prefs.wake) lock?.release();
    else { wakeLock?.release(); wakeLock = lock; }
  } catch { /* denied */ }
}
function releaseWake() {
  try { wakeLock?.release(); } catch { /* already released */ }
  wakeLock = null;
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !started) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: state.name,
      artist: 'Genbient',
      album: `${NOTE_NAMES[state.root]} ${MODES[state.mode].name}`,
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('play', () => { if (!engine.playing) togglePlay(); });
    navigator.mediaSession.setActionHandler('pause', () => { if (engine.playing) togglePlay(); });
    navigator.mediaSession.setActionHandler('nexttrack', generate);
    navigator.mediaSession.setActionHandler('previoustrack', () => { if (history_.length) back(); });
    navigator.mediaSession.setActionHandler('stop', () => { if (engine.playing) togglePlay(); });
  } catch { /* partial support */ }
}
function setMediaState(s) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s; } catch { /* ignore */ }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // A new version took over: reload straight away if nothing is playing yet,
  // otherwise say so and let it apply next time.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (!started) location.reload();
    else toast('Genbient was updated · it applies next time you open it');
  });
}

/* ─────────────────────────── boot ─────────────────────────── */

applyVisualPrefs();
applyScene(state, { animate: false, remember: false });
booted = true;
bumpIdle();

window.genbient = { prefs, tickRun, recorder, engine, visuals, keepAlive, conductor, get state() { return state; }, applyScene, generateScene, LAYER_BY_ID, GLOBAL_BY_ID, defaults };
