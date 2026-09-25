import { mulberry32, gaussian, pickWeighted, uniform } from './prng.js';
import { calculateProfit, statusFromProfit, toTrade } from './tradeModel.js';

// Deterministic synthetic trade journal. It models a realistic retail trader
// (risk-based sizing, a session edge) plus the behavioural leaks the engine is
// built to catch: revenge trades, overconfidence after streaks, FOMO entries
// and losers held past the stop. Leaks fade month by month, so the data also
// tells an improvement story. Same seed => same trades on every JS engine.

const MARKETS = [
  { symbol: 'BTCUSD', price: 62000, vol: 0.012, drift: 0.0006, priceDp: 1, sizeDp: 3, stop: [0.006, 0.014], weight: 0.35 },
  { symbol: 'ETHUSD', price: 3100, vol: 0.016, drift: 0.0003, priceDp: 2, sizeDp: 2, stop: [0.008, 0.018], weight: 0.3 },
  { symbol: 'SOLUSD', price: 145, vol: 0.022, drift: 0.0004, priceDp: 2, sizeDp: 1, stop: [0.012, 0.025], weight: 0.2 },
  { symbol: 'XAUUSD', price: 2320, vol: 0.006, drift: 0.0004, priceDp: 2, sizeDp: 2, stop: [0.003, 0.007], weight: 0.15 }
];

const SESSION_PLAN = [
  { hours: [1, 6], winProb: 0.45, weight: 0.1 },
  { hours: [7, 12], winProb: 0.6, weight: 0.4 },
  { hours: [13, 20], winProb: 0.52, weight: 0.38 },
  { hours: [21, 23], winProb: 0.33, weight: 0.12 }
];

const SETUPS = [
  'Breakout retest with volume',
  'Support bounce on 1H',
  'Trend continuation pullback',
  'Range fade at resistance',
  'VWAP reclaim',
  'Liquidity sweep reversal',
  'Higher-low entry, plan followed',
  'Momentum after news, planned entry'
];

const roundTo = (value, dp) => Math.round(value * 10 ** dp) / 10 ** dp;
const winProbForHour = (hour) => SESSION_PLAN.find((s) => hour >= s.hours[0] && hour <= s.hours[1])?.winProb ?? 0.5;

export function generateTrades({ seed = 20260301, count = 160, start = '2026-03-02T00:00:00Z', baseRisk = 100 } = {}) {
  const rand = mulberry32(seed);
  const markets = MARKETS.map((m) => ({ ...m }));
  const startMs = new Date(start).getTime();
  const trades = [];

  let lastLoss = null;
  let winStreak = 0;

  for (let day = 0; trades.length < count && day < Math.max(3650, count * 4); day++) {
    const dayStart = startMs + day * 86400000;
    const weekday = new Date(dayStart).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    // Emotional leaks fade as the months go by (the trader is learning).
    const leak = Math.max(0.35, 1 - Math.floor(day / 30) * 0.12);

    for (const m of markets) m.price *= 1 + m.drift + m.vol * gaussian(rand);

    const tradesToday = isWeekend
      ? pickWeighted(rand, [[0, 0.75], [1, 0.25]])
      : pickWeighted(rand, [[0, 0.2], [1, 0.4], [2, 0.28], [3, 0.12]]);

    let lastTime = null;
    for (let k = 0; k < tradesToday && trades.length < count; k++) {
      const market = pickWeighted(rand, markets.map((m) => [m, m.weight]));
      const session = pickWeighted(rand, SESSION_PLAN.map((s) => [s, s.weight]));

      let entryMs = dayStart + Math.floor(uniform(rand, session.hours[0], session.hours[1] + 1)) * 3600000 + Math.floor(rand() * 60) * 60000;
      if (lastTime !== null && entryMs <= lastTime) entryMs = lastTime + Math.floor(uniform(rand, 45, 180)) * 60000;

      let sizeMult = 1;
      let winProb = winProbForHour(new Date(entryMs).getUTCHours());
      let note = SETUPS[Math.floor(rand() * SETUPS.length)];
      let hasStop = true;
      let lossAversionProb = 0.3 * leak;

      if (lastLoss && rand() < 0.35 * leak) {
        // Revenge trade: quick re-entry, bigger size, worse odds.
        entryMs = lastLoss.closeMs + Math.floor(uniform(rand, 5, 40)) * 60000;
        sizeMult = uniform(rand, 1.6, 2.3);
        winProb -= 0.15;
        lossAversionProb += 0.15;
        note = rand() < 0.5 ? 'Revenge trade, wanted to win it back fast' : 'Jumped straight back in after the loss';
      } else if (winStreak >= 3 && rand() < 0.45 * leak) {
        sizeMult = uniform(rand, 1.5, 2.0);
        winProb -= 0.08;
        note = 'On a heater, sized up because I felt confident';
      } else if (rand() < 0.07 * leak) {
        winProb -= 0.12;
        hasStop = rand() < 0.5;
        note = rand() < 0.5 ? 'FOMO entry, chased the breakout' : 'No proper setup, entered too quickly';
      }

      const price = roundTo(market.price * (1 + market.vol * 0.3 * gaussian(rand)), market.priceDp);
      const stopDistance = price * uniform(rand, market.stop[0], market.stop[1]);
      const positionSize = Math.max(10 ** -market.sizeDp, roundTo((baseRisk * sizeMult) / stopDistance, market.sizeDp));
      const type = rand() < 0.6 ? 'buy' : 'sell';
      const dir = type === 'buy' ? 1 : -1;
      const targetR = uniform(rand, 1.5, 2.5);

      let r;
      let heldTooLong = false;
      const roll = rand();
      if (roll < 0.03) r = 0;
      else if (roll < 0.03 + Math.max(0.1, winProb)) r = rand() < 0.6 ? targetR : uniform(rand, 0.4, targetR);
      else if (rand() < lossAversionProb) {
        r = -uniform(rand, 1.25, 2.3);
        heldTooLong = true;
      } else r = -uniform(rand, 0.85, 1.0);

      if (heldTooLong && !note.startsWith('Revenge') && rand() < 0.6) note = 'Held past the stop hoping for a recovery';

      const exitPrice = roundTo(price + dir * r * stopDistance, market.priceDp);
      const duration = Math.floor(
        heldTooLong ? uniform(rand, 180, 600) : r > 0 ? uniform(rand, 20, 240) : uniform(rand, 10, 150)
      );
      const profit = calculateProfit(type, price, exitPrice, positionSize);

      trades.push(
        toTrade({
          id: `demo_${String(trades.length + 1).padStart(4, '0')}`,
          symbol: market.symbol,
          type,
          entryPrice: price,
          exitPrice,
          positionSize,
          profit,
          duration,
          timestamp: new Date(entryMs).toISOString(),
          notes: note,
          status: statusFromProfit(profit),
          stopLoss: hasStop ? roundTo(price - dir * stopDistance, market.priceDp) : null,
          takeProfit: roundTo(price + dir * targetR * stopDistance, market.priceDp)
        })
      );

      const closeMs = entryMs + duration * 60000;
      lastTime = closeMs;
      lastLoss = profit < 0 ? { closeMs } : null;
      winStreak = profit > 0 ? winStreak + 1 : 0;
    }
  }

  return trades;
}

// The demo journal every fresh install starts with.
export function generateSampleTrades() {
  return generateTrades();
}
