import { Hono } from 'hono';
import { analyze, computeStats } from '../../public/engine/index.js';
import { SERVER_ANALYSIS } from '../services/coachService.js';

const history = new Hono();
const DAY_MS = 24 * 60 * 60 * 1000;

// Complete history with stats, period comparison, patterns and chart data.
history.get('/', async (c) => {
  const trades = await c.get('store').listTrades();
  const report = analyze(trades, SERVER_ANALYSIS);
  const { stats, breakdowns } = report;

  const now = Date.now();
  const since = (days) => trades.filter((t) => new Date(t.timestamp).getTime() >= now - days * DAY_MS);

  return c.json({
    success: true,
    summary: {
      totalTrades: stats.totalTrades,
      totalProfit: stats.totalProfit,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      sharpeRatio: stats.sharpeRatio,
      maxDrawdown: stats.maxDrawdown,
      riskScore: report.riskScore,
      riskLevel: report.riskLevel,
      alphaScore: report.dna?.alphaScore ?? null
    },
    periodComparison: {
      weekly: computeStats(since(7)),
      monthly: computeStats(since(30)),
      allTime: stats
    },
    symbolPerformance: breakdowns.bySymbol,
    patterns: { technical: report.patterns, behavioral: report.biases },
    behavioralPattern: report.behavioralPattern,
    chartData: { equity: report.equity, monthly: breakdowns.monthly, weekly: breakdowns.weekly },
    heatmap: breakdowns.heatmap,
    breakdowns,
    dna: report.dna,
    monteCarlo: report.monteCarlo,
    insights: report.insights,
    recentTrades: trades.slice(0, 15),
    categories: { byOutcome: { wins: stats.wins, losses: stats.losses, breakEven: stats.breakEven } }
  });
});

export default history;
