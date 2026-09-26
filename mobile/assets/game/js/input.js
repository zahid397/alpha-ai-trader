// Keyboard, touch and gamepad -> the engine's button bitmask.

export const BTN = {
  left: 1,
  right: 2,
  jump: 4,
  down: 8,
  attack: 16,
  heavy: 32,
  special: 64,
  dash: 128,
  run: 256
};

const KEYS = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
  ArrowDown: 'down', KeyS: 'down',
  KeyJ: 'attack', KeyZ: 'attack',
  KeyK: 'heavy', KeyX: 'heavy',
  KeyL: 'dash', KeyC: 'dash',
  KeyU: 'special', KeyI: 'special',
  ShiftLeft: 'walk', ShiftRight: 'walk'
};

export class Input {
  constructor() {
    this.keys = new Set();
    this.touch = new Set();
    // Presses since the last poll, so a tap shorter than one frame still counts.
    this.latched = new Set();
    this.onCommand = null; // (name) => void for pause, mute, vision...
    this.lastDevice = 'keyboard';

    addEventListener('keydown', (e) => this.#key(e, true));
    addEventListener('keyup', (e) => this.#key(e, false));
    addEventListener('blur', () => {
      this.keys.clear();
      this.touch.clear();
      this.latched.clear();
    });
  }

  #key(e, down) {
    if (e.target instanceof HTMLInputElement) return;
    const action = KEYS[e.code];
    if (down && !e.repeat) {
      const command = { Escape: 'pause', KeyP: 'pause', KeyM: 'mute', KeyV: 'vision', KeyB: 'boss', Enter: 'confirm', KeyR: 'restart' }[e.code];
      if (command) this.onCommand?.(command);
    }
    if (!action) return;
    e.preventDefault();
    this.lastDevice = 'keyboard';
    if (down) {
      this.keys.add(action);
      this.latched.add(action);
    } else this.keys.delete(action);
  }

  /** Wire on-screen buttons: any element with data-btn="left|right|jump|...". */
  bindTouch(root) {
    const active = new Map(); // pointerId -> action
    const update = () => {
      this.touch = new Set(active.values());
      for (const el of root.querySelectorAll('[data-btn]')) el.classList.toggle('on', this.touch.has(el.dataset.btn));
    };
    const actionAt = (x, y) => document.elementFromPoint(x, y)?.closest('[data-btn]')?.dataset.btn;
    root.addEventListener('pointerdown', (e) => {
      const action = e.target.closest('[data-btn]')?.dataset.btn;
      if (!action) return;
      e.preventDefault();
      root.setPointerCapture?.(e.pointerId);
      this.lastDevice = 'touch';
      active.set(e.pointerId, action);
      this.latched.add(action);
      update();
    });
    // Slide a thumb across the d-pad without lifting it.
    root.addEventListener('pointermove', (e) => {
      if (!active.has(e.pointerId)) return;
      const action = actionAt(e.clientX, e.clientY);
      const current = active.get(e.pointerId);
      if (action && action !== current && (action === 'left' || action === 'right') && (current === 'left' || current === 'right')) {
        active.set(e.pointerId, action);
        update();
      }
    });
    const end = (e) => {
      if (active.delete(e.pointerId)) update();
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  #gamepad() {
    const held = new Set();
    const pads = navigator.getGamepads?.() || [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i) => pad.buttons[i]?.pressed;
      const x = pad.axes[0] || 0;
      if (x < -0.35 || b(14)) held.add('left');
      if (x > 0.35 || b(15)) held.add('right');
      if ((pad.axes[1] || 0) > 0.6 || b(13)) held.add('down');
      if (b(0) || b(12)) held.add('jump');
      if (b(2)) held.add('attack');
      if (b(3)) held.add('heavy');
      if (b(1) || b(4)) held.add('dash');
      if (b(5) || b(7)) held.add('special');
      if (b(6)) held.add('walk');
      if (b(9) && !this.padStart) this.onCommand?.('pause');
      this.padStart = b(9);
      if (held.size) this.lastDevice = 'gamepad';
    }
    return held;
  }

  /** Current buttons for the engine. Running is the default; Shift walks. */
  buttons() {
    const all = new Set([...this.keys, ...this.touch, ...this.latched, ...this.#gamepad()]);
    this.latched.clear();
    let mask = 0;
    for (const action of all) if (BTN[action]) mask |= BTN[action];
    if (!all.has('walk')) mask |= BTN.run;
    if ((mask & BTN.left) && (mask & BTN.right)) mask &= ~(BTN.left | BTN.right);
    return mask;
  }

  anyAction() {
    return this.keys.size > 0 || this.touch.size > 0;
  }
}
