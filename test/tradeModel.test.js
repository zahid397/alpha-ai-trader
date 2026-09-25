import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTrade, calculateProfit, exceededStopLoss } from '../public/engine/tradeModel.js';

const valid = { symbol: 'btcusd', type: 'buy', entryPrice: 100, exitPrice: 110, positionSize: 2 };

describe('buildTrade', () => {
  it('builds a normalised trade and computes profit/status', () => {
    const { trade, errors } = buildTrade(valid, { id: 'trade_x', now: new Date('2024-05-01T00:00:00Z') });
    assert.equal(errors, undefined);
    assert.equal(trade.id, 'trade_x');
    assert.equal(trade.symbol, 'BTCUSD');
    assert.equal(trade.profit, 20);
    assert.equal(trade.status, 'win');
    assert.equal(trade.timestamp, '2024-05-01T00:00:00.000Z');
    assert.equal(trade.stopLoss, null);
  });

  it('accepts long/short aliases and numeric strings', () => {
    const { trade } = buildTrade({ ...valid, type: 'Short', entryPrice: '100', exitPrice: '90' }, { id: 't' });
    assert.equal(trade.type, 'sell');
    assert.equal(trade.profit, 20);
  });

  it('reports every invalid field', () => {
    const { errors } = buildTrade({ symbol: '', type: 'hold', entryPrice: 0, exitPrice: -1, positionSize: 'abc', duration: -5 });
    assert.equal(errors.length, 6);
  });

  it('partial update keeps the id and recomputes profit', () => {
    const { trade: existing } = buildTrade(valid, { id: 'keep_me' });
    const { trade } = buildTrade({ id: 'hacked', exitPrice: 90 }, { existing });
    assert.equal(trade.id, 'keep_me');
    assert.equal(trade.profit, -20);
    assert.equal(trade.status, 'loss');
  });

  it('rejects an invalid timestamp', () => {
    assert.ok(buildTrade({ ...valid, timestamp: 'not a date' }).errors);
  });
});

describe('trade helpers', () => {
  it('calculateProfit handles both directions', () => {
    assert.equal(calculateProfit('buy', 100, 105, 3), 15);
    assert.equal(calculateProfit('sell', 100, 105, 3), -15);
  });

  it('exceededStopLoss only applies to losers past their stop', () => {
    assert.equal(exceededStopLoss({ type: 'buy', profit: -10, exitPrice: 94, stopLoss: 95 }), true);
    assert.equal(exceededStopLoss({ type: 'buy', profit: -5, exitPrice: 95, stopLoss: 95 }), false);
    assert.equal(exceededStopLoss({ type: 'sell', profit: -10, exitPrice: 106, stopLoss: 105 }), true);
    assert.equal(exceededStopLoss({ type: 'buy', profit: 10, exitPrice: 110, stopLoss: 95 }), false);
  });
});
