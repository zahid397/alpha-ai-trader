// Lightweight particle + floating-text system, in world coordinates
// (x right, y up from the floor) so effects stay put as the camera moves.

const MAX_PARTICLES = 700;

export class Particles {
  constructor() {
    this.list = [];
    this.texts = [];
  }

  add(p) {
    if (this.list.length >= MAX_PARTICLES) this.list.shift();
    p.life ??= 0.5;
    p.max = p.life;
    p.vx ??= 0;
    p.vy ??= 0;
    p.grav ??= 0;
    p.drag ??= 0;
    p.size ??= 3;
    p.type ??= 'dot';
    this.list.push(p);
    return p;
  }

  burst(x, y, n, make) {
    for (let i = 0; i < n; i++) this.add(make(i));
  }

  text(x, y, text, { color = '#fff', size = 22, life = 0.9, vy = 70, weight = 800, stroke = 'rgba(0,0,0,.65)', font } = {}) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life, max: life, vy, weight, stroke, font });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.floor && p.y < 0) {
        p.y = 0;
        p.vy *= -0.35;
        p.vx *= 0.7;
      }
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 1 - 2.5 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
  }

  /** `toScreen(x, y)` maps world -> screen. */
  draw(ctx, toScreen) {
    let additive = false;
    for (const p of this.list) {
      const k = p.life / p.max;
      const [sx, sy] = toScreen(p.x, p.y);
      const add = p.type === 'spark' || p.type === 'glow' || p.type === 'ember';
      if (add !== additive) {
        ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
        additive = add;
      }
      ctx.globalAlpha = p.type === 'smoke' ? k * (p.alpha ?? 0.5) : Math.min(1, k * 1.4) * (p.alpha ?? 1);
      switch (p.type) {
        case 'spark': {
          const len = Math.min(26, Math.hypot(p.vx, p.vy) * 0.035) + 2;
          const a = Math.atan2(-p.vy, p.vx);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * k + 0.6;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - Math.cos(a) * len, sy - Math.sin(a) * len);
          ctx.stroke();
          break;
        }
        case 'ring': {
          const r = p.size + (1 - k) * p.grow;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 3 * k + 0.5;
          ctx.beginPath();
          ctx.ellipse(sx, sy, r, r * (p.flat ?? 1), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'smoke': {
          const r = p.size * (1.6 - k * 0.6);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        default: {
          const r = p.type === 'glow' ? p.size * (0.6 + k * 0.4) : p.size * (0.4 + k * 0.6);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(sx, sy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const age = 1 - k;
      const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.55 : age < 0.22 ? 1.15 - ((age - 0.12) / 0.1) * 0.15 : 1;
      const [sx, sy] = toScreen(t.x, t.y);
      ctx.globalAlpha = Math.min(1, k * 2.2);
      ctx.font = `${t.weight} ${Math.round(t.size * pop)}px ${t.font || "'Cinzel', Georgia, serif"}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = t.stroke;
      ctx.strokeText(t.text, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }
}
