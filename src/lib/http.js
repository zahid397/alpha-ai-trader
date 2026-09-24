import { HTTPException } from 'hono/http-exception';

export function httpError(status, message) {
  return new HTTPException(status, { message });
}

// Parse a JSON body, treating an empty body as `{}` and rejecting anything
// that is not a plain object.
export async function readJson(c) {
  const raw = await c.req.text();
  if (!raw.trim()) return {};

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw httpError(400, 'Request body must be valid JSON');
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'Request body must be a JSON object');
  }
  return body;
}

export function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Constant-time string comparison for bearer tokens.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
