// Canvas renderer. Draws whatever the C# engine reports: it never decides
// gameplay, it only animates it (sprites, parallax, particles, shake).

import { Particles } from './fx.js';

export const VIEW_W = 960;
export const VIEW_H = 540;
const FLOOR = 456; // screen y of the ground line
const MAX_BACKING_WIDTH = 1600;

/** Per-sheet draw scale so the cast reads at a consistent size. */
const DRAW_SCALE = { heroine: 1.4, knight: 0.84, rogue: 0.8, warlord: 1.34, trap: 0.9, fx: 1.35 };
const KIND_COLOR = ['#ff5a5f', '#7fe8ff', '#ff2a3a', '#ff7a1a'];
const RIM = [[-1.5, 0], [1.5, 0], [0, 1.5], [0, -1.5]];

export class Renderer {
  constructor(canvas, assets, layout) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.FS = layout.fighterStates;
    this.AK = layout.attackKinds;
    this.TP = layout.trapPhases;
    this.EK = layout.enemyKinds;
    this.intentNames = Object.fromEntries(Object.entries(layout.intents).map(([k, v]) => [v, k]));
    this.attackNames = Object.fromEntries(Object.entries(layout.attackKinds).map(([k, v]) => [v, k]));
    this.arenaW = layout.tuning.arenaWidth;
    this.cam = { x: (this.arenaW - VIEW_W) / 2, trauma: 0, punch: 0 };
    this.fx = new Particles();
    this.trail = [];
    this.flashHurt = 0;
    this.flashWhite = 0;
    this.portal = [0, 0];
    this.time = 0;
    this.vision = false;
    this.#buildBackdrop();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const q = new URLSearchParams(location.search);
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    // Cap the backing store: the compositor upscales far cheaper than we can fill pixels.
    this.cap ??= Number(q.get('max')) || MAX_BACKING_WIDTH;
    const cap = this.cap;
    const scale = Math.min(dpr, cap / Math.max(1, rect.width));
    const w = Math.max(1, Math.round(rect.width * scale));
    const h = Math.max(1, Math.round(rect.height * scale));
    this.quality = q.get('q') || 'medium'; // sprites; big surfaces always use 'low'
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.sx = w / VIEW_W;
    this.sy = h / VIEW_H;
  }

  /** Lower the render resolution one step (called when frames run long). */
  degrade() {
    if (this.cap <= 960) return false;
    this.cap = this.cap > 1280 ? 1280 : 960;
    this.resize();
    return true;
  }

  shake(amount) {
    this.cam.trauma = Math.min(1, this.cam.trauma + amount);
  }

  /** World (x right, y up) -> logical screen coordinates. */
  toScreen = (x, y) => [x - this.cam.x, FLOOR - y];

  // ------------------------------------------------------------------ frame

  draw(snap, dt, { paused = false } = {}) {
    const ctx = this.ctx;
    this.lastDt = paused ? 0 : dt;
    if (!paused) {
      this.time += dt;
      this.fx.update(dt * (snap.timeScale < 1 ? 0.6 : 1));
      this.#ambient(dt);
    }
    this.#updateCamera(snap, paused ? 0 : dt);

    ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    this.#drawBackdrop(ctx);

    // World layer, with screen shake.
    const t = this.cam.trauma * this.cam.trauma;
    const ox = t * 14 * Math.sin(this.time * 71.3);
    const oy = t * 10 * Math.sin(this.time * 53.7 + 1.3);
    ctx.save();
    ctx.translate(ox, oy);
    if (this.cam.punch > 0) {
      const z = 1 + this.cam.punch * 0.035;
      ctx.translate(VIEW_W / 2, FLOOR - 80);
      ctx.scale(z, z);
      ctx.translate(-VIEW_W / 2, -(FLOOR - 80));
    }

    this.#drawGround(ctx);
    ctx.imageSmoothingQuality = this.quality;
    this.#drawGates(ctx);
    for (const trap of snap.traps) this.#drawTrap(ctx, trap);
    for (const pk of snap.pickups) this.#drawPickup(ctx, pk);

    const p = snap.player;
    for (const e of snap.enemies) {
      const r = e.kind === this.EK.Warlord ? 48 : 30 * e.scale;
      this.#shadow(ctx, e.x, e.y, r, e.state === this.FS.Dead ? 1 - e.deathTimer / this.#linger(e) : 1);
    }
    this.#shadow(ctx, p.x, p.y, 26, 1);

    for (const e of snap.enemies) if (e.state === this.FS.Dead) this.#drawEnemy(ctx, e);
    for (const e of snap.enemies) if (e.state !== this.FS.Dead) this.#drawEnemy(ctx, e);
    this.#drawPlayer(ctx, p, paused ? 0 : dt);
    for (const pr of snap.projectiles) this.#drawProjectile(ctx, pr, paused ? 0 : dt);

    this.fx.draw(ctx, this.toScreen);
    if (this.vision) this.#drawVision(ctx, snap);
    ctx.restore();

    ctx.imageSmoothingQuality = 'low';
    this.#drawOffscreen(ctx, snap);
    this.#drawScreenFx(ctx, snap, paused ? 0 : dt);
  }

  #updateCamera(snap, dt) {
    const p = snap.player;
    const lead = p.facing * 70 + p.vx * 0.18;
    const target = Math.max(0, Math.min(this.arenaW - VIEW_W, p.x - VIEW_W / 2 + lead));
    this.cam.x += (target - this.cam.x) * Math.min(1, dt * 4.5);
    this.cam.trauma = Math.max(0, this.cam.trauma - dt * 1.6);
    this.cam.punch = Math.max(0, this.cam.punch - dt * 6);
  }

  // ------------------------------------------------------------------ sprites

  #sprite(ctx, name, frameIndex, x, y, facing, o = {}) {
    const sheet = this.assets.sheets[name];
    const f = sheet.frames[frameIndex];
    if (!f) return;
    const s = DRAW_SCALE[name] * (o.scale ?? 1);
    const [sx, sy] = this.toScreen(x, y);
    const flip = facing * sheet.facing < 0;
    ctx.save();
    ctx.translate(sx, sy + (o.bob ?? 0));
    if (o.rot) ctx.rotate(o.rot);
    if (flip) ctx.scale(-1, 1);
    if (o.composite) ctx.globalCompositeOperation = o.composite;
    const dx = -f.ax * s;
    const dy = -f.ay * s;
    const dw = f.w * s;
    const dh = f.h * s;
    const alpha = o.alpha ?? 1;
    if (!o.only) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(sheet.img, f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    }
    for (const [tint, a] of o.tints ?? []) {
      if (a <= 0.01) continue;
      ctx.globalAlpha = alpha * Math.min(1, a);
      ctx.drawImage(sheet[tint], f.x, f.y, f.w, f.h, dx, dy, dw, dh);
    }
    ctx.restore();
  }

  #shadow(ctx, x, y, r, alpha) {
    const [sx] = this.toScreen(x, 0);
    const k = Math.max(0.35, 1 - y / 260);
    ctx.globalAlpha = 0.45 * alpha * k;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(sx, FLOOR + 3, r * k, 6 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  #heroFrame(p) {
    const A = this.assets.sheets.heroine.animations;
    const FS = this.FS;
    const AK = this.AK;
    const t = p.stateTime;
    switch (p.state) {
      case FS.Walk:
        return loop(A.walk, t, 11);
      case FS.Run:
        return loop(A.run, t, 14);
      case FS.Jump:
        return once(A.jump, t, 12);
      case FS.Fall:
        return once(A.fall, t, 12);
      case FS.Attack: {
        const anim = p.attack === AK.Heavy ? A.heavy : p.attack === AK.Light2 || p.attack === AK.Special ? A.attack2 : A.attack1;
        return phaseFrame(anim, p.attackPhase, p.phaseT);
      }
      case FS.Hurt:
        return once(A.hurt, t, 14);
      case FS.Dead:
        return once(A.death, t, 9);
      case FS.Dash:
        return A.run[2];
      default:
        return loop(A.idle, t, 8);
    }
  }

  #drawPlayer(ctx, p, dt) {
    const FS = this.FS;
    const frame = this.#heroFrame(p);

    // Dash afterimages.
    if (p.state === FS.Dash && dt > 0) this.trail.push({ x: p.x, y: p.y, frame, facing: p.facing, life: 0.22 });
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const g = this.trail[i];
      g.life -= dt;
      if (g.life <= 0) {
        this.trail.splice(i, 1);
        continue;
      }
      this.#sprite(ctx, 'heroine', g.frame, g.x, g.y, g.facing, { only: true, tints: [['cyan', (g.life / 0.22) * 0.55]] });
    }

    // Special ready: a crimson aura.
    if (p.rage >= 50 && p.state !== FS.Dead) {
      const [sx, sy] = this.toScreen(p.x, p.y + 50);
      const pulse = 0.55 + 0.25 * Math.sin(this.time * 6);
      const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 70);
      g.addColorStop(0, `rgba(255,70,90,${0.28 * pulse})`);
      g.addColorStop(1, 'rgba(255,40,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 70, sy - 70, 140, 140);
    }

    const blink = p.invuln > 0 && p.state !== FS.Dash && p.state !== FS.Dead && Math.floor(this.time * 18) % 2 === 0;
    // Rim light so the heroine always reads against the dark arena.
    if (!blink) {
      for (const [ox, oy] of RIM) this.#sprite(ctx, 'heroine', frame, p.x + ox, p.y + oy, p.facing, { only: true, tints: [['white', 0.22]] });
    }
    this.#sprite(ctx, 'heroine', frame, p.x, p.y, p.facing, {
      alpha: blink ? 0.45 : 1,
      tints: [
        ['white', p.flash / 0.2],
        ['cyan', p.state === FS.Dash ? 0.35 : 0]
      ]
    });

    // Slash arc on the active frames.
    if (p.state === FS.Attack && p.attackPhase === 1 && p.attack !== this.AK.Special) {
      const heavy = p.attack === this.AK.Heavy;
      const reach = heavy ? 108 : p.attack === this.AK.Light2 ? 88 : 80;
      const [sx, sy] = this.toScreen(p.x + p.facing * reach * 0.45, p.y + 42);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(p.facing, 1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * (1 - p.phaseT * 0.6);
      const r = reach * 0.62;
      const start = heavy ? -2.3 : p.attack === this.AK.Light2 ? -0.5 : -1.7;
      const sweep = heavy ? 2.9 : 2.1;
      const a0 = start + sweep * Math.max(0, p.phaseT - 0.35);
      const a1 = start + sweep * Math.min(1, p.phaseT + 0.45);
      const grad = ctx.createLinearGradient(-r, 0, r, 0);
      grad.addColorStop(0, 'rgba(255,90,110,0)');
      grad.addColorStop(1, heavy ? 'rgba(255,200,120,0.95)' : 'rgba(255,220,230,0.95)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = heavy ? 9 : 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(0, 0, r, a0, a1);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(0, 0, r, a0 + (a1 - a0) * 0.4, a1);
      ctx.stroke();
      ctx.restore();
    }
  }

  #knightFrame(e) {
    const A = this.assets.sheets.knight.animations;
    const AK = this.AK;
    if (e.state === this.FS.Attack) {
      const ph = e.attackPhase;
      const t = e.phaseT;
      if (e.attack === AK.KnightSlash) return ph === 0 ? A.slash[t < 0.5 ? 0 : 1] : ph === 1 ? A.slash[2] : t < 0.55 ? A.slash[2] : A.idle[0];
      if (e.attack === AK.KnightOverhead) return ph === 0 ? A.overhead[0] : ph === 1 ? A.overhead[t < 0.4 ? 1 : 2] : t < 0.6 ? A.overhead[2] : A.idle[0];
      if (e.attack === AK.KnightLunge) return ph === 0 ? A.lunge[0] : ph === 1 ? A.lunge[1] : A.lunge[2];
    }
    return loop(A.idle, e.stateTime, e.state === this.FS.Walk ? 9 : 5);
  }

  #rogueFrame(e) {
    const A = this.assets.sheets.rogue.animations;
    const FS = this.FS;
    if (e.state === FS.Attack) {
      if (e.attackPhase === 0) return A.throw[Math.min(2, Math.floor(e.phaseT * 3))];
      if (e.attackPhase === 1) return A.throw[4];
      return A.recover[Math.min(1, Math.floor(e.phaseT * 2))];
    }
    if (e.state === FS.Stagger || e.state === FS.Hurt || e.state === FS.Dead) return A.recover[0];
    if (e.state === FS.Fall || e.y > 1) return A.run[3];
    if (e.state === FS.Walk) return Math.abs(e.vx) > 140 ? loop(A.run, e.stateTime, 14) : loop(A.walk, e.stateTime, 10);
    return loop(A.idle, e.stateTime, 6);
  }

  #linger(e) {
    return e.kind === this.EK.Warlord ? 2.4 : 1.6; // matches World.DeathLinger
  }

  /** The Main Boss: idle / walk / 10-frame greatsword attack / 10-frame burning death. */
  #warlordFrame(e) {
    const A = this.assets.sheets.warlord.animations;
    const FS = this.FS;
    const H = A.heavy;
    if (e.state === FS.Dead) return once(A.death, e.deathTimer, 4.6);
    if (e.state === FS.Attack) {
      const t = Math.max(0, Math.min(0.999, e.phaseT));
      if (e.attack === this.AK.WarlordSlam) {
        if (e.attackPhase === 0) return [H[0], H[1], H[3]][Math.floor(t * 3)];
        if (e.attackPhase === 1) return t < 0.5 ? H[7] : H[8];
        return t < 0.5 ? H[8] : H[9];
      }
      if (e.attackPhase === 0) return H[Math.floor(t * 4)];
      if (e.attackPhase === 1) return t < 0.5 ? H[4] : H[5];
      return t < 0.45 ? H[6] : H[9];
    }
    if (e.state === FS.Walk) return loop(A.walk, e.stateTime, 9);
    return loop(A.idle, e.stateTime, 6);
  }

  #drawEnemy(ctx, e) {
    const FS = this.FS;
    const rogue = e.kind === this.EK.Rogue;
    const warlord = e.kind === this.EK.Warlord;
    const boss = e.kind === this.EK.Boss || warlord;
    const sheet = rogue ? 'rogue' : warlord ? 'warlord' : 'knight';
    const frame = rogue ? this.#rogueFrame(e) : warlord ? this.#warlordFrame(e) : this.#knightFrame(e);
    const dead = e.state === FS.Dead;
    const spawning = e.state === FS.Spawn;
    let alpha = 1;
    let rot = 0;
    let bob = 0;
    const tints = [['white', e.flash / 0.12]];

    if (dead && warlord) {
      // Its own death animation burns it away; just fade the last embers.
      alpha = Math.min(1, (2.4 - e.deathTimer) / 0.35);
    } else if (dead) {
      const k = Math.min(1, e.deathTimer / 1.6);
      alpha = 1 - k * k;
      rot = -e.facing * Math.min(1, e.deathTimer * 2.2) * 0.35;
      tints.push(['red', 0.5 * (1 - k)]);
    } else if (spawning) {
      const k = e.stateDuration > 0 ? e.stateTime / e.stateDuration : 1;
      alpha = k;
      tints.push(['red', 1 - k]);
    } else if (e.state === FS.Stagger) {
      rot = Math.sin(this.time * 30) * 0.05;
    } else if (e.state === FS.Walk && !rogue) {
      bob = -Math.abs(Math.sin(e.stateTime * 9)) * 3;
    }

    // Telegraph: glow red while winding up, so attacks can be read and dodged.
    if (e.state === FS.Attack && e.attackPhase === 0) {
      tints.push(['red', 0.15 + 0.55 * e.phaseT * (0.75 + 0.25 * Math.sin(this.time * 40))]);
    }

    if (boss && !dead) {
      const r = warlord ? 190 : 140;
      const [sx, sy] = this.toScreen(e.x, e.y + (warlord ? 90 : 80));
      const pulse = e.enraged ? 0.7 + 0.3 * Math.sin(this.time * 9) : 0.5;
      const g = ctx.createRadialGradient(sx, sy, 10, sx, sy, r);
      g.addColorStop(0, warlord ? `rgba(255,90,20,${0.34 * pulse})` : `rgba(255,30,50,${0.32 * pulse})`);
      g.addColorStop(1, 'rgba(255,0,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      if (!warlord) tints.push(['red', e.enraged ? 0.2 + 0.12 * Math.sin(this.time * 9) : 0.1]);
      else if (e.enraged) tints.push(['red', 0.12 + 0.1 * Math.sin(this.time * 9)]);
      // The Warlord smoulders.
      if (warlord && this.lastDt > 0 && Math.random() < this.lastDt * (e.enraged ? 30 : 14)) {
        this.fx.add({ type: 'ember', x: e.x + (Math.random() - 0.5) * 70, y: e.y + 20 + Math.random() * 120, vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60, life: 0.9 + Math.random() * 0.6, size: 1.5 + Math.random() * 1.5, color: Math.random() < 0.5 ? '#ff7a1a' : '#ff3d2a' });
      }
    }

    this.#sprite(ctx, sheet, frame, e.x, e.y, e.facing, { scale: e.scale, alpha, rot, bob, tints });

    if (spawning) {
      const [sx, sy] = this.toScreen(e.x, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 1 - e.stateTime / Math.max(0.01, e.stateDuration);
      ctx.fillStyle = 'rgba(255,40,80,0.5)';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 50 * e.scale, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    if (dead || spawning) return;
    const top = warlord ? 196 : (rogue ? 108 : 128) * e.scale;

    // Heavy attacks get an explicit "!" so they can be learned.
    if (e.state === FS.Attack && e.attackPhase === 0 && (e.attack === this.AK.KnightOverhead || e.attack === this.AK.KnightLunge || e.attack === this.AK.WarlordSlam)) {
      const [sx, sy] = this.toScreen(e.x, e.y + top + 18);
      ctx.font = "900 26px 'Cinzel', Georgia, serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText('!', sx, sy);
      ctx.fillStyle = e.phaseT > 0.6 ? '#fff' : '#ffcc4d';
      ctx.fillText('!', sx, sy);
    }

    if (e.state === FS.Stagger) {
      const [sx, sy] = this.toScreen(e.x, e.y + top + 6);
      ctx.fillStyle = '#ffd76a';
      for (let i = 0; i < 3; i++) {
        const a = this.time * 7 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * 16, sy + Math.sin(a) * 5, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (!boss && e.hp < e.maxHp) {
      const [sx, sy] = this.toScreen(e.x, e.y + top);
      const w = 44;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, 6);
      ctx.fillStyle = KIND_COLOR[e.kind];
      ctx.fillRect(sx - w / 2, sy, w * Math.max(0, e.hp / e.maxHp), 4);
    }
  }

  #drawProjectile(ctx, pr, dt) {
    const dir = pr.vx >= 0 ? 1 : -1;
    if (pr.kind === 2) {
      // Warlord shockwave: a wall of fire rolling along the floor.
      const [sx] = this.toScreen(pr.x, 0);
      const fade = Math.min(1, pr.life * 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const h = 46 - i * 12 + Math.sin(this.time * 30 + i) * 5;
        const w = 30 - i * 6;
        const g = ctx.createLinearGradient(0, FLOOR - h, 0, FLOOR);
        g.addColorStop(0, 'rgba(255,200,80,0)');
        g.addColorStop(0.4, `rgba(255,120,30,${0.55 * fade})`);
        g.addColorStop(1, `rgba(255,40,20,${0.85 * fade})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(sx - dir * w * 1.6, FLOOR);
        ctx.quadraticCurveTo(sx - dir * w * 0.4, FLOOR - h * 0.9, sx + dir * w * 0.2, FLOOR - h);
        ctx.quadraticCurveTo(sx + dir * w * 0.7, FLOOR - h * 0.4, sx + dir * w, FLOOR);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      if (dt > 0) {
        this.fx.add({ type: 'spark', x: pr.x, y: 6 + Math.random() * 20, vx: -dir * (60 + Math.random() * 120), vy: 120 + Math.random() * 200, grav: 700, life: 0.4, size: 2, color: Math.random() < 0.5 ? '#ffb347' : '#ff5a2a' });
        if (Math.random() < 0.5) this.fx.add({ type: 'smoke', x: pr.x - dir * 20, y: 10, vx: -dir * 30, vy: 30, life: 0.6, size: 8, color: '#3a1410', alpha: 0.5 });
      }
      return;
    }
    if (pr.kind === 0) {
      const A = this.assets.sheets.fx.animations.crescent;
      const frame = A[Math.floor(this.time * 14) % A.length];
      this.#sprite(ctx, 'fx', frame, pr.x, pr.y - 42, dir, { composite: 'lighter', alpha: Math.min(1, pr.life * 4) });
      if (dt > 0 && Math.random() < 0.8) {
        this.fx.add({ type: 'spark', x: pr.x - dir * 20, y: pr.y + (Math.random() - 0.5) * 60, vx: -dir * 200, vy: (Math.random() - 0.5) * 60, color: '#ff6b7a', life: 0.25, size: 2 });
      }
      return;
    }
    const [sx, sy] = this.toScreen(pr.x, pr.y);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(dir, 1);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(-40, 0, 14, 0);
    g.addColorStop(0, 'rgba(127,232,255,0)');
    g.addColorStop(1, 'rgba(127,232,255,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(-40, -3, 50, 6);
    ctx.fillStyle = '#dff9ff';
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(2, -4);
    ctx.lineTo(-8, 0);
    ctx.lineTo(2, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  #drawPickup(ctx, pk) {
    const bob = Math.sin(this.time * 4 + pk.id) * 4;
    const [sx, sy] = this.toScreen(pk.x, pk.y + 12 + bob);
    if (pk.life < 3 && Math.floor(this.time * 10) % 2 === 0) return;
    const color = pk.kind === 0 ? ['#ff6b7a', '#ff2a3a'] : ['#ffe08a', '#ffb020'];
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, sy, 2, sx, sy, 26);
    g.addColorStop(0, color[0]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 26, sy - 26, 52, 52);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = color[1];
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (pk.kind === 0) {
      // Heart
      ctx.moveTo(sx, sy + 7);
      ctx.bezierCurveTo(sx - 12, sy - 2, sx - 7, sy - 12, sx, sy - 5);
      ctx.bezierCurveTo(sx + 7, sy - 12, sx + 12, sy - 2, sx, sy + 7);
    } else {
      // Rage crystal
      ctx.moveTo(sx, sy - 10);
      ctx.lineTo(sx + 7, sy);
      ctx.lineTo(sx, sy + 10);
      ctx.lineTo(sx - 7, sy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  #drawTrap(ctx, t) {
    const A = this.assets.sheets.trap.animations;
    const TP = this.TP;
    const k = t.phaseDuration > 0 ? Math.min(0.999, t.phaseTime / t.phaseDuration) : 0;
    let frame;
    switch (t.phase) {
      case TP.Charge:
        frame = loop(A.charge, t.phaseTime, 10);
        break;
      case TP.Rise:
        frame = A.rise[Math.floor(k * A.rise.length)];
        break;
      case TP.Full:
        frame = loop(A.full, t.phaseTime, 10);
        break;
      case TP.Retract:
        frame = A.retract[Math.floor(k * A.retract.length)];
        break;
      default:
        frame = loop(A.idle, this.time + t.x, 4);
    }
    // Warning glow on the floor while charging / armed.
    if (t.phase !== TP.Idle && t.phase !== TP.Retract) {
      const [sx] = this.toScreen(t.x, 0);
      const pulse = t.phase === TP.Charge ? 0.35 + 0.35 * Math.sin(this.time * 24) * k + 0.3 * k : 0.75;
      const g = ctx.createRadialGradient(sx, FLOOR, 4, sx, FLOOR, t.halfWidth * 1.6);
      g.addColorStop(0, `rgba(255,50,40,${0.55 * pulse})`);
      g.addColorStop(1, 'rgba(255,30,30,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(sx - t.halfWidth * 1.6, FLOOR - 50, t.halfWidth * 3.2, 70);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Sunk into the floor: only the lid and the spikes show above ground.
    ctx.save();
    ctx.beginPath();
    ctx.rect(-50, -50, VIEW_W + 100, FLOOR + 53);
    ctx.clip();
    this.#sprite(ctx, 'trap', frame, t.x, -34, 1);
    ctx.restore();
  }

  // ------------------------------------------------------------------ backdrop

  #buildBackdrop() {
    const rand = mulberry32(1337);
    const span = this.arenaW - VIEW_W;

    // Sky
    this.sky = layer(VIEW_W, VIEW_H, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#07050d');
      grad.addColorStop(0.45, '#170a1c');
      grad.addColorStop(0.72, '#3a0f22');
      grad.addColorStop(0.86, '#5c1a26');
      grad.addColorStop(1, '#1a0a10');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 140; i++) {
        const y = rand() * h * 0.55;
        g.globalAlpha = 0.2 + rand() * 0.6 * (1 - y / (h * 0.55));
        g.fillStyle = rand() < 0.15 ? '#ffd2dc' : '#ffffff';
        g.fillRect(rand() * w, y, rand() < 0.1 ? 2 : 1, rand() < 0.1 ? 2 : 1);
      }
      g.globalAlpha = 1;
    });

    // Blood moon (with its glow), 380x380 centred on the disc
    this.moon = layer(380, 380, (g) => {
      const c = 190;
      const glow = g.createRadialGradient(c, c, 30, c, c, 190);
      glow.addColorStop(0, 'rgba(255,90,90,0.35)');
      glow.addColorStop(1, 'rgba(255,40,60,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, 380, 380);
      const disc = g.createRadialGradient(c - 14, c - 14, 6, c, c, 56);
      disc.addColorStop(0, '#ffd0c4');
      disc.addColorStop(0.55, '#ff7a6a');
      disc.addColorStop(1, '#b8283a');
      g.fillStyle = disc;
      g.beginPath();
      g.arc(c, c, 54, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(120,20,40,0.25)';
      g.beginPath();
      g.arc(c + 16, c + 8, 12, 0, Math.PI * 2);
      g.arc(c - 20, c + 18, 7, 0, Math.PI * 2);
      g.fill();
    });

    this.vignette = layer(VIEW_W, VIEW_H, (g, w, h) => {
      const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = v;
      g.fillRect(0, 0, w, h);
    });

    // Far mountains
    this.far = layer(Math.ceil(VIEW_W + span * 0.12), VIEW_H, (g, w) => {
      const pts = ridge(w, 34, 300, 360, rand);
      const grad = g.createLinearGradient(0, 280, 0, FLOOR);
      grad.addColorStop(0, '#2a1024');
      grad.addColorStop(1, '#170a18');
      g.fillStyle = grad;
      poly(g, pts, w, VIEW_H);
      g.strokeStyle = 'rgba(255,90,110,0.18)';
      g.lineWidth = 1.5;
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
    });

    // Castle ruins
    this.mid = layer(Math.ceil(VIEW_W + span * 0.3), VIEW_H, (g, w) => {
      g.fillStyle = '#12081a';
      const base = FLOOR - 26;
      let x = 20;
      while (x < w) {
        const tw = 40 + rand() * 50;
        const th = 90 + rand() * 170;
        const top = base - th;
        g.fillRect(x, top, tw, th + 40);
        // Spire
        g.beginPath();
        g.moveTo(x - 6, top);
        g.lineTo(x + tw / 2, top - 30 - rand() * 60);
        g.lineTo(x + tw + 6, top);
        g.closePath();
        g.fill();
        // Lit windows
        for (let wy = top + 20; wy < base - 20; wy += 34) {
          if (rand() < 0.45) {
            g.fillStyle = rand() < 0.5 ? 'rgba(255,120,60,0.55)' : 'rgba(255,70,80,0.4)';
            g.fillRect(x + tw / 2 - 3, wy, 6, 12);
            g.fillStyle = '#12081a';
          }
        }
        // Wall with battlements to the next tower
        const gap = 60 + rand() * 140;
        const wallH = 40 + rand() * 50;
        g.fillRect(x + tw, base - wallH, gap, wallH + 40);
        for (let bx = x + tw + 4; bx < x + tw + gap - 8; bx += 16) g.fillRect(bx, base - wallH - 8, 9, 8);
        // Arches
        g.fillStyle = '#1d0c22';
        for (let ax = x + tw + 12; ax < x + tw + gap - 26; ax += 30) {
          g.beginPath();
          g.moveTo(ax, base);
          g.lineTo(ax, base - wallH * 0.55);
          g.arc(ax + 9, base - wallH * 0.55, 9, Math.PI, 0);
          g.lineTo(ax + 18, base);
          g.fill();
        }
        g.fillStyle = '#12081a';
        x += tw + gap;
      }
    });

    // Near silhouettes: dead trees and broken columns
    this.near = layer(Math.ceil(VIEW_W + span * 0.6), VIEW_H, (g, w) => {
      g.fillStyle = '#0a0510';
      g.strokeStyle = '#0a0510';
      let x = 60 + rand() * 80;
      while (x < w) {
        if (rand() < 0.55) tree(g, x, FLOOR - 8, 90 + rand() * 80, rand);
        else {
          const cw = 22 + rand() * 12;
          const ch = 60 + rand() * 110;
          g.fillRect(x, FLOOR - 8 - ch, cw, ch);
          g.fillRect(x - 5, FLOOR - 8 - ch, cw + 10, 8);
          g.beginPath();
          g.moveTo(x, FLOOR - 8 - ch);
          g.lineTo(x + cw * 0.3, FLOOR - 8 - ch - 14 * rand());
          g.lineTo(x + cw * 0.7, FLOOR - 8 - ch - 4);
          g.lineTo(x + cw, FLOOR - 8 - ch - 18 * rand());
          g.lineTo(x + cw, FLOOR - 8 - ch);
          g.fill();
        }
        x += 180 + rand() * 260;
      }
    });
  }

  #drawBackdrop(ctx) {
    const cx = this.cam.x;
    ctx.drawImage(this.sky, 0, 0);

    ctx.drawImage(this.moon, 700 - cx * 0.04 - 190, 118 - 190);

    ctx.drawImage(this.far, -cx * 0.12, 0);
    this.#fog(ctx, 0.1, 330, 'rgba(150,40,80,0.10)');
    ctx.drawImage(this.mid, -cx * 0.3, 0);
    this.#fog(ctx, 0.3, 390, 'rgba(120,40,90,0.14)');
    ctx.drawImage(this.near, -cx * 0.6, 0);
  }

  #fog(ctx, speed, y, color) {
    const drift = (this.time * 12 * (1 + speed) + this.cam.x * speed) % 480;
    ctx.fillStyle = color;
    for (let i = -1; i < 4; i++) {
      const x = i * 480 - drift;
      ctx.beginPath();
      ctx.ellipse(x + 240, y, 320, 38, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  #drawGround(ctx) {
    const gr = this.assets.ground;
    const top = FLOOR - gr.surface;
    const start = Math.floor(this.cam.x / gr.width) * gr.width - gr.width;
    for (let x = start; x < this.cam.x + VIEW_W + gr.width; x += gr.width) {
      ctx.drawImage(gr.img, x - this.cam.x, top);
    }
    if (top + gr.height < VIEW_H + 20) {
      ctx.fillStyle = '#0b0609';
      ctx.fillRect(-20, top + gr.height - 1, VIEW_W + 40, VIEW_H);
    }
    // Soft light pool over the arena floor
    const g = ctx.createLinearGradient(0, FLOOR - 6, 0, FLOOR + 40);
    g.addColorStop(0, 'rgba(255,80,90,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-20, FLOOR - 6, VIEW_W + 40, 46);
  }

  #drawGates(ctx) {
    for (const side of [0, 1]) {
      const wx = side === 0 ? 0 : this.arenaW;
      const [sx] = this.toScreen(wx, 0);
      if (sx < -200 || sx > VIEW_W + 200) continue;
      const dir = side === 0 ? 1 : -1;
      // Pillar
      ctx.fillStyle = '#0d0710';
      ctx.fillRect(sx - (side === 0 ? 40 : -4) - 4, FLOOR - 330, 44, 340);
      ctx.fillStyle = '#1b0e1f';
      ctx.fillRect(sx - (side === 0 ? 40 : -4), FLOOR - 340, 36, 12);
      // Portal
      const px = sx + dir * 80;
      const glow = 0.35 + this.portal[side] * 0.9 + Math.sin(this.time * 3 + side) * 0.08;
      const g = ctx.createRadialGradient(px, FLOOR - 60, 4, px, FLOOR - 60, 90);
      g.addColorStop(0, `rgba(255,60,90,${0.55 * glow})`);
      g.addColorStop(0.5, `rgba(140,20,70,${0.35 * glow})`);
      g.addColorStop(1, 'rgba(60,0,40,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(px, FLOOR - 60, 46, 90, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = `rgba(255,120,150,${0.35 * glow})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(px, FLOOR - 60, 34 + Math.sin(this.time * 4) * 3, 78, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    this.portal[0] = Math.max(0, this.portal[0] - 0.02);
    this.portal[1] = Math.max(0, this.portal[1] - 0.02);
  }

  #ambient(dt) {
    // Drifting embers
    if (Math.random() < dt * 14) {
      this.fx.add({
        type: 'ember',
        x: this.cam.x + Math.random() * VIEW_W,
        y: -10,
        vx: 10 + Math.random() * 20,
        vy: 30 + Math.random() * 50,
        life: 4 + Math.random() * 4,
        size: 1 + Math.random() * 1.6,
        color: Math.random() < 0.5 ? '#ff7043' : '#ff3d5a',
        alpha: 0.7
      });
    }
  }

  // ------------------------------------------------------------------ overlays

  #drawOffscreen(ctx, snap) {
    for (const e of snap.enemies) {
      if (e.state === this.FS.Dead) continue;
      const [sx] = this.toScreen(e.x, 0);
      if (sx >= -10 && sx <= VIEW_W + 10) continue;
      const left = sx < 0;
      const x = left ? 18 : VIEW_W - 18;
      const y = FLOOR - 60;
      ctx.fillStyle = KIND_COLOR[e.kind];
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x + (left ? -8 : 8), y);
      ctx.lineTo(x + (left ? 6 : -6), y - 10);
      ctx.lineTo(x + (left ? 6 : -6), y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  #drawScreenFx(ctx, snap, dt) {
    const p = snap.player;
    ctx.drawImage(this.vignette, 0, 0);

    // Slow motion: desaturate + violet wash.
    if (snap.timeScale < 0.99) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'rgba(128,128,128,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(60,20,90,0.14)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // Low health heartbeat, damage flash.
    const low = p.maxHp > 0 && p.hp / p.maxHp < 0.3 && p.hp > 0 ? 0.25 + 0.2 * Math.sin(this.time * 7) : 0;
    const hurt = Math.max(this.flashHurt, low);
    if (hurt > 0.01) {
      const g = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.3, VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.9);
      g.addColorStop(0, 'rgba(255,0,30,0)');
      g.addColorStop(1, `rgba(200,0,30,${Math.min(0.6, hurt)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    if (this.flashWhite > 0.01) {
      ctx.fillStyle = `rgba(255,240,245,${this.flashWhite * 0.5})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }
    this.flashHurt = Math.max(0, this.flashHurt - dt * 2.2);
    this.flashWhite = Math.max(0, this.flashWhite - dt * 4);
  }

  #drawVision(ctx, snap) {
    ctx.font = "600 11px 'Inter', system-ui, sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of snap.traps) {
      const [sx] = this.toScreen(t.x, 0);
      ctx.strokeStyle = t.phase === this.TP.Idle ? 'rgba(255,255,255,.25)' : 'rgba(255,60,60,.9)';
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(sx - t.halfWidth, FLOOR - 30, t.halfWidth * 2, 30);
      ctx.setLineDash([]);
    }
    for (const e of snap.enemies) {
      if (e.state === this.FS.Dead) continue;
      const [sx, sy] = this.toScreen(e.x, e.y);
      const h = e.kind === this.EK.Rogue ? 82 : e.kind === this.EK.Boss ? 135 : e.kind === this.EK.Warlord ? 150 : 100;
      const hw = e.kind === this.EK.Rogue ? 17 : e.kind === this.EK.Boss ? 34 : e.kind === this.EK.Warlord ? 36 : 24;
      ctx.strokeStyle = 'rgba(127,232,255,.7)';
      ctx.strokeRect(sx - hw, sy - h, hw * 2, h);
      const label =
        e.state === this.FS.Attack ? `Attack ${this.attackNames[e.attack] ?? ''}`
        : e.state === this.FS.Stagger ? 'Staggered'
        : e.state === this.FS.Spawn ? 'Spawning'
        : this.intentNames[e.intent] ?? '?';
      const text = `${label.replace(/([a-z])([A-Z])/g, '$1 $2').replace('Knight ', '').replace('Rogue ', '').toUpperCase()}${e.hasToken ? ' ◆' : ''}`;
      const w = ctx.measureText(text).width + 12;
      const y = sy - h - 28;
      ctx.fillStyle = e.hasToken ? 'rgba(255,90,95,.92)' : 'rgba(10,10,20,.8)';
      roundRect(ctx, sx - w / 2, y - 9, w, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(text, sx, y);
    }
    const [px, py] = this.toScreen(snap.player.x, snap.player.y);
    ctx.strokeStyle = 'rgba(120,255,160,.8)';
    ctx.strokeRect(px - 18, py - 78, 36, 78);
  }
}

// ------------------------------------------------------------------ helpers

function loop(frames, t, fps) {
  return frames[Math.floor(Math.max(0, t) * fps) % frames.length];
}

function once(frames, t, fps) {
  return frames[Math.min(frames.length - 1, Math.floor(Math.max(0, t) * fps))];
}

/** Map an attack's windup / active / recovery phase onto its animation frames. */
function phaseFrame(frames, phase, t) {
  const n = frames.length;
  const w = Math.max(1, Math.round(n * 0.35));
  const a = Math.max(1, Math.min(2, n - w - 1));
  const r = Math.max(1, n - w - a);
  const k = Math.max(0, Math.min(0.999, t));
  if (phase === 0) return frames[Math.floor(k * w)];
  if (phase === 1) return frames[w + Math.floor(k * a)];
  return frames[Math.min(n - 1, w + a + Math.floor(k * r))];
}

function layer(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  return c;
}

function ridge(w, step, minY, maxY, rand) {
  const pts = [];
  let y = (minY + maxY) / 2;
  for (let x = -step; x <= w + step; x += step) {
    y = Math.max(minY - 60, Math.min(maxY, y + (rand() - 0.5) * 70));
    pts.push([x, y]);
  }
  return pts;
}

function poly(g, pts, w, h) {
  g.beginPath();
  g.moveTo(-10, h);
  for (const [x, y] of pts) g.lineTo(x, y);
  g.lineTo(w + 10, h);
  g.closePath();
  g.fill();
}

function tree(g, x, base, height, rand) {
  g.lineCap = 'round';
  const branch = (x0, y0, len, angle, width, depth) => {
    const x1 = x0 + Math.cos(angle) * len;
    const y1 = y0 - Math.sin(angle) * len;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    if (depth <= 0) return;
    const n = 2 + (rand() < 0.3 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      branch(x1, y1, len * (0.55 + rand() * 0.2), angle + (rand() - 0.5) * 1.3, width * 0.62, depth - 1);
    }
  };
  branch(x, base, height * 0.45, Math.PI / 2 + (rand() - 0.5) * 0.2, 9, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
