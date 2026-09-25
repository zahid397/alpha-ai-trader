import { clamp, mean, pct, round2, std } from './math.js';
import { chronological } from './quant.js';
import { SESSIONS, minutesBetween, sessionLabel, sessionOf, weekKey } from './time.js';
import { exceededStopLoss, plannedRisk, sizeRatio } from './tradeModel.js';

// Behaviour engine: rule-based bias detection, structural patterns, the risk
// score and the "Trader DNA" profile. Deterministic and explainable: every
// finding carries the evidence that triggered it.

export const BIAS_LABELS = {
  lossAversion: 'Loss aversion',
  revengeTrading: 'Revenge trading',
  overconfidence: 'Overconfidence',
  fomo: 'FOMO / impulsive entries',
  riskManagement: 'Missing stop losses'
};

const NOTE_SIGNALS = {
  hoping: /hop(e|ing) for (a )?recovery|held (too long|past)|refused to (close|exit)/i,
  revenge: /revenge|tilt|win it back|make it back|straight back in/i,
  fomo: /\bfomo\b|no (proper )?setup|too quickly|chas(e|ed|ing)|impulsive/i
};

const shortDate = (t) => t.timestamp.slice(0, 10);
const usd = (v) => `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signedUsd = (v) => `${v < 0 ? '-' : '+'}${usd(v)}`;
const severityFor = (count, total, [medium, high]) => {
  const rate = total ? count / total : 0;
  return rate >= high ? 'high' : rate >= medium ? 'medium' : 'low';
};
const listEvidence = (items, max = 3) =>
  items.length > max ? `${items.slice(0, max).join('; ')}; +${items.length - max} more` : items.join('; ');

export function detectBehavioralBiases(trades = []) {
  const ordered = chronological(trades);
  const n = ordered.length;
  if (n < 3) return [];

  const biases = [];
  const wins = ordered.filter((t) => t.profit > 0);
  const losses = ordered.filter((t) => t.profit < 0);

  // Loss aversion: letting losers run past the plan.
  const lossSignals = [];
  const lossesWithStop = losses.filter((t) => Number.isFinite(t.stopLoss));
  const stopViolations = lossesWithStop.filter(exceededStopLoss);
  if (lossesWithStop.length >= 2 && stopViolations.length / lossesWithStop.length >= 0.2) {
    lossSignals.push(`${stopViolations.length} of ${lossesWithStop.length} losing trades closed beyond the planned stop loss`);
  }
  const avgWinDuration = mean(wins.map((t) => t.duration || 0));
  const avgLossDuration = mean(losses.map((t) => t.duration || 0));
  if (wins.length && losses.length >= 3 && avgLossDuration > avgWinDuration * 1.3) {
    lossSignals.push(`losers held ${Math.round(avgLossDuration)}min on average vs ${Math.round(avgWinDuration)}min for winners`);
  }
  const avgWin = mean(wins.map((t) => t.profit));
  const avgLoss = Math.abs(mean(losses.map((t) => t.profit)));
  if (wins.length >= 3 && losses.length >= 3 && avgLoss > avgWin * 1.2) {
    lossSignals.push(`average loss ${usd(avgLoss)} is larger than average win ${usd(avgWin)}`);
  }
  const hopingNotes = losses.filter((t) => NOTE_SIGNALS.hoping.test(t.notes || ''));
  if (hopingNotes.length) lossSignals.push(`journal notes mention holding and hoping for a recovery (${hopingNotes.length} trades)`);
  if (lossSignals.length) {
    const occurrences = Math.max(stopViolations.length, hopingNotes.length);
    biases.push({
      type: 'lossAversion',
      severity: lossSignals.length >= 2 || stopViolations.length / Math.max(1, lossesWithStop.length) >= 0.4 ? 'high' : 'medium',
      confidence: Math.min(95, 55 + lossSignals.length * 12),
      occurrences,
      costUsd: round2(stopViolations.reduce((s, t) => s + Math.max(0, Math.abs(t.profit) - (plannedRisk(t) || 0)), 0)),
      description: 'Letting losing trades run instead of honouring planned exits',
      evidence: lossSignals.join('; '),
      recommendation: 'Place the stop loss as a hard order at entry and never widen it once the trade is live.'
    });
  }

  // Revenge trading: sizing up, or jumping straight back in, after a loss.
  const revengeEvents = new Map();
  for (let i = 1; i < n; i++) {
    const prev = ordered[i - 1];
    const cur = ordered[i];
    if (!(prev.profit < 0)) continue;
    const ratio = sizeRatio(prev, cur);
    const gap = minutesBetween(prev, cur);
    if (ratio >= 1.3) revengeEvents.set(cur.id, { trade: cur, text: `size up ${ratio.toFixed(1)}x right after a losing ${prev.symbol} trade (${shortDate(cur)})` });
    else if (gap >= 0 && gap <= 30) revengeEvents.set(cur.id, { trade: cur, text: `re-entered ${Math.round(gap)}min after a loss (${cur.symbol}, ${shortDate(cur)})` });
  }
  for (const t of ordered) {
    if (!revengeEvents.has(t.id) && NOTE_SIGNALS.revenge.test(t.notes || '')) {
      revengeEvents.set(t.id, { trade: t, text: `journal note flags a revenge trade (${t.symbol}, ${shortDate(t)})` });
    }
  }
  if (revengeEvents.size) {
    const events = [...revengeEvents.values()];
    const eventPl = events.reduce((s, e) => s + e.trade.profit, 0);
    biases.push({
      type: 'revengeTrading',
      severity: revengeEvents.size >= 3 && revengeEvents.size / Math.max(1, losses.length) >= 0.2 ? 'high' : 'medium',
      confidence: Math.min(92, 50 + revengeEvents.size * 6),
      occurrences: revengeEvents.size,
      costUsd: round2(Math.max(0, -eventPl)),
      description: 'Trading bigger or faster to win back a loss',
      evidence: `${revengeEvents.size} revenge trade${revengeEvents.size > 1 ? 's' : ''} (net ${signedUsd(eventPl)}): ${listEvidence(events.map((e) => e.text))}`,
      recommendation: 'After any loss, wait 30 minutes and keep the same or smaller size. After two losses in a row, stop for the day.'
    });
  }

  // Overconfidence: sizing well above normal after a winning run.
  const risks = ordered.map(plannedRisk).filter((r) => r !== null);
  const avgRisk = mean(risks);
  const overconfidenceEvents = [];
  let winRun = 0;
  for (let i = 0; i < n; i++) {
    const cur = ordered[i];
    const risk = plannedRisk(cur);
    if (winRun >= 2 && risk !== null && avgRisk > 0 && risk >= avgRisk * 1.3) {
      overconfidenceEvents.push({ trade: cur, text: `${cur.symbol} risk ${(risk / avgRisk).toFixed(1)}x your average after ${winRun} straight wins (${shortDate(cur)})` });
    }
    winRun = cur.profit > 0 ? winRun + 1 : 0;
  }
  if (overconfidenceEvents.length) {
    const eventPl = overconfidenceEvents.reduce((s, e) => s + e.trade.profit, 0);
    biases.push({
      type: 'overconfidence',
      severity: overconfidenceEvents.length >= 3 && overconfidenceEvents.length / n >= 0.05 ? 'high' : 'medium',
      confidence: Math.min(90, 55 + overconfidenceEvents.length * 8),
      occurrences: overconfidenceEvents.length,
      costUsd: round2(Math.max(0, -eventPl)),
      description: 'Increasing risk after a winning run',
      evidence: listEvidence(overconfidenceEvents.map((e) => e.text)),
      recommendation: 'Keep risk per trade fixed by rule (e.g. 1% of the account) regardless of recent results.'
    });
  }

  // FOMO / impulsive entries, taken from the trade journal.
  const fomoTrades = ordered.filter((t) => NOTE_SIGNALS.fomo.test(t.notes || ''));
  if (fomoTrades.length) {
    const eventPl = fomoTrades.reduce((s, t) => s + t.profit, 0);
    biases.push({
      type: 'fomo',
      severity: severityFor(fomoTrades.length, n, [0.03, 0.1]),
      confidence: Math.min(88, 50 + fomoTrades.length * 6),
      occurrences: fomoTrades.length,
      costUsd: round2(Math.max(0, -eventPl)),
      description: 'Entering without a valid setup',
      evidence: `${fomoTrades.length} impulsive entr${fomoTrades.length > 1 ? 'ies' : 'y'} (net ${signedUsd(eventPl)}): ${listEvidence(fomoTrades.map((t) => `${t.symbol} ${shortDate(t)} "${t.notes}"`), 2)}`,
      recommendation: 'Write the setup, entry, stop and target before clicking buy. No checklist, no trade.'
    });
  }

  // Missing stops.
  const noStop = ordered.filter((t) => !Number.isFinite(t.stopLoss));
  if (noStop.length && noStop.length / n >= 0.03) {
    biases.push({
      type: 'riskManagement',
      severity: noStop.length / n >= 0.3 ? 'high' : 'medium',
      confidence: 95,
      occurrences: noStop.length,
      costUsd: round2(Math.max(0, -noStop.reduce((s, t) => s + t.profit, 0))),
      description: 'Trades opened without a stop loss',
      evidence: `${noStop.length} of ${n} trades have no stop loss recorded`,
      recommendation: 'Every trade needs a predefined stop loss before entry.'
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return biases.sort((a, b) => order[a.severity] - order[b.severity] || b.costUsd - a.costUsd);
}

// Structural patterns: streaks, sizing reactions and time-of-day edges.
export function detectPatterns(trades = []) {
  const ordered = chronological(trades);
  if (ordered.length < 3) return [];

  const patterns = [];
  let run = 0;
  let runType = 'none';
  for (const t of ordered) {
    const type = t.profit > 0 ? 'win' : t.profit < 0 ? 'loss' : 'none';
    run = type !== 'none' && type === runType ? run + 1 : type === 'none' ? 0 : 1;
    runType = type;
  }

  if (runType === 'win' && run >= 3) {
    patterns.push({ type: 'winningStreak', confidence: 85, description: `${run} consecutive winning trades`, implication: 'Risk of overconfidence bias: keep position sizes unchanged' });
  }
  if (runType === 'loss' && run >= 3) {
    patterns.push({ type: 'losingStreak', confidence: 90, description: `${run} consecutive losing trades`, implication: 'Possible tilt: consider pausing before the next trade' });
  }

  let upAfterLoss = 0;
  let downAfterWin = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const ratio = sizeRatio(prev, ordered[i]);
    if (prev.profit < 0 && ratio >= 1.5) upAfterLoss++;
    if (prev.profit > 0 && ratio <= 0.7) downAfterWin++;
  }
  if (upAfterLoss >= 2) {
    patterns.push({ type: 'martingalePattern', confidence: 75, description: `Risk increased 1.5x+ right after a loss (${upAfterLoss} times)`, implication: 'Potential revenge trading behavior' });
  }
  if (downAfterWin >= 2) {
    patterns.push({ type: 'riskAversionAfterWin', confidence: 70, description: `Risk cut 30%+ right after a win (${downAfterWin} times)`, implication: 'Missing profit opportunities due to fear' });
  }

  const overall = pct(ordered.filter((t) => t.profit > 0).length, ordered.length);
  const sessionOfTrade = new Map(ordered.map((t) => [t, sessionOf(t.timestamp)]));
  for (const session of SESSIONS) {
    const inSession = ordered.filter((t) => sessionOfTrade.get(t) === session);
    if (inSession.length < 5) continue;
    const winRate = pct(inSession.filter((t) => t.profit > 0).length, inSession.length);
    const profit = inSession.reduce((s, t) => s + t.profit, 0);
    if (winRate >= overall + 10 && profit > 0) {
      patterns.push({ type: 'sessionEdge', confidence: 70, description: `Win rate ${winRate.toFixed(0)}% in the ${sessionLabel(session)} vs ${overall.toFixed(0)}% overall`, implication: `Your edge lives in the ${session.name} session; focus there` });
    } else if (winRate <= overall - 10 && profit < 0) {
      patterns.push({ type: 'sessionWeakness', confidence: 70, description: `Win rate ${winRate.toFixed(0)}% in the ${sessionLabel(session)} vs ${overall.toFixed(0)}% overall`, implication: `Reduce size or stop trading the ${session.name} session` });
    }
  }

  return patterns;
}

const SEVERITY_WEIGHT = { high: 14, medium: 8, low: 4 };

// 0 (disciplined) .. 100 (very risky). Deterministic: no randomness.
// Behaviour contributes up to 45 points; results and drawdown the rest.
export function computeRiskScore(stats, biases = []) {
  if (!stats || !stats.totalTrades) return 0;
  let score = 10;
  score += Math.min(45, biases.reduce((s, b) => s + (SEVERITY_WEIGHT[b.severity] || 0), 0));
  if (stats.profitFactor < 1) score += 15;
  else if (stats.profitFactor < 1.3) score += 6;
  if (stats.winRate < 40) score += 8;
  score += clamp(stats.maxDrawdownPct || 0, 0, 30) * 0.8;
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
  return `Emotional trading detected: ${biases.map((b) => BIAS_LABELS[b.type] || b.type).join(', ')}`;
}

const GRADES = [
  [85, 'A'],
  [72, 'B'],
  [60, 'C'],
  [45, 'D'],
  [0, 'F']
];

/**
 * Trader DNA: five 0-100 scores that explain *why* results look the way
 * they do, plus the weighted Alpha Score and a letter grade.
 */
export function traderDNA(trades = [], stats, biases = []) {
  const ordered = chronological(trades);
  const n = ordered.length;
  if (n < 3) return null;

  const losses = ordered.filter((t) => t.profit < 0);
  const withStop = ordered.filter((t) => Number.isFinite(t.stopLoss));
  const lossesWithStop = losses.filter((t) => Number.isFinite(t.stopLoss));
  const violations = lossesWithStop.filter(exceededStopLoss).length;
  const occurrences = (type) => biases.find((b) => b.type === type)?.occurrences || 0;

  const stopUsage = withStop.length / n;
  const adherence = lossesWithStop.length ? 1 - violations / lossesWithStop.length : 1;
  const impulsiveRate = occurrences('fomo') / n;
  const discipline = 100 * (0.35 * stopUsage + 0.5 * adherence + 0.15 * clamp(1 - impulsiveRate * 5, 0, 1));

  const risks = ordered.map(plannedRisk).filter((r) => r !== null);
  const cv = risks.length >= 3 && mean(risks) > 0 ? std(risks) / mean(risks) : 0.5;
  const riskConsistency = clamp(1 - cv, 0, 1);
  const lossControl = stats.avgLoss > 0 ? clamp(stats.avgProfit / stats.avgLoss, 0, 1) : 1;
  const riskControl = 100 * (0.6 * riskConsistency + 0.4 * lossControl);

  const emotionalEvents = occurrences('revengeTrading') + occurrences('overconfidence') + occurrences('fomo');
  const emotional = 100 * clamp(1 - (emotionalEvents / n) * 3, 0, 1);

  const weeks = new Map();
  for (const t of ordered) {
    const key = weekKey(t.timestamp);
    weeks.set(key, (weeks.get(key) || 0) + t.profit);
  }
  const weekValues = [...weeks.values()];
  const consistency = weekValues.length ? pct(weekValues.filter((v) => v > 0).length, weekValues.length) : 0;

  const edge = 100 * clamp((stats.profitFactor - 0.6) / 1.4, 0, 1);

  const scores = [
    { key: 'discipline', label: 'Discipline', value: Math.round(discipline), detail: `${Math.round(stopUsage * 100)}% of trades had a stop; ${Math.round(adherence * 100)}% of stopped losses respected it` },
    { key: 'riskControl', label: 'Risk control', value: Math.round(riskControl), detail: `risk per trade varies ${Math.round(cv * 100)}%; avg win/loss ${stats.payoffRatio}` },
    { key: 'emotional', label: 'Emotional control', value: Math.round(emotional), detail: `${emotionalEvents} emotional trades (revenge, overconfidence, FOMO) out of ${n}` },
    { key: 'consistency', label: 'Consistency', value: Math.round(consistency), detail: `${weekValues.filter((v) => v > 0).length} of ${weekValues.length} weeks profitable` },
    { key: 'edge', label: 'Edge', value: Math.round(edge), detail: `profit factor ${stats.profitFactor}, expectancy $${stats.expectancy}/trade` }
  ];

  const weights = { discipline: 0.25, riskControl: 0.2, emotional: 0.2, consistency: 0.15, edge: 0.2 };
  const alphaScore = Math.round(scores.reduce((s, d) => s + d.value * weights[d.key], 0));
  const sorted = [...scores].sort((a, b) => b.value - a.value);

  return {
    scores,
    alphaScore,
    grade: GRADES.find(([min]) => alphaScore >= min)[1],
    strongest: sorted[0],
    weakest: sorted[sorted.length - 1]
  };
}
