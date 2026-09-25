// Runtime configuration, resolved per request from the platform env:
// Cloudflare passes bindings/vars as the Worker `env`; Vercel and Node expose
// them on `process.env` (merged in by `resolveEnv` below).

export const APP_VERSION = '3.0.0';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Platform env with a `process.env` fallback. Worker bindings (D1, AI) are
 * never copied, only looked through, so they keep working on Cloudflare.
 */
export function resolveEnv(env) {
  const nodeEnv = typeof process !== 'undefined' && process?.env ? process.env : null;
  const base = env && typeof env === 'object' ? env : {};
  if (!nodeEnv) return base;
  return new Proxy(base, {
    get: (target, key) => (key in target && target[key] !== undefined ? target[key] : nodeEnv[key]),
    has: (target, key) => key in target || key in nodeEnv
  });
}

export function getConfig(env = {}) {
  return {
    environment: env.ENVIRONMENT || 'production',
    platform: env.VERCEL ? 'vercel' : env.DB || env.AI ? 'cloudflare' : 'node',
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    workersAiModel: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    // Engine-only mode: never call an external LLM, even if one is configured.
    engineOnly: env.USE_MOCK_AI === 'true' || env.AI_PROVIDER === 'alpha',
    // Cloudflare Workers AI is opt-in; the built-in Alpha Engine is the default.
    workersAiEnabled: env.WORKERS_AI_ENABLED === 'true',
    corsOrigin: env.CORS_ORIGIN || '*',
    rateLimitMax: toInt(env.RATE_LIMIT_MAX, 60),
    rateLimitWindowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    adminToken: env.ADMIN_TOKEN || ''
  };
}

export function hasWorkersAi(env = {}) {
  return getConfig(env).workersAiEnabled && Boolean(env.AI) && typeof env.AI.run === 'function';
}

// Which LLM (if any) polishes the engine's answers. 'alpha' means the
// built-in engine answers on its own, with no API key and no network call.
export function getAiMode(env = {}) {
  const config = getConfig(env);
  if (config.engineOnly) return 'alpha';
  if (config.groqApiKey) return 'groq';
  if (hasWorkersAi(env)) return 'workers-ai';
  return 'alpha';
}
