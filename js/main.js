import { Engine } from './engine.js';
import { Conductor, FRESH_BASS } from './conductor.js';
import { Recorder } from './recorder.js';
import { StepSense } from './stepsense.js';
import { Visuals } from './visuals.js';
import { LAYERS, LAYER_BY_ID, GROUPS } from './layers/index.js';
import { NOTE_NAMES, MODES } from './theory.js';
import { GLOBAL_SECTIONS, GLOBAL_BY_ID, VISUAL_PARAMS, defaults, fill, randomize } from './params.js';
import {
  PALETTES, MOODS, STARTS, SECTIONS, CADENCES, runify, unrun, generateScene, startScene, rerollSection, mutateScene,
  encodeScene, decodeScene, normalize, shareCode, decodeShare,
} from './scenes.js';
import { seeded, clamp, lerp, glide, pick } from './util.js';
import { SONG_MODE, PROGRESSION_COUNT } from './progressions.js';

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
  { volume: 0.85, journey: 0, breath: 'off', wake: false, mood: 'any', energy: null, filter: 'playing', quality: 'balanced', cadence: 165, runSong: true, runIntensity: 'steady', lite: false, recMax: 0, recFade: true, recLevel: true, intervals: 'off', pushCadence: 0, mode: 'listen', warmup: 5, runGoal: 0, sleepFade: 5, windDown: true, song: false, focusLen: 25, breakLen: 5, focusRounds: 4, focusCalm: true },
  store.get('prefs', {}),
);
prefs.vp = fill(prefs.vp, VISUAL_PARAMS);

const engine = new Engine();
engine.volume = prefs.volume;
// Simple mode is for small ears too: it never goes above 60% of the phone's volume
const vol = () => (prefs.mode === 'kids' && !running() ? Math.min(prefs.volume, 0.6) : prefs.volume);
const visuals = new Visuals($('#bg'), engine);
visuals.setParams(prefs.vp);
visuals.setQuality(prefs.quality);

let state = loadInitial();
let started = false;
let lastSceneChange = Date.now();

// A shared scene in the address: "#amber-harbor.z…" (or an older "#s=…").
// Messaging apps sometimes glue text onto a link, so only the code is read.
const hasShare = () => /#s=[A-Za-z0-9_-]|\.z[A-Za-z0-9_-]/.test(location.hash);
async function sceneFromHash() {
  if (!hasShare()) return undefined;
  const hash = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  const s = await decodeShare(hash);
  if (!s) toast('That link couldn\'t be read');
  return s;
}

async function openShared(first) {
  const s = await sceneFromHash();
  if (!s) return;
  applyScene(s, { remember: !first });
  toast(first ? 'Shared soundscape · tap to listen' : `Shared scene: ${s.name}`);
}

addEventListener('hashchange', () => openShared(false));

function loadInitial() {
  const saved = store.get('scene2', null);
  if (saved) return normalize(saved);
  // First visit: something new but gentle: no beat, a bed of sound under a
  // few layers, nothing that asks too much of someone who just arrived.
  const first = generateScene(newSeed(), { mood: 'oceanic', energy: 0.12, rhythm: false });
  if (!['ocean', 'rain', 'stream'].some((id) => first.layers[id].on)) Object.assign(first.layers.ocean, { on: true, p: { ...first.layers.ocean.p, vol: 0.45 } });
  const keep = ['pad', 'drone', 'ocean', 'rain', 'stream'];
  const on = LAYERS.filter((d) => first.layers[d.id].on).sort((a, b) => keep.includes(b.id) - keep.includes(a.id));
  on.slice(4).forEach((d) => { first.layers[d.id].on = false; });
  return first;
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  readyUrl = null;
  saveTimer = setTimeout(() => { store.set('scene2', state); store.set('prefs', prefs); refreshShare(); }, 300);
}

/* ─────────────────────────── engine events ─────────────────────────── */

engine.on('note', (n) => visuals.note(n));
engine.on('chord', () => { if (state.g.song && mode() !== 'sleep') panelViews.forEach((f) => f()); });
engine.on('key', (hm) => {
  state.root = hm.root;
  state.mode = hm.mode;
  renderMeta();
  if (openName === 'music') renderSheet();
  save();
});
engine.on('evolve', (ev) => {
  if (ev.global) {
    if (winding && (ev.id === 'density' || ev.id === 'bright')) return; // wind-down owns these for now
    if (focus.phase === 'focus' && prefs.focusCalm && ev.id === 'density') return; // so does focus
    if (running() && ev.id === 'bright') ev.value = Math.max(ev.value, 0.78);
    if (running() && ev.id === 'revMix') ev.value = Math.min(ev.value, 0.45);
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
  bedChoice = null;
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
  // a quiet line, not a spec sheet: the mood and the key
  const key = `${NOTE_NAMES[state.root]} ${MODES[state.mode].name.toLowerCase()}`;
  $('#scene-meta').textContent = `${mood ? mood.name.toLowerCase() : 'a scene'} in ${key}`;
  $('#scene-meta').title = `${Math.round(state.g.bpm)} bpm · ${state.g.meter} · ${n} ${n === 1 ? 'layer' : 'layers'}`;
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
    if (!prefs.knowsTokens) $('#hint').textContent = 'tap an underlined word to change it';
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
  if (sleepEnd) engine.scheduleSleep((sleepEnd - Date.now()) / 1000, fadeSecs());
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

// Song chords: progressions from real songs instead of free harmony. New
// scenes follow the preference; a scene in an unusual scale moves to the
// nearest one songs are written in.
function songify(s) {
  if (!prefs.song) return s;
  s.g.song = true;
  if (SONG_MODE[s.mode]) s.mode = SONG_MODE[s.mode];
  return s;
}

function setSong(v) {
  prefs.song = v;
  save();
  state.g.song = v;
  engine.setGlobal('song', v);
  if (v && SONG_MODE[state.mode]) {
    state.mode = SONG_MODE[state.mode];
    commitKey();
  }
  // mid-run, start in the part that fits the section playing now
  if (v && conductor.active && currentSection) {
    const t = currentSection.type;
    engine.harmony.setPart(t === 'lift' || t === 'peak' ? 'chorus' : t === 'breakdown' ? 'bridge' : 'verse');
  }
  renderPanel();
  if (openName === 'music') renderSheet();

}

function generate() {
  if (mode() === 'kids') return kidsSurprise();
  if (running()) { newRunMusic(); toast('New music, same beat', undoAction()); return; }
  const mood = prefs.mood === 'any' ? undefined : prefs.mood;
  applyScene(songify(generateScene(newSeed(), { mood, energy: prefs.energy ?? undefined, rhythm: state.g.beat ? undefined : false })));
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
  const last = history_[history_.length - 1];
  if (last && last.code === code) return;
  // the same scene, changed (a beat added, a run started): keep only its latest form
  if (last && last.name === s.name && last.mood === s.mood) history_.pop();
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
  $('#btn-back').hidden = !history_.length || running(); // in a run, Listen is the way back
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
    if (state.g.bright < 0.78) setGlobal('bright', 0.78);
    if (state.g.drift) setGlobal('drift', 0);
    if (state.g.revSize > 0.35) setGlobal('revSize', 0.35);
    if (state.g.revMix > 0.45) setGlobal('revMix', 0.45);
  }
  // a full running band needs a little more headroom than an ambient bed
  if (engine.ctx) engine.drive.gain.setTargetAtTime(want ? 0.75 : 0.95, engine.ctx.currentTime, 0.5);
  if (want && (restart || !conductor.active)) { conductor.start(); syncLock(); }
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
  const base = songify(generateScene(newSeed(), { mood, rhythm: false }));
  applyScene(runify(base, state.g.bpm, newSeed()));
}

function endRun() {
  if (steps.active) { steps.stop(); senseState = ''; }
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
const mode = () => (running() ? 'run' : ['sleep', 'kids', 'focus'].includes(prefs.mode) ? prefs.mode : 'listen');
const panel = $('#panel');
const panelViews = new Set();
const refreshViews = () => { cadenceViews.forEach((f) => f()); panelViews.forEach((f) => f()); };

function setMode(m) {
  if (m === mode()) return;
  if (m === 'run') return setCadence(prefs.cadence);
  prefs.mode = m;
  if (running()) endRun();
  if (m === 'kids' && !state.kids) applyScene(kidsScene(prefs.kidWorld || 'ocean'), { fade: 4 });
  renderModes();
  renderPanel();
  if (m === 'sleep' && !sleepEnd) toast('Tap “Plays until you stop it” to set a timer');
  save();
}

function renderModes() {
  const m = mode();
  document.querySelectorAll('.modes [data-mode]').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === m);
    b.setAttribute('aria-pressed', String(b.dataset.mode === m));
  });
  document.body.dataset.mode = m;
  engine.setVolume(vol());
  visuals.drawing = m === 'kids'; // in Simple mode a finger leaves colour behind
  if (typeof wakeBreath === 'function') wakeBreath();
}
document.querySelectorAll('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// Each mode's panel reads as a sentence. The words that can change are
// underlined: a two-way word flips when tapped, the others open a quiet row
// of alternatives just beneath the sentence.
let openTok = null;

function renderPanel() {
  panel.innerHTML = '';
  panelViews.clear();
  const m = mode();
  const phrase = h('p', 'phrase');
  const picker = h('div', 'picker');
  const parts = [];
  const text = (str) => parts.push(document.createTextNode(str));
  const flip = (label, act) => {
    const b = h('button', 'tok', esc(label));
    b.addEventListener('click', () => { openTok = null; learnedTokens(); act(); });
    parts.push(b);
  };
  const choose = (key, options, current, onPick) => {
    const cur = options.find(([v]) => v === current) || options[0];
    const b = h('button', 'tok' + (openTok === key ? ' open' : ''), esc(cur[1]));
    b.setAttribute('aria-expanded', String(openTok === key));
    b.addEventListener('click', () => { openTok = openTok === key ? null : key; learnedTokens(); renderPanel(); });
    parts.push(b);
    if (openTok === key) {
      picker.append(chips(options.map(([value, label]) => ({ value, label })), cur[0], (v) => { openTok = null; onPick(v); renderPanel(); }, 'pchips'));
    }
  };
  const whisper = h('div', 'whisper');

  if (m === 'listen') {
    flip(state.g.beat ? 'With a beat' : 'Without a beat', () => setRhythm(!state.g.beat));
    text(' and ');
    flip(state.g.song ? 'song chords' : 'free chords', () => setSong(!state.g.song));
    text('. ');
    const moodNow = prefs.mood === 'any' ? state.mood : prefs.mood;
    choose('mood', [...MOODS.filter((x) => x.id !== 'run').map((x) => [x.id, x.name]), ['any', 'Any']], moodNow, pickMood);
    text(' mood, ');
    choose('drift', [[0, 'staying put'], [5, 'a new scene every 5 min'], [10, 'every 10 min'], [20, 'every 20 min'], [40, 'every 40 min']], prefs.journey, setJourney);
    text('.');
    if (state.g.song) {
      const now = h('span');
      whisper.append(now);
      panelViews.add(() => {
        const info = engine.harmony?.songInfo;
        now.textContent = info ? `${info.part} · ${info[info.part]}` : 'the verse starts with the next chord';
      });
    }
  } else if (m === 'kids') {
    renderKids();
    return;
  } else if (m === 'focus') {
    choose('flen', [[15, '15 minutes'], [25, '25 minutes'], [45, '45 minutes'], [50, '50 minutes'], [90, '90 minutes']], prefs.focusLen, (v) => { prefs.focusLen = v; save(); });
    text(' of focus, ');
    choose('blen', [[5, '5 minute'], [10, '10 minute'], [15, '15 minute']], prefs.breakLen, (v) => { prefs.breakLen = v; save(); });
    text(' breaks, ');
    choose('rounds', [[1, 'once'], [2, 'two rounds'], [4, 'four rounds'], [6, 'six rounds'], [0, 'on repeat']], prefs.focusRounds, (v) => { prefs.focusRounds = v; save(); });
    text('. ');
    flip(prefs.focusCalm ? 'Calm music while working' : 'Music as it is while working', () => { prefs.focusCalm = !prefs.focusCalm; save(); applyFocusSound(); renderPanel(); });
    text('.');
    const lab = h('span', 'section-label');
    const go = h('button', 'text-btn skip-btn', '');
    const stop = h('button', 'text-btn', 'stop');
    go.addEventListener('click', () => (focus.phase ? (focus.paused ? resumeFocus() : pauseFocus()) : startFocus()));
    stop.addEventListener('click', stopFocus);
    whisper.append(lab, go, stop);
    panelViews.add(() => {
      lab.textContent = focusLabel();
      go.textContent = !focus.phase ? 'start' : focus.paused ? 'resume' : 'pause';
      stop.hidden = !focus.phase;
    });
  } else if (m === 'run') {
    const top = h('div', 'run-top');
    const tap = h('button', 'text-btn tap-link', 'tap your steps');
    tap.setAttribute('aria-label', 'Tap along with your steps to set the cadence');
    tap.addEventListener('click', () => tapStep());
    const links = h('div', 'run-links');
    links.append(tap);
    if (StepSense.supported) {
      const sense = h('button', 'text-btn tap-link', '');
      sense.setAttribute('aria-label', 'Count my steps with the motion sensor');
      sense.addEventListener('click', toggleSense);
      panelViews.add(() => { sense.textContent = senseLabel(); sense.classList.toggle('live', steps.active); });
      links.append(sense);
    }
    top.append(cadenceControl(panelViews), links);
    panel.append(top);
    choose('iv', Object.entries(INTERVALS).map(([id, iv]) => [id, iv ? iv.label : 'No intervals']), prefs.intervals, setIntervals);
    text(', ');
    choose('len', [[0, 'no end'], [20, 'for 20 minutes'], [30, 'for 30 minutes'], [45, 'for 45 minutes'], [60, 'for an hour'], [90, 'for 90 minutes']], prefs.runGoal, setRunGoal);
    text('. ');
    flip(state.g.song ? 'Song chords' : 'Free chords', () => setSong(!state.g.song));
    text(', ');
    choose('bass', [['plain', 'plain bass'], ['dub', 'dub bass'], ['drive', 'driving bass'], ['psy', 'psy bass'], ['funk', 'funk bass']], state.g.groove ? state.layers.bass.p.bstyle || 'dub' : 'plain', setBass);
    text('.');
    const lab = h('span', 'section-label');
    const time = h('span', 'run-time');
    const skip = h('button', 'text-btn skip-btn', 'skip');
    skip.addEventListener('click', skipPhase);
    const more = h('button', 'text-btn', 'run settings');
    more.addEventListener('click', () => openSheet('run'));
    whisper.append(lab, time, skip, more);
    panelViews.add(() => {
      const part = state.g.song && engine.harmony?.songInfo?.part;
      lab.textContent = (runPhaseLabel() || (conductor.active && currentSection ? currentSection.name.toLowerCase() : prefs.runSong ? 'starting' : 'steady loop')) + (part ? ` · ${part}` : '');
      time.textContent = (runElapsed >= 1 ? mmss(runElapsed) : '0:00') + (prefs.runGoal ? ` / ${prefs.runGoal}:00` : '');
      const ph = runPhase;
      skip.hidden = !['warm', 'push', 'easy'].includes(ph);
      skip.textContent = ph === 'warm' ? 'skip warm-up' : ph === 'push' ? 'skip to easy' : 'skip to push';
    });
  } else {
    choose('timer', [[0, 'Plays until you stop it'], [15, 'Stops in 15 min'], [30, 'Stops in 30 min'], [45, 'Stops in 45 min'], [60, 'Stops in an hour'], [90, 'Stops in 90 min'], [120, 'Stops in 2 hours'], [180, 'Stops in 3 hours']], sleepEnd ? sleepMin : 0, setSleep);
    if (sleepEnd) {
      text(', fading over ');
      choose('fade', [[1, 'a minute'], [5, 'five minutes'], [15, 'fifteen minutes']], prefs.sleepFade, (v) => {
        prefs.sleepFade = v;
        sleepFading = false;
        engine.setVolume(vol());
        engine.scheduleSleep((sleepEnd - Date.now()) / 1000, fadeSecs());
        save();
      });
      text(', ');
      flip(prefs.windDown ? 'winding down' : 'not winding down', () => {
        prefs.windDown = !prefs.windDown;
        if (!prefs.windDown) endWind();
        save();
        renderPanel();
      });
    }
    text('. ');
    choose('bed', [[null, 'This scene'], ...BEDS.map(([v, l]) => [v, l === 'Sleepier' ? 'Something sleepier' : l])], bedChoice, (v) => { if (v) playBed(v); });
    text(', breathing ');
    choose('breath', Object.entries(BREATHS).map(([id, b]) => [id, b ? b.label.toLowerCase() : 'freely']), prefs.breath, setBreath);
    text('.');
    whisper.append(h('span', 'timer-status'));
  }
  phrase.append(...parts);
  panel.append(phrase);
  if (picker.firstChild) panel.append(picker);
  if (whisper.firstChild) panel.append(whisper);
  if (m === 'sleep') updateTimerStatus();
  refreshViews();
}

// Picking a mood plays a new scene in it; Any lets Random choose again.
function pickMood(v) {
  prefs.mood = v;
  save();
  if (v === 'any') toast('Random picks any mood');
  else generate();
}

// The first-run hint about underlined words goes once someone has used one.
function learnedTokens() {
  if (prefs.knowsTokens) return;
  prefs.knowsTokens = true;
  document.body.classList.add('knows');
  save();
}

function setBass(v) {
  if (v === 'plain') return setGroove(false);
  state.layers.bass.p.bstyle = v;
  setGroove(true);
}

/* ─────────────────────────── focus sessions ─────────────────────────── */

// Work and rest in rounds. While working the music thins out and holds still
// (engine-only, the scene itself is untouched); breaks open it up again. A
// soft bell marks each change: rising into focus, falling into a break.
const focus = { phase: null, endAt: 0, left: 0, round: 1, paused: false };

function focusLabel() {
  if (!focus.phase) return prefs.focusRounds ? `${prefs.focusRounds} × ${prefs.focusLen} min` : `${prefs.focusLen} min at a time`;
  if (focus.phase === 'done') return 'all rounds done · well done';
  const left = focus.paused ? focus.left : Math.max(0, focus.endAt - Date.now());
  const rounds = prefs.focusRounds ? ` ${focus.round} of ${prefs.focusRounds}` : ` ${focus.round}`;
  return `${focus.phase === 'focus' ? 'focus' : 'break'}${focus.phase === 'focus' ? rounds : ''} · ${mmss(left / 1000)}${focus.paused ? ' · paused' : ''}`;
}

function applyFocusSound() {
  if (!engine.ctx) return;
  const calm = focus.phase === 'focus' && prefs.focusCalm;
  engine.setGlobal('density', calm ? state.g.density * 0.45 : state.g.density);
  engine.setGlobal('evolve', calm ? Math.min(state.g.evolve, 0.1) : state.g.evolve);
}

function focusPhase(phase) {
  focus.phase = phase;
  focus.endAt = Date.now() + (phase === 'focus' ? prefs.focusLen : prefs.breakLen) * 60000;
  focus.paused = false;
  applyFocusSound();
  if (engine.ctx) conductor.cue(phase === 'focus');
  toast(phase === 'focus' ? `Focus · ${prefs.focusLen} minutes` : `Break · ${prefs.breakLen} minutes`);
  refreshViews();
}

function startFocus() {
  if (!started || !engine.playing) togglePlay();
  focus.round = 1;
  focusPhase('focus');
}

function pauseFocus() { focus.left = Math.max(0, focus.endAt - Date.now()); focus.paused = true; refreshViews(); }
function resumeFocus() { focus.endAt = Date.now() + focus.left; focus.paused = false; refreshViews(); }

function stopFocus() {
  focus.phase = null;
  focus.paused = false;
  applyFocusSound();
  $('#focus-left').textContent = '';
  refreshViews();
}

function tickFocus() {
  const el = $('#focus-left');
  if (!focus.phase || focus.phase === 'done') { el.textContent = ''; return; }
  if (focus.paused) return;
  const left = focus.endAt - Date.now();
  el.textContent = `${Math.max(1, Math.ceil(left / 60000))}m`;
  if (left > 0) { if (mode() === 'focus') refreshViews(); return; }
  if (focus.phase === 'focus') {
    if (prefs.focusRounds && focus.round >= prefs.focusRounds) {
      focus.phase = 'done';
      applyFocusSound();
      if (engine.ctx) { conductor.cue(false); setTimeout(() => conductor.cue(false), 900); }
      toast('All rounds done · well done');
      el.textContent = '';
      refreshViews();
      return;
    }
    focusPhase('break');
  } else {
    focus.round++;
    focusPhase('focus');
  }
}

/* ─────────────────────────── full screen: play along ─────────────────────────── */

// The whole screen becomes the instrument. Nothing on it pauses or changes
// settings; the only way out is holding the ring in the corner.
let immersive = false;
let immersiveTimer;

function enterImmersive() {
  immersive = true;
  closeSheet();
  openTok = null;
  clearTimeout(idleTimer);
  document.body.classList.remove('idle');
  document.body.classList.add('immersive');
  try { document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {}); } catch { /* not allowed here */ }
  requestWake();
  if (!engine.playing) togglePlay();
  const hint = $('#immersive-hint');
  hint.classList.add('show');
  clearTimeout(immersiveTimer);
  immersiveTimer = setTimeout(() => hint.classList.remove('show'), 4000);
}

function exitImmersive() {
  if (!immersive) return;
  immersive = false;
  document.body.classList.remove('immersive');
  $('#immersive-hint').classList.remove('show');
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* fine */ }
  if (!prefs.wake) releaseWake();
  bumpIdle();
}

$('#btn-full').addEventListener('click', enterImmersive);
(() => {
  const ring = $('#exit-hold');
  let t = null;
  const cancel = () => { clearTimeout(t); t = null; ring.classList.remove('holding'); };
  ring.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    ring.classList.add('holding');
    t = setTimeout(() => { cancel(); exitImmersive(); }, 1500);
  });
  ring.addEventListener('pointerup', () => {
    if (t) {
      // let go too soon: remind how to leave
      const hint = $('#immersive-hint');
      hint.classList.add('show');
      clearTimeout(immersiveTimer);
      immersiveTimer = setTimeout(() => hint.classList.remove('show'), 2500);
    }
    cancel();
  });
  ring.addEventListener('pointerleave', cancel);
  ring.addEventListener('pointercancel', cancel);
  ring.addEventListener('contextmenu', (e) => e.preventDefault());
})();

/* ─────────────────────────── Simple mode ─────────────────────────── */

// One-tap play, good for children too: pick a world, pick what your finger
// plays, play with the whole screen. Every world uses a five-note happy
// scale, so whatever you play fits, and the volume never goes past 60%.
const WORLDS = {
  ocean: { name: 'Ocean', mood: 'oceanic', bed: 'ocean', tune: 'bells', palette: 'tide', icon: '<path d="M3 10c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>' },
  forest: { name: 'Forest', mood: 'sylvan', bed: 'birds', tune: 'marimba', palette: 'moss', icon: '<path d="M12 3l6 8h-4l4 6H6l4-6H6zM12 17v4"/>' },
  rain: { name: 'Rain', mood: 'oceanic', bed: 'rain', tune: 'keys', palette: 'fog', icon: '<path d="M12 3c3 5 6 8 6 11a6 6 0 0 1-12 0c0-3 3-6 6-11z"/>' },
  stars: { name: 'Stars', mood: 'celestial', bed: 'shimmer', tune: 'bells', palette: 'plum', icon: '<path d="M12 2.8c.7 5 3.3 7.8 8.8 9.2-5.5 1.4-8.1 4.2-8.8 9.2-.7-5-3.3-7.8-8.8-9.2 5.5-1.4 8.1-4.2 8.8-9.2Z"/>' },
  night: { name: 'Night', mood: 'sleep', bed: 'night', tune: 'piano', palette: 'night', icon: '<path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5z"/>' },
  underwater: { name: 'Underwater', mood: 'oceanic', bed: 'ocean', tune: 'bowls', palette: 'tide', extra: 'drone', bedTone: 0.3, icon: '<path d="M3 12c3-4 8-5 12-2l4-3v10l-4-3c-4 3-9 2-12-2z"/><circle cx="8" cy="11" r=".8"/>' },
  campfire: { name: 'Campfire', mood: 'hearth', bed: 'fire', tune: 'keys', palette: 'ember', icon: '<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 2 0-2-1-3 0-5z"/><path d="M5 21l14-3M5 18l14 3"/>' },
  mountain: { name: 'Mountain', mood: 'glacial', bed: 'wind', tune: 'flute', palette: 'frost', icon: '<path d="M3 19l6-10 4 6 3-4 5 8z"/>' },
};
const KID_VOICES = [['bell', 'Bells'], ['pluck', 'Piano'], ['voice', 'Singing'], ['glass', 'Glass'], ['warm', 'Soft']];

function kidsScene(world) {
  const w = WORLDS[world] || WORLDS.ocean;
  const s = generateScene(newSeed(), { mood: w.mood, energy: 0.2, rhythm: false });
  for (const id in s.layers) s.layers[id].on = false;
  const on = (id, p) => { s.layers[id].on = true; Object.assign(s.layers[id].p, p); };
  on('pad', { vol: 0.5, oct: 0 });
  on(w.bed, { vol: 0.55 });
  on(w.tune, { vol: 0.42, style: 'motif', density: 0.4, oct: 0 });
  if (w.extra) on(w.extra, { vol: 0.35, oct: 0 });
  if (w.bedTone) s.layers[w.bed].p.tone = w.bedTone; // underwater: the sea heard from below
  Object.assign(s, { name: w.name, tagline: '', palette: w.palette, mode: 'majpent', root: pick([0, 2, 5, 7]), kids: world });
  Object.assign(s.g, { song: true, groove: false, bpm: 76, meter: '4/4', touchMode: 'both', touchNotes: 'scale', touchVoice: prefs.kidVoice || 'bell', touchLevel: 0.8, touchEcho: 0.35, touchRange: 2, touchSculpt: 0.35 });
  return s;
}

function kidsWorld(world) {
  prefs.kidWorld = world;
  save();
  applyScene(kidsScene(world), { fade: 3 });
  if (!started || !engine.playing) togglePlay();
}

function kidsSurprise() {
  const others = Object.keys(WORLDS).filter((k) => k !== state.kids);
  kidsWorld(pick(others));
}

function renderKids() {
  const k = h('div', 'kids');
  const worlds = h('div', 'worlds');
  for (const [id, w] of Object.entries(WORLDS)) {
    const b = h('button', 'world' + (state.kids === id ? ' on' : ''), `<span class="world-ring"><svg viewBox="0 0 24 24">${w.icon}</svg></span>${w.name}`);
    b.setAttribute('aria-pressed', String(state.kids === id));
    b.addEventListener('click', () => kidsWorld(id));
    worlds.append(b);
  }
  k.append(h('p', 'kids-q', 'Pick a world'), worlds);
  k.append(h('p', 'kids-q', 'Your finger plays'));
  k.append(chips(KID_VOICES.map(([value, label]) => ({ value, label })), state.g.touchVoice, (v) => {
    prefs.kidVoice = v;
    save();
    setGlobal('touchVoice', v);
  }, 'kid-voices'));
  const row = h('div', 'kids-actions');
  const big = h('button', 'primary', 'Play with the whole screen');
  big.addEventListener('click', enterImmersive);
  const surprise = h('button', 'btn', 'Surprise!');
  surprise.addEventListener('click', kidsSurprise);
  row.append(big, surprise);
  k.append(row);
  const bed = h('button', 'text-btn kids-bed', sleepEnd ? `bedtime in ${Math.ceil((sleepEnd - Date.now()) / 60000)} min` : 'bedtime in 15 minutes');
  bed.addEventListener('click', () => { if (!sleepEnd) { prefs.windDown = true; setSleep(15); } renderPanel(); });
  k.append(bed);
  panel.append(k);
}

// Plain beds for sleeping: one sound, nothing that asks for attention.
const BEDS = [['sleepier', 'Sleepier'], ['rain', 'Rain'], ['ocean', 'Ocean'], ['noise', 'Brown noise'], ['stream', 'Stream'], ['night', 'Night'], ['fire', 'Fire']];
function playBed(kind) {
  const s = songify(generateScene(newSeed(), { mood: 'sleep', rhythm: false, energy: 0.02 }));
  if (kind !== 'sleepier') {
    for (const id in s.layers) s.layers[id].on = false;
    const l = s.layers[kind];
    l.on = true;
    l.p = { ...l.p, vol: 0.75 };
    if (kind === 'noise') l.p = { ...l.p, color: 'brown', sweep: 0.2 };
    s.name = { rain: 'Rain', ocean: 'Ocean', noise: 'Brown Noise', stream: 'Stream', night: 'Night Garden', fire: 'Fireside' }[kind];
    s.palette = 'night';
  }
  applyScene(s, { fade: 6 });
  bedChoice = kind;
  renderPanel();
  toast(s.name, undoAction());
  if (!started) togglePlay();
}
let bedChoice = null; // which sleep sound is playing, until the scene changes

// Fresh bass: a syncopated line at the drum tempo. In a running song the
// arranger shapes it per section; otherwise it just plays.
function setGroove(v) {
  if (v && !state.g.beat) setRhythm(true); // before the bass, so a new rhythm can't replace it
  state.g.groove = v;
  engine.setGlobal('groove', v);
  const ls = state.layers.bass;
  if (v) {
    Object.assign(ls.p, FRESH_BASS, { busy: running() ? 0.6 : 0.5 });
    ls.on = true;
  } else if (ls.p.pattern === 'groove' || ls.p.pattern === 'held') ls.p.pattern = running() ? 'pulse' : 'roots';
  if (started) {
    const l = engine.layers.bass;
    l.setAll(ls.p);
    if (ls.on) l.enable(1);
  }
  renderPanel();
  renderMeta();
  if (openName) renderSheet();
  save();
  const style = { dub: 'Dub bass: deep and patient', drive: 'Driving bass: fuzzed sixteenths', psy: 'Psy bass: rolling, with a sweeping filter', funk: 'Funk bass: syncopated, octave jumps' }[ls.p.bstyle] || 'Deep bass';
  toast(v ? style : 'Plain bass');
}

function setJourney(v) {
  prefs.journey = v;
  lastSceneChange = Date.now();
  save();

}

function setRunGoal(v) {
  prefs.runGoal = v;
  if (goalDone && (!v || runElapsed < v * 60)) { goalDone = false; runPhase = 'off'; conductor.intensity = runIntensity(); tickRun(0); }
  refreshViews();
  save();
  toast(v ? `The music winds down to a cool-down at ${v} min` : 'Open run · no end time');
}

function setIntervals(v) {
  prefs.intervals = v;
  if (runPhase === 'push' && prefs.pushCadence) setGlobal('bpm', runBase);
  runPhase = 'off';
  tickRun(0);
  conductor.intensity = runIntensity();
  refreshViews();
  save();
  if (v !== 'off') toast(running() && phaseAt(runElapsed).phase === 'warm' ? 'Intervals start after the warm-up · Skip starts them now' : 'Intervals on');
}

/* ─── run clock and intervals ─── */

// Time only counts while the music plays, so pausing at a crossing pauses the run.
let runElapsed = 0;
let runPhase = 'off';
let runBase = 0;
let ivShift = 0;      // seconds skipped ahead in the interval plan
let goalDone = false;
const warmup = () => prefs.warmup * 60;
const INTERVALS = {
  off: null,
  '1-2': { on: 60, off: 120, label: 'One minute on, two easy' },
  '2-2': { on: 120, off: 120, label: 'Two on, two easy' },
  '4-3': { on: 240, off: 180, label: 'Four on, three easy' },
};

function resetRunClock() {
  runElapsed = 0;
  runPhase = 'off';
  ivShift = 0;
  goalDone = false;
  conductor.lock = null;
  conductor.intensity = runIntensity();
}

function runIntensity() {
  return runPhase === 'push' ? 'push' : runPhase === 'easy' || goalDone ? 'easy' : prefs.runIntensity;
}

function phaseAt(t) {
  const iv = INTERVALS[prefs.intervals];
  if (goalDone) return { phase: 'cool' };
  if (!iv) return { phase: 'off' };
  t += ivShift;
  const w = warmup();
  if (t < w) return { phase: 'warm', left: w - t };
  const n = Math.floor((t - w) / (iv.on + iv.off));
  const c = (t - w) % (iv.on + iv.off);
  return c < iv.on ? { phase: 'push', left: iv.on - c, round: n + 1 } : { phase: 'easy', left: iv.on + iv.off - c, round: n + 1 };
}

function runPhaseLabel() {
  if (!running()) return '';
  if (runPhase === 'cool') return 'done · cool-down';
  if (runPhase === 'off') return '';
  const { left, round } = phaseAt(runElapsed);
  const name = { warm: 'warm-up', push: `push ${round}`, easy: `easy ${round}` }[runPhase];
  return `${name} · ${mmss(left)}`;
}

// Jump to the end of the warm-up, or on to the next push or easy stretch.
function skipPhase() {
  const ph = phaseAt(runElapsed);
  if (!ph.left) return;
  ivShift += ph.left;
  tickRun(0);
  refreshViews();
}

function tickRun(dt) {
  if (!running()) { if (runElapsed || runPhase !== 'off') resetRunClock(); return; }
  if (!engine.playing) return;
  runElapsed += dt;
  if (prefs.runGoal && !goalDone && runElapsed >= prefs.runGoal * 60) {
    // goal reached: bells, a breakdown, and easy music to cool down to
    goalDone = true;
    if (runPhase === 'push' && prefs.pushCadence) setGlobal('bpm', runBase);
    runPhase = 'cool';
    conductor.intensity = 'easy';
    conductor.lock = 'easy';
    conductor.force('breakdown');
    conductor.cue(false);
    setTimeout(() => conductor.cue(false), 900);
    toast(`${prefs.runGoal} minutes · well done · cooling down`);
    refreshViews();
    return;
  }
  const { phase } = phaseAt(runElapsed);
  if (phase !== runPhase) {
    const was = runPhase;
    runPhase = phase;
    conductor.intensity = runIntensity();
    conductor.lock = phase === 'push' ? 'push' : phase === 'easy' ? 'easy' : null;
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
  syncLock();
  refreshViews();
}

// The arranger's lock always follows where the runner is, whatever changed it.
function syncLock() {
  conductor.lock = goalDone ? 'easy' : runPhase === 'push' ? 'push' : runPhase === 'easy' ? 'easy' : null;
  conductor.intensity = runIntensity();
}

// The phone counts steps itself: start running and the beat finds you.
let senseState = '';
let senseAt = 0;
const steps = new StepSense((c) => {
  senseState = `${c}`;
  const now = performance.now();
  const bpm = running() ? Math.round(state.g.bpm) : null;
  // follow the runner, but gently: at most every 8 s, and only for a real change
  if (bpm == null || (Math.abs(c - bpm) >= 2 && now - senseAt > 8000)) {
    senseAt = now;
    setCadence(c);
  }
  refreshViews();
}, (s) => { senseState = s; refreshViews(); });

function senseLabel() {
  if (!steps.active) return 'count my steps';
  if (senseState === 'listening') return 'start running…';
  if (senseState === 'counting') return 'counting steps…';
  return `following you · ${senseState}`;
}

async function toggleSense() {
  if (steps.active) { steps.stop(); senseState = ''; refreshViews(); toast('Stopped counting steps'); return; }
  try {
    await steps.start();
    toast('Start running: the beat will find your step');
  } catch (err) {
    toast(err.message === 'denied' ? 'Motion access was declined' : 'This device can’t count steps');
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
  ivs.append(chips(Object.entries(INTERVALS).map(([id, iv]) => ({ value: id, label: iv ? iv.label : 'No intervals' })), prefs.intervals, (v) => { setIntervals(v); renderPanel(); }, 'scroll'));
  const pc = h('div', 'choice');
  pc.append(h('span', 'choice-label', 'Cadence during a push'));
  pc.append(chips([[0, 'Same'], [4, '+4'], [8, '+8'], [12, '+12']].map(([v, l]) => ({ value: v, label: l })), prefs.pushCadence, (v) => {
    if (runPhase === 'push') setGlobal('bpm', runBase + v);
    prefs.pushCadence = v;
    save();
  }));
  ivs.append(h('p', 'note', 'After the warm-up the music alternates between a push and an easy stretch. Two soft bell notes mark each change: rising for push, falling for easy. The run clock pauses when the music does.'));
  const wu = h('div', 'choice');
  wu.append(h('span', 'choice-label', 'Warm-up before intervals'));
  wu.append(chips([[0, 'None'], [3, '3 min'], [5, '5 min'], [10, '10 min']].map(([v, l]) => ({ value: v, label: l })), prefs.warmup, (v) => {
    prefs.warmup = v;
    if (runPhase === 'push' && prefs.pushCadence) setGlobal('bpm', runBase);
    runPhase = 'off';
    tickRun(0);
    refreshViews();
    save();
  }));
  ivs.append(wu);
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
  if (!openName) renderPanel();
  save();
}

/* ─────────────────────────── touch: the screen is an instrument ─────────────────────────── */

const app = $('#app');
const touches = new Map();
const isControl = (el) => el.closest('button, input, .dock, header, .sheet');

// A tap that starts the music or wakes the faded interface stays silent;
// it only turns into a note once the finger actually moves.
app.addEventListener('pointerdown', (e) => {
  if (isControl(e.target)) return;
  const quiet = !started; // the tap that starts the music doesn't also play a note
  if (!started) togglePlay();
  bumpIdle();
  touches.set(e.pointerId, { x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, quiet });
  try { app.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  engine.init();
  if (!quiet) engine.touch.down(e.pointerId, e.clientX / innerWidth, e.clientY / innerHeight);
  visuals.touch(e.pointerId, e.clientX, e.clientY, true);
});
app.addEventListener('pointermove', (e) => {
  const tt = touches.get(e.pointerId);
  if (!tt) {
    if (e.pointerType === 'mouse') bumpIdle();
    return;
  }
  if (Math.hypot(e.clientX - tt.x0, e.clientY - tt.y0) > 8) tt.moved = true;
  if (tt.quiet) {
    if (!tt.moved || !started) return;
    tt.quiet = false; // it's a gesture after all: start playing along
    engine.touch.down(e.pointerId, e.clientX / innerWidth, e.clientY / innerHeight);
  }
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
  if (immersive) return; // full screen has no interface to fade
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
  document.body.classList.add('sheet-open');
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
  document.body.classList.remove('sheet-open');
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
  // full screen: keys can't pause or change anything; Escape leaves
  if (immersive) { if (e.key === 'Escape') exitImmersive(); e.preventDefault(); return; }
  if (e.key === 'Escape' && openName) closeSheet();
  if (e.target.tagName === 'INPUT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' && !openName && e.target.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); }
  const keys = {
    g: generate, n: generate, b: () => history_.length && back(), s: saveScene, r: () => (recorder.recording ? stopRecording() : startRecording()),
    1: () => openSheet('create'), 2: () => openSheet('layers'), 3: () => openSheet('music'), 4: () => openSheet('sound'),
    l: () => setMode('listen'), u: () => setMode('run'), f: () => setMode('focus'), z: () => setMode('sleep'),
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
  // in a scrolling row, show the chosen option
  requestAnimationFrame(() => {
    const on = wrap.querySelector('.chip.on');
    if (on && wrap.scrollWidth > wrap.clientWidth) wrap.scrollLeft = Math.max(0, on.offsetLeft - wrap.clientWidth / 3);
  });
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
    if (p.hint) wrap.append(h('small', 'hint-line', esc(p.hint))); // phones have no hover
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
  if (id === 'song') return setSong(v);
  if (id === 'groove') return setGroove(v);
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
  el.append(head('Scenes', 'saved, recent, new'));

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


  const st = section('Starting points');
  const ul = h('div', 'starts');
  for (const s of STARTS) {
    const b = h('button', s.name === state.name ? 'current' : '', `<b>${esc(s.name)}</b><span>${esc(MOODS.find((m) => m.id === s.mood).name.toLowerCase())}</span>`);
    b.addEventListener('click', () => {
      applyScene(songify(startScene(s)));
      if (!started) togglePlay();
    });
    ul.append(b);
  }
  st.append(ul);
  el.append(st);

  const mood = section('Mood');
  mood.append(chips([{ value: 'any', label: 'Any' }, ...MOODS.filter((m) => m.id !== 'run').map((m) => ({ value: m.id, label: m.name }))], prefs.mood, (v) => { pickMood(v); }, 'scroll'));
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

}

/* ─── Layers ─── */

const expanded = new Set();
const mixOpen = new Set();

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
  const row = h('div', 'layer' + (ls.on ? ' on' : '') + (expanded.has(def.id) ? ' open' : '') + (def.group === 'rhythm' && !state.g.beat ? ' muted' : ''));
  const groupName = GROUPS.find((g) => g.id === def.group).name + (def.group === 'rhythm' && !state.g.beat ? ' · beat off' : '');
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
  // what makes this layer itself comes first; the mixing desk folds away below
  const MIX = def.id === 'binaural' ? ['tone'] : ['tone', 'pan', 'rev', 'dly']; // binaural stays dry and centred
  const HIDE = def.id === 'binaural' ? ['pan', 'rev', 'dly'] : [];
  const fillParams = () => {
    params.innerHTML = '';
    for (const p of def.schema) {
      if (p.id === 'vol' || MIX.includes(p.id) || HIDE.includes(p.id)) continue;
      params.append(control(p, ls.p[p.id], (v) => setP(p.id, v), `${def.id}.${p.id}`));
    }
    const mix = h('details', 'mix');
    mix.open = mixOpen.has(def.id);
    mix.addEventListener('toggle', () => { if (mix.open) mixOpen.add(def.id); else mixOpen.delete(def.id); });
    mix.append(h('summary', null, 'Mix · filter, pan, reverb, echo'));
    for (const id of MIX) {
      const p = def.schema.find((x) => x.id === id);
      if (p) mix.append(control(p, ls.p[id], (v) => setP(id, v), `${def.id}.${id}`));
    }
    params.append(mix);
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
  el.append(head('Sound', 'volume, space, colour, look'));
  const vol = section('Volume');
  vol.append(control({ id: 'volume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    prefs.volume, (v) => { prefs.volume = v; engine.setVolume(vol()); if (sleepEnd) engine.scheduleSleep((sleepEnd - Date.now()) / 1000, fadeSecs()); save(); }));
  el.append(vol);
  for (const id of ['space', 'colour']) globalSection(GLOBAL_SECTIONS.find((s) => s.id === id), el);
  const touch = GLOBAL_SECTIONS.find((s) => s.id === 'touch');
  const ts = section('Touch');
  ts.append(h('p', 'note', 'Drag a finger anywhere. <b>Left to right</b> plays notes in key, <b>up and down</b> opens the tone and the space.'));
  for (const p of touch.params) ts.append(control(p, state.g[p.id], (v) => setGlobal(p.id, v), `g.${p.id}`));
  el.append(ts);

  const vs = section('Look', null, () => {
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
  vs.prepend(h('span', 'choice-label', 'Palette'), pal); // colour first, then the finer controls
  vs.insertBefore(vs.querySelector('.section-title'), vs.firstChild);
  el.append(vs);
  el.append(recordSection());

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

const fadeSecs = () => Math.min(prefs.sleepFade * 60, sleepMin * 60 * 0.5);

// Over the timer the music darkens, slows a little and thins out, so it
// eases you down rather than just stopping. Engine-only: the scene itself
// is untouched and comes back as it was.
let winding = false;
let windAt = 0;
function windDown(now) {
  if (!sleepEnd || !prefs.windDown || !engine.playing || !engine.ctx || conductor.active) return;
  if (now - windAt < 10000) return;
  windAt = now;
  const p = clamp(1 - (sleepEnd - now) / (sleepMin * 60000), 0, 1);
  glide(engine.arr.frequency, 20000 * Math.pow(900 / 20000, Math.pow(p, 0.8)), engine.ctx.currentTime, 6);
  engine.setGlobal('density', state.g.density * (1 - 0.6 * p));
  engine.setGlobal('bpm', state.g.bpm * (1 - 0.12 * p));
  winding = true;
}
function endWind() {
  if (!winding) return;
  winding = false;
  windAt = 0;
  if (engine.ctx) glide(engine.arr.frequency, 20000, engine.ctx.currentTime, 1);
  engine.setGlobal('density', state.g.density);
  engine.setGlobal('bpm', state.g.bpm);
}

function setSleep(m) {
  endWind();
  sleepMin = m;
  sleepEnd = m ? Date.now() + m * 60000 : 0;
  sleepFading = false;
  engine.setVolume(vol());
  if (m) engine.scheduleSleep(m * 60, fadeSecs());
  updateTimerStatus();
  toast(m ? `Stops in ${m < 120 ? `${m} min` : `${m / 60} hours`}${prefs.windDown ? ', winding down as it goes' : ''}` : 'Timer off');
}

function setBreath(v) {
  prefs.breath = v;
  breathStart = performance.now();
  wakeBreath();
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
  if (el) el.textContent = sleepEnd ? `${fmt(sleepEnd - Date.now())} left${winding ? ' · winding down' : ''}` : '';
  $('#sleep-left').textContent = sleepEnd ? `${Math.ceil((sleepEnd - Date.now()) / 60000)}m` : '';
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  tickRun(Math.min(5, (now - lastTick) / 1000));
  tickFocus();
  lastTick = now;
  if (sleepEnd) {
    const left = sleepEnd - now;
    windDown(now);
    if (left <= fadeSecs() * 1000 && !sleepFading && engine.playing) {
      sleepFading = true;
      engine.fadeOut(left / 1000);
    }
    if (left <= 0) {
      sleepEnd = 0;
      sleepMin = 0;
      sleepFading = false;
      if (engine.playing) togglePlay();
      endWind();
      engine.setVolume(vol());
      if (mode() === 'sleep') renderPanel();
    }
    updateTimerStatus();
  }
  if (engine.playing && prefs.journey && !conductor.active && !winding && focus.phase !== 'focus' && now - lastSceneChange > prefs.journey * 60000) {
    applyScene(mutateScene(state, newSeed()), { fade: 10 });
  }
}, 1000);

/* ─── breathing loop ─── */

let breathStart = performance.now();
const breathText = $('#breath-text');
// Runs only while a breathing guide is showing; otherwise it stops asking for frames.
let breathOn = false;
function breathLoop(ts) {
  const b = mode() === 'sleep' ? BREATHS[prefs.breath] : null;
  if (!b) {
    visuals.breath = null;
    breathText.classList.remove('show');
    breathOn = false;
    return;
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
function wakeBreath() {
  if (breathOn) return;
  breathOn = true;
  requestAnimationFrame(breathLoop);
}
wakeBreath();

/* ─────────────────────────── share ─────────────────────────── */

const shareUrl = async () => `${location.origin}${location.pathname}#${await shareCode(state)}`;
// kept ready in the background: phones only open the share sheet straight after a tap
let readyUrl = null;
const refreshShare = () => { const at = state; shareUrl().then((u) => { if (state === at) readyUrl = u; }).catch(() => {}); };

async function share_() {
  const url = readyUrl || await shareUrl();
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
  const url = readyUrl || await shareUrl();
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
if (prefs.knowsTokens) document.body.classList.add('knows');
applyScene(state, { animate: false, remember: false });
booted = true;
if (hasShare()) openShared(true);
bumpIdle();

window.genbient = { prefs, tickRun, focus, shareUrl, recorder, engine, visuals, keepAlive, conductor, get state() { return state; }, applyScene, generateScene, LAYER_BY_ID, GLOBAL_BY_ID, defaults };
