import { Hono } from 'hono';
import {
  analyzeTrader,
  categorizeTrades,
  computeStats,
  dailyPnL,
  generateHeatmapData,
  symbolPerformance
} from '../services/tradeAnalyzer.js';

const history = new Hono();
const DAY_MS = 24 * 60 * 60 * 1000;

// Complete history with stats, period comparison, patterns and chart data.
history.get('/', async (c) => {
  const trades = await c.get('store').listTrades();
  const analysis = analyzeTrader(trades);
  const categorized = categorizeTrades(trades);

  const now = Date.now();
  const since = (days) => trades.filter((t) => new Date(t.timestamp).getTime() >= now - days * DAY_MS);
  const { daily, cumulative } = dailyPnL(trades, 30);
  const { stats } = analysis;

  return c.json({
    success: true,
    summary: {
      totalTrades: stats.totalTrades,
      totalProfit: stats.totalProfit,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      sharpeRatio: stats.sharpeRatio,
      maxDrawdown: stats.maxDrawdown,
      riskScore: analysis.riskScore,
      riskLevel: analysis.riskLevel
    },
    periodComparison: {
      weekly: computeStats(since(7)),
      monthly: computeStats(since(30)),
      allTime: stats
    },
    symbolPerformance: symbolPerformance(trades),
    patterns: {
      technical: analysis.patterns,
      behavioral: analysis.biases
    },
    behavioralPattern: analysis.behavioralPattern,
    chartData: { daily, cumulative },
    heatmap: generateHeatmapData(trades),
    recentTrades: trades.slice(0, 15),
    categories: {
      byOutcome: { wins: stats.wins, losses: stats.losses, breakEven: stats.breakEven },
      byDuration: {
        scalps: categorized.filter((t) => t.category.isScalp).length,
        swings: categorized.filter((t) => t.category.isSwing).length,
        longTerm: categorized.filter((t) => t.category.isLongTerm).length
      }
    }
  });
});

export default history;
