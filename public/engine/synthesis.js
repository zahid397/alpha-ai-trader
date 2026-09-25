import { mean, round2 } from './math.js';
import { monteCarlo } from './montecarlo.js';
import { understand } from './nlu.js';
import { BIAS_LABELS } from './behavior.js';
import { chronological, computeStats } from './quant.js';
import { exceededStopLoss, notional, plannedRisk, rMultiple } from './tradeModel.js';

// Synthesis engine: turns the numeric report into grounded natural-language
// coaching. Every sentence is built from the trader's own numbers, so answers
// are specific, reproducible and never hallucinated.

export const money = (value) => {
  const abs = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? '-' : value > 0 ? '+' : ''}$${abs}`;
};
const usd = (value) => `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = (bias) => BIAS_LABELS[bias.type] || bias.type;
const bullets = (lines) => lines.filter(Boolean).map((l) => `- ${l}`).join('\n');
const compose = (...parts) => parts.filter(Boolean).join('\n');
const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const ENGINE_INTRO = "I'm Alpha, the built-in trading coach. I run entirely on this app (no API key, no data sent anywhere)";

function headline({ stats, dna }) {
  return `Across your ${plural(stats.totalTrades, 'trade')}: win rate ${stats.winRate}%, net P/L ${money(stats.totalProfit)}, profit factor ${stats.profitFactor}${dna ? `, Alpha Score ${dna.alphaScore}/100 (grade ${dna.grade})` : ''}.`;
}

function topLeak(report) {
  return [...report.biases].sort((a, b) => b.costUsd - a.costUsd)[0] || null;
}

function sessionExtremes(report) {
  const sessions = report.breakdowns.bySession.filter((s) => s.trades >= 3);
  if (!sessions.length) return null;
  const sorted = [...sessions].sort((a, b) => b.profit - a.profit);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

function symbolExtremes(report) {
  const symbols = report.breakdowns.bySymbol.filter((s) => s.trades >= 3);
  if (!symbols.length) return null;
  return { best: symbols[0], worst: symbols[symbols.length - 1] };
}

const EXPLANATIONS = {
  sharpe: ['Sharpe ratio', 'average P/L per trade divided by its standard deviation: return per unit of total volatility. Above 0.3 per trade is strong.', (s) => s.sharpeRatio],
  sortino: ['Sortino ratio', 'like Sharpe but only penalises downside volatility (losses), so big winners do not hurt the score.', (s) => s.sortinoRatio],
  profitFactor: ['Profit factor', 'gross profit divided by gross loss. Above 1 means the system makes money; 1.5+ is solid, 2+ is excellent.', (s) => s.profitFactor],
  expectancy: ['Expectancy', 'the average amount you make (or lose) per trade. It is what each click is worth over the long run.', (s) => money(s.expectancy)],
  sqn: ['System Quality Number (SQN)', "Van Tharp's score: sqrt(trades) x average R / std(R). Below 1.6 is poor, 2-3 is good, 3+ is excellent.", (s) => s.sqn],
  drawdown: ['Max drawdown', 'the largest drop from an equity peak to a later low. It measures the pain you must be able to sit through.', (s) => `${usd(s.maxDrawdown)} (${s.maxDrawdownPct}%)`],
  rMultiple: ['R-multiple', 'profit divided by the risk you planned at entry (entry to stop). +2R means you made twice what you risked.', (s) => `average ${s.avgR}R`],
  kelly: ['Kelly criterion', 'the bet size that maximises long-run growth given your win rate and payoff. Pros use a fraction (1/4 to 1/2 Kelly) because it is volatile.', (s) => `${s.kellyPct}%`],
  payoff: ['Payoff ratio', 'average win divided by average loss. Combined with win rate it decides whether you have an edge.', (s) => s.payoffRatio],
  winRate: ['Win rate', 'the share of trades that make money. It only matters together with the payoff ratio.', (s) => `${s.winRate}%`],
  alphaScore: ['Alpha Score', 'a 0-100 blend of your Trader DNA: discipline 25%, risk control 20%, emotional control 20%, consistency 15% and edge 20%.', (s, r) => (r.dna ? `${r.dna.alphaScore}/100` : 'n/a')],
  dna: ['Trader DNA', 'five 0-100 scores (discipline, risk control, emotional control, consistency, edge) that explain why your results look the way they do.', (s, r) => (r.dna ? r.dna.scores.map((d) => `${d.label} ${d.value}`).join(', ') : 'n/a')],
  riskOfRuin: ['Risk of ruin', 'the share of Monte Carlo futures in which your account falls 20% below its starting balance.', (s, r) => (r.monteCarlo ? `${r.monteCarlo.riskOfRuin}%` : 'n/a')],
  monteCarlo: ['Monte Carlo simulation', 'replays your own trade results in random order thousands of times to show the range of futures your strategy can produce.', (s, r) => (r.monteCarlo ? `${r.monteCarlo.probProfit}% chance of profit over ${r.monteCarlo.horizon} trades` : 'n/a')]
};

const INTENT_ANSWERS = {
  greeting(report) {
    return {
      text: compose(`Hi! ${ENGINE_INTRO}.`, headline(report), 'Ask me about your risk, your biases, a symbol, the best time to trade, or a 50-trade forecast.'),
      highlights: highlightsFor(report, ['winRate', 'net', 'alpha'])
    };
  },

  help(report) {
    return {
      text: compose(
        `${ENGINE_INTRO}. It combines five modules:`,
        bullets([
          'Quant engine: win rate, profit factor, Sharpe, Sortino, SQN, Kelly, drawdown and R-multiples',
          'Behaviour engine: detects loss aversion, revenge trading, overconfidence and FOMO from your trades and notes',
          'Monte Carlo engine: simulates 1,000 futures of your strategy to estimate profit odds and risk of ruin',
          'NLU engine: a machine-learning classifier that understands your question, even with typos',
          'Synthesis engine: writes every answer from your own numbers'
        ]),
        'Try: "How is my risk?", "What biases do you see?", "How do I trade BTC?", "What happens in the next 100 trades?", "Make me a trading plan".'
      ),
      highlights: []
    };
  },

  performance(report) {
    const { stats } = report;
    const sym = symbolExtremes(report);
    const leak = topLeak(report);
    return {
      text: compose(
        headline(report),
        bullets([
          `Return ${stats.returnPct}% on a ${usd(stats.startingBalance)} account; expectancy ${money(stats.expectancy)} per trade`,
          `Average win ${usd(stats.avgProfit)} vs average loss ${usd(stats.avgLoss)} (payoff ${stats.payoffRatio}); average ${stats.avgR}R`,
          `Max drawdown ${usd(stats.maxDrawdown)} (${stats.maxDrawdownPct}%); Sharpe ${stats.sharpeRatio}, SQN ${stats.sqn}`,
          sym && `Best market ${sym.best.symbol} (${money(sym.best.profit)}), weakest ${sym.worst.symbol} (${money(sym.worst.profit)})`
        ]),
        leak ? `Biggest leak: ${label(leak)} cost about ${usd(leak.costUsd)}. ${leak.recommendation}` : 'No major behavioural leaks detected. Keep executing your plan.'
      ),
      highlights: highlightsFor(report, ['net', 'winRate', 'pf', 'dd'])
    };
  },

  risk(report) {
    const { stats, dna, monteCarlo: mc } = report;
    const riskBiases = report.biases.filter((b) => ['lossAversion', 'revengeTrading', 'overconfidence', 'riskManagement'].includes(b.type));
    const riskPct = stats.avgRisk ? round2((stats.avgRisk / stats.startingBalance) * 100) : null;
    return {
      text: compose(
        `Your risk score is ${report.riskScore}/100 (${report.riskLevel}).`,
        bullets([
          `Max drawdown ${usd(stats.maxDrawdown)} (${stats.maxDrawdownPct}% from peak)`,
          riskPct !== null && `Average planned risk ${usd(stats.avgRisk)} per trade (${riskPct}% of the account)`,
          `Average loss ${usd(stats.avgLoss)} vs average win ${usd(stats.avgProfit)}`,
          dna && `Discipline score ${dna.scores[0].value}/100: ${dna.scores[0].detail}`,
          mc && `Monte Carlo risk of ruin (-${mc.ruinPct}%) over the next ${mc.horizon} trades: ${mc.riskOfRuin}%`
        ]),
        riskBiases.length ? `Fix first: ${label(riskBiases[0])}. ${riskBiases[0].recommendation}` : 'Your risk process is clean. Keep a fixed 1% risk per trade.'
      ),
      highlights: highlightsFor(report, ['risk', 'dd', 'ruin'])
    };
  },

  sizing(report) {
    const { stats } = report;
    const halfKelly = Math.max(0, stats.kellyPct / 2);
    const suggested = Math.min(2, Math.max(0.25, halfKelly / 4));
    const riskPct = stats.avgRisk ? round2((stats.avgRisk / stats.startingBalance) * 100) : null;
    return {
      text: compose(
        stats.kellyPct > 0
          ? `Your full Kelly fraction is ${stats.kellyPct}% (win rate ${stats.winRate}%, payoff ${stats.payoffRatio}). Full Kelly is far too aggressive for real trading.`
          : `Your current Kelly fraction is ${stats.kellyPct}%: there is no statistical edge to size up yet.`,
        bullets([
          riskPct !== null && `You currently risk about ${usd(stats.avgRisk)} per trade (${riskPct}% of ${usd(stats.startingBalance)})`,
          `Suggested fixed risk: ${round2(suggested)}% per trade (${usd((suggested / 100) * stats.endingBalance)} on your current ${usd(stats.endingBalance)} balance)`,
          'Position size = risk in $ / (entry - stop). Size by the stop distance, never by conviction',
          'Add a daily loss limit of 2R: after two full losses, stop trading for the day'
        ])
      ),
      highlights: [{ label: 'Kelly', value: `${stats.kellyPct}%` }, { label: 'Suggested risk', value: `${round2(suggested)}%` }]
    };
  },

  improve(report) {
    const { stats } = report;
    const leak = topLeak(report);
    const ses = sessionExtremes(report);
    const sym = symbolExtremes(report);
    return {
      text: compose(
        `Win rate ${stats.winRate}% with payoff ${stats.payoffRatio}. The fastest improvements, ranked by dollars at stake:`,
        bullets([
          leak && `${label(leak)} cost about ${usd(leak.costUsd)}: ${leak.recommendation}`,
          ses && ses.worst.profit < 0 && `Cut the ${ses.worst.session} session (${ses.worst.hours}): ${money(ses.worst.profit)}, win rate ${ses.worst.winRate}%`,
          sym && sym.worst.profit < 0 && `Review ${sym.worst.symbol}: ${money(sym.worst.profit)} over ${plural(sym.worst.trades, 'trade')} (win rate ${sym.worst.winRate}%)`,
          stats.avgLoss > stats.avgProfit
            ? `Your average loss (${usd(stats.avgLoss)}) is bigger than your average win (${usd(stats.avgProfit)}): exits matter more than entries`
            : ses && `Double down on what works: ${ses.best.session} session made ${money(ses.best.profit)} at ${ses.best.winRate}% win rate`
        ])
      ),
      highlights: highlightsFor(report, ['winRate', 'payoff', 'alpha'])
    };
  },

  psychology(report) {
    const { biases, dna } = report;
    if (!biases.length) {
      return { text: `No significant behavioural biases in your ${plural(report.stats.totalTrades, 'trade')}. Keep journaling every trade so drift is caught early.`, highlights: [] };
    }
    const emotional = dna?.scores.find((d) => d.key === 'emotional');
    return {
      text: compose(
        `I found ${plural(biases.length, 'behavioural bias', 'behavioural biases')}${emotional ? ` (emotional control ${emotional.value}/100)` : ''}:`,
        bullets(biases.slice(0, 4).map((b) => `${label(b)} [${b.severity}]${b.costUsd ? `, cost ~${usd(b.costUsd)}` : ''}: ${b.evidence}`)),
        `Start with: ${biases[0].recommendation}`
      ),
      highlights: biases.slice(0, 3).map((b) => ({ label: label(b), value: b.severity, tone: b.severity === 'high' ? 'negative' : 'warning' }))
    };
  },

  forecast(report, { entities, trades }) {
    const horizon = entities.horizon || report.monteCarlo?.horizon || 50;
    const mc = horizon === report.monteCarlo?.horizon ? report.monteCarlo : monteCarlo(trades, { horizon, startingBalance: report.stats.startingBalance });
    if (!mc) return { text: 'I need at least 5 trades to run a Monte Carlo forecast. Log a few more trades first.', highlights: [] };
    const start = mc.startingBalance;
    return {
      text: compose(
        `I simulated ${mc.runs.toLocaleString('en-US')} futures of your next ${mc.horizon} trades by replaying your own results in random order:`,
        bullets([
          `Chance of finishing in profit: ${mc.probProfit}%`,
          `Median outcome: ${money(mc.final.p50 - start)} (balance ${usd(mc.final.p50)})`,
          `Likely range (25-75%): ${money(mc.final.p25 - start)} to ${money(mc.final.p75 - start)}`,
          `Bad case (5%): ${money(mc.final.p5 - start)}; great case (95%): ${money(mc.final.p95 - start)}`,
          `Typical max drawdown ${mc.medianMaxDrawdownPct}%, worst case ${mc.worstCaseDrawdownPct}%; risk of ruin (-${mc.ruinPct}%): ${mc.riskOfRuin}%`
        ]),
        mc.probProfit >= 70 ? 'Your edge is statistically solid: protect it by keeping risk fixed.' : 'The edge is thin: fixing your top leak will move these odds more than any new setup.'
      ),
      highlights: [
        { label: 'P(profit)', value: `${mc.probProfit}%`, tone: mc.probProfit >= 60 ? 'positive' : 'negative' },
        { label: 'Median', value: money(mc.final.p50 - start) },
        { label: 'Risk of ruin', value: `${mc.riskOfRuin}%`, tone: mc.riskOfRuin > 5 ? 'negative' : 'positive' }
      ]
    };
  },

  symbol(report, { entities, trades }) {
    const rows = report.breakdowns.bySymbol;
    const wanted = entities.symbols.length ? rows.filter((r) => entities.symbols.includes(r.symbol)) : [];
    if (wanted.length) {
      return {
        text: wanted
          .map((r) => {
            const list = trades.filter((t) => t.symbol === r.symbol);
            const violations = list.filter(exceededStopLoss).length;
            const verdict = r.profit > 0 && r.winRate >= 45 ? 'Keep trading it: it is one of your edges.' : r.profit > 0 ? 'Profitable but streaky: keep size modest.' : 'It is costing you money: cut size in half or pause it until you review these trades.';
            return compose(
              `${r.symbol}: ${plural(r.trades, 'trade')}, win rate ${r.winRate}%, net ${money(r.profit)}, expectancy ${money(r.expectancy)}/trade, average ${r.avgR}R.`,
              violations ? `- ${plural(violations, 'loss', 'losses')} on ${r.symbol} ran past the planned stop.` : null,
              verdict
            );
          })
          .join('\n\n'),
        highlights: wanted.slice(0, 3).map((r) => ({ label: r.symbol, value: money(r.profit), tone: r.profit >= 0 ? 'positive' : 'negative' }))
      };
    }
    return {
      text: compose('Your markets ranked by profit:', bullets(rows.map((r) => `${r.symbol}: ${money(r.profit)} over ${plural(r.trades, 'trade')}, win rate ${r.winRate}%, ${r.avgR}R avg`))),
      highlights: rows.slice(0, 3).map((r) => ({ label: r.symbol, value: money(r.profit), tone: r.profit >= 0 ? 'positive' : 'negative' }))
    };
  },

  timing(report, { entities }) {
    const sessions = report.breakdowns.bySession.filter((s) => s.trades > 0);
    const days = report.breakdowns.byWeekday.filter((d) => d.trades > 0).sort((a, b) => b.profit - a.profit);
    const focus = entities.session ? sessions.find((s) => s.session === entities.session) : null;
    const ranked = [...sessions].sort((a, b) => b.profit - a.profit);
    return {
      text: compose(
        focus
          ? `${focus.session} session (${focus.hours}): ${plural(focus.trades, 'trade')}, win rate ${focus.winRate}%, net ${money(focus.profit)}, ${focus.avgR}R avg.`
          : 'Your results by trading session (UTC):',
        bullets(ranked.map((s) => `${s.session} ${s.hours}: ${money(s.profit)}, win rate ${s.winRate}% (${plural(s.trades, 'trade')})`)),
        days.length ? `Best day: ${days[0].weekday} (${money(days[0].profit)}); worst day: ${days[days.length - 1].weekday} (${money(days[days.length - 1].profit)}).` : null,
        ranked.length > 1 && ranked[ranked.length - 1].profit < 0 ? `Consider not trading the ${ranked[ranked.length - 1].session} session at all.` : null
      ),
      highlights: ranked.slice(0, 2).map((s) => ({ label: s.session, value: money(s.profit), tone: s.profit >= 0 ? 'positive' : 'negative' }))
    };
  },

  extremes(report, { trades }) {
    const ordered = [...trades].sort((a, b) => b.profit - a.profit);
    if (!ordered.length) return { text: 'No trades yet.', highlights: [] };
    const describe = (t) => {
      const r = rMultiple(t);
      return `${t.symbol} ${t.type === 'buy' ? 'long' : 'short'} on ${t.timestamp.slice(0, 10)}: ${money(t.profit)}${r !== null ? ` (${round2(r)}R)` : ''}${t.notes ? `, note: "${t.notes}"` : ''}`;
    };
    return {
      text: compose('Best trades:', bullets(ordered.slice(0, 3).map(describe)), 'Worst trades:', bullets(ordered.slice(-3).reverse().map(describe)),
        exceededStopLoss(ordered[ordered.length - 1]) ? 'Your worst trade went past its stop loss. Honouring the stop would have capped that loss.' : null),
      highlights: [
        { label: 'Best', value: money(ordered[0].profit), tone: 'positive' },
        { label: 'Worst', value: money(ordered[ordered.length - 1].profit), tone: 'negative' }
      ]
    };
  },

  plan(report) {
    const { stats } = report;
    const ses = sessionExtremes(report);
    const sym = symbolExtremes(report);
    const leak = topLeak(report);
    const riskPct = Math.min(1, Math.max(0.25, stats.kellyPct / 8 || 0.5));
    return {
      text: compose(
        'Your personal trading plan, built from your data:',
        bullets([
          `Risk ${round2(riskPct)}% of the account per trade (${usd((riskPct / 100) * stats.endingBalance)}), sized by the stop distance`,
          'Hard stop at entry, never moved further away. Exit at the stop, no exceptions',
          'After a loss: 30-minute cooldown, same or smaller size. After 2 losses in a day: done for the day',
          ses && `Trade the ${ses.best.session} session (${ses.best.hours}), your best at ${ses.best.winRate}% win rate${ses.worst.profit < 0 ? `; skip ${ses.worst.session}` : ''}`,
          sym && sym.worst.profit < 0 && `Half size on ${sym.worst.symbol} until it turns positive; focus on ${sym.best.symbol}`,
          leak && `Weekly review target: zero "${label(leak).toLowerCase()}" trades`,
          'Journal every trade with setup, stop, target and one line on emotion'
        ])
      ),
      highlights: highlightsFor(report, ['alpha', 'risk'])
    };
  },

  explain(report, { entities }) {
    const key = entities.metric && EXPLANATIONS[entities.metric] ? entities.metric : 'profitFactor';
    const [name, meaning, value] = EXPLANATIONS[key];
    return {
      text: compose(`${name}: ${meaning}`, `Yours: ${value(report.stats, report)}.`),
      highlights: [{ label: name, value: String(value(report.stats, report)) }]
    };
  },

  unknown(report) {
    return {
      text: compose("I'm not sure I understood that, but here is where you stand:", headline(report), 'Try asking about your risk, biases, a symbol like BTC, the best session, a forecast, or a trading plan.'),
      highlights: highlightsFor(report, ['net', 'winRate'])
    };
  }
};

function highlightsFor(report, keys) {
  const { stats, dna, monteCarlo: mc } = report;
  const map = {
    net: { label: 'Net P/L', value: money(stats.totalProfit), tone: stats.totalProfit >= 0 ? 'positive' : 'negative' },
    winRate: { label: 'Win rate', value: `${stats.winRate}%` },
    pf: { label: 'Profit factor', value: String(stats.profitFactor), tone: stats.profitFactor >= 1 ? 'positive' : 'negative' },
    dd: { label: 'Max DD', value: `${stats.maxDrawdownPct}%` },
    payoff: { label: 'Payoff', value: String(stats.payoffRatio) },
    risk: { label: 'Risk score', value: `${report.riskScore}/100`, tone: report.riskLevel === 'high' ? 'negative' : report.riskLevel === 'low' ? 'positive' : 'warning' },
    alpha: dna && { label: 'Alpha Score', value: `${dna.alphaScore} (${dna.grade})` },
    ruin: mc && { label: 'Risk of ruin', value: `${mc.riskOfRuin}%`, tone: mc.riskOfRuin > 5 ? 'negative' : 'positive' }
  };
  return keys.map((k) => map[k]).filter(Boolean);
}

/**
 * Answer a free-text question from the report. `trades` enables per-symbol
 * detail and custom Monte Carlo horizons.
 */
export function answerQuestion(question, report, trades = [], nlu = null) {
  if (!report || !report.stats.totalTrades) {
    return {
      reply: 'You have no trades logged yet. Add a few trades (entry, exit, stop and a short note) or import a CSV, and I will analyse your performance and behaviour.',
      intent: 'empty',
      confidence: 1,
      highlights: []
    };
  }
  nlu ||= understand(question, { knownSymbols: report.breakdowns.bySymbol.map((s) => s.symbol) });
  const handler = INTENT_ANSWERS[nlu.intent] || INTENT_ANSWERS.unknown;
  const { text, highlights } = handler(report, { entities: nlu.entities, trades, question });
  return { reply: text, intent: nlu.intent, confidence: nlu.confidence, entities: nlu.entities, highlights };
}

// ---------------------------------------------------------------------------
// Single trade analysis
// ---------------------------------------------------------------------------

const JOURNAL_FLAGS = [
  { pattern: /\bfomo\b|no (proper )?setup|too quickly|chas(e|ed|ing)|impulsive/i, text: 'Journal note points to an impulsive / FOMO entry' },
  { pattern: /revenge|tilt|win it back|make it back|straight back in/i, text: 'Journal note flags a revenge trade' },
  { pattern: /hop(e|ing) for (a )?recovery|held (too long|past)/i, text: 'Journal note says the loser was held hoping for a recovery' }
];

export function analyzeTrade(trade, trades = []) {
  const isWin = trade.profit > 0;
  const size = notional(trade);
  const risks = trades.map(plannedRisk).filter((r) => r !== null);
  const risk = plannedRisk(trade);
  const avgRisk = mean(risks);
  const sizeVsAverage = risk && avgRisk ? risk / avgRisk : trades.length ? size / (mean(trades.map(notional)) || size) : 1;
  const hasStop = Number.isFinite(trade.stopLoss);
  const hasTarget = Number.isFinite(trade.takeProfit);
  const r = rMultiple(trade);
  const stopExceeded = exceededStopLoss(trade);
  const targetReached = hasTarget && (trade.type === 'buy' ? trade.exitPrice >= trade.takeProfit : trade.exitPrice <= trade.takeProfit);
  const journalFlags = JOURNAL_FLAGS.filter((f) => f.pattern.test(trade.notes || '')).map((f) => f.text);

  const successFactors = [];
  if (hasStop) successFactors.push('Defined a stop loss before entry');
  if (hasTarget) successFactors.push('Planned a profit target');
  if (isWin && r !== null && r >= 1) successFactors.push(`Captured ${r.toFixed(1)}R on planned risk`);
  if (targetReached) successFactors.push('Reached the planned profit target');
  if (!isWin && hasStop && !stopExceeded) successFactors.push('Loss was contained at the planned stop');
  if (sizeVsAverage <= 1.1) successFactors.push('Risk in line with your average');

  const mistakes = [...journalFlags];
  if (stopExceeded) mistakes.push(`Closed beyond the planned stop: planned risk ${usd(risk)}, actual loss ${usd(trade.profit)}`);
  if (!hasStop) mistakes.push('No stop loss recorded');
  if (sizeVsAverage >= 1.5) mistakes.push(`Risk was ${sizeVsAverage.toFixed(1)}x your average`);
  if (isWin && hasTarget && !targetReached) mistakes.push('Exited before the planned target');

  let confidenceScore = 70;
  if (hasStop && !stopExceeded) confidenceScore += 10;
  if (stopExceeded) confidenceScore -= 25;
  if (!hasStop) confidenceScore -= 20;
  if (r !== null && r >= 1) confidenceScore += 10;
  if (sizeVsAverage >= 1.5) confidenceScore -= 10;
  confidenceScore -= journalFlags.length * 10;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));

  const improvementSuggestions = [];
  if (stopExceeded || !hasStop) improvementSuggestions.push('Place the stop as a hard order at entry and never move it further away');
  if (sizeVsAverage >= 1.5) improvementSuggestions.push('Size positions by a fixed % of account risk, not by conviction');
  if (journalFlags.length) improvementSuggestions.push('Run a pre-trade checklist (setup, entry, stop, target) before every order');
  if (isWin && hasTarget && !targetReached) improvementSuggestions.push('Scale out at the target or trail the stop instead of exiting early');
  improvementSuggestions.push('Review this trade in your journal within 24 hours');

  return {
    successFactors,
    mistakes,
    confidenceScore,
    behavioralInsights: stopExceeded
      ? 'The trade was held past its planned exit, a classic loss-aversion signal. Losses should be taken at the level you chose when you were calm.'
      : journalFlags.length
        ? `${journalFlags[0]}. Emotional entries tend to have worse risk/reward than planned setups.`
        : isWin
          ? 'Plan-driven execution: entry, stop and exit followed a defined plan.'
          : 'A controlled loss inside the plan is part of trading, not a mistake.',
    improvementSuggestions,
    riskAssessment: sizeVsAverage >= 1.5 || !hasStop || stopExceeded ? 'high' : sizeVsAverage >= 1.1 ? 'medium' : 'low',
    technicalAnalysis: trade.notes
      ? `Trader notes: "${trade.notes}". No live market data is attached; review the chart around ${trade.timestamp.slice(0, 10)} to validate the setup.`
      : 'No notes or market data recorded for this trade. Add a short setup note so future analysis can judge the entry.',
    metrics: {
      notional: round2(size),
      sizeVsAverage: round2(sizeVsAverage),
      plannedRisk: risk === null ? null : round2(risk),
      rMultiple: r === null ? null : round2(r),
      stopLossRespected: hasStop ? !stopExceeded : null,
      targetReached: hasTarget ? targetReached : null
    }
  };
}

// Short real-time coaching for a described market situation.
export function coachingAdvice(report, marketContext = '') {
  const top = report.biases[0];
  const risk = report.riskLevel === 'high' ? 'High' : report.riskLevel === 'moderate' ? 'Medium' : 'Low';
  const ses = sessionExtremes(report);
  return `Market read: no setup justifies skipping your plan${marketContext ? '; treat this view as a hypothesis, not a signal' : ''}. | Risk level: ${risk} (score ${report.riskScore}/100) | Action: define entry, stop and target before the order and risk at most 1% of your account${ses ? `; your best window is the ${ses.best.session} session` : ''}. | Psychology: ${
    top ? `${label(top)}: ${top.recommendation}` : 'your recent behaviour is disciplined, so keep the same process.'
  }`;
}

export function biasSummary(report) {
  if (!report.biases.length) return 'No significant behavioural biases detected. Keep following your plan and journaling every trade.';
  const top = topLeak(report) || report.biases[0];
  return `Your biggest behavioural leak is ${label(top).toLowerCase()} (${top.severity}${top.costUsd ? `, about ${usd(top.costUsd)}` : ''}): ${top.evidence}. ${top.recommendation}`;
}

export function recentStats(trades, count = 20) {
  return computeStats(chronological(trades).slice(-count));
}
