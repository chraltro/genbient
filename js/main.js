import { Engine } from './engine.js';
import { Visuals } from './visuals.js';
import { LAYERS, LAYER_BY_ID, GROUPS } from './layers/index.js';
import { NOTE_NAMES, MODES } from './theory.js';
import { GLOBAL_SECTIONS, GLOBAL_BY_ID, VISUAL_PARAMS, defaults, fill, randomize } from './params.js';
import {
  PALETTES, MOODS, STARTS, SECTIONS, generateScene, startScene, rerollSection, mutateScene,
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
  { volume: 0.85, journey: 0, breath: 'off', wake: false, mood: 'any', energy: null, filter: 'playing', quality: 'balanced' },
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

function loadInitial() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (m) {
    const s = decodeScene(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
    if (s) { setTimeout(() => toast('Shared soundscape loaded · tap to listen'), 800); return s; }
  }
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

function applyScene(next, { fade = 5, animate = true } = {}) {
  state = normalize(next);
  lastSceneChange = Date.now();
  visuals.setPalette(state.palette);
  setTheme();
  if (started) engine.apply(state, { fade });
  else engine.g = { ...engine.g, ...state.g };
  renderTitle(animate);
  renderRhythm();
  updateMediaSession();
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


document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (engine.playing && engine.ctx && engine.ctx.state !== 'running') engine.ctx.resume();
  if (engine.playing && prefs.wake) requestWake();
});

/* ─────────────────────────── generate ─────────────────────────── */

function generate() {
  const mood = prefs.mood === 'any' ? undefined : prefs.mood;
  applyScene(generateScene(newSeed(), { mood, energy: prefs.energy ?? undefined, rhythm: state.g.beat ? undefined : false }));
  if (!started) togglePlay();
}

$('#btn-generate').addEventListener('click', (e) => {
  e.currentTarget.classList.toggle('spin');
  generate();
});

/* ─────────────────────────── rhythm mode ─────────────────────────── */

const rhythmBtn = $('#btn-rhythm');
function renderRhythm() {
  rhythmBtn.textContent = state.g.beat ? 'Rhythm on' : 'Rhythm off';
  rhythmBtn.setAttribute('aria-pressed', String(!!state.g.beat));
}

// Off: drums and heartbeat fall silent, bass holds, and Random makes
// beatless scenes. On: if this scene never had drums, give it some.
function setRhythm(on) {
  state.g.beat = on;
  engine.setGlobal('beat', on);
  renderRhythm();
  const hasDrums = LAYERS.some((d) => d.group === 'rhythm' && state.layers[d.id].on);
  if (on && !hasDrums) {
    const next = rerollSection(state, 'rhythm', newSeed(), { rhythm: 'force', energy: Math.max(state.energy, 0.55) });
    next.name = state.name;
    next.tagline = state.tagline;
    applyScene(next, { fade: 3, animate: false });
  } else if (openName) renderSheet();
  toast(on ? 'Rhythm on' : 'Rhythm off');
  save();
}
rhythmBtn.addEventListener('click', () => setRhythm(!state.g.beat));

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

const SHEETS = { create: renderCreate, layers: renderLayers, music: renderMusic, sound: renderSound, rest: renderRest };

function openSheet(name) {
  if (openName === name) return closeSheet();
  openName = name;
  renderSheet();
  body.scrollTop = 0;
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  backdrop.classList.add('open');
  visuals.busy = true;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.toggle('active', b.dataset.sheet === name));
  bumpIdle();
}

function closeSheet() {
  openName = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  backdrop.classList.remove('open');
  visuals.busy = false;
  document.querySelectorAll('[data-sheet]').forEach((b) => b.classList.remove('active'));
  bumpIdle();
}

function renderSheet() {
  if (!openName) return;
  const top = body.scrollTop;
  bound.clear();
  body.innerHTML = '';
  SHEETS[openName](body);
  body.scrollTop = top;
}

document.querySelectorAll('[data-sheet]').forEach((b) => b.addEventListener('click', () => openSheet(b.dataset.sheet)));
backdrop.addEventListener('click', closeSheet);
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ' && !openName) { e.preventDefault(); togglePlay(); }
  if (e.key === 'g' && !openName) generate();
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
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      b.classList.add('on');
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
  if (id === 'bpm' || id === 'meter') renderMeta();
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

  const rh = section('Rhythm', 'Random follows this');
  rh.append(chips([{ value: true, label: 'With rhythm' }, { value: false, label: 'Without' }], !!state.g.beat, (v) => setRhythm(v)));
  el.append(rh);

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
      toast(`New ${s.name.toLowerCase()}`);
    });
    list.append(b);
  }
  const mut = h('button', 'reroll', 'Nudge everything');
  mut.addEventListener('click', () => applyScene(mutateScene(state, newSeed()), { fade: 6 }));
  list.append(mut);
  rr.append(list);
  el.append(rr);

  const j = section('Journey', 'drifts on its own');
  j.append(chips(
    [{ value: 0, label: 'Off' }, { value: 3, label: '3 min' }, { value: 5, label: '5 min' }, { value: 10, label: '10 min' }, { value: 20, label: '20 min' }, { value: 40, label: '40 min' }],
    prefs.journey,
    (v) => { prefs.journey = v; lastSceneChange = Date.now(); save(); if (v) toast(`Drifting every ${v} min`); },
    'scroll',
  ));
  el.append(j);

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
  key.append(chips(NOTE_NAMES.map((n, i) => ({ value: i, label: n })), state.root, (v) => { state.root = v; commitKey(); }, 'keys'));
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
  const vol = section('Volume');
  vol.append(control({ id: 'volume', label: 'Master', type: 'range', min: 0, max: 1, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    prefs.volume, (v) => { prefs.volume = v; engine.setVolume(v); save(); }));
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
  el.append(perf);
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

function renderRest(el) {
  el.append(head('Sleep', 'timer, breath, screen'));

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
  if (el) el.textContent = sleepEnd ? `Fading out in ${fmt(sleepEnd - Date.now())}` : '';
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
    navigator.mediaSession.setActionHandler('nexttrack', generate);
  } catch { /* partial support */ }
}
function setMediaState(s) {
  try { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s; } catch { /* ignore */ }
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

/* ─────────────────────────── boot ─────────────────────────── */

applyVisualPrefs();
applyScene(state, { animate: false });
bumpIdle();

window.genbient = { engine, visuals, get state() { return state; }, applyScene, generateScene, LAYER_BY_ID, GLOBAL_BY_ID, defaults };
