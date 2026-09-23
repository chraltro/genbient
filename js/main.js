import { Engine } from './engine.js';
import { Visuals } from './visuals.js';
import { LAYERS, GROUPS } from './layers.js';
import { NOTE_NAMES, MODES } from './theory.js';
import { PRESETS, PALETTES, generateScene, mutateScene, encodeScene, decodeScene } from './scenes.js';

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, html) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;

const store = {
  get(k, d) { try { const v = localStorage.getItem('genbient:' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('genbient:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const engine = new Engine();
const visuals = new Visuals($('#bg'), engine);
engine.on('note', (n) => visuals.note(n));
engine.on('key', (hm) => {
  state.root = hm.root;
  renderMeta();
  if (openName === 'tune') renderSheet();
  save();
});

const prefs = Object.assign({ volume: 0.85, journey: 0, breath: 'off', wake: false }, store.get('prefs', {}));
engine.params.volume = prefs.volume;

let state = loadInitial();
let started = false;
let lastSceneChange = Date.now();

function loadInitial() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    const s = decodeScene(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    if (s) return s;
  }
  const saved = store.get('scene', null);
  if (saved && saved.layers && MODES[saved.mode]) {
    for (const def of LAYERS) saved.layers[def.id] ||= { on: false, vol: 0.6, ch: 0.5 };
    return saved;
  }
  return clone(PRESETS[0]);
}

function save() {
  store.set('scene', state);
  store.set('prefs', prefs);
}

/* ─────────────────────────── scene application ─────────────────────────── */

function setAccent() {
  const p = PALETTES[state.palette] || PALETTES.abyss;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(p.accent.slice(i, i + 2), 16));
  document.documentElement.style.setProperty('--accent', p.accent);
  document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  $('meta[name="theme-color"]').setAttribute('content', p.bg[0]);
}

function applyScene(next, { fade = 5, animate = true } = {}) {
  state = next;
  lastSceneChange = Date.now();
  visuals.setPalette(state.palette);
  setAccent();
  if (started) engine.apply(state, { fade });
  else Object.assign(engine.params, { pace: state.pace, evolve: state.evolve, bright: state.bright, space: state.space });
  renderTitle(animate);
  updateMediaSession();
  if (openName) renderSheet();
  save();
}

// Small edits (sliders, toggles) go straight to the engine.
function commit() {
  if (started) engine.apply(state, { fade: 3 });
  renderMeta();
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
  const bits = [`${NOTE_NAMES[state.root]} ${MODES[state.mode].name}`];
  if (state.a4 === 432) bits.push('432');
  if (state.just) bits.push('just');
  bits.push(`${n} ${n === 1 ? 'layer' : 'layers'}`);
  $('#scene-meta').textContent = bits.join('  ·  ');
}

/* ─────────────────────────── play / pause ─────────────────────────── */

const orb = $('#orb');

async function togglePlay() {
  if (engine.playing) {
    engine.pause();
    document.body.classList.remove('playing');
    orb.setAttribute('aria-label', 'Play');
    $('#orb-label').textContent = 'resume';
    releaseWake();
    setMediaState('paused');
    return;
  }
  engine.init();
  if (!started) {
    started = true;
    document.body.classList.add('started');
    engine.apply(state, { fade: 6 });
  }
  try {
    await engine.play();
  } catch (err) {
    console.error(err);
    toast('Audio could not start. Tap again.');
    return;
  }
  document.body.classList.add('playing');
  orb.setAttribute('aria-label', 'Pause');
  if (prefs.wake) requestWake();
  updateMediaSession();
  setMediaState('playing');
  bumpIdle();
}

orb.addEventListener('click', () => {
  if (wakeTap) { wakeTap = false; return; }
  togglePlay();
});

function placeOrb() { visuals.setOrb(orb.getBoundingClientRect()); }
addEventListener('resize', () => requestAnimationFrame(placeOrb));
new ResizeObserver(placeOrb).observe(orb);
placeOrb();

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (engine.playing && engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume();
  if (engine.playing && prefs.wake) requestWake();
});

/* ─────────────────────────── generate ─────────────────────────── */

$('#btn-generate').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  btn.classList.toggle('spin');
  applyScene(generateScene(newSeed()));
  if (!started) togglePlay();
});

/* ─────────────────────────── idle fade ─────────────────────────── */

let idleTimer;
let wakeTap = false;
// When the interface has dissolved, the first tap only brings it back.
addEventListener('pointerdown', () => {
  wakeTap = document.body.classList.contains('idle');
  if (wakeTap) setTimeout(() => { wakeTap = false; }, 600);
}, { capture: true });
function bumpIdle() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (engine.playing && !openName) document.body.classList.add('idle');
  }, 7000);
}
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel']) {
  addEventListener(ev, bumpIdle, { passive: true });
}

/* ─────────────────────────── sheets ─────────────────────────── */

const sheet = $('#sheet');
const body = $('#sheet-body');
const backdrop = $('#backdrop');
let openName = null;

const SHEETS = { scenes: renderScenes, layers: renderLayers, tune: renderTune, rest: renderRest };

function openSheet(name) {
  if (openName === name) return closeSheet();
  openName = name;
  renderSheet();
  body.scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  document.querySelectorAll('.dock-btn').forEach((b) => b.classList.toggle('active', b.dataset.sheet === name));
  bumpIdle();
}

function closeSheet() {
  openName = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  document.querySelectorAll('.dock-btn').forEach((b) => b.classList.remove('active'));
  bumpIdle();
}

function renderSheet() {
  if (!openName) return;
  const top = body.scrollTop;
  body.innerHTML = '';
  SHEETS[openName](body);
  body.scrollTop = top;
}

document.querySelectorAll('.dock-btn').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
backdrop.addEventListener('click', closeSheet);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ' && !openName) { e.preventDefault(); togglePlay(); }
});

// drag the sheet down to dismiss
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

/* ─── UI building blocks ─── */

function head(title, sub) {
  const el = h('div', 'sheet-head');
  el.append(h('h2', null, title));
  if (sub) el.append(h('small', null, sub));
  return el;
}

function section(title, aside) {
  const el = h('div', 'section');
  const t = h('p', 'section-title', title);
  if (aside) t.append(h('em', null, aside));
  el.append(t);
  return el;
}

function slider(label, value, onInput, cls = '') {
  const wrap = h('label', 'slider ' + cls);
  const span = h('span', null, label);
  const input = h('input');
  input.type = 'range';
  input.min = 0; input.max = 100; input.step = 1;
  input.value = Math.round(value * 100);
  input.setAttribute('aria-label', label.replace(/<[^>]+>/g, ''));
  const fill = () => input.style.setProperty('--v', input.value + '%');
  fill();
  input.addEventListener('input', () => { fill(); onInput(input.value / 100); });
  wrap.append(span, input);
  return wrap;
}

function chips(options, current, onPick, cls = '') {
  const wrap = h('div', 'chips ' + cls);
  for (const o of options) {
    const b = h('button', 'chip' + (o.value === current ? ' on' : ''), o.label);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
      onPick(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.8c.7 5 3.3 7.8 8.8 9.2-5.5 1.4-8.1 4.2-8.8 9.2-.7-5-3.3-7.8-8.8-9.2 5.5-1.4 8.1-4.2 8.8-9.2Z"/></svg>';

function cardBg(pid) {
  const p = PALETTES[pid];
  return `radial-gradient(90% 90% at 20% 15%, ${p.orbs[0]}cc, transparent 70%),
    radial-gradient(80% 90% at 90% 90%, ${p.orbs[1]}bb, transparent 70%),
    radial-gradient(60% 60% at 70% 30%, ${p.accent}44, transparent 70%),
    linear-gradient(160deg, ${p.bg[1]}, ${p.bg[0]})`;
}

/* ─── Scenes ─── */

function renderScenes(el) {
  el.append(head('Soundscapes', `${PRESETS.length} scenes · ∞ more`));

  const gen = h('button', 'gen-card', `<div class="star">${STAR}</div><div><b>Dream up a new one</b><span>A fresh soundscape, never heard before</span></div>`);
  gen.addEventListener('click', () => {
    applyScene(generateScene(newSeed()));
    if (!started) togglePlay();
  });
  el.append(gen);

  const j = section('Journey', 'slowly wander into new scenes');
  j.append(chips(
    [{ value: 0, label: 'Stay here' }, { value: 5, label: '5 min' }, { value: 10, label: '10 min' }, { value: 20, label: '20 min' }, { value: 40, label: '40 min' }],
    prefs.journey,
    (v) => { prefs.journey = v; lastSceneChange = Date.now(); save(); if (v) toast(`Drifting every ${v} minutes`); },
  ));
  el.append(j);

  const s = section('Curated');
  const grid = h('div', 'scene-grid');
  for (const p of PRESETS) {
    const card = h('button', 'scene-card' + (p.name === state.name ? ' current' : ''), `<b>${p.name}</b><span>${p.tagline}</span>`);
    card.style.background = cardBg(p.palette);
    card.addEventListener('click', () => {
      applyScene(clone(p));
      if (!started) togglePlay();
    });
    grid.append(card);
  }
  s.append(grid);
  el.append(s);
}

/* ─── Layers ─── */

function renderLayers(el) {
  const count = () => LAYERS.filter((l) => state.layers[l.id].on).length;
  const hd = head('Layers', `${count()} playing`);
  el.append(hd);
  for (const g of GROUPS) {
    const sec = section(g.name);
    for (const def of LAYERS.filter((l) => l.group === g.id)) {
      const ls = state.layers[def.id];
      const row = h('div', 'layer' + (ls.on ? ' on' : ''));
      const sub = def.id === 'binaural' ? 'use headphones' : def.ch.toLowerCase();
      const tg = h('button', 'layer-toggle', `<span class="dot"></span><span class="layer-name">${def.name}<small>${sub}</small></span><span class="switch"></span>`);
      tg.setAttribute('aria-pressed', String(ls.on));
      tg.addEventListener('click', () => {
        ls.on = !ls.on;
        row.classList.toggle('on', ls.on);
        tg.setAttribute('aria-pressed', String(ls.on));
        hd.querySelector('small').textContent = `${count()} playing`;
        commit();
      });
      const ctl = h('div', 'layer-controls');
      const inner = h('div');
      inner.append(
        slider('Level', ls.vol, (v) => { ls.vol = v; if (started) engine.layers[def.id].setVolume(v); save(); }),
        slider(def.ch, ls.ch, (v) => { ls.ch = v; if (started) engine.layers[def.id].setCharacter(v); save(); }),
      );
      ctl.append(inner);
      row.append(tg, ctl);
      sec.append(row);
    }
    el.append(sec);
  }
}

/* ─── Tune ─── */

function renderTune(el) {
  el.append(head('Tune', MODES[state.mode].name));

  const key = section('Key');
  key.append(chips(NOTE_NAMES.map((n, i) => ({ value: i, label: n })), state.root, (v) => { state.root = v; commit(); }, 'keys'));
  el.append(key);

  const mode = section('Scale');
  mode.append(chips(Object.entries(MODES).map(([id, m]) => ({ value: id, label: m.name })), state.mode, (v) => {
    state.mode = v;
    el.querySelector('.sheet-head small').textContent = MODES[v].name;
    commit();
  }));
  el.append(mode);

  const feel = section('Feel');
  const g = (label, key, hint) => slider(`${label}<em>${hint}</em>`, state[key], (v) => { state[key] = v; commit(); }, 'wide');
  feel.append(
    g('Pace', 'pace', 'how often things happen'),
    g('Evolution', 'evolve', 'how fast it changes'),
    g('Brightness', 'bright', 'dark ↔ airy'),
    g('Space', 'space', 'room ↔ cathedral'),
  );
  el.append(feel);

  const tun = section('Tuning');
  tun.append(chips([{ value: 440, label: 'A = 440 Hz' }, { value: 432, label: 'A = 432 Hz' }], state.a4, (v) => { state.a4 = v; commit(); }));
  const ji = chips([{ value: false, label: 'Equal temperament' }, { value: true, label: 'Just intonation' }], !!state.just, (v) => { state.just = v; commit(); });
  ji.style.marginTop = '8px';
  tun.append(ji);
  el.append(tun);

  const vol = section('Volume');
  vol.append(slider('Master', prefs.volume, (v) => { prefs.volume = v; engine.setVolume(v); save(); }, 'wide'));
  el.append(vol);

  const share = section('Share');
  const row = h('div', 'row-btns');
  const b1 = h('button', 'btn', '<svg viewBox="0 0 24 24"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5.5"/></svg>Share scene');
  b1.addEventListener('click', share_);
  const b2 = h('button', 'btn', `${STAR}Surprise me`);
  b2.querySelector('svg').style.cssText = 'fill:currentColor;stroke:none';
  b2.addEventListener('click', () => applyScene(generateScene(newSeed())));
  row.append(b1, b2);
  share.append(row);
  el.append(share);
}

/* ─── Rest: sleep timer, breathing, screen ─── */

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

function renderRest(el) {
  el.append(head('Rest', 'timer · breath · screen'));

  const timer = section('Sleep timer', 'fades out gently');
  const opts = [0, 10, 20, 30, 45, 60, 90].map((m) => ({ value: m, label: m ? `${m} min` : 'Off' }));
  timer.append(chips(opts, sleepEnd ? sleepMin : 0, (m) => {
    sleepMin = m;
    sleepEnd = m ? Date.now() + m * 60000 : 0;
    sleepFading = false;
    if (m && engine.playing) engine.setVolume(prefs.volume);
    updateTimerStatus();
  }));
  timer.append(h('p', 'timer-status', ''));
  el.append(timer);
  updateTimerStatus();

  const br = section('Breathing guide', 'follow the orb');
  br.append(chips(Object.entries(BREATHS).map(([id, b]) => ({ value: id, label: b ? b.label : 'Off' })), prefs.breath, (v) => {
    prefs.breath = v;
    breathStart = performance.now();
    save();
    if (v !== 'off') closeSheet();
  }));
  el.append(br);

  const sc = section('Screen');
  if ('wakeLock' in navigator) {
    const row = h('button', 'toggle-row', `<span><b>Keep screen awake</b><small>for watching the visuals</small></span><span class="switch${prefs.wake ? ' on' : ''}"></span>`);
    row.addEventListener('click', () => {
      prefs.wake = !prefs.wake;
      row.querySelector('.switch').classList.toggle('on', prefs.wake);
      if (prefs.wake && engine.playing) requestWake(); else releaseWake();
      save();
    });
    sc.append(row);
  }
  sc.append(h('p', 'note', 'The interface fades away while you listen. <b>Tap anywhere</b> to bring it back.'));
  el.append(sc);

  const about = section('About');
  about.append(h('p', 'note', 'Every sound here is synthesised live in your browser: no recordings, no loops. Harmony wanders slowly through the scale, melodies are improvised note by note, and weather comes and goes, so no two minutes are ever the same. Best with headphones.'));
  el.append(about);
}

function fmt(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function updateTimerStatus() {
  const el = $('.timer-status');
  if (!el) return;
  el.textContent = sleepEnd ? `Fading out in ${fmt(sleepEnd - Date.now())}` : '';
}

setInterval(() => {
  const now = Date.now();
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
      if (openName === 'rest') renderSheet();
    }
    updateTimerStatus();
  }
  if (engine.playing && prefs.journey && now - lastSceneChange > prefs.journey * 60000) {
    applyScene(mutateScene(state, newSeed()), { fade: 10 });
  }
}, 1000);

/* ─── breathing loop ─── */

let breathStart = performance.now();
const breathText = $('#breath-text');
function breathLoop(ts) {
  const b = BREATHS[prefs.breath];
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

async function share_() {
  const url = `${location.origin}${location.pathname}#s=${encodeScene(state)}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `${state.name} · Genbient`, text: `Listen to “${state.name}”, a generative soundscape`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

let wakeLock = null;
async function requestWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* denied */ }
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
    navigator.mediaSession.setActionHandler('nexttrack', () => applyScene(generateScene(newSeed())));
  } catch { /* partial support */ }
}
function setMediaState(s) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s; } catch { /* ignore */ }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ─────────────────────────── boot ─────────────────────────── */

applyScene(state, { animate: false });
bumpIdle();

// exposed for debugging and automated checks
window.genbient = { engine, get state() { return state; }, applyScene, generateScene };
