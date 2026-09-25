import { Hono } from 'hono';
import { analyze, buildTrade, newTradeId } from '../../public/engine/index.js';
import { httpError, readJson } from '../lib/http.js';
import { SERVER_ANALYSIS } from '../services/coachService.js';

const trades = new Hono();
export const MAX_IMPORT = 1000;

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

const validationError = (c, errors) => c.json({ success: false, error: 'Invalid trade', details: errors }, 400);

// List trades (newest first), optionally filtered by symbol and date range.
trades.get('/', async (c) => {
  const list = await c.get('store').listTrades(parseFilters(c.req.query()));
  return c.json({ success: true, count: list.length, trades: list });
});

// Full Alpha Engine report: stats, equity curve, breakdowns, biases, Trader
// DNA, Monte Carlo forecast and ranked insights. Older fields are kept for
// backwards compatibility.
trades.get('/stats/summary', async (c) => {
  const list = await c.get('store').listTrades();
  const report = analyze(list, SERVER_ANALYSIS);
  return c.json({
    success: true,
    ...report,
    categories: {
      wins: report.stats.wins,
      losses: report.stats.losses,
      breakEven: report.stats.breakEven
    },
    recentTrades: list.slice(0, 10)
  });
});

// Bulk import (CSV uploads are parsed in the browser and sent as JSON).
trades.post('/import', async (c) => {
  const body = await readJson(c);
  if (!Array.isArray(body.trades) || !body.trades.length) throw httpError(400, 'trades must be a non-empty array');
  if (body.trades.length > MAX_IMPORT) throw httpError(400, `At most ${MAX_IMPORT} trades per import`);

  const valid = [];
  const errors = [];
  body.trades.forEach((input, index) => {
    const { trade, errors: problems } = buildTrade(input, { id: newTradeId() });
    if (problems) errors.push({ index, details: problems });
    else valid.push(trade);
  });

  if (valid.length) await c.get('store').insertTrades(valid);
  return c.json({ success: valid.length > 0, imported: valid.length, rejected: errors.length, errors: errors.slice(0, 20) }, valid.length ? 201 : 400);
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
