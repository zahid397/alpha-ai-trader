import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyze,
  analyzeTrade,
  ask,
  computeStats,
  generateSampleTrades,
  generateTrades,
  monteCarlo,
  normalizeSeedTrade,
  parseCsv,
  tradesFromCsv,
  tradesToCsv,
  understand
} from '../public/engine/index.js';
import { detectBehavioralBiases, traderDNA } from '../public/engine/behavior.js';
import { sessionOf, utcHour, weekKey, weekdayOf } from '../public/engine/time.js';

const sample = generateSampleTrades();

const hasNaN = (value) =>
  typeof value === 'number' ? !Number.isFinite(value) : value && typeof value === 'object' ? Object.values(value).some(hasNaN) : false;

const trade = (overrides) =>
  normalizeSeedTrade({
    id: overrides.id,
    symbol: 'BTCUSD',
    type: 'buy',
    entryPrice: 100,
    exitPrice: 110,
    positionSize: 1,
    profit: 10,
    duration: 60,
    notes: '',
    stopLoss: 95,
    takeProfit: 120,
    timestamp: '2024-01-01T10:00:00Z',
    ...overrides
  });

describe('demo data generator', () => {
  it('is deterministic and realistic', () => {
    assert.deepEqual(generateSampleTrades(), sample);
    assert.equal(sample.length, 160);
    assert.equal(new Set(sample.map((t) => t.id)).size, 160);
    const symbols = new Set(sample.map((t) => t.symbol));
    assert.deepEqual([...symbols].sort(), ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XAUUSD']);
    assert.ok(sample.every((t) => Number.isFinite(t.profit) && t.entryPrice > 0 && t.exitPrice > 0));
  });

  it('scales to big datasets', () => {
    assert.equal(generateTrades({ count: 5000, seed: 7 }).length, 5000);
  });
});

describe('time bucketing', () => {
  it('computes ISO weeks correctly across year boundaries', () => {
    const cases = {
      '2026-03-02T09:00:00.000Z': '2026-W10',
      '2024-12-30T09:00:00.000Z': '2025-W01',
      '2021-01-04T09:00:00.000Z': '2021-W01',
      '2021-01-03T09:00:00.000Z': '2020-W53',
      '2023-01-01T09:00:00.000Z': '2022-W52',
      '2026-12-31T23:59:00.000Z': '2026-W53'
    };
    for (const [ts, week] of Object.entries(cases)) assert.equal(weekKey(ts), week, ts);
  });

  it('reads weekday, hour and session in UTC', () => {
    assert.equal(weekdayOf('2026-09-25T09:00:00.000Z'), 5);
    assert.equal(utcHour('2024-01-01T10:00:00+05:00'), 5);
    assert.equal(sessionOf('2026-01-01T08:30:00.000Z').name, 'European');
    assert.equal(sessionOf('2026-01-01T22:00:00Z').name, 'Late US');
  });
});

describe('quant engine', () => {
  it('computes the full stat set without NaN', () => {
    const stats = computeStats(sample);
    assert.equal(stats.totalTrades, 160);
    assert.equal(stats.wins + stats.losses + stats.breakEven, 160);
    assert.equal(hasNaN(stats), false);
    assert.equal(stats.endingBalance, Math.round((10000 + stats.totalProfit) * 100) / 100);
  });

  it('never returns NaN for empty, all-win or all-loss journals', () => {
    for (const input of [[], [trade({ id: 'a' })], [trade({ id: 'b', profit: -5, exitPrice: 95 })]]) {
      assert.equal(hasNaN(computeStats(input)), false, JSON.stringify(input));
    }
  });

  it('computes drawdown chronologically regardless of input order', () => {
    const series = [
      trade({ id: '1', timestamp: '2024-01-01T00:00:00Z', profit: 100 }),
      trade({ id: '2', timestamp: '2024-01-02T00:00:00Z', profit: -150 }),
      trade({ id: '3', timestamp: '2024-01-03T00:00:00Z', profit: 20 })
    ];
    assert.equal(computeStats(series).maxDrawdown, 150);
    assert.equal(computeStats([...series].reverse()).maxDrawdown, 150);
  });
});

describe('behaviour engine', () => {
  it('finds the leaks planted in the demo journal', () => {
    const types = detectBehavioralBiases(sample).map((b) => b.type);
    for (const expected of ['lossAversion', 'revengeTrading', 'overconfidence', 'fomo', 'riskManagement']) {
      assert.ok(types.includes(expected), `missing ${expected}`);
    }
  });

  it('reports nothing for a disciplined trader', () => {
    const disciplined = Array.from({ length: 6 }, (_, i) =>
      trade({ id: `d${i}`, timestamp: `2024-02-0${i + 1}T10:00:00Z`, notes: 'Planned setup' })
    );
    assert.deepEqual(detectBehavioralBiases(disciplined), []);
  });

  it('detects revenge trading from quick re-entry after a loss', () => {
    const series = [
      trade({ id: '1', timestamp: '2024-01-01T10:00:00Z', profit: -5, exitPrice: 94, duration: 30 }),
      trade({ id: '2', timestamp: '2024-01-01T10:40:00Z' }),
      trade({ id: '3', timestamp: '2024-01-03T10:00:00Z' })
    ];
    const revenge = detectBehavioralBiases(series).find((b) => b.type === 'revengeTrading');
    assert.match(revenge.evidence, /re-entered 10min after a loss/);
  });

  it('builds Trader DNA scores in 0-100 with a grade', () => {
    const stats = computeStats(sample);
    const dna = traderDNA(sample, stats, detectBehavioralBiases(sample));
    assert.equal(dna.scores.length, 5);
    assert.ok(dna.scores.every((s) => s.value >= 0 && s.value <= 100));
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(dna.grade));
  });
});

describe('Monte Carlo engine', () => {
  it('is deterministic for the same journal and ordered by percentile', () => {
    const a = monteCarlo(sample, { runs: 500, horizon: 40 });
    const b = monteCarlo(sample, { runs: 500, horizon: 40 });
    assert.deepEqual(a, b);
    for (const band of a.bands) assert.ok(band.p5 <= band.p25 && band.p25 <= band.p50 && band.p50 <= band.p75 && band.p75 <= band.p95);
    assert.equal(a.bands.at(-1).step, 40);
    assert.ok(a.probProfit >= 0 && a.probProfit <= 100);
  });

  it('needs at least 5 trades', () => {
    assert.equal(monteCarlo(sample.slice(0, 4)), null);
  });
});

describe('NLU engine', () => {
  const cases = {
    'hi': 'greeting',
    'how is my perfomance': 'performance',
    'am i risking to much?': 'risk',
    'risck managment': 'risk',
    'what biases do you see in my trades': 'psychology',
    'tips to improve winrate': 'improve',
    'what happens in next 100 trades': 'forecast',
    'chance of blowing my account': 'forecast',
    'how do i do on bitcoin': 'symbol',
    'what is the sharpe ratio': 'explain',
    'best time of day to trade': 'timing',
    'wich sesion is best for me?': 'timing',
    'what is my biggest loss': 'extremes',
    'make me a trading plan': 'plan',
    'kelly position sizing': 'sizing',
    'what can you do': 'help',
    'asdfgh qwerty': 'unknown'
  };
  for (const [question, intent] of Object.entries(cases)) {
    it(`"${question}" -> ${intent}`, () => {
      assert.equal(understand(question, { knownSymbols: ['BTCUSD', 'ETHUSD'] }).intent, intent);
    });
  }

  it('extracts symbols and forecast horizons', () => {
    const { entities } = understand('what about eth over the next 120 trades', { knownSymbols: ['BTCUSD', 'ETHUSD'] });
    assert.deepEqual(entities.symbols, ['ETHUSD']);
    assert.equal(entities.horizon, 120);
  });
});

describe('synthesis engine (coach answers)', () => {
  it('answers from the real numbers', () => {
    const report = analyze(sample);
    const answer = ask('How is my risk?', sample);
    assert.equal(answer.intent, 'risk');
    assert.match(answer.reply, new RegExp(`${report.riskScore}/100`));
    assert.ok(answer.highlights.length > 0);
  });

  it('runs custom-horizon forecasts', () => {
    assert.match(ask('what happens in the next 120 trades', sample).reply, /next 120 trades/);
  });

  it('answers per symbol', () => {
    assert.match(ask('how do I trade BTC?', sample).reply, /^BTCUSD: \d+ trades/);
  });

  it('handles an empty journal', () => {
    assert.equal(ask('how am i doing', []).intent, 'empty');
  });

  it('analyses a single trade, flagging a blown stop', () => {
    const blown = sample.find((t) => t.profit < 0 && t.stopLoss && (t.type === 'buy' ? t.exitPrice < t.stopLoss : t.exitPrice > t.stopLoss));
    const result = analyzeTrade(blown, sample);
    assert.equal(result.metrics.stopLossRespected, false);
    assert.equal(result.riskAssessment, 'high');
  });

  it('produces ranked insights', () => {
    const { insights } = analyze(sample);
    assert.ok(insights.length >= 4);
    assert.ok(insights.every((i) => i.title && i.detail));
  });
});

describe('CSV', () => {
  it('parses quoted fields and maps broker-style headers', () => {
    const csv = 'Ticker,Side,Open Price,Close Price,Qty,SL,Comment\nbtcusd,long,100,110,2,95,"Breakout, planned"\n';
    const { inputs, error } = tradesFromCsv(csv);
    assert.equal(error, null);
    assert.deepEqual(inputs[0], { symbol: 'btcusd', type: 'long', entryPrice: '100', exitPrice: '110', positionSize: '2', stopLoss: '95', notes: 'Breakout, planned' });
  });

  it('reports missing required columns', () => {
    assert.match(tradesFromCsv('symbol,notes\nBTC,x').error, /Missing required columns/);
  });

  it('round-trips an export', () => {
    const rows = parseCsv(tradesToCsv(sample.slice(0, 3)));
    assert.equal(rows.length, 4);
    assert.equal(rows[1][1], sample[0].symbol);
  });
});

describe('big data', () => {
  it('analyses 5,000 trades quickly with no NaN anywhere', () => {
    const big = generateTrades({ count: 5000, seed: 11 });
    const started = performance.now();
    const report = analyze(big, { runs: 1000, horizon: 100 });
    const elapsed = performance.now() - started;
    assert.equal(report.stats.totalTrades, 5000);
    assert.equal(JSON.stringify(report).includes('NaN'), false);
    assert.ok(elapsed < 2000, `took ${elapsed.toFixed(0)}ms`);
  });
});
