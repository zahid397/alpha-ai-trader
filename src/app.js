import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { APP_VERSION, getAiMode, getConfig } from './config.js';
import { rateLimit } from './middleware/rateLimit.js';
import coachRoutes from './routes/coach.js';
import historyRoutes from './routes/history.js';
import sessionRoutes from './routes/session.js';
import tradeRoutes from './routes/trades.js';
import { getStore as defaultGetStore } from './storage/index.js';

const API_ROUTES = {
  health: '/api/health',
  trades: '/api/trades',
  stats: '/api/trades/stats/summary',
  history: '/api/history',
  chat: '/api/coach/chat',
  advice: '/api/coach/advice',
  biases: '/api/coach/biases',
  analyze: '/api/coach/analyze/:tradeId',
  marketAnalysis: '/api/coach/market-analysis',
  session: '/api/session'
};

function resolveCorsOrigin(origin, c) {
  const allowed = getConfig(c.env).corsOrigin;
  if (allowed === '*') return '*';
  return allowed.split(',').map((o) => o.trim()).includes(origin) ? origin : null;
}

/**
 * Build the API. `getStore(env)` is injectable so tests can run the full app
 * in Node against an in-memory store; on Cloudflare it picks D1 when bound.
 */
export function createApp({ getStore = defaultGetStore } = {}) {
  const app = new Hono();

  app.use('*', secureHeaders());
  app.use(
    '/api/*',
    cors({
      origin: resolveCorsOrigin,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400
    })
  );
  app.use('/api/*', bodyLimit({ maxSize: 100 * 1024, onError: (c) => c.json({ success: false, error: 'Request body too large' }, 413) }));
  app.use('/api/*', async (c, next) => {
    c.set('store', getStore(c.env));
    await next();
  });
  // AI-backed endpoints are the only ones with a real cost, so limit those.
  app.use('/api/coach/*', rateLimit());

  const health = (c) =>
    c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: getConfig(c.env).environment,
      aiMode: getAiMode(c.env),
      storage: getStore(c.env).kind,
      version: APP_VERSION
    });
  app.get('/health', health);
  app.get('/api/health', health);

  app.get('/api', (c) =>
    c.json({
      name: 'Alpha AI Trader API',
      version: APP_VERSION,
      status: 'operational',
      ai: getAiMode(c.env),
      endpoints: API_ROUTES
    })
  );

  app.route('/api/trades', tradeRoutes);
  app.route('/api/coach', coachRoutes);
  app.route('/api/history', historyRoutes);
  app.route('/api/session', sessionRoutes);

  app.notFound((c) =>
    c.json({ success: false, error: 'Route not found', availableRoutes: Object.values(API_ROUTES) }, 404)
  );

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('Unhandled error', { path: c.req.path, method: c.req.method, message: err.message, stack: err.stack });
    const exposeDetails = getConfig(c.env).environment === 'development';
    return c.json(
      { success: false, error: 'Something went wrong. Please try again.', ...(exposeDetails && { message: err.message }) },
      500
    );
  });

  return app;
}
