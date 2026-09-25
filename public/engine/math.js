// Small numeric helpers shared by every engine module. Pure functions only,
// so the engine runs identically in Node, Cloudflare Workers and browsers.

export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
export const round1 = (value) => Math.round((value + Number.EPSILON) * 10) / 10;
export const sum = (values) => values.reduce((total, v) => total + v, 0);
export const mean = (values) => (values.length ? sum(values) / values.length : 0);
export const pct = (part, whole) => (whole ? (part / whole) * 100 : 0);
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Sample standard deviation (n - 1).
export function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - avg) ** 2)) / (values.length - 1));
}

// Linear-interpolated percentile of an already sorted numeric array.
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
