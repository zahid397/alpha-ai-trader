// Every sound is synthesised with WebAudio: no audio files to download,
// nothing to license. Includes a small adaptive music loop whose intensity
// follows the fight (calm between waves, driving during boss fights).

const STORE_KEY = 'crimson-arena:muted';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem(STORE_KEY) === '1';
    } catch {}
    this.intensity = 0; // 0 menu, 1 fighting, 2 boss
    this.step = 0;
    this.nextNote = 0;
    this.last = new Map();
  }

  /** Browsers only allow audio after a user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.32;
    this.musicBus.connect(this.master);

    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.nextNote = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.#schedule(), 30);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(STORE_KEY, this.muted ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  setIntensity(level) {
    this.intensity = level;
  }

  // ---------------------------------------------------------------- primitives

  #ok(name, gap = 0.03) {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last.get(name) ?? -1) < gap) return false; // avoid stacking the same sound
    this.last.set(name, now);
    return true;
  }

  #env(gain, t, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, to, at = 0, bus = this.sfxBus, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.#env(g, t, attack, dur, gain);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
  }

  noise(dur, { type = 'bandpass', freq = 1200, to, q = 1, gain = 0.3, at = 0, bus = this.sfxBus, attack = 0.004 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (to) filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    this.#env(g, t, attack, dur, gain);
    src.connect(filter).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
  }

  // ---------------------------------------------------------------- effects

  swing(heavy) {
    if (!this.#ok('swing', 0.05)) return;
    this.noise(heavy ? 0.28 : 0.16, { freq: heavy ? 700 : 1800, to: heavy ? 2400 : 5200, q: 1.4, gain: heavy ? 0.32 : 0.22 });
  }

  enemySwing(kind) {
    if (!this.#ok('eswing', 0.08)) return;
    if (kind === 6) {
      // Overhead: a ringing warning so players learn to dodge on sound.
      this.tone(880, 0.35, { type: 'triangle', gain: 0.12 });
      this.tone(1320, 0.3, { type: 'sine', gain: 0.06, at: 0.02 });
    }
    this.noise(0.22, { freq: 500, to: 1400, q: 1.2, gain: 0.14, at: 0.1 });
  }

  hit(heavy) {
    if (!this.#ok('hit', 0.025)) return;
    this.tone(heavy ? 110 : 170, heavy ? 0.22 : 0.12, { type: 'square', gain: heavy ? 0.28 : 0.2, to: heavy ? 45 : 70 });
    this.noise(heavy ? 0.16 : 0.08, { type: 'highpass', freq: 2500, gain: heavy ? 0.3 : 0.22 });
    if (heavy) this.noise(0.25, { type: 'lowpass', freq: 600, to: 120, gain: 0.35 });
  }

  hurt() {
    if (!this.#ok('hurt', 0.1)) return;
    this.tone(220, 0.25, { type: 'sawtooth', gain: 0.2, to: 80 });
    this.noise(0.2, { type: 'lowpass', freq: 900, to: 200, gain: 0.35 });
  }

  death(boss) {
    if (!this.#ok('death', 0.05)) return;
    this.tone(boss ? 90 : 150, boss ? 1.2 : 0.45, { type: 'sawtooth', gain: 0.18, to: boss ? 30 : 50 });
    this.noise(boss ? 1 : 0.4, { type: 'lowpass', freq: 1400, to: 100, gain: 0.3 });
  }

  jump() {
    if (!this.#ok('jump')) return;
    this.tone(320, 0.12, { type: 'triangle', gain: 0.1, to: 620 });
  }

  land() {
    if (!this.#ok('land', 0.08)) return;
    this.noise(0.08, { type: 'lowpass', freq: 500, gain: 0.16 });
  }

  dash() {
    if (!this.#ok('dash', 0.05)) return;
    this.noise(0.2, { freq: 3000, to: 600, q: 0.8, gain: 0.22 });
  }

  trap(near) {
    if (!this.#ok('trap', 0.05)) return;
    const g = near ? 1 : 0.35;
    this.noise(0.12, { type: 'highpass', freq: 3000, gain: 0.25 * g });
    this.tone(95, 0.18, { type: 'square', gain: 0.15 * g, to: 60 });
    this.tone(1900, 0.3, { type: 'triangle', gain: 0.05 * g, to: 1500, at: 0.02 });
  }

  pickup(kind) {
    if (!this.#ok('pickup', 0.05)) return;
    const notes = kind === 0 ? [523, 659, 784] : [587, 740, 988];
    notes.forEach((f, i) => this.tone(f, 0.18, { type: 'triangle', gain: 0.12, at: i * 0.06 }));
  }

  throwKnife() {
    if (!this.#ok('throw', 0.05)) return;
    this.noise(0.1, { freq: 4000, to: 2000, q: 2, gain: 0.12 });
  }

  special() {
    if (!this.#ok('special', 0.1)) return;
    this.tone(260, 0.5, { type: 'sawtooth', gain: 0.12, to: 1040 });
    this.noise(0.45, { freq: 800, to: 6000, q: 1, gain: 0.25 });
  }

  perfect() {
    if (!this.#ok('perfect', 0.2)) return;
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.4, { type: 'sine', gain: 0.08, at: i * 0.04 }));
    this.noise(0.4, { freq: 6000, to: 1200, q: 1, gain: 0.12 });
  }

  stagger() {
    if (!this.#ok('stagger', 0.08)) return;
    this.tone(640, 0.15, { type: 'square', gain: 0.08, to: 320 });
  }

  spawn() {
    if (!this.#ok('spawn', 0.1)) return;
    this.tone(70, 0.6, { type: 'sine', gain: 0.25, to: 140, attack: 0.15 });
    this.noise(0.5, { type: 'lowpass', freq: 200, to: 900, gain: 0.12, attack: 0.2 });
  }

  wave(boss) {
    if (!this.#ok('wave', 0.5)) return;
    const base = boss ? 73.4 : 146.8;
    [1, 1.5, 2].forEach((m, i) => this.tone(base * m, 1.1, { type: 'sawtooth', gain: 0.07, attack: 0.08, at: i * 0.05 }));
    this.noise(0.6, { type: 'lowpass', freq: 300, gain: 0.3 });
  }

  clear() {
    if (!this.#ok('clear', 0.5)) return;
    [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', gain: 0.1, at: i * 0.08 }));
  }

  roar() {
    if (!this.#ok('roar', 0.5)) return;
    this.tone(80, 1.2, { type: 'sawtooth', gain: 0.22, to: 45, attack: 0.1 });
    this.noise(1.2, { type: 'lowpass', freq: 700, to: 150, gain: 0.35, attack: 0.1 });
  }

  gameOver() {
    if (!this.#ok('over', 1)) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.6, { type: 'triangle', gain: 0.1, at: i * 0.22 }));
  }

  ui() {
    if (!this.#ok('ui', 0.05)) return;
    this.tone(660, 0.06, { type: 'triangle', gain: 0.08 });
  }

  // ---------------------------------------------------------------- music

  #schedule() {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') {
      if (ctx) this.nextNote = Math.max(this.nextNote, ctx.currentTime + 0.05);
      return;
    }
    const bpm = this.intensity >= 2 ? 132 : this.intensity === 1 ? 112 : 84;
    const sixteenth = 60 / bpm / 4;
    while (this.nextNote < ctx.currentTime + 0.12) {
      this.#note(this.step, this.nextNote - ctx.currentTime);
      this.nextNote += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  #note(step, at) {
    const bus = this.musicBus;
    // D minor: i - VI - III - VII
    const roots = [73.42, 58.27, 87.31, 65.41];
    const root = roots[Math.floor(step / 16)];
    const beat = step % 16;
    if (beat % 4 === 0) this.tone(root, 0.5, { type: 'sawtooth', gain: 0.12, at, bus, attack: 0.02 });
    if (beat === 0) this.tone(root * 4, 1.6, { type: 'triangle', gain: 0.035, at, bus, attack: 0.3 });
    if (this.intensity >= 1) {
      if (beat % 4 === 0) this.tone(120, 0.18, { type: 'sine', gain: 0.35, to: 40, at, bus });
      if (beat === 4 || beat === 12) this.noise(0.12, { type: 'bandpass', freq: 1800, gain: 0.12, at, bus });
      if (beat % 2 === 1) this.noise(0.03, { type: 'highpass', freq: 7000, gain: 0.04, at, bus });
      if (beat === 10 || beat === 14) this.tone(root * 2, 0.2, { type: 'square', gain: 0.03, at, bus });
    }
    if (this.intensity >= 2 && beat % 2 === 0) this.tone(root * 2, 0.12, { type: 'sawtooth', gain: 0.04, at, bus });
  }
}
