import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sampleTrades from '../data/sampleTrades.json' with { type: 'json' };
import {
  analyzeTrader,
  computeRiskScore,
  computeStats,
  detectBehavioralBiases,
  detectPatterns,
  generateHeatmapData
} from '../src/services/tradeAnalyzer.js';
import { normalizeSeedTrade } from '../src/services/tradeModel.js';

const trades = sampleTrades.map(normalizeSeedTrade);

const hasNaN = (value) =>
  typeof value === 'number' ? Number.isNaN(value) : value && typeof value === 'object' ? Object.values(value).some(hasNaN) : false;

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

describe('computeStats', () => {
  it('computes stats for the sample trades', () => {
    const stats = computeStats(trades);
    assert.equal(stats.totalTrades, 15);
    assert.equal(stats.wins, 9);
    assert.equal(stats.losses, 6);
    assert.equal(stats.winRate, 60);
    assert.equal(stats.totalProfit, -14.52);
    assert.equal(stats.profitFactor, 0.99);
    assert.equal(stats.bestTrade, 348.25);
    assert.equal(stats.worstTrade, -497.5);
    assert.deepEqual(stats.currentStreak, { type: 'win', length: 2 });
  });

  it('never returns NaN, even with no trades, only wins or only losses', () => {
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

describe('detectBehavioralBiases', () => {
  it('finds the biases documented in the sample journal', () => {
    const types = detectBehavioralBiases(trades).map((b) => b.type);
    assert.deepEqual(types, ['lossAversion', 'revengeTrading', 'overconfidence', 'fomo']);
  });

  it('flags losing trades closed beyond their stop loss', () => {
    const lossAversion = detectBehavioralBiases(trades).find((b) => b.type === 'lossAversion');
    assert.match(lossAversion.evidence, /6 of 6 losing trades closed beyond the planned stop loss/);
  });

  it('reports nothing for a disciplined trader', () => {
    const disciplined = Array.from({ length: 6 }, (_, i) =>
      trade({ id: `d${i}`, timestamp: `2024-02-0${i + 1}T10:00:00Z`, notes: 'Planned setup' })
    );
    assert.deepEqual(detectBehavioralBiases(disciplined), []);
  });

  it('flags missing stop losses', () => {
    const noStops = Array.from({ length: 4 }, (_, i) =>
      trade({ id: `n${i}`, timestamp: `2024-03-0${i + 1}T10:00:00Z`, stopLoss: null })
    );
    const bias = detectBehavioralBiases(noStops).find((b) => b.type === 'riskManagement');
    assert.equal(bias.severity, 'high');
  });
});

describe('risk score and patterns', () => {
  it('is deterministic and within 0-100', () => {
    const first = analyzeTrader(trades).riskScore;
    assert.equal(analyzeTrader(trades).riskScore, first);
    assert.ok(first >= 0 && first <= 100);
    assert.equal(analyzeTrader(trades).riskLevel, 'high');
  });

  it('is 0 with no trades', () => {
    assert.equal(computeRiskScore(computeStats([]), []), 0);
  });

  it('detects a current losing streak from the most recent trades', () => {
    const series = [
      trade({ id: '1', timestamp: '2024-01-01T10:00:00Z', profit: 50 }),
      trade({ id: '2', timestamp: '2024-01-02T10:00:00Z', profit: -10, exitPrice: 99 }),
      trade({ id: '3', timestamp: '2024-01-03T10:00:00Z', profit: -10, exitPrice: 99 }),
      trade({ id: '4', timestamp: '2024-01-04T10:00:00Z', profit: -10, exitPrice: 99 })
    ];
    assert.ok(detectPatterns(series).some((p) => p.type === 'losingStreak'));
  });

  it('heatmap has per-symbol win rates without NaN', () => {
    const heatmap = generateHeatmapData(trades);
    assert.equal(hasNaN(heatmap), false);
    const sol = heatmap.symbols.find((s) => s.symbol === 'SOLUSD');
    assert.equal(sol.winRate, 100);
  });
});
