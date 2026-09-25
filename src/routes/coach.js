import { Hono } from 'hono';
import { buildTrade } from '../../public/engine/index.js';
import { round2 } from '../../public/engine/math.js';
import { httpError, readJson } from '../lib/http.js';
import { analyzeTrade, biasReport, coachChat, coachingAdvice } from '../services/coachService.js';
import {
  MAX_CHAT_INPUT_LENGTH,
  appendMessages,
  isValidSessionId,
  makeMessage,
  newSession,
  toChatHistory
} from '../services/sessionService.js';

const coach = new Hono();
const MAX_CLIENT_TRADES = 5000;

// Trades supplied by the client (browser-local journals). Each one is
// re-validated; invalid rows are dropped rather than trusted.
function clientTrades(value) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw httpError(400, 'trades must be an array');
  if (value.length > MAX_CLIENT_TRADES) throw httpError(400, `At most ${MAX_CLIENT_TRADES} trades per request`);
  return value
    .map((input, i) => buildTrade(input, { id: typeof input?.id === 'string' && input.id.length <= 64 ? input.id : `client_${i}` }).trade)
    .filter(Boolean)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

function requireText(value, name, maxLength = MAX_CHAT_INPUT_LENGTH) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw httpError(400, `${name} is required`);
  if (text.length > maxLength) throw httpError(400, `${name} must be at most ${maxLength} characters`);
  return text;
}

// Conversational coach. With a sessionId the conversation is stored and
// reused as context; otherwise the client may pass `history` itself. Pass
// `trades` to analyse a browser-local journal instead of the stored one.
coach.post('/chat', async (c) => {
  const body = await readJson(c);
  const message = requireText(body.message, 'message');
  const store = c.get('store');

  let session = null;
  let history;
  if (body.sessionId !== undefined && body.sessionId !== null) {
    if (!isValidSessionId(body.sessionId)) throw httpError(400, 'sessionId is invalid');
    session = (await store.getSession(body.sessionId)) || newSession(body.sessionId);
    history = toChatHistory(session.messages);
  } else {
    history = toChatHistory(Array.isArray(body.history) ? body.history : []);
  }

  const trades = clientTrades(body.trades) ?? (await store.listTrades());
  const answer = await coachChat(c.env, trades, { message, history });

  if (session) {
    appendMessages(
      session,
      makeMessage('user', message, 'chat'),
      makeMessage('assistant', answer.reply, 'chat', { source: answer.source, highlights: answer.highlights })
    );
    await store.saveSession(session);
  }

  return c.json({ success: true, ...answer, sessionId: session?.id ?? null, timestamp: new Date().toISOString() });
});

// Analyse one stored trade.
coach.post('/analyze/:tradeId', async (c) => {
  const body = await readJson(c);
  const store = c.get('store');
  const trade = await store.getTrade(c.req.param('tradeId'));
  if (!trade) return c.json({ success: false, error: 'Trade not found' }, 404);

  const marketCondition = typeof body.marketCondition === 'string' ? body.marketCondition.slice(0, 500) : '';
  const trades = await store.listTrades();
  const { analysis, source } = await analyzeTrade(c.env, trade, trades, marketCondition);
  return c.json({ success: true, analysis, trade, source });
});

// Short real-time coaching for a described market situation.
coach.post('/advice', async (c) => {
  const body = await readJson(c);
  const marketContext = requireText(body.marketContext, 'marketContext', 1000);
  const trades = await c.get('store').listTrades();
  const { advice, source } = await coachingAdvice(c.env, trades, marketContext, body.traderProfile);
  return c.json({ success: true, advice, source, timestamp: new Date().toISOString() });
});

// Behavioural bias report (Alpha Engine detection + optional LLM summary).
coach.get('/biases', async (c) => {
  const trades = await c.get('store').listTrades();
  const report = await biasReport(c.env, trades);
  return c.json({ success: true, ...report, analyzedTrades: trades.length, timestamp: new Date().toISOString() });
});

// Market snapshot. There is no live market-data feed, so prices are
// simulated and flagged as such; the coaching part is real.
coach.post('/market-analysis', async (c) => {
  const body = await readJson(c);
  const symbols = typeof body.symbols === 'string' ? body.symbols.slice(0, 100) : 'BTCUSD, ETHUSD';
  const timeframe = typeof body.timeframe === 'string' ? body.timeframe.slice(0, 20) : '1H';
  const indicators = typeof body.indicators === 'string' ? body.indicators.slice(0, 100) : 'RSI, MACD, Volume';

  const jitter = (base, spread) => round2(base + (Math.random() * 2 - 1) * spread);
  const marketData = {
    btcusd: { price: jitter(95900, 1000), change24h: jitter(0, 3), rsi: jitter(55, 5), sentiment: Math.random() > 0.5 ? 'bullish' : 'bearish', support: 94500, resistance: 96500 },
    ethusd: { price: jitter(3200, 100), change24h: jitter(0, 2.5), rsi: jitter(52, 4), sentiment: Math.random() > 0.4 ? 'bullish' : 'bearish', support: 3100, resistance: 3300 }
  };

  const trades = await c.get('store').listTrades();
  const { advice, source } = await coachingAdvice(
    c.env,
    trades,
    `Market analysis for ${symbols} on the ${timeframe} timeframe. Indicators: ${indicators}. Snapshot: ${JSON.stringify(marketData)}`,
    {}
  );

  return c.json({ success: true, analysis: advice, source, marketData, simulated: true, timestamp: new Date().toISOString() });
});

export default coach;
