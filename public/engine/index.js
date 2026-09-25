// Alpha Engine: the built-in, key-free AI trading coach.
//
//   quant.js      performance statistics, equity curve, breakdowns
//   behavior.js   bias detection, patterns, risk score, Trader DNA
//   montecarlo.js bootstrap simulation of future results
//   nlu.js        ML intent classifier for chat questions
//   synthesis.js  grounded natural-language answers
//
// Pure ES modules with no dependencies: the same code runs in the Worker /
// Vercel function and directly in the browser (offline mode).

import { BIAS_LABELS, computeRiskScore, detectBehavioralBiases, detectPatterns, riskLevel, summarizeBehavior, traderDNA } from './behavior.js';
import { round2 } from './math.js';
import { monteCarlo, tradesFingerprint } from './montecarlo.js';
import { DEFAULT_STARTING_BALANCE, breakdowns, chronological, computeStats, equityCurve } from './quant.js';
import { understand } from './nlu.js';
import { answerQuestion } from './synthesis.js';

export const ENGINE_NAME = 'Alpha Engine';
export const ENGINE_VERSION = '3.0.0';

const money = (v) => `${v < 0 ? '-' : '+'}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Ranked, human-readable findings for the dashboard.
export function generateInsights(report) {
  const insights = [];
  const { stats, breakdowns: bd, biases, monteCarlo: mc, dna } = report;
  if (!stats.totalTrades) return insights;

  const leak = [...biases].sort((a, b) => b.costUsd - a.costUsd)[0];
  if (leak && leak.costUsd > 0) {
    insights.push({ kind: 'leak', tone: 'negative', title: `${BIAS_LABELS[leak.type]} cost you ~$${Math.round(leak.costUsd).toLocaleString('en-US')}`, detail: leak.recommendation });
  }

  const sessions = bd.bySession.filter((s) => s.trades >= 3).sort((a, b) => b.profit - a.profit);
  if (sessions.length >= 2) {
    const best = sessions[0];
    const worst = sessions[sessions.length - 1];
    insights.push({ kind: 'edge', tone: 'positive', title: `Your edge: ${best.session} session (${money(best.profit)})`, detail: `${best.winRate}% win rate over ${best.trades} trades, ${best.hours}.` });
    if (worst.profit < 0) insights.push({ kind: 'leak', tone: 'negative', title: `${worst.session} session loses money (${money(worst.profit)})`, detail: `${worst.winRate}% win rate over ${worst.trades} trades. Consider skipping it.` });
  }

  const symbols = bd.bySymbol.filter((s) => s.trades >= 3);
  if (symbols.length >= 2 && symbols[symbols.length - 1].profit < 0) {
    const w = symbols[symbols.length - 1];
    insights.push({ kind: 'leak', tone: 'negative', title: `${w.symbol} is your weakest market (${money(w.profit)})`, detail: `${w.winRate}% win rate, ${w.avgR}R average over ${w.trades} trades.` });
  }

  if (mc) {
    insights.push({
      kind: 'forecast',
      tone: mc.probProfit >= 60 ? 'positive' : 'negative',
      title: `${mc.probProfit}% chance of profit over the next ${mc.horizon} trades`,
      detail: `Median ${money(mc.final.p50 - mc.startingBalance)}, risk of ruin ${mc.riskOfRuin}% (Monte Carlo, ${mc.runs.toLocaleString('en-US')} runs).`
    });
  }

  // Only months with enough trades to be meaningful.
  const months = bd.monthly.filter((m) => m.trades >= 8);
  if (months.length >= 3) {
    const first = months[0];
    const last = months[months.length - 1];
    const delta = last.winRate - first.winRate;
    const name = (key) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    insights.push({
      kind: 'trend',
      tone: delta >= 0 ? 'positive' : 'negative',
      title: `Win rate ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta).toFixed(1)} pts since ${name(first.month)}`,
      detail: `${first.winRate.toFixed(1)}% in ${name(first.month)} vs ${last.winRate.toFixed(1)}% in ${name(last.month)} (months with 8+ trades).`
    });
  }

  if (dna) {
    insights.push({ kind: 'dna', tone: 'neutral', title: `Strongest trait: ${dna.strongest.label} (${dna.strongest.value})`, detail: `Biggest opportunity: ${dna.weakest.label} (${dna.weakest.value}). ${dna.weakest.detail}.` });
  }

  return insights;
}

// Small LRU cache: repeated chat/dashboard calls on the same journal reuse
// the report instead of re-running the analysis and simulation.
const CACHE_SIZE = 4;
const cache = new Map();

/**
 * Analyse a trade journal. Returns everything the dashboard, the coach and
 * the API need in one object.
 */
export function analyze(trades = [], { startingBalance = DEFAULT_STARTING_BALANCE, horizon = 50, runs = 1000, simulate = true } = {}) {
  const key = `${tradesFingerprint(trades)}:${trades.length}:${startingBalance}:${horizon}:${simulate ? runs : 0}`;
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const stats = computeStats(trades, { startingBalance });
  const biases = detectBehavioralBiases(trades);
  const riskScore = computeRiskScore(stats, biases);
  const report = {
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    generatedAt: new Date().toISOString(),
    stats,
    equity: equityCurve(trades, { startingBalance }),
    breakdowns: breakdowns(trades),
    biases,
    patterns: detectPatterns(trades),
    riskScore,
    riskLevel: riskLevel(riskScore),
    behavioralPattern: summarizeBehavior(biases),
    dna: traderDNA(trades, stats, biases),
    monteCarlo: simulate ? monteCarlo(trades, { horizon, runs, startingBalance }) : null
  };
  report.insights = generateInsights(report);

  cache.set(key, report);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
  return report;
}

// Intents whose answers use the Monte Carlo simulation.
const SIMULATION_INTENTS = new Set(['forecast', 'risk']);

// Chat entry point: understand the question and answer from the report. The
// simulation only runs when the question needs it, keeping chat cheap.
export function ask(question, trades = [], options = {}) {
  const nlu = understand(question, { knownSymbols: [...new Set(trades.map((t) => t.symbol))] });
  const report = analyze(trades, { ...options, simulate: options.simulate ?? SIMULATION_INTENTS.has(nlu.intent) });
  return { ...answerQuestion(question, report, trades, nlu), engine: ENGINE_NAME };
}

export { chronological, computeStats, monteCarlo };
export { BIAS_LABELS } from './behavior.js';
export { analyzeTrade, biasSummary, coachingAdvice, money } from './synthesis.js';
export { understand } from './nlu.js';
export { generateSampleTrades, generateTrades } from './generator.js';
export { buildTrade, newTradeId, normalizeSeedTrade, toTrade, rMultiple, plannedRisk } from './tradeModel.js';
export { parseCsv, tradesFromCsv, tradesToCsv } from './csv.js';
