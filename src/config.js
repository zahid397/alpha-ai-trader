// Runtime configuration. On Cloudflare every value comes from the Worker `env`
// (wrangler.jsonc `vars` + secrets), so config is resolved per request.

export const APP_VERSION = '2.0.0';

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export function getConfig(env = {}) {
  return {
    environment: env.ENVIRONMENT || 'production',
    groqApiKey: env.GROQ_API_KEY || '',
    groqModel: env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    workersAiModel: env.WORKERS_AI_MODEL || '@cf/meta/llama-3.1-8b-instruct',
    // Force the rule-based coach even when an AI provider is configured.
    forceRules: env.USE_MOCK_AI === 'true',
    // `npm run dev` sets this to false: the AI binding exists locally but
    // cannot reach Cloudflare without remote bindings.
    workersAiEnabled: env.WORKERS_AI_ENABLED !== 'false',
    corsOrigin: env.CORS_ORIGIN || '*',
    rateLimitMax: toInt(env.RATE_LIMIT_MAX, 30),
    rateLimitWindowMs: toInt(env.RATE_LIMIT_WINDOW_MS, 60_000),
    adminToken: env.ADMIN_TOKEN || ''
  };
}

export function hasWorkersAi(env = {}) {
  return getConfig(env).workersAiEnabled && Boolean(env.AI) && typeof env.AI.run === 'function';
}

// Which provider will answer first. Rules are always the last-resort fallback.
export function getAiMode(env = {}) {
  const config = getConfig(env);
  if (config.forceRules) return 'rules';
  if (config.groqApiKey) return 'groq';
  if (hasWorkersAi(env)) return 'workers-ai';
  return 'rules';
}
