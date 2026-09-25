import { round2 } from '../lib/http.js';
import { exceededStopLoss, notional } from './tradeModel.js';

// All analysis runs on chronological (oldest -> newest) order. Storage hands
// trades back newest first, so every public function sorts its own copy.
export function chronological(trades = []) {
  return [...trades].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

const sum = (values) => values.reduce((total, v) => total + v, 0);
const mean = (values) => (values.length ? sum(values) / values.length : 0);
const pct = (part, whole) => (whole ? (part / whole) * 100 : 0);

export const BIAS_LABELS = {
  lossAversion: 'Loss aversion',
  revengeTrading: 'Revenge trading',
  overconfidence: 'Overconfidence',
  fomo: 'FOMO / impulsive entries',
  riskManagement: 'Missing stop losses'
};

function streakInfo(ordered) {
  let maxWins = 0;
  let maxLosses = 0;
  let run = 0;
  let runType = 'none';

  for (const trade of ordered) {
    const type = trade.profit > 0 ? 'win' : trade.profit < 0 ? 'loss' : 'none';
    run = type !== 'none' && type === runType ? run + 1 : type === 'none' ? 0 : 1;
    runType = type;
    if (type === 'win') maxWins = Math.max(maxWins, run);
    if (type === 'loss') maxLosses = Math.max(maxLosses, run);
  }

  return {
    currentStreak: { type: runType, length: runType === 'none' ? 0 : run },
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses
  };
}

export function computeStats(trades = []) {
  const ordered = chronological(trades);
  const n = ordered.length;
  const profits = ordered.map((t) => t.profit);
  const wins = ordered.filter((t) => t.profit > 0);
  const losses = ordered.filter((t) => t.profit < 0);

  const grossProfit = sum(wins.map((t) => t.profit));
  const grossLoss = Math.abs(sum(losses.map((t) => t.profit)));
  const totalProfit = sum(profits);

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const profit of profits) {
    running += profit;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  // Per-trade Sharpe-style ratio: mean P/L over its sample standard deviation.
  let sharpeRatio = 0;
  if (n >= 2) {
    const avg = mean(profits);
    const variance = sum(profits.map((p) => (p - avg) ** 2)) / (n - 1);
    const std = Math.sqrt(variance);
    sharpeRatio = std === 0 ? 0 : avg / std;
  }

  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;

  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    breakEven: n - wins.length - losses.length,
    winRate: round2(pct(wins.length, n)),
    totalProfit: round2(totalProfit),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    avgProfit: round2(mean(wins.map((t) => t.profit))),
    avgLoss: round2(Math.abs(mean(losses.map((t) => t.profit)))),
    profitFactor: round2(profitFactor),
    maxDrawdown: round2(maxDrawdown),
    sharpeRatio: round2(sharpeRatio),
    expectancy: round2(n ? totalProfit / n : 0),
    bestTrade: n ? Math.max(...profits) : 0,
    worstTrade: n ? Math.min(...profits) : 0,
    avgWinDuration: Math.round(mean(wins.map((t) => t.duration || 0))),
    avgLossDuration: Math.round(mean(losses.map((t) => t.duration || 0))),
    ...streakInfo(ordered)
  };
}

const SESSIONS = [
  { name: 'Asian', from: 0, to: 7 },
  { name: 'European', from: 7, to: 13 },
  { name: 'US', from: 13, to: 21 },
  { name: 'Late US', from: 21, to: 24 }
];

function sessionOf(trade) {
  const hour = new Date(trade.timestamp).getUTCHours();
  return SESSIONS.find((s) => hour >= s.from && hour < s.to);
}

// Structural patterns: streaks, sizing reactions and time-of-day edges.
export function detectPatterns(trades = []) {
  const ordered = chronological(trades);
  if (ordered.length < 3) return [];

  const patterns = [];
  const { currentStreak } = streakInfo(ordered);

  if (currentStreak.type === 'win' && currentStreak.length >= 3) {
    patterns.push({
      type: 'winningStreak',
      confidence: 85,
      description: `${currentStreak.length} consecutive winning trades`,
      implication: 'Risk of overconfidence bias: keep position sizes unchanged'
    });
  }

  if (currentStreak.type === 'loss' && currentStreak.length >= 3) {
    patterns.push({
      type: 'losingStreak',
      confidence: 90,
      description: `${currentStreak.length} consecutive losing trades`,
      implication: 'Possible tilt: consider pausing before the next trade'
    });
  }

  let upAfterLoss = 0;
  let downAfterWin = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const ratio = notional(ordered[i]) / (notional(prev) || 1);
    if (prev.profit < 0 && ratio >= 1.5) upAfterLoss++;
    if (prev.profit > 0 && ratio <= 0.7) downAfterWin++;
  }

  if (upAfterLoss >= 2) {
    patterns.push({
      type: 'martingalePattern',
      confidence: 75,
      description: `Position size increased 1.5x+ right after a loss (${upAfterLoss} times)`,
      implication: 'Potential revenge trading behavior'
    });
  }

  if (downAfterWin >= 2) {
    patterns.push({
      type: 'riskAversionAfterWin',
      confidence: 70,
      description: `Position size cut 30%+ right after a win (${downAfterWin} times)`,
      implication: 'Missing profit opportunities due to fear'
    });
  }

  const overallWinRate = pct(ordered.filter((t) => t.profit > 0).length, ordered.length);
  for (const session of SESSIONS) {
    const inSession = ordered.filter((t) => sessionOf(t) === session);
    if (inSession.length < 3) continue;
    const winRate = pct(inSession.filter((t) => t.profit > 0).length, inSession.length);
    const label = `${session.name} session (${String(session.from).padStart(2, '0')}-${String(session.to).padStart(2, '0')} UTC)`;

    if (winRate >= overallWinRate + 15) {
      patterns.push({
        type: 'sessionEdge',
        confidence: 70,
        description: `Win rate ${winRate.toFixed(0)}% in the ${label} vs ${overallWinRate.toFixed(0)}% overall`,
        implication: `Consider focusing on the ${session.name} session`
      });
    } else if (winRate <= overallWinRate - 15) {
      patterns.push({
        type: 'sessionWeakness',
        confidence: 70,
        description: `Win rate ${winRate.toFixed(0)}% in the ${label} vs ${overallWinRate.toFixed(0)}% overall`,
        implication: `Reduce size or avoid trading the ${session.name} session`
      });
    }
  }

  return patterns;
}

const NOTE_SIGNALS = {
  hoping: /hop(e|ing) for (a )?recovery|held too long|refused to (close|exit)/i,
  revenge: /revenge|tilt|win it back|make it back/i,
  fomo: /\bfomo\b|no (proper )?setup|too quickly|chas(e|ed|ing)|impulsive/i
};

const shortDate = (t) => t.timestamp.slice(0, 10);

// Rule-based behavioural bias detection. Deterministic and free, so it is the
// source of truth for biases and the risk score; AI only adds narrative.
export function detectBehavioralBiases(trades = []) {
  const ordered = chronological(trades);
  if (ordered.length < 3) return [];

  const biases = [];
  const wins = ordered.filter((t) => t.profit > 0);
  const losses = ordered.filter((t) => t.profit < 0);
  const avgNotional = mean(ordered.map(notional));

  // Loss aversion: letting losers run past the plan.
  const lossSignals = [];
  const lossesWithStop = losses.filter((t) => Number.isFinite(t.stopLoss));
  const stopViolations = lossesWithStop.filter(exceededStopLoss);
  if (lossesWithStop.length >= 2 && stopViolations.length / lossesWithStop.length >= 0.5) {
    lossSignals.push(`${stopViolations.length} of ${lossesWithStop.length} losing trades closed beyond the planned stop loss`);
  }
  const avgWinDuration = mean(wins.map((t) => t.duration || 0));
  const avgLossDuration = mean(losses.map((t) => t.duration || 0));
  if (wins.length && losses.length >= 3 && avgLossDuration > avgWinDuration * 1.5) {
    lossSignals.push(`losers held ${Math.round(avgLossDuration)}min on average vs ${Math.round(avgWinDuration)}min for winners`);
  }
  const avgWin = mean(wins.map((t) => t.profit));
  const avgLoss = Math.abs(mean(losses.map((t) => t.profit)));
  if (wins.length >= 3 && losses.length >= 3 && avgLoss > avgWin * 1.2) {
    lossSignals.push(`average loss $${avgLoss.toFixed(2)} is larger than average win $${avgWin.toFixed(2)}`);
  }
  const hopingNotes = losses.filter((t) => NOTE_SIGNALS.hoping.test(t.notes || ''));
  if (hopingNotes.length) {
    lossSignals.push(`journal notes mention holding and hoping for a recovery (${hopingNotes.length} trades)`);
  }
  if (lossSignals.length) {
    biases.push({
      type: 'lossAversion',
      severity: lossSignals.length >= 2 ? 'high' : 'medium',
      confidence: Math.min(95, 55 + lossSignals.length * 12),
      description: 'Letting losing trades run instead of honouring planned exits',
      evidence: lossSignals.join('; '),
      recommendation: 'Place the stop loss as a hard order at entry and never widen it once the trade is live.'
    });
  }

  // Revenge trading: sizing up straight after a loss, or journal says so.
  const revengeEvents = new Map();
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    const ratio = notional(cur) / (notional(prev) || 1);
    if (prev.profit < 0 && ratio >= 1.25) {
      revengeEvents.set(cur.id, `size up ${ratio.toFixed(2)}x right after a losing ${prev.symbol} trade (${shortDate(cur)})`);
    }
  }
  for (const t of ordered) {
    if (!revengeEvents.has(t.id) && NOTE_SIGNALS.revenge.test(t.notes || '')) {
      revengeEvents.set(t.id, `journal note flags a revenge trade (${t.symbol}, ${shortDate(t)})`);
    }
  }
  if (revengeEvents.size) {
    biases.push({
      type: 'revengeTrading',
      severity: revengeEvents.size >= 2 ? 'high' : 'medium',
      confidence: Math.min(90, 50 + revengeEvents.size * 12),
      description: 'Trading bigger or faster to win back a loss',
      evidence: [...revengeEvents.values()].join('; '),
      recommendation: 'After any loss, the next trade uses the same or smaller size. After two losses in a row, stop for the day.'
    });
  }

  // Overconfidence: sizing well above normal right after back-to-back wins.
  const overconfidenceEvents = [];
  let winRun = 0;
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    if (winRun >= 2 && notional(cur) >= avgNotional * 1.3 && notional(cur) >= notional(ordered[i - 1])) {
      overconfidenceEvents.push(
        `${cur.symbol} position ${(notional(cur) / avgNotional).toFixed(2)}x your average size after ${winRun} straight wins (${shortDate(cur)})`
      );
    }
    winRun = cur.profit > 0 ? winRun + 1 : 0;
  }
  if (overconfidenceEvents.length) {
    biases.push({
      type: 'overconfidence',
      severity: overconfidenceEvents.length >= 2 ? 'high' : 'medium',
      confidence: Math.min(90, 55 + overconfidenceEvents.length * 12),
      description: 'Increasing risk after a winning run',
      evidence: overconfidenceEvents.join('; '),
      recommendation: 'Keep position sizing fixed by rule (e.g. 1% account risk) regardless of recent results.'
    });
  }

  // FOMO / impulsive entries, taken from the trade journal.
  const fomoTrades = ordered.filter((t) => NOTE_SIGNALS.fomo.test(t.notes || ''));
  if (fomoTrades.length) {
    biases.push({
      type: 'fomo',
      severity: fomoTrades.length >= 3 ? 'high' : fomoTrades.length === 2 ? 'medium' : 'low',
      confidence: Math.min(85, 50 + fomoTrades.length * 12),
      description: 'Entering without a valid setup',
      evidence: fomoTrades.map((t) => `${t.symbol} ${shortDate(t)}: "${t.notes}"`).join('; '),
      recommendation: 'Write the setup, entry, stop and target before clicking buy. No checklist, no trade.'
    });
  }

  // Missing stops.
  const noStop = ordered.filter((t) => !Number.isFinite(t.stopLoss));
  if (noStop.length && noStop.length / ordered.length >= 0.2) {
    biases.push({
      type: 'riskManagement',
      severity: noStop.length / ordered.length >= 0.5 ? 'high' : 'medium',
      confidence: 90,
      description: 'Trades opened without a stop loss',
      evidence: `${noStop.length} of ${ordered.length} trades have no stop loss recorded`,
      recommendation: 'Every trade needs a predefined stop loss before entry.'
    });
  }

  return biases;
}

const SEVERITY_WEIGHT = { high: 20, medium: 12, low: 6 };

// 0 (disciplined) .. 100 (very risky). Deterministic: no randomness.
export function computeRiskScore(stats, biases = []) {
  if (!stats || !stats.totalTrades) return 0;
  let score = 10;
  for (const bias of biases) score += SEVERITY_WEIGHT[bias.severity] || 0;
  if (stats.profitFactor < 1) score += 10;
  else if (stats.profitFactor < 1.5) score += 5;
  if (stats.winRate < 40) score += 10;
  if (stats.currentStreak?.type === 'loss' && stats.currentStreak.length >= 3) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function riskLevel(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

export function summarizeBehavior(biases = []) {
  if (!biases.length) return 'Disciplined, systematic trading: no significant biases detected';
  const names = biases.map((b) => BIAS_LABELS[b.type] || b.type).join(', ');
  return `Emotional trading detected: ${names}`;
}

export function categorizeTrades(trades = []) {
  return trades.map((trade) => {
    const size = notional(trade);
    return {
      ...trade,
      category: {
        isWin: trade.profit > 0,
        isBigWin: size > 0 && trade.profit > size * 0.02,
        isBigLoss: size > 0 && trade.profit < -size * 0.015,
        isScalp: (trade.duration || 0) < 60,
        isSwing: (trade.duration || 0) >= 60 && (trade.duration || 0) < 1440,
        isLongTerm: (trade.duration || 0) >= 1440
      }
    };
  });
}

export function generateHeatmapData(trades = []) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, profit: 0, trades: 0 }));
  const daily = Array.from({ length: 7 }, (_, day) => ({ day, profit: 0, trades: 0 }));
  const symbols = new Map();

  for (const trade of trades) {
    const date = new Date(trade.timestamp);
    const hour = hourly[date.getUTCHours()];
    const day = daily[date.getUTCDay()];
    hour.profit += trade.profit;
    hour.trades++;
    day.profit += trade.profit;
    day.trades++;

    const entry = symbols.get(trade.symbol) || { symbol: trade.symbol, profit: 0, trades: 0, wins: 0 };
    entry.profit += trade.profit;
    entry.trades++;
    if (trade.profit > 0) entry.wins++;
    symbols.set(trade.symbol, entry);
  }

  const roundProfit = (row) => ({ ...row, profit: round2(row.profit) });

  return {
    hourly: hourly.map(roundProfit),
    daily: daily.map(roundProfit),
    symbols: [...symbols.values()]
      .map(({ wins, ...s }) => ({ ...s, profit: round2(s.profit), winRate: round2(pct(wins, s.trades)) }))
      .sort((a, b) => b.profit - a.profit)
  };
}

export function symbolPerformance(trades = []) {
  const bySymbol = new Map();
  for (const trade of trades) {
    const entry = bySymbol.get(trade.symbol) || { trades: 0, wins: 0, profit: 0, notional: 0 };
    entry.trades++;
    entry.profit += trade.profit;
    entry.notional += notional(trade);
    if (trade.profit > 0) entry.wins++;
    bySymbol.set(trade.symbol, entry);
  }

  return [...bySymbol.entries()]
    .map(([symbol, s]) => ({
      symbol,
      trades: s.trades,
      winRate: round2(pct(s.wins, s.trades)),
      totalProfit: round2(s.profit),
      avgProfitPerTrade: round2(s.profit / s.trades),
      returnOnNotional: round2(pct(s.profit, s.notional))
    }))
    .sort((a, b) => b.totalProfit - a.totalProfit);
}

export function dailyPnL(trades = [], days = 30) {
  const byDate = new Map();
  for (const trade of trades) {
    const date = trade.timestamp.slice(0, 10);
    byDate.set(date, (byDate.get(date) || 0) + trade.profit);
  }

  const daily = [...byDate.entries()]
    .map(([date, profit]) => ({ date, profit: round2(profit) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-days);

  let cumulative = 0;
  const cumulativeData = daily.map((d) => {
    cumulative += d.profit;
    return { ...d, cumulative: round2(cumulative) };
  });

  return { daily, cumulative: cumulativeData };
}

// One-call summary used by the dashboard, coach and bias endpoints.
export function analyzeTrader(trades = []) {
  const stats = computeStats(trades);
  const biases = detectBehavioralBiases(trades);
  const riskScore = computeRiskScore(stats, biases);
  return {
    stats,
    biases,
    patterns: detectPatterns(trades),
    riskScore,
    riskLevel: riskLevel(riskScore),
    behavioralPattern: summarizeBehavior(biases)
  };
}
