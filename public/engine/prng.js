// Deterministic pseudo-random numbers. Only integer/float arithmetic is used
// (no Math.sin/log), so every JS engine produces the same sequence.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit string hash, used to seed simulations from the data itself.
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Approximately normal N(0, 1) via the Irwin-Hall sum of 12 uniforms.
export function gaussian(rand) {
  let total = 0;
  for (let i = 0; i < 12; i++) total += rand();
  return total - 6;
}

export const uniform = (rand, min, max) => min + (max - min) * rand();

export function pickWeighted(rand, entries) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}
