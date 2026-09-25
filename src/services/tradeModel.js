import { round2 } from '../lib/http.js';

const TYPE_ALIASES = { buy: 'buy', long: 'buy', sell: 'sell', short: 'sell' };
const SYMBOL_PATTERN = /^[A-Z0-9._:/-]{1,20}$/;
const MAX_NOTES_LENGTH = 1000;

export function calculateProfit(type, entryPrice, exitPrice, positionSize) {
  const perUnit = type === 'buy' ? exitPrice - entryPrice : entryPrice - exitPrice;
  return round2(perUnit * positionSize);
}

export function statusFromProfit(profit) {
  if (profit > 0) return 'win';
  if (profit < 0) return 'loss';
  return 'breakeven';
}

export function notional(trade) {
  return Math.abs((trade.entryPrice || 0) * (trade.positionSize || 0));
}

// True when a losing trade was closed beyond its planned stop loss,
// i.e. the trader let the loser run past the exit they had planned.
export function exceededStopLoss(trade) {
  if (!(trade.profit < 0) || !Number.isFinite(trade.stopLoss)) return false;
  return trade.type === 'buy' ? trade.exitPrice < trade.stopLoss : trade.exitPrice > trade.stopLoss;
}

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : NaN;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Validate client input and build a canonical trade record.
 * When `existing` is given this is a partial update: only supplied fields
 * change, the id is never overwritten and profit/status are recomputed.
 */
export function buildTrade(input, { existing = null, id, now = new Date() } = {}) {
  const errors = [];
  const source = input && typeof input === 'object' ? input : {};
  const merged = { ...(existing || {}) };

  if (source.symbol !== undefined || !existing) {
    const symbol = typeof source.symbol === 'string' ? source.symbol.trim().toUpperCase() : '';
    if (!SYMBOL_PATTERN.test(symbol)) errors.push('symbol is required (1-20 chars: A-Z, 0-9, . _ : / -)');
    merged.symbol = symbol;
  }

  if (source.type !== undefined || !existing) {
    const type = TYPE_ALIASES[String(source.type ?? '').trim().toLowerCase()];
    if (!type) errors.push('type must be "buy" or "sell"');
    merged.type = type;
  }

  for (const field of ['entryPrice', 'exitPrice', 'positionSize']) {
    if (source[field] !== undefined || !existing) {
      const num = parsePositiveNumber(source[field]);
      if (!Number.isFinite(num)) errors.push(`${field} must be a number greater than 0`);
      merged[field] = num;
    }
  }

  for (const field of ['stopLoss', 'takeProfit']) {
    if (source[field] !== undefined) {
      const num = parsePositiveNumber(source[field]);
      if (Number.isNaN(num)) errors.push(`${field} must be a number greater than 0 when provided`);
      merged[field] = num ?? null;
    } else if (!existing) {
      merged[field] = null;
    }
  }

  if (source.duration !== undefined || !existing) {
    const duration = source.duration === undefined || source.duration === '' ? 0 : Number(source.duration);
    if (!Number.isInteger(duration) || duration < 0) errors.push('duration must be a whole number of minutes >= 0');
    merged.duration = duration;
  }

  if (source.notes !== undefined || !existing) {
    const notes = source.notes === undefined || source.notes === null ? '' : String(source.notes);
    if (notes.length > MAX_NOTES_LENGTH) errors.push(`notes must be at most ${MAX_NOTES_LENGTH} characters`);
    merged.notes = notes.trim();
  }

  if (source.timestamp !== undefined || !existing) {
    const timestamp = normalizeTimestamp(source.timestamp);
    if (timestamp === null) errors.push('timestamp must be a valid date');
    merged.timestamp = timestamp || now.toISOString();
  }

  if (errors.length) return { errors };

  merged.id = existing ? existing.id : id;
  merged.profit = calculateProfit(merged.type, merged.entryPrice, merged.exitPrice, merged.positionSize);
  merged.status = statusFromProfit(merged.profit);

  return { trade: toTrade(merged) };
}

// Fixed key order so both storage backends return identical shapes.
export function toTrade(t) {
  return {
    id: t.id,
    symbol: t.symbol,
    type: t.type,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    positionSize: t.positionSize,
    profit: t.profit,
    duration: t.duration ?? 0,
    timestamp: t.timestamp,
    notes: t.notes ?? '',
    status: t.status,
    stopLoss: t.stopLoss ?? null,
    takeProfit: t.takeProfit ?? null
  };
}

// Seed data is trusted but still normalised (ISO timestamps, recomputed
// status) so string comparisons on `timestamp` behave consistently.
export function normalizeSeedTrade(t) {
  return toTrade({
    ...t,
    timestamp: new Date(t.timestamp).toISOString(),
    status: statusFromProfit(t.profit)
  });
}

export function newTradeId() {
  return `trade_${crypto.randomUUID()}`;
}
