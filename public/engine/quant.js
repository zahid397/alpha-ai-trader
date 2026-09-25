import { clamp, mean, pct, round2, std, sum } from './math.js';
import { SESSIONS, WEEKDAYS, monthKey, sessionOf, weekdayOf, weekKey } from './time.js';
import { plannedRisk, rMultiple } from './tradeModel.js';

// Quant engine: performance statistics, equity curve and breakdowns.
// All functions take trades in any order and sort their own copy.

export const DEFAULT_STARTING_BALANCE = 10000;

export function chronological(trades = []) {
  return [...trades].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

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

export function computeStats(trades = [], { startingBalance = DEFAULT_STARTING_BALANCE } = {}) {
  const ordered = chronological(trades);
  const n = ordered.length;
  const profits = ordered.map((t) => t.profit);
  const wins = ordered.filter((t) => t.profit > 0);
  const losses = ordered.filter((t) => t.profit < 0);

  const grossProfit = sum(wins.map((t) => t.profit));
  const grossLoss = Math.abs(sum(losses.map((t) => t.profit)));
  const totalProfit = sum(profits);
  const avgWin = mean(wins.map((t) => t.profit));
  const avgLoss = Math.abs(mean(losses.map((t) => t.profit)));

  let equity = startingBalance;
  let peak = startingBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
  }

  // Per-trade Sharpe/Sortino: mean P/L over its (downside) deviation.
  const avg = mean(profits);
  const deviation = std(profits);
  const downside = n ? Math.sqrt(mean(profits.map((p) => Math.min(p, 0) ** 2))) : 0;

  const rValues = ordered.map(rMultiple).filter((r) => r !== null);
  const rStd = std(rValues);
  // Van Tharp's System Quality Number, sample size capped at 100.
  const sqn = rValues.length >= 5 && rStd > 0 ? (Math.sqrt(Math.min(rValues.length, 100)) * mean(rValues)) / rStd : 0;

  const winRate = n ? wins.length / n : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 99 : 0;
  const kelly = payoffRatio > 0 ? winRate - (1 - winRate) / payoffRatio : 0;
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss;
  const risks = ordered.map(plannedRisk).filter((r) => r !== null);

  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    breakEven: n - wins.length - losses.length,
    winRate: round2(pct(wins.length, n)),
    totalProfit: round2(totalProfit),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    avgProfit: round2(avgWin),
    avgLoss: round2(avgLoss),
    payoffRatio: round2(payoffRatio),
    profitFactor: round2(profitFactor),
    expectancy: round2(n ? totalProfit / n : 0),
    maxDrawdown: round2(maxDrawdown),
    maxDrawdownPct: round2(maxDrawdownPct),
    recoveryFactor: round2(maxDrawdown > 0 ? totalProfit / maxDrawdown : 0),
    sharpeRatio: round2(deviation > 0 ? avg / deviation : 0),
    sortinoRatio: round2(downside > 0 ? avg / downside : 0),
    sqn: round2(sqn),
    avgR: round2(mean(rValues)),
    kellyPct: round2(clamp(kelly, -1, 1) * 100),
    avgRisk: round2(mean(risks)),
    startingBalance,
    endingBalance: round2(startingBalance + totalProfit),
    returnPct: round2(pct(totalProfit, startingBalance)),
    bestTrade: n ? Math.max(...profits) : 0,
    worstTrade: n ? Math.min(...profits) : 0,
    avgWinDuration: Math.round(mean(wins.map((t) => t.duration || 0))),
    avgLossDuration: Math.round(mean(losses.map((t) => t.duration || 0))),
    ...streakInfo(ordered)
  };
}

// Equity and drawdown after every trade, starting from the opening balance.
export function equityCurve(trades = [], { startingBalance = DEFAULT_STARTING_BALANCE } = {}) {
  const ordered = chronological(trades);
  const points = [{ index: 0, timestamp: ordered[0]?.timestamp ?? null, equity: startingBalance, drawdown: 0, drawdownPct: 0, tradeId: null }];
  let equity = startingBalance;
  let peak = startingBalance;
  ordered.forEach((t, i) => {
    equity += t.profit;
    peak = Math.max(peak, equity);
    points.push({
      index: i + 1,
      timestamp: t.timestamp,
      equity: round2(equity),
      drawdown: round2(peak - equity),
      drawdownPct: round2(peak > 0 ? ((peak - equity) / peak) * 100 : 0),
      tradeId: t.id,
      symbol: t.symbol,
      profit: t.profit
    });
  });
  return points;
}

function groupStats(trades) {
  const wins = trades.filter((t) => t.profit > 0).length;
  const profit = sum(trades.map((t) => t.profit));
  const rValues = trades.map(rMultiple).filter((r) => r !== null);
  return {
    trades: trades.length,
    wins,
    winRate: round2(pct(wins, trades.length)),
    profit: round2(profit),
    expectancy: round2(trades.length ? profit / trades.length : 0),
    avgR: round2(mean(rValues))
  };
}

function groupBy(trades, keyFn) {
  const groups = new Map();
  for (const t of trades) {
    const key = keyFn(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return groups;
}

export function breakdowns(trades = []) {
  const ordered = chronological(trades);
  // Bucket every trade once; the groupings below reuse these keys.
  const meta = ordered.map((t) => ({ t, day: weekdayOf(t.timestamp), session: sessionOf(t.timestamp), month: monthKey(t.timestamp), week: weekKey(t.timestamp) }));
  const pick = (predicate) => meta.filter(predicate).map((m) => m.t);

  const bySymbol = [...groupBy(ordered, (t) => t.symbol)]
    .map(([symbol, list]) => ({ symbol, ...groupStats(list) }))
    .sort((a, b) => b.profit - a.profit);

  const bySide = ['buy', 'sell'].map((type) => ({
    side: type === 'buy' ? 'Long' : 'Short',
    ...groupStats(ordered.filter((t) => t.type === type))
  }));

  const bySession = SESSIONS.map((s) => ({
    session: s.name,
    key: s.key,
    hours: `${String(s.from).padStart(2, '0')}-${String(s.to).padStart(2, '0')} UTC`,
    ...groupStats(pick((m) => m.session === s))
  }));

  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  const byWeekday = WEEK_ORDER.map((day) => ({ weekday: WEEKDAYS[day], ...groupStats(pick((m) => m.day === day)) }));

  const cells = new Map();
  for (const m of meta) {
    const key = `${m.day}|${m.session.key}`;
    const cell = cells.get(key) || { trades: 0, profit: 0 };
    cell.trades++;
    cell.profit += m.t.profit;
    cells.set(key, cell);
  }
  const heatmap = WEEK_ORDER.flatMap((day) =>
    SESSIONS.map((s) => {
      const cell = cells.get(`${day}|${s.key}`) || { trades: 0, profit: 0 };
      return { weekday: WEEKDAYS[day], session: s.name, trades: cell.trades, profit: round2(cell.profit) };
    })
  );

  const monthly = [...groupBy(meta, (m) => m.month)].map(([month, list]) => ({ month, ...groupStats(list.map((m) => m.t)) }));

  const weekly = [...groupBy(meta, (m) => m.week)].map(([week, list]) => ({
    week,
    profit: round2(sum(list.map((m) => m.t.profit))),
    trades: list.length
  }));

  // R-multiple histogram in half-R bins, clamped to [-3, +3].
  const binEdges = [];
  for (let edge = -3; edge < 3; edge += 0.5) binEdges.push(edge);
  const rDistribution = binEdges.map((from) => ({ from, to: from + 0.5, count: 0 }));
  for (const r of ordered.map(rMultiple).filter((v) => v !== null)) {
    const clamped = clamp(r, -3, 2.999);
    rDistribution[Math.floor((clamped + 3) / 0.5)].count++;
  }

  return { bySymbol, bySide, bySession, byWeekday, heatmap, monthly, weekly, rDistribution };
}
