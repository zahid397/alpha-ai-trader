import { getConfig } from '../config.js';

const MAX_TRACKED_CLIENTS = 5000;

// Best-effort fixed-window limiter. State lives per Worker isolate, which is
// enough to stop a single client from burning the free AI quota.
export function rateLimit() {
  const hits = new Map();

  return async (c, next) => {
    const { rateLimitMax: limit, rateLimitWindowMs: windowMs } = getConfig(c.env);
    const now = Date.now();
    const key =
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'anonymous';

    if (hits.size > MAX_TRACKED_CLIENTS) {
      for (const [k, entry] of hits) if (entry.resetAt <= now) hits.delete(k);
      if (hits.size > MAX_TRACKED_CLIENTS) hits.clear();
    }

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;

    const remaining = Math.max(0, limit - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    c.header('RateLimit-Limit', String(limit));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetSeconds));

    if (entry.count > limit) {
      c.header('Retry-After', String(resetSeconds));
      return c.json({ success: false, error: 'Too many requests', message: 'Please try again later.' }, 429);
    }

    await next();
  };
}
