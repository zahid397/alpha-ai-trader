import { Hono } from 'hono';
import { httpError, readJson } from '../lib/http.js';
import { analyzeTrader, categorizeTrades, generateHeatmapData } from '../services/tradeAnalyzer.js';
import { buildTrade, newTradeId } from '../services/tradeModel.js';

const trades = new Hono();

function parseDate(value, name) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError(400, `${name} must be a valid date`);
  return date.toISOString();
}

function parseFilters(query) {
  return {
    symbol: query.symbol ? String(query.symbol).trim().toUpperCase() : undefined,
    startDate: parseDate(query.startDate, 'startDate'),
    endDate: parseDate(query.endDate, 'endDate')
  };
}

const validationError = (c, errors) =>
  c.json({ success: false, error: 'Invalid trade', details: errors }, 400);

// List trades (newest first), optionally filtered by symbol and date range.
trades.get('/', async (c) => {
  const list = await c.get('store').listTrades(parseFilters(c.req.query()));
  return c.json({ success: true, count: list.length, trades: list });
});

// Dashboard summary: stats, patterns, biases and a deterministic risk score.
trades.get('/stats/summary', async (c) => {
  const list = await c.get('store').listTrades();
  const analysis = analyzeTrader(list);
  const categorized = categorizeTrades(list);

  return c.json({
    success: true,
    stats: analysis.stats,
    patterns: analysis.patterns,
    biases: analysis.biases,
    riskScore: analysis.riskScore,
    riskLevel: analysis.riskLevel,
    behavioralPattern: analysis.behavioralPattern,
    categories: {
      wins: categorized.filter((t) => t.category.isWin).length,
      losses: categorized.filter((t) => t.profit < 0).length,
      bigWins: categorized.filter((t) => t.category.isBigWin).length,
      bigLosses: categorized.filter((t) => t.category.isBigLoss).length
    },
    heatmap: generateHeatmapData(list),
    recentTrades: list.slice(0, 10)
  });
});

trades.get('/:id', async (c) => {
  const trade = await c.get('store').getTrade(c.req.param('id'));
  if (!trade) return c.json({ success: false, error: 'Trade not found' }, 404);
  return c.json({ success: true, trade });
});

trades.post('/', async (c) => {
  const body = await readJson(c);
  const { trade, errors } = buildTrade(body, { id: newTradeId() });
  if (errors) return validationError(c, errors);

  await c.get('store').insertTrade(trade);
  return c.json({ success: true, trade, message: 'Trade added successfully' }, 201);
});

trades.put('/:id', async (c) => {
  const store = c.get('store');
  const existing = await store.getTrade(c.req.param('id'));
  if (!existing) return c.json({ success: false, error: 'Trade not found' }, 404);

  const { trade, errors } = buildTrade(await readJson(c), { existing });
  if (errors) return validationError(c, errors);

  await store.updateTrade(trade);
  return c.json({ success: true, trade, message: 'Trade updated successfully' });
});

trades.delete('/:id', async (c) => {
  const deleted = await c.get('store').deleteTrade(c.req.param('id'));
  if (!deleted) return c.json({ success: false, error: 'Trade not found' }, 404);
  return c.json({ success: true, message: 'Trade deleted successfully' });
});

export default trades;
