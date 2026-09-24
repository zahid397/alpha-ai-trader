import { round2 } from '../lib/http.js';
import { extractJson, generateText } from './aiService.js';
import {
  buildBiasSummaryPrompt,
  buildChatSystemPrompt,
  buildCoachingPrompt,
  buildTradeAnalysisPrompt,
  money
} from './promptBuilder.js';
import { BIAS_LABELS, analyzeTrader } from './tradeAnalyzer.js';
import { exceededStopLoss, notional } from './tradeModel.js';

const RECENT_FOR_PROMPT = 8;
const label = (bias) => BIAS_LABELS[bias.type] || bias.type;
const bullet = (lines) => lines.map((line) => `- ${line}`).join('\n');

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function snapshotLine({ stats, riskScore, riskLevel }) {
  return `Across your ${stats.totalTrades} trades: win rate ${stats.winRate}%, net P/L ${money(stats.totalProfit)}, profit factor ${stats.profitFactor}, risk score ${riskScore}/100 (${riskLevel}).`;
}

export function ruleBasedChatReply(message, analysis) {
  const text = message.toLowerCase();
  const { stats, biases } = analysis;
  const has = (pattern) => pattern.test(text);

  if (!stats.totalTrades) {
    return 'You have no trades logged yet. Log a few trades with entry, exit, stop loss and a short note, and I can analyse your performance and spot behavioural biases.';
  }

  const biasTips = biases.map((b) => `${label(b)}: ${b.recommendation}`);

  if (has(/\b(hi|hello|hey|salam|assalamu|good (morning|afternoon|evening))\b/)) {
    return `Hello! I'm your AI Trading Coach. ${snapshotLine(analysis)}\nAsk me about your risk, win rate, patterns or a specific trade.`;
  }

  if (has(/risk|stop|drawdown|siz(e|ing)|position|leverage/)) {
    const riskBiases = biases.filter((b) => ['lossAversion', 'revengeTrading', 'overconfidence', 'riskManagement'].includes(b.type));
    const actions = riskBiases.length
      ? riskBiases.map((b) => `${label(b)}: ${b.recommendation}`)
      : ['Keep risking a fixed 1% of your account per trade.'];
    return `Your risk score is ${analysis.riskScore}/100 (${analysis.riskLevel}). Max drawdown is $${stats.maxDrawdown}, and your average loss ($${stats.avgLoss}) vs average win ($${stats.avgProfit}) shows how much each mistake costs.\n${bullet(actions.slice(0, 3))}`;
  }

  if (has(/bias|pattern|psycholog|emotion|tilt|revenge|fomo|mistake|habit|behavio/)) {
    if (!biases.length) {
      return `No significant behavioural biases in your ${stats.totalTrades} trades. Keep journaling every trade so drift gets caught early.`;
    }
    return `I found ${biases.length} behavioural pattern${biases.length > 1 ? 's' : ''} in your history:\n${bullet(
      biases.slice(0, 3).map((b) => `${label(b)} (${b.severity}): ${b.evidence}`)
    )}\nStart with: ${biases[0].recommendation}`;
  }

  if (has(/win ?rate|improve|better|tips?|increase|consisten/)) {
    const tips = [
      stats.avgLoss > stats.avgProfit
        ? `Your average loss ($${stats.avgLoss}) is bigger than your average win ($${stats.avgProfit}). Fixing exits matters more than finding more winners.`
        : 'Your winners are bigger than your losers. Protect that edge by taking only A+ setups.',
      ...biasTips.slice(0, 2)
    ];
    return `Win rate is ${stats.winRate}% (${stats.wins} wins / ${stats.losses} losses) with expectancy ${money(stats.expectancy)} per trade.\n${bullet(tips)}`;
  }

  if (has(/analy[sz]|performance|stats|summary|review|how am i|recent|doing/)) {
    const streak = stats.currentStreak;
    return `${snapshotLine(analysis)}\n${bullet([
      `Best trade ${money(stats.bestTrade)}, worst trade ${money(stats.worstTrade)}.`,
      `Current streak: ${streak.length} ${streak.type === 'none' ? 'trades' : streak.type + (streak.length === 1 ? '' : 's')}.`,
      biases.length ? `Biggest issue: ${label(biases[0])}. ${biases[0].recommendation}` : 'No major behavioural issues detected.'
    ])}`;
  }

  return `${snapshotLine(analysis)}\n${
    biases.length
      ? `Your top priority: ${label(biases[0])}. ${biases[0].recommendation}`
      : 'Stay disciplined: same size, predefined stop, journal every trade.'
  }`;
}

export async function coachChat(env, trades, { message, history = [] }) {
  const analysis = analyzeTrader(trades);
  const result = await generateText(env, {
    system: buildChatSystemPrompt(analysis, trades.slice(0, RECENT_FOR_PROMPT)),
    messages: [...history, { role: 'user', content: message }],
    temperature: 0.5,
    maxTokens: 450
  });

  if (result) return { reply: result.text, source: result.source };
  return { reply: ruleBasedChatReply(message, analysis), source: 'rules' };
}

// ---------------------------------------------------------------------------
// Single trade analysis
// ---------------------------------------------------------------------------

const JOURNAL_FLAGS = [
  { pattern: /\bfomo\b|no (proper )?setup|too quickly|chas(e|ed|ing)|impulsive/i, text: 'Journal note points to an impulsive / FOMO entry' },
  { pattern: /revenge|tilt|win it back|make it back/i, text: 'Journal note flags a revenge trade' },
  { pattern: /hop(e|ing) for (a )?recovery|held too long/i, text: 'Journal note says the loser was held hoping for a recovery' }
];

export function ruleBasedTradeAnalysis(trade, trades = []) {
  const isWin = trade.profit > 0;
  const size = notional(trade);
  const avgSize = trades.length ? trades.reduce((s, t) => s + notional(t), 0) / trades.length : size;
  const sizeRatio = avgSize ? size / avgSize : 1;
  const hasStop = Number.isFinite(trade.stopLoss);
  const hasTarget = Number.isFinite(trade.takeProfit);
  const plannedRisk = hasStop ? Math.abs(trade.entryPrice - trade.stopLoss) * trade.positionSize : null;
  const rMultiple = plannedRisk ? trade.profit / plannedRisk : null;
  const stopExceeded = exceededStopLoss(trade);
  const targetReached =
    hasTarget && (trade.type === 'buy' ? trade.exitPrice >= trade.takeProfit : trade.exitPrice <= trade.takeProfit);
  const journalFlags = JOURNAL_FLAGS.filter((f) => f.pattern.test(trade.notes || '')).map((f) => f.text);

  const successFactors = [];
  if (hasStop) successFactors.push('Defined a stop loss before entry');
  if (hasTarget) successFactors.push('Planned a profit target');
  if (isWin && rMultiple !== null && rMultiple >= 1) successFactors.push(`Captured ${rMultiple.toFixed(1)}R on planned risk`);
  if (targetReached) successFactors.push('Reached the planned profit target');
  if (!isWin && hasStop && !stopExceeded) successFactors.push('Loss was contained at the planned stop');
  if (sizeRatio <= 1.1) successFactors.push('Position size in line with your average');

  const mistakes = [...journalFlags];
  if (stopExceeded) {
    mistakes.push(`Closed beyond the planned stop: planned risk $${plannedRisk.toFixed(2)}, actual loss $${Math.abs(trade.profit).toFixed(2)}`);
  }
  if (!hasStop) mistakes.push('No stop loss recorded');
  if (sizeRatio >= 1.5) mistakes.push(`Position was ${sizeRatio.toFixed(1)}x your average size`);
  if (isWin && hasTarget && !targetReached) mistakes.push('Exited before the planned target');

  let confidenceScore = 70;
  if (hasStop && !stopExceeded) confidenceScore += 10;
  if (stopExceeded) confidenceScore -= 25;
  if (!hasStop) confidenceScore -= 20;
  if (rMultiple !== null && rMultiple >= 1) confidenceScore += 10;
  if (sizeRatio >= 1.5) confidenceScore -= 10;
  confidenceScore -= journalFlags.length * 10;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  const improvementSuggestions = [];
  if (stopExceeded || !hasStop) improvementSuggestions.push('Place the stop as a hard order at entry and never move it further away');
  if (sizeRatio >= 1.5) improvementSuggestions.push('Size positions by a fixed % of account risk, not by conviction');
  if (journalFlags.length) improvementSuggestions.push('Run a pre-trade checklist (setup, entry, stop, target) before every order');
  if (isWin && hasTarget && !targetReached) improvementSuggestions.push('Scale out at the target or trail the stop instead of exiting early');
  improvementSuggestions.push('Review this trade in your journal within 24 hours');

  const riskAssessment = sizeRatio >= 1.5 || !hasStop || stopExceeded ? 'high' : sizeRatio >= 1.1 ? 'medium' : 'low';

  const behavioralInsights = stopExceeded
    ? 'The trade was held past its planned exit, a classic loss-aversion signal. Losses should be taken at the level you chose when you were calm.'
    : journalFlags.length
      ? `${journalFlags[0]}. Emotional entries tend to have worse risk/reward than planned setups.`
      : isWin
        ? 'Plan-driven execution: entry, stop and exit followed a defined plan.'
        : 'A controlled loss inside the plan is part of trading, not a mistake.';

  return {
    successFactors,
    mistakes,
    confidenceScore,
    behavioralInsights,
    improvementSuggestions,
    riskAssessment,
    technicalAnalysis: trade.notes
      ? `Trader notes: "${trade.notes}". No live market data is attached; review the chart around ${trade.timestamp.slice(0, 10)} to validate the setup.`
      : 'No notes or market data recorded for this trade. Add a short setup note so future analysis can judge the entry.',
    metrics: {
      notional: round2(size),
      sizeVsAverage: round2(sizeRatio),
      plannedRisk: plannedRisk === null ? null : round2(plannedRisk),
      rMultiple: rMultiple === null ? null : round2(rMultiple),
      stopLossRespected: hasStop ? !stopExceeded : null,
      targetReached: hasTarget ? targetReached : null
    }
  };
}

const stringList = (value) =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') && value.length ? value : null;
const nonEmptyString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// Trust the AI only for fields it returned in the expected shape.
function mergeAnalysis(base, ai) {
  const score = Number(ai.confidenceScore);
  const risk = typeof ai.riskAssessment === 'string' ? ai.riskAssessment.toLowerCase() : '';
  return {
    successFactors: stringList(ai.successFactors) || base.successFactors,
    mistakes: stringList(ai.mistakes) || base.mistakes,
    confidenceScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : base.confidenceScore,
    behavioralInsights: nonEmptyString(ai.behavioralInsights) || base.behavioralInsights,
    improvementSuggestions: stringList(ai.improvementSuggestions) || base.improvementSuggestions,
    riskAssessment: ['low', 'medium', 'high'].includes(risk) ? risk : base.riskAssessment,
    technicalAnalysis: nonEmptyString(ai.technicalAnalysis) || base.technicalAnalysis,
    metrics: base.metrics
  };
}

export async function analyzeTrade(env, trade, trades, marketCondition) {
  const base = ruleBasedTradeAnalysis(trade, trades);
  const prompt = buildTradeAnalysisPrompt(trade, analyzeTrader(trades), marketCondition);
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.3,
    maxTokens: 700,
    json: true
  });

  const parsed = result && extractJson(result.text);
  if (parsed) return { analysis: mergeAnalysis(base, parsed), source: result.source };
  return { analysis: base, source: 'rules' };
}

// ---------------------------------------------------------------------------
// Advice and bias report
// ---------------------------------------------------------------------------

export async function coachingAdvice(env, trades, marketContext, traderProfile) {
  const analysis = analyzeTrader(trades);
  const prompt = buildCoachingPrompt(marketContext, traderProfile, analysis, trades.slice(0, RECENT_FOR_PROMPT));
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.4,
    maxTokens: 300
  });

  if (result) return { advice: result.text, source: result.source };

  const top = analysis.biases[0];
  const risk = analysis.riskLevel === 'high' ? 'High' : analysis.riskLevel === 'moderate' ? 'Medium' : 'Low';
  return {
    advice: `Market read: no setup justifies skipping your plan, so wait for one of your predefined setups to appear. | Risk level: ${risk} (score ${analysis.riskScore}/100) | Action: define entry, stop and target before the order and risk at most 1% of your account. | Psychology: ${
      top ? `${label(top)}: ${top.recommendation}` : 'your recent behaviour is disciplined, so keep the same process.'
    }`,
    source: 'rules'
  };
}

export async function biasReport(env, trades) {
  const analysis = analyzeTrader(trades);
  const report = {
    detectedBiases: analysis.biases,
    overallRiskScore: analysis.riskScore,
    riskLevel: analysis.riskLevel,
    behavioralPattern: analysis.behavioralPattern,
    patterns: analysis.patterns
  };

  if (!analysis.biases.length) {
    return { ...report, summary: 'No significant behavioural biases detected. Keep following your plan and journaling every trade.', source: 'rules' };
  }

  const prompt = buildBiasSummaryPrompt(analysis);
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.4,
    maxTokens: 250
  });

  const top = analysis.biases[0];
  return {
    ...report,
    summary: result
      ? result.text
      : `Your biggest behavioural risk is ${label(top).toLowerCase()} (${top.severity}): ${top.evidence}. ${top.recommendation}`,
    source: result ? result.source : 'rules'
  };
}
