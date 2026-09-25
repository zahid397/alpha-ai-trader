import { mean, percentile, round2 } from './math.js';
import { hashString, mulberry32 } from './prng.js';
import { DEFAULT_STARTING_BALANCE } from './quant.js';

// Monte Carlo engine: bootstrap-resamples the trader's own P/L history into
// thousands of possible futures. The seed is derived from the data, so the
// same journal always yields the same forecast (stable UI, testable).

const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];

export function tradesFingerprint(trades) {
  let text = '';
  for (const t of trades) text += `${t.id}:${t.profit}|`;
  return hashString(text);
}

export function monteCarlo(
  trades = [],
  { runs = 1000, horizon = 50, startingBalance = DEFAULT_STARTING_BALANCE, ruinPct = 20, seed } = {}
) {
  const profits = trades.map((t) => t.profit).filter(Number.isFinite);
  if (profits.length < 5) return null;

  const rand = mulberry32(seed ?? tradesFingerprint(trades));
  const n = profits.length;
  const ruinLevel = startingBalance * (1 - ruinPct / 100);
  const steps = Array.from({ length: horizon + 1 }, () => new Float64Array(runs));
  const maxDrawdowns = new Float64Array(runs);
  let ruined = 0;

  for (let r = 0; r < runs; r++) {
    let equity = startingBalance;
    let peak = startingBalance;
    let maxDd = 0;
    let hitRuin = false;
    steps[0][r] = equity;
    for (let s = 1; s <= horizon; s++) {
      equity += profits[Math.floor(rand() * n)];
      steps[s][r] = equity;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak : 1;
      if (dd > maxDd) maxDd = dd;
      if (equity <= ruinLevel) hitRuin = true;
    }
    maxDrawdowns[r] = maxDd * 100;
    if (hitRuin) ruined++;
  }

  // Percentile bands for the fan chart at ~25 evenly spaced steps (sorting is
  // the expensive part), always including the final step.
  const stride = Math.max(1, Math.ceil(horizon / 25));
  const sampledSteps = [];
  for (let step = 0; step < horizon; step += stride) sampledSteps.push(step);
  sampledSteps.push(horizon);
  const bands = sampledSteps.map((step) => {
    const sorted = steps[step].sort();
    const [p5, p25, p50, p75, p95] = QUANTILES.map((q) => round2(percentile(sorted, q)));
    return { step, p5, p25, p50, p75, p95 };
  });

  const finals = steps[horizon];
  const sortedDd = maxDrawdowns.sort();
  const final = bands[bands.length - 1];

  return {
    runs,
    horizon,
    startingBalance,
    ruinPct,
    bands,
    final: { ...final, mean: round2(mean(Array.from(finals))) },
    probProfit: round2((finals.filter((v) => v > startingBalance).length / runs) * 100),
    riskOfRuin: round2((ruined / runs) * 100),
    medianMaxDrawdownPct: round2(percentile(sortedDd, 0.5)),
    worstCaseDrawdownPct: round2(percentile(sortedDd, 0.95))
  };
}
