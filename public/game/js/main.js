// Crimson Arena: boot, main loop, game flow and HUD.
// Gameplay (movement, physics, combat, AI) runs in the C# engine compiled to
// WebAssembly; this file feeds it input and turns its events into juice.

import { loadAssets } from './assets.js';
import { Sfx } from './audio.js';
import { Bot } from './bot.js';
import { loadEngine } from './engine.js';
import { Input } from './input.js';
import { Renderer } from './render.js';

const $ = (id) => document.getElementById(id);
const BEST_KEY = 'crimson-arena:best';
const SCREENS = ['loading', 'title', 'pause', 'over', 'error'];

const input = new Input();
const audio = new Sfx();
const game = {
  mode: 'loading', // loading | title | playing | paused | over | error
  engine: null,
  renderer: null,
  bot: null,
  snap: null,
  best: readBest(),
  stats: null,
  overAt: 0
};

// ---------------------------------------------------------------- boot

boot();

async function boot() {
  const bar = $('load-bar');
  const label = $('load-label');
  const progress = (pct, text) => {
    bar.style.width = `${pct}%`;
    if (text) label.textContent = text;
  };
  try {
    progress(8, 'Loading sprites…');
    const assets = loadAssets('./');
    const engine = loadEngine((loaded, total) => progress(15 + (loaded / Math.max(1, total)) * 80, `Booting C# engine · ${loaded}/${total}`));
    const [a, e] = await Promise.all([assets, engine]);
    progress(97, 'Summoning the arena…');
    await Promise.race([document.fonts?.load("700 24px 'Cinzel'"), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});

    game.engine = e;
    game.renderer = new Renderer($('stage'), a, e.layout);
    game.bot = new Bot(e.layout);
    wireUi();
    progress(100);
    showTitle();
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    $('error-message').textContent = err?.message || String(err);
    setMode('error');
  }
}

function startAttract() {
  game.engine.start(randomSeed());
  game.snap = game.engine.step(0, 0);
}

// ---------------------------------------------------------------- loop

let last = performance.now();
let fpsTime = 0;
let fpsFrames = 0;
let slowWindows = 0;

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const { engine, renderer } = game;
  const paused = game.mode === 'paused';

  if (!paused) {
    let buttons = 0;
    if (game.mode === 'playing') buttons = input.buttons();
    else if (game.mode === 'title') buttons = game.bot.buttons(game.snap);
    game.snap = engine.step(dt, buttons);
    handleEvents(game.snap);
    if (game.mode === 'playing') game.stats.time += dt * game.snap.timeScale;
    if (game.mode === 'title' && game.snap.state === engine.layout.states.GameOver) startAttract();
    if (game.mode === 'playing' && game.overAt && now >= game.overAt) showGameOver();
  }

  renderer.draw(game.snap, dt, { paused });
  if (game.mode === 'playing' || game.mode === 'paused') updateHud(game.snap, dt);

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const fps = fpsFrames / fpsTime;
    $('fps').textContent = Math.round(fps);
    // Adaptive quality: a few slow windows in a row -> render fewer pixels.
    slowWindows = fps < 45 && !document.hidden ? slowWindows + 1 : 0;
    if (slowWindows >= 4 && renderer.degrade()) slowWindows = 0;
    fpsFrames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- flow

function setMode(mode) {
  game.mode = mode;
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== mode;
  $('hud').hidden = !(mode === 'playing' || mode === 'paused');
  document.body.dataset.mode = mode;
}

function showTitle() {
  $('title-best').textContent = game.best.toLocaleString();
  audio.setIntensity(0);
  startAttract();
  setMode('title');
}

function play() {
  audio.unlock();
  audio.ui();
  game.engine.start(randomSeed());
  game.snap = game.engine.step(0, 0);
  game.stats = { time: 0, perfect: 0, damage: 0, hits: 0, trapKills: 0 };
  game.overAt = 0;
  input.latched.clear();
  hudCache.clear();
  game.renderer.fx.list.length = 0;
  game.renderer.fx.texts.length = 0;
  setMode('playing');
  audio.setIntensity(1);
}

function pause() {
  if (game.mode !== 'playing') return;
  setMode('paused');
  audio.ui();
}

function resume() {
  if (game.mode !== 'paused') return;
  audio.unlock();
  input.latched.clear();
  last = performance.now();
  setMode('playing');
}

function showGameOver() {
  const s = game.snap;
  game.overAt = 0;
  const score = Math.round(s.score);
  const newBest = score > game.best;
  if (newBest) {
    game.best = score;
    try {
      localStorage.setItem(BEST_KEY, String(score));
    } catch {}
  }
  $('over-score').textContent = score.toLocaleString();
  $('over-wave').textContent = s.wave;
  $('over-kills').textContent = s.kills;
  $('over-combo').textContent = s.bestCombo;
  $('over-time').textContent = formatTime(game.stats.time);
  $('over-perfect').textContent = game.stats.perfect;
  $('new-best').hidden = !newBest;
  $('over-note').textContent = directorNote(s.aggression, s.wave);
  audio.setIntensity(0);
  setMode('over');
}

function directorNote(aggression, wave) {
  if (aggression > 1.15) return `The AI Director turned ruthless: you were dominating, so wave ${wave} hit back harder. Enemies reacted faster and more of them attacked at once.`;
  if (aggression < 0.9) return 'The AI Director eased off: it saw you struggling, slowed enemy reactions and dropped more health. Master the dodge and it will push back.';
  return 'The AI Director kept the fight balanced, tuning enemy reaction time, attack tokens and wave size to how you played.';
}

// ---------------------------------------------------------------- events -> juice

function handleEvents(s) {
  const r = game.renderer;
  const fx = r.fx;
  const live = game.mode === 'playing';
  const sfx = live ? audio : null;
  const p = s.player;
  const L = game.engine.layout;

  for (const ev of s.events) {
    switch (ev.name) {
      case 'Hit': {
        const heavy = ev.aux === 1;
        const dir = Math.sign(ev.x - p.x) || 1;
        fx.burst(ev.x, ev.y, heavy ? 16 : 9, () => ({
          type: 'spark',
          x: ev.x,
          y: ev.y,
          vx: dir * (150 + Math.random() * 420) * (Math.random() < 0.2 ? -0.5 : 1),
          vy: (Math.random() - 0.3) * 380,
          grav: 600,
          life: 0.25 + Math.random() * 0.25,
          size: heavy ? 3 : 2,
          color: Math.random() < 0.5 ? '#fff4d6' : heavy ? '#ffb347' : '#ff6b7a'
        }));
        fx.add({ type: 'ring', x: ev.x, y: ev.y, size: 6, grow: heavy ? 60 : 34, life: 0.25, color: heavy ? '#ffd166' : '#ffffff' });
        fx.text(ev.x + (Math.random() - 0.5) * 20, ev.y + 26, String(ev.value), { color: heavy ? '#ffd166' : '#ffffff', size: heavy ? 30 : 22 });
        r.shake(heavy ? 0.32 : 0.1);
        if (heavy) r.cam.punch = 1;
        sfx?.hit(heavy);
        if (live) game.stats.hits++;
        break;
      }
      case 'PlayerHurt':
        r.flashHurt = 0.7;
        r.shake(0.45);
        fx.text(ev.x, ev.y + 40, `-${ev.value}`, { color: '#ff4d5e', size: 26 });
        fx.burst(ev.x, ev.y, 10, () => ({ type: 'spark', x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 420, vy: Math.random() * 300, grav: 700, life: 0.35, size: 2.4, color: '#ff4d5e' }));
        sfx?.hurt();
        if (live) game.stats.damage += ev.value;
        if (live && ev.aux <= 0) game.overAt = performance.now() + 2600;
        break;
      case 'EnemyDeath': {
        const boss = ev.aux === L.enemyKinds.Boss;
        fx.burst(ev.x, ev.y, boss ? 40 : 16, () => ({
          type: 'smoke',
          x: ev.x + (Math.random() - 0.5) * 40,
          y: ev.y + (Math.random() - 0.5) * 60,
          vx: (Math.random() - 0.5) * 60,
          vy: 20 + Math.random() * 60,
          life: 0.8 + Math.random() * 0.6,
          size: boss ? 18 : 11,
          color: '#2a0d24',
          alpha: 0.7
        }));
        fx.burst(ev.x, ev.y, boss ? 30 : 10, () => ({ type: 'glow', x: ev.x, y: ev.y, vx: (Math.random() - 0.5) * 160, vy: 60 + Math.random() * 200, drag: 1.5, life: 1 + Math.random(), size: 3.5, color: '#ff3d5a' }));
        fx.text(ev.x, ev.y + 60, `+${ev.value}`, { color: '#ffd166', size: boss ? 38 : 24, life: 1.2 });
        if (boss) {
          r.flashWhite = 1;
          r.shake(1);
          banner('Dread Knight slain', 'The arena trembles');
        } else r.shake(0.15);
        sfx?.death(boss);
        break;
      }
      case 'Swing':
        if (ev.aux === 0) sfx?.swing(ev.value === L.attackKinds.Heavy);
        else sfx?.enemySwing(ev.value);
        break;
      case 'Jump':
        dust(fx, ev.x, 6);
        sfx?.jump();
        break;
      case 'Land':
        dust(fx, ev.x, 8);
        sfx?.land();
        break;
      case 'Dash':
        dust(fx, ev.x, 10);
        if (ev.aux === -1) sfx?.dash();
        break;
      case 'TrapFire': {
        const near = Math.abs(ev.x - p.x) < 520;
        fx.burst(ev.x, 10, 12, () => ({ type: 'spark', x: ev.x + (Math.random() - 0.5) * 80, y: 6, vx: (Math.random() - 0.5) * 120, vy: 200 + Math.random() * 300, grav: 900, life: 0.35, size: 2, color: '#ff7a45' }));
        if (near) r.shake(0.12);
        sfx?.trap(near);
        break;
      }
      case 'WaveStart':
        banner(ev.aux ? `Wave ${ev.value} · Boss` : `Wave ${ev.value}`, ev.aux ? 'The Dread Knight approaches' : waveLine(s));
        sfx?.wave(ev.aux === 1);
        if (live) audio.setIntensity(ev.aux ? 2 : 1);
        break;
      case 'WaveClear':
        banner('Wave cleared', `+${ev.value.toLocaleString()} bonus${ev.aux ? ' · Flawless' : ''}`);
        sfx?.clear();
        if (live) audio.setIntensity(0);
        break;
      case 'Pickup':
        fx.text(ev.x, ev.y + 40, ev.value === 0 ? '+22 HP' : '+30 Rage', { color: ev.value === 0 ? '#ff6b7a' : '#ffd166', size: 20, font: "'Inter', system-ui, sans-serif" });
        fx.add({ type: 'ring', x: ev.x, y: ev.y + 10, size: 8, grow: 40, life: 0.35, color: ev.value === 0 ? '#ff6b7a' : '#ffd166' });
        sfx?.pickup(ev.value);
        break;
      case 'BossSpawn':
        r.shake(0.8);
        if (ev.aux === -1) banner('Enraged!', 'The Dread Knight calls for aid');
        else r.portal[ev.x < 1200 ? 0 : 1] = 1.5;
        sfx?.roar();
        break;
      case 'PerfectDodge':
        fx.text(ev.x, ev.y + 60, 'PERFECT', { color: '#7fe8ff', size: 30, life: 1 });
        fx.add({ type: 'ring', x: ev.x, y: ev.y, size: 10, grow: 90, life: 0.4, color: '#7fe8ff' });
        r.flashWhite = 0.35;
        sfx?.perfect();
        if (live) game.stats.perfect++;
        break;
      case 'Throw':
        sfx?.throwKnife();
        break;
      case 'Special':
        r.flashWhite = 0.4;
        r.shake(0.25);
        fx.add({ type: 'ring', x: ev.x, y: ev.y, size: 10, grow: 120, life: 0.35, color: '#ff5a6e' });
        sfx?.special();
        break;
      case 'Stagger':
        fx.text(ev.x, ev.y + 20, 'BREAK', { color: '#ffd76a', size: 18, life: 0.7, font: "'Inter', system-ui, sans-serif" });
        sfx?.stagger();
        break;
      case 'Spawn':
        r.portal[ev.x < 1200 ? 0 : 1] = 1;
        fx.burst(ev.x, 40, 14, () => ({ type: 'smoke', x: ev.x + (Math.random() - 0.5) * 50, y: Math.random() * 90, vx: (Math.random() - 0.5) * 40, vy: 30 + Math.random() * 40, life: 0.8, size: 12, color: '#3b0c2a', alpha: 0.6 }));
        if (Math.abs(ev.x - p.x) < 600) sfx?.spawn();
        break;
      case 'TrapKill':
        fx.text(ev.x, ev.y + 40, 'TRAP KILL +150', { color: '#ff9a4d', size: 20, life: 1.2 });
        if (live) game.stats.trapKills++;
        break;
      case 'GameOver':
        if (live) {
          sfx?.gameOver();
          game.overAt = Math.min(game.overAt || Infinity, performance.now() + 400);
        }
        break;
    }
  }
}

function dust(fx, x, n) {
  fx.burst(x, 2, n, () => ({ type: 'smoke', x: x + (Math.random() - 0.5) * 30, y: 4, vx: (Math.random() - 0.5) * 120, vy: 10 + Math.random() * 40, drag: 3, life: 0.45, size: 6, color: '#5a3a44', alpha: 0.45 }));
}

function waveLine(s) {
  const mood = game.engine.mood();
  return mood === 'ruthless' ? 'The AI Director senses your strength' : mood === 'calm' ? 'The AI Director gives you room to breathe' : 'Hold the arena';
}

let bannerTimer = 0;
function banner(title, sub) {
  const el = $('banner');
  $('banner-title').textContent = title;
  $('banner-sub').textContent = sub || '';
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------------------------------------------------------------- HUD

const hudCache = new Map();
let ghostHp = 1;
let shownScore = 0;

function set(id, value, apply) {
  if (hudCache.get(id) === value) return;
  hudCache.set(id, value);
  apply($(id), value);
}

const text = (el, v) => (el.textContent = v);
const width = (el, v) => (el.style.width = `${v}%`);

function updateHud(s, dt) {
  const p = s.player;
  const t = game.engine.layout.tuning;
  const hp = Math.max(0, p.hp / p.maxHp);
  ghostHp = hp > ghostHp ? hp : Math.max(hp, ghostHp - dt * 0.35);
  set('hp-fill', (hp * 100).toFixed(1), width);
  set('hp-ghost', (ghostHp * 100).toFixed(1), width);
  set('hp-num', Math.ceil(p.hp), text);
  set('st-fill', ((p.stamina / t.staminaMax) * 100).toFixed(1), width);
  set('rage-fill', ((p.rage / t.rageMax) * 100).toFixed(1), width);
  set('rage-ready', p.rage >= t.specialCost, (el, v) => el.classList.toggle('on', v));
  set('hud', hp < 0.3 && hp > 0, (el, v) => el.classList.toggle('danger', v));

  set('hud-wave', `Wave ${s.wave}`, text);
  set('hud-left', s.state === game.engine.layout.states.WaveBreak ? `Next wave in ${Math.ceil(s.stateTimer)}` : `${s.enemiesLeft} ${s.enemiesLeft === 1 ? 'foe' : 'foes'} left`, text);
  const mood = s.aggression < 0.9 ? 'calm' : s.aggression > 1.15 ? 'ruthless' : 'balanced';
  set('hud-mood', mood, (el, v) => {
    el.textContent = `AI ${v}`;
    el.dataset.mood = v;
  });

  shownScore += (s.score - shownScore) * Math.min(1, dt * 10);
  if (Math.abs(s.score - shownScore) < 1) shownScore = s.score;
  set('hud-score', Math.round(shownScore).toLocaleString(), text);
  set('hud-mult', `×${s.multiplier.toFixed(2)}`, text);
  set('hud-best', Math.max(game.best, Math.round(s.score)).toLocaleString(), text);

  set('combo', s.combo >= 2, (el, v) => el.classList.toggle('show', v));
  if (s.combo >= 2) {
    set('combo-n', s.combo, (el, v) => {
      el.textContent = v;
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    });
    set('combo-bar', ((s.comboTimer / t.comboWindow) * 100).toFixed(0), width);
  }

  set('boss', s.bossHp >= 0, (el, v) => (el.hidden = !v));
  if (s.bossHp >= 0) set('boss-fill', (s.bossHp * 100).toFixed(1), width);
}

// ---------------------------------------------------------------- UI wiring

function wireUi() {
  const click = (id, fn) => $(id).addEventListener('click', fn);
  click('btn-play', play);
  click('btn-again', play);
  click('btn-resume', resume);
  click('btn-restart', play);
  click('btn-quit', showTitle);
  click('btn-menu', showTitle);
  click('btn-pause', () => (game.mode === 'paused' ? resume() : pause()));
  click('btn-mute', toggleMute);
  click('btn-vision', toggleVision);
  click('btn-howto', () => $('controls').classList.toggle('open'));
  click('btn-fullscreen', toggleFullscreen);

  input.onCommand = (cmd) => {
    if (cmd === 'pause') game.mode === 'paused' ? resume() : pause();
    else if (cmd === 'mute') toggleMute();
    else if (cmd === 'vision') toggleVision();
    else if (cmd === 'confirm') {
      if (game.mode === 'title' || game.mode === 'over') play();
      else if (game.mode === 'paused') resume();
    } else if (cmd === 'restart' && game.mode === 'over') play();
  };
  input.bindTouch($('touch'));

  const coarse = matchMedia('(pointer: coarse)');
  const syncTouch = () => document.body.classList.toggle('touch-ui', coarse.matches || input.lastDevice === 'touch');
  syncTouch();
  coarse.addEventListener?.('change', syncTouch);
  addEventListener('touchstart', () => document.body.classList.add('touch-ui'), { once: true, passive: true });

  addEventListener('resize', () => game.renderer.resize());
  new ResizeObserver(() => game.renderer.resize()).observe($('stage'));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  addEventListener('pointerdown', () => audio.unlock(), { once: true });
  addEventListener('keydown', () => audio.unlock(), { once: true });
  syncMute();
}

function toggleMute() {
  audio.unlock();
  audio.toggleMute();
  syncMute();
}

function syncMute() {
  $('btn-mute').classList.toggle('off', audio.muted);
  $('btn-mute').setAttribute('aria-pressed', String(audio.muted));
  $('btn-mute').title = audio.muted ? 'Sound off (M)' : 'Sound on (M)';
}

function toggleVision() {
  game.renderer.vision = !game.renderer.vision;
  $('btn-vision').classList.toggle('on', game.renderer.vision);
  $('btn-vision').setAttribute('aria-pressed', String(game.renderer.vision));
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.({ navigationUI: 'hide' })?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// ---------------------------------------------------------------- utils

function readBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31) + 1;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Small read-only hook for automated playtests.
globalThis.crimsonArena = {
  get mode() {
    return game.mode;
  },
  get snap() {
    return game.snap;
  },
  play,
  pause,
  resume
};
