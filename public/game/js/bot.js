// Attract-mode pilot: plays the game behind the title screen so the arena
// is alive (and the C# AI visibly at work) before anyone presses Play.

import { BTN } from './input.js';

export class Bot {
  constructor(layout) {
    this.FS = layout.fighterStates;
    this.TP = layout.trapPhases;
    this.last = 0;
    this.wander = 1;
  }

  buttons(s) {
    const { FS, TP } = this;
    const p = s.player;
    let b = BTN.run;
    let target = null;
    let best = Infinity;
    for (const e of s.enemies) {
      if (e.state === FS.Dead || e.state === FS.Spawn) continue;
      const d = Math.abs(e.x - p.x);
      if (d < best) {
        best = d;
        target = e;
      }
    }

    const threat = s.enemies.find((e) => e.state === FS.Attack && e.attackPhase === 0 && e.phaseT > 0.55 && Math.abs(e.x - p.x) < 150 * e.scale);
    const dagger = s.projectiles.find((pr) => !pr.fromPlayer && Math.abs(pr.x - p.x) < 120 && Math.sign(p.x - pr.x) === Math.sign(pr.vx));
    const trap = s.traps.find((t) => t.phase !== TP.Idle && t.phase !== TP.Retract && Math.abs(t.x - p.x) < t.halfWidth + 30);

    if (threat && Math.random() < 0.6) {
      b |= (p.x < threat.x ? BTN.right : BTN.left) | BTN.dash;
    } else if (dagger || trap) {
      b |= BTN.jump;
      if (trap) b |= p.x < trap.x ? BTN.left : BTN.right;
    } else if (target) {
      const dx = target.x - p.x;
      if (Math.abs(dx) > 80) b |= dx > 0 ? BTN.right : BTN.left;
      else {
        if (Math.sign(dx) !== p.facing) b |= dx > 0 ? BTN.right : BTN.left;
        if (p.rage >= 50) b |= BTN.special;
        else if (p.stamina > 70 && Math.random() < 0.2) b |= BTN.heavy;
        else b |= BTN.attack;
      }
    } else {
      if (p.x < 500) this.wander = 1;
      if (p.x > 1900) this.wander = -1;
      b |= this.wander > 0 ? BTN.right : BTN.left;
    }

    const edge = BTN.attack | BTN.heavy | BTN.special | BTN.dash;
    if (this.last & edge) b &= ~edge;
    this.last = b;
    return b;
  }
}
