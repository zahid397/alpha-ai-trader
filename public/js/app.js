import { BIAS_LABELS, ENGINE_NAME, ENGINE_VERSION, analyze, ask, buildTrade, rMultiple, tradesFromCsv, tradesToCsv } from '../engine/index.js';
import { barChart, fanChart, heatmap, hideTooltip, lineChart, renderTable, sparkline } from './charts.js';
import { connect } from './data.js';
import { compactMoney, date, debounce, el, money, number, percent, toneClass } from './format.js';
import { hydrateIcons, icon } from './icons.js';

const VIEWS = {
  dashboard: ['Dashboard', 'Your trading performance and behaviour at a glance'],
  analytics: ['Analytics', 'Deep statistics, Monte Carlo forecasts and timing analysis'],
  coach: ['AI Coach', 'Ask anything about your trading. Answers come from your own data'],
  journal: ['Journal', 'Every trade you have logged, with import and export']
};

const SUGGESTIONS = [
  'How am I doing?',
  'How is my risk?',
  'What biases do you see?',
  'What happens in the next 100 trades?',
  'Which session is best for me?',
  'How do I trade BTC?',
  'Make me a trading plan',
  'How much should I risk per trade?',
  'What is my worst trade?',
  'What is SQN?'
];

const SOURCE_LABELS = {
  'alpha-engine': 'Alpha Engine',
  groq: 'Alpha Engine + Groq',
  'workers-ai': 'Alpha Engine + Workers AI',
  offline: 'Alpha Engine (offline)'
};

const PAGE_SIZE = 25;

const state = {
  source: null,
  trades: [],
  report: null,
  horizon: 50,
  view: 'dashboard',
  tables: new Set(),
  journal: { query: '', symbol: '', page: 0 },
  chat: [],
  busy: false
};

const $ = (selector) => document.querySelector(selector);
const shortDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------------
// Toasts & errors
// ---------------------------------------------------------------------------
function toast(message, type = 'success') {
  const node = el('div', { class: 'toast', 'data-type': type, html: icon(type === 'success' ? 'check' : type === 'warning' ? 'alert' : 'alert') });
  node.append(el('span', { text: message }));
  $('#toasts').append(node);
  setTimeout(() => node.remove(), 4200);
}

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  toast(event.reason?.message || 'Something went wrong', 'error');
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function effectiveTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced) return forced;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function renderThemeButton() {
  const button = $('#theme-toggle');
  const dark = effectiveTheme() === 'dark';
  button.innerHTML = icon(dark ? 'sun' : 'moon');
  button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

function setupTheme() {
  renderThemeButton();
  $('#theme-toggle').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('alpha-ai-trader:theme', next);
    } catch {
      /* not persisted */
    }
    renderThemeButton();
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function showView(name, { focus = false } = {}) {
  if (!VIEWS[name]) name = 'dashboard';
  state.view = name;
  hideTooltip();
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== `view-${name}`;
  for (const link of document.querySelectorAll('[data-view]')) {
    if (link.dataset.view === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  const [title, subtitle] = VIEWS[name];
  $('#view-title').textContent = title;
  $('#view-subtitle').textContent = subtitle;
  document.title = `${title} | Alpha AI Trader`;
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  renderView(name);
  if (name === 'coach' && focus) $('#message-input').focus();
  window.scrollTo({ top: 0 });
}

function setupNav() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-view], [data-view-link]');
    if (!link) return;
    showView(link.dataset.view || link.dataset.viewLink, { focus: true });
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function renderStatus(analysisMs) {
  const src = state.source;
  const pill = $('#mode-pill');
  const health = src?.health;
  let dot = 'ok';
  let label = 'Cloud · synced';
  let title = 'Trades are stored in the cloud database';
  if (src?.mode === 'local') {
    dot = 'warn';
    label = src.reason === 'offline' ? 'Offline · browser' : 'Local · browser';
    title =
      src.reason === 'no-database'
        ? 'The server has no database, so your trades are saved in this browser'
        : 'API unreachable: everything runs in your browser, trades are saved locally';
  }
  pill.replaceChildren(el('span', { class: `dot ${dot}` }), label);
  pill.title = title;

  const ai = health?.aiMode && health.aiMode !== 'alpha' ? ` + ${health.aiMode === 'groq' ? 'Groq' : 'Workers AI'}` : '';
  $('#engine-status').textContent = `${ENGINE_NAME} v${ENGINE_VERSION}${ai} · ${src?.mode === 'cloud' ? `${health.platform || 'cloud'} + D1` : 'in-browser'}`;
  $('#coach-engine').textContent = ai ? `${ENGINE_NAME} with an optional LLM polish${ai}` : `${ENGINE_NAME}: runs locally, no API key needed`;
  if (analysisMs !== undefined) {
    $('#engine-perf').textContent = `Analysed ${state.trades.length.toLocaleString('en-US')} trades in ${analysisMs < 1 ? '<1' : Math.round(analysisMs)} ms`;
  }
  $('#dataset').hidden = src?.mode !== 'local';
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
function recompute() {
  const started = performance.now();
  state.report = analyze(state.trades, { horizon: state.horizon, runs: 1000 });
  renderStatus(performance.now() - started);
}

function renderAll() {
  renderView(state.view);
  renderSymbolOptions();
}

function renderView(name) {
  if (!state.report) return;
  if (name === 'dashboard') renderDashboard();
  else if (name === 'analytics') renderAnalytics();
  else if (name === 'journal') renderJournal();
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function tile({ label, value, sub, tone, subTone, spark }) {
  const card = el('article', { class: 'card tile' }, [
    el('div', { class: 'tile-label', text: label }),
    el('div', { class: `tile-value ${tone || ''}`, text: value }),
    sub ? el('div', { class: `tile-sub ${subTone || ''}`, html: sub }) : null
  ]);
  if (spark) {
    const holder = el('div', { class: 'spark' });
    card.append(holder);
    requestAnimationFrame(() => sparkline(holder, spark.values, { negative: spark.negative }));
  }
  return card;
}

function meterColor(value) {
  return value >= 70 ? 'var(--accent)' : value >= 45 ? 'var(--warning)' : 'var(--critical)';
}

function renderDashboard() {
  const { stats, dna, insights, biases, equity, riskScore, riskLevel } = state.report;

  // Hero
  $('#alpha-score').replaceChildren(dna ? String(dna.alphaScore) : '--', el('small', { text: '/100' }));
  $('#alpha-grade').textContent = dna ? dna.grade : '-';
  $('#alpha-meter').style.width = `${dna ? dna.alphaScore : 0}%`;
  $('#alpha-summary').textContent = dna
    ? `Strongest: ${dna.strongest.label} (${dna.strongest.value}). Biggest opportunity: ${dna.weakest.label} (${dna.weakest.value}).`
    : 'Log at least 3 trades to compute your Alpha Score.';

  // KPI tiles
  const riskIcon = riskLevel === 'high' ? 'alert' : riskLevel === 'low' ? 'check' : 'shield';
  $('#kpi-tiles').replaceChildren(
    tile({
      label: 'Net P/L',
      value: money(stats.totalProfit),
      tone: toneClass(stats.totalProfit),
      sub: `${stats.returnPct >= 0 ? '+' : ''}${stats.returnPct}% on ${compactMoney(stats.startingBalance)}`,
      spark: { values: equity.map((p) => p.equity), negative: stats.totalProfit < 0 }
    }),
    tile({ label: 'Win rate', value: percent(stats.winRate), sub: `${stats.wins} wins · ${stats.losses} losses` }),
    tile({ label: 'Profit factor', value: number(stats.profitFactor), tone: stats.profitFactor >= 1 ? 'up' : 'down', sub: `Payoff ratio ${number(stats.payoffRatio)}` }),
    tile({ label: 'Expectancy', value: money(stats.expectancy), tone: toneClass(stats.expectancy), sub: `per trade · ${number(stats.avgR)}R average` }),
    tile({ label: 'Max drawdown', value: money(-stats.maxDrawdown), tone: stats.maxDrawdown ? 'down' : '', sub: `${percent(stats.maxDrawdownPct)} from peak` }),
    tile({ label: 'Risk score', value: `${riskScore}/100`, sub: `${icon(riskIcon, { size: 14 })}<span>${riskLevel[0].toUpperCase()}${riskLevel.slice(1)} risk</span>`, subTone: riskLevel === 'high' ? 'down' : riskLevel === 'low' ? 'up' : '' })
  );

  // Equity curve (single series: the card title names it)
  $('#equity-sub').textContent = `Balance after each of ${stats.totalTrades.toLocaleString('en-US')} trades, starting at ${compactMoney(stats.startingBalance)}`;
  chartOrTable('equity', $('#chart-equity'), () =>
    lineChart($('#chart-equity'), {
      points: equity,
      value: (p) => p.equity,
      xLabel: (p, i) => (i === 0 ? 'Start' : shortDate(p.timestamp)),
      yFormat: compactMoney,
      baseline: stats.startingBalance,
      height: 330,
      tooltip: (p, i) => ({
        title: i === 0 ? 'Starting balance' : `Trade #${i} · ${date(p.timestamp)}`,
        rows: [
          { label: 'Equity', value: money(p.equity, { sign: false }), color: 'var(--series-1)' },
          ...(i ? [{ label: `${p.symbol} P/L`, value: money(p.profit) }, { label: 'Drawdown', value: percent(p.drawdownPct) }] : [])
        ]
      })
    }),
    {
      columns: [
        { key: 'index', label: '#', num: true },
        { key: 'timestamp', label: 'Date', format: (v) => (v ? date(v) : 'Start') },
        { key: 'symbol', label: 'Symbol', format: (v) => v || '' },
        { key: 'profit', label: 'P/L', num: true, format: (v) => (v === undefined ? '' : money(v)), tone: (v) => toneClass(v) },
        { key: 'equity', label: 'Equity', num: true, format: (v) => money(v, { sign: false }) },
        { key: 'drawdownPct', label: 'Drawdown', num: true, format: percent }
      ],
      rows: [...equity].reverse()
    }
  );

  // Trader DNA
  const dnaRoot = $('#dna');
  dnaRoot.replaceChildren();
  if (!dna) dnaRoot.append(el('p', { class: 'chart-empty', text: 'Log at least 3 trades to build your Trader DNA.' }));
  for (const d of dna?.scores || []) {
    const bar = el('span', { style: 'width: 0%' });
    dnaRoot.append(
      el('div', { class: 'meter-row' }, [
        el('span', { class: 'meter-name', text: d.label }),
        el('span', { class: 'meter-value', text: String(d.value) }),
        el('div', { class: 'meter', style: `--meter-color: ${meterColor(d.value)}`, role: 'meter', 'aria-valuenow': d.value, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': d.label }, [bar]),
        el('span', { class: 'meter-detail', text: d.detail })
      ])
    );
    requestAnimationFrame(() => (bar.style.width = `${d.value}%`));
  }

  // Insights
  const insightIcons = { leak: 'alert', edge: 'target', forecast: 'dice', trend: 'up', dna: 'brain' };
  $('#insights').replaceChildren(
    ...(insights.length
      ? insights.map((ins) =>
          el('li', { class: 'insight', 'data-tone': ins.tone }, [
            el('span', { class: 'insight-icon', html: icon(ins.kind === 'trend' && ins.tone === 'negative' ? 'down' : insightIcons[ins.kind] || 'info') }),
            el('div', {}, [el('strong', { text: ins.title }), el('span', { text: ins.detail })])
          ])
        )
      : [el('li', { class: 'chart-empty', text: 'Insights appear once you have a few trades.' })])
  );

  // Biases
  $('#bias-sub').textContent = biases.length ? `${biases.length} detected from your trades and notes` : 'Detected from your trades and notes';
  $('#biases').replaceChildren(
    ...(biases.length
      ? biases.map((b) =>
          el('li', { class: 'bias' }, [
            el('div', { class: 'bias-head' }, [
              el('span', { class: 'severity', 'data-level': b.severity, html: `${icon('alert')}${b.severity}` }),
              el('strong', { text: BIAS_LABELS[b.type] || b.type }),
              b.costUsd ? el('span', { class: 'bias-cost', text: `cost ~${money(b.costUsd, { decimals: 0, sign: false })}` }) : null
            ]),
            el('p', { text: b.evidence }),
            el('p', { class: 'bias-fix', html: `${icon('target', { size: 14 })}` }, [b.recommendation])
          ])
        )
      : [el('li', { class: 'insight', 'data-tone': 'positive' }, [el('span', { class: 'insight-icon', html: icon('check') }), el('div', {}, [el('strong', { text: 'No biases detected' }), el('span', { text: 'Your journal shows disciplined, plan-driven trading.' })])])])
  );

  // Recent trades
  renderTradeTable($('#recent-trades'), state.trades.slice(0, 8), { compact: true });
}

// ---------------------------------------------------------------------------
// Chart <-> table toggles
// ---------------------------------------------------------------------------
function chartOrTable(key, container, drawChart, table) {
  const button = document.querySelector(`[data-toggle="${key}"]`);
  const showTable = state.tables.has(key);
  if (button) {
    button.innerHTML = `${icon(showTable ? 'chart' : 'table')}${showTable ? 'Chart' : 'Table'}`;
    button.setAttribute('aria-pressed', String(showTable));
  }
  if (showTable) renderTable(container, table);
  else drawChart();
}

function setupToggles() {
  document.addEventListener('click', (e) => {
    const button = e.target.closest('[data-toggle]');
    if (!button) return;
    const key = button.dataset.toggle;
    if (state.tables.has(key)) state.tables.delete(key);
    else state.tables.add(key);
    renderView(state.view);
  });
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------
function setupHorizon() {
  $('#horizon').addEventListener('click', (e) => {
    const button = e.target.closest('[data-horizon]');
    if (!button) return;
    state.horizon = Number(button.dataset.horizon);
    $('#view-analytics').classList.add('loading');
    requestAnimationFrame(() => {
      recompute();
      renderAnalytics();
      $('#view-analytics').classList.remove('loading');
    });
  });
}

const METRIC_ROWS = [
  ['Sharpe ratio (per trade)', (s) => number(s.sharpeRatio), 'Mean P/L divided by its volatility'],
  ['Sortino ratio', (s) => number(s.sortinoRatio), 'Like Sharpe, but only losses count as risk'],
  ['System Quality Number', (s) => number(s.sqn), 'Van Tharp: <1.6 poor, 2-3 good, 3+ excellent'],
  ['Average R-multiple', (s) => `${number(s.avgR)}R`, 'Profit per unit of planned risk'],
  ['Kelly fraction', (s) => percent(s.kellyPct), 'Growth-optimal bet size (use 1/4 of it)'],
  ['Payoff ratio', (s) => number(s.payoffRatio), 'Average win divided by average loss'],
  ['Recovery factor', (s) => number(s.recoveryFactor), 'Net profit divided by max drawdown'],
  ['Average risk / trade', (s) => money(s.avgRisk, { sign: false }), 'Entry-to-stop distance times size'],
  ['Longest win / loss streak', (s) => `${s.maxConsecutiveWins} / ${s.maxConsecutiveLosses}`, 'Consecutive winners and losers'],
  ['Avg hold: win / loss', (s) => `${s.avgWinDuration} / ${s.avgLossDuration} min`, 'Holding losers longer is a warning sign']
];

function renderAnalytics() {
  const { stats, monteCarlo: mc, equity, breakdowns } = state.report;
  for (const b of $('#horizon').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.horizon) === state.horizon));

  // Monte Carlo
  $('#mc-sub').textContent = mc ? `${mc.runs.toLocaleString('en-US')} simulated futures of your next ${mc.horizon} trades, resampled from your own results` : 'Needs at least 5 trades';
  $('#mc-tiles').replaceChildren(
    tile({ label: 'Chance of profit', value: mc ? percent(mc.probProfit) : '--', tone: mc ? (mc.probProfit >= 60 ? 'up' : 'down') : '', sub: mc ? `after ${mc.horizon} trades` : '' }),
    tile({ label: 'Median outcome', value: mc ? money(mc.final.p50 - mc.startingBalance, { decimals: 0 }) : '--', tone: mc ? toneClass(mc.final.p50 - mc.startingBalance) : '', sub: mc ? `range ${compactMoney(mc.final.p25 - mc.startingBalance)} to ${compactMoney(mc.final.p75 - mc.startingBalance)}` : '' }),
    tile({ label: 'Risk of ruin', value: mc ? percent(mc.riskOfRuin) : '--', tone: mc ? (mc.riskOfRuin > 5 ? 'down' : 'up') : '', sub: mc ? `falling ${mc.ruinPct}% below start` : '' }),
    tile({ label: 'Worst-case drawdown', value: mc ? percent(mc.worstCaseDrawdownPct) : '--', sub: mc ? `typical ${percent(mc.medianMaxDrawdownPct)}` : '' })
  );
  chartOrTable('fan', $('#chart-fan'), () => fanChart($('#chart-fan'), { bands: mc?.bands, startingBalance: stats.startingBalance, yFormat: compactMoney }), {
    columns: [
      { key: 'step', label: 'Trades ahead', num: true },
      { key: 'p5', label: '5%', num: true, format: (v) => money(v, { sign: false }) },
      { key: 'p25', label: '25%', num: true, format: (v) => money(v, { sign: false }) },
      { key: 'p50', label: 'Median', num: true, format: (v) => money(v, { sign: false }) },
      { key: 'p75', label: '75%', num: true, format: (v) => money(v, { sign: false }) },
      { key: 'p95', label: '95%', num: true, format: (v) => money(v, { sign: false }) }
    ],
    rows: mc?.bands || []
  });

  // Drawdown (underwater curve)
  chartOrTable('drawdown', $('#chart-drawdown'), () =>
    lineChart($('#chart-drawdown'), {
      points: equity,
      value: (p) => -p.drawdownPct,
      negative: true,
      xLabel: (p, i) => (i === 0 ? 'Start' : shortDate(p.timestamp)),
      yFormat: (v) => `${number(v, 1)}%`,
      height: 220,
      tooltip: (p, i) => ({ title: i ? `Trade #${i} · ${date(p.timestamp)}` : 'Start', rows: [{ label: 'Below peak', value: percent(p.drawdownPct), color: 'var(--neg)' }, { label: 'In dollars', value: money(-p.drawdown) }] })
    }),
    { columns: [{ key: 'index', label: '#', num: true }, { key: 'timestamp', label: 'Date', format: (v) => (v ? date(v) : 'Start') }, { key: 'drawdownPct', label: 'Drawdown', num: true, format: percent }, { key: 'drawdown', label: 'Dollars', num: true, format: (v) => money(-v) }], rows: [...equity].reverse() }
  );

  // R-multiple histogram
  const bins = breakdowns.rDistribution.map((b) => ({ label: `${b.from > 0 ? '+' : ''}${b.from}`, value: b.count, tone: b.from < 0 ? 'neg' : 'pos', bin: b }));
  chartOrTable('rdist', $('#chart-rdist'), () =>
    barChart($('#chart-rdist'), {
      items: bins,
      orientation: 'vertical',
      height: 220,
      format: (v) => String(Math.round(v)),
      tooltip: (d) => ({ title: `${d.bin.from}R to ${d.bin.to}R`, rows: [{ label: 'Trades', value: String(d.value) }] }),
      emptyText: 'Add stop losses to your trades to see R-multiples'
    }),
    { columns: [{ key: 'from', label: 'From (R)', num: true }, { key: 'to', label: 'To (R)', num: true }, { key: 'count', label: 'Trades', num: true }], rows: breakdowns.rDistribution }
  );

  // Profit by market
  chartOrTable('symbols', $('#chart-symbols'), () =>
    barChart($('#chart-symbols'), {
      items: breakdowns.bySymbol.map((s) => ({ label: s.symbol, value: s.profit, meta: s })),
      format: (v, axis) => (axis ? compactMoney(v) : money(v, { decimals: 0 })),
      tooltip: (d) => ({ title: d.label, rows: [{ label: 'Net P/L', value: money(d.value) }, { label: 'Trades', value: String(d.meta.trades) }, { label: 'Win rate', value: percent(d.meta.winRate) }, { label: 'Avg R', value: `${number(d.meta.avgR)}R` }] })
    }),
    { columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'trades', label: 'Trades', num: true }, { key: 'winRate', label: 'Win rate', num: true, format: percent }, { key: 'profit', label: 'Net P/L', num: true, format: (v) => money(v), tone: toneClass }, { key: 'avgR', label: 'Avg R', num: true }], rows: breakdowns.bySymbol }
  );

  // Weekday x session heatmap
  const sessions = breakdowns.bySession.map((s) => s.session);
  const weekdays = breakdowns.byWeekday.map((d) => d.weekday);
  chartOrTable('heatmap', $('#chart-heatmap'), () =>
    heatmap($('#chart-heatmap'), {
      rows: weekdays,
      cols: sessions,
      cells: breakdowns.heatmap.map((c) => ({ row: c.weekday, col: c.session, value: c.profit, trades: c.trades })),
      format: (v, cell) => (cell ? compactMoney(v) : money(v)),
      tooltip: (row, col, cell) => ({ title: `${row} · ${col} session`, rows: cell.trades ? [{ label: 'Net P/L', value: money(cell.value) }, { label: 'Trades', value: String(cell.trades) }] : [{ label: 'Trades', value: '0' }] })
    }),
    { columns: [{ key: 'weekday', label: 'Day' }, { key: 'session', label: 'Session' }, { key: 'trades', label: 'Trades', num: true }, { key: 'profit', label: 'Net P/L', num: true, format: (v) => money(v), tone: toneClass }], rows: breakdowns.heatmap.filter((c) => c.trades) }
  );

  // Monthly P/L
  chartOrTable('monthly', $('#chart-monthly'), () =>
    barChart($('#chart-monthly'), {
      items: breakdowns.monthly.map((m) => ({
        label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC', ...(breakdowns.monthly.length > 12 && { year: '2-digit' }) }),
        value: m.profit,
        meta: m
      })),
      orientation: 'vertical',
      height: 220,
      format: (v, axis) => (axis ? compactMoney(v) : compactMoney(v)),
      tooltip: (d) => ({ title: d.meta.month, rows: [{ label: 'Net P/L', value: money(d.value) }, { label: 'Trades', value: String(d.meta.trades) }, { label: 'Win rate', value: percent(d.meta.winRate) }] })
    }),
    { columns: [{ key: 'month', label: 'Month' }, { key: 'trades', label: 'Trades', num: true }, { key: 'winRate', label: 'Win rate', num: true, format: percent }, { key: 'profit', label: 'Net P/L', num: true, format: (v) => money(v), tone: toneClass }], rows: breakdowns.monthly }
  );

  renderTable($('#metrics-table'), {
    columns: [{ key: 'name', label: 'Metric' }, { key: 'value', label: 'Value', num: true }, { key: 'meaning', label: 'What it means', wrap: true }],
    rows: METRIC_ROWS.map(([name, fn, meaning]) => ({ name, value: fn(stats), meaning }))
  });
}

// ---------------------------------------------------------------------------
// Trades table (dashboard + journal)
// ---------------------------------------------------------------------------
function renderTradeTable(container, trades, { compact = false } = {}) {
  container.replaceChildren();
  if (!trades.length) {
    container.append(el('div', { class: 'chart-empty', text: 'No trades yet. Use "Add trade" or import a CSV to get started.' }));
    return;
  }
  const headers = ['Date', 'Symbol', 'Side', 'Entry', 'Exit', ...(compact ? [] : ['Size', 'Stop']), 'P/L', 'R', 'Notes', ''];
  const numeric = new Set(['Entry', 'Exit', 'Size', 'Stop', 'P/L', 'R']);
  const table = el('table', { class: 'data' }, [
    el('thead', {}, [el('tr', {}, headers.map((h) => el('th', { class: numeric.has(h) ? 'num' : '', text: h })))])
  ]);
  const body = el('tbody');
  for (const t of trades) {
    const r = rMultiple(t);
    body.append(
      el('tr', {}, [
        el('td', { text: date(t.timestamp, !compact) }),
        el('td', {}, [el('strong', { text: t.symbol })]),
        el('td', {}, [el('span', { class: 'side', text: t.type === 'sell' ? 'Short' : 'Long' })]),
        el('td', { class: 'num', text: number(t.entryPrice, 6) }),
        el('td', { class: 'num', text: number(t.exitPrice, 6) }),
        ...(compact ? [] : [el('td', { class: 'num', text: number(t.positionSize, 6) }), el('td', { class: 'num', text: t.stopLoss ? number(t.stopLoss, 6) : '—' })]),
        el('td', { class: `num ${toneClass(t.profit)}`, text: money(t.profit) }),
        el('td', { class: 'num', text: r === null ? '—' : `${r > 0 ? '+' : ''}${number(r, 2)}R` }),
        el('td', { class: 'notes', text: t.notes || '' }),
        el('td', {}, [
          el('div', { class: 'row-actions' }, [
            el('button', { class: 'btn btn-sm btn-icon btn-ghost', 'data-analyze': t.id, title: 'Ask the coach about this trade', 'aria-label': `Analyze ${t.symbol} trade`, html: icon('coach') }),
            compact ? null : el('button', { class: 'btn btn-sm btn-icon btn-ghost', 'data-delete': t.id, title: 'Delete trade', 'aria-label': `Delete ${t.symbol} trade`, html: icon('trash') })
          ])
        ])
      ])
    );
  }
  table.append(body);
  container.append(table);
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
function filteredTrades() {
  const { query, symbol } = state.journal;
  const q = query.trim().toLowerCase();
  return state.trades.filter((t) => (!symbol || t.symbol === symbol) && (!q || t.symbol.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q)));
}

function renderSymbolOptions() {
  const select = $('#journal-symbol');
  const current = select.value;
  const symbols = [...new Set(state.trades.map((t) => t.symbol))].sort();
  select.replaceChildren(el('option', { value: '', text: 'All markets' }), ...symbols.map((s) => el('option', { value: s, text: s })));
  select.value = symbols.includes(current) ? current : '';
}

function renderJournal() {
  const list = filteredTrades();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.journal.page = Math.min(state.journal.page, pages - 1);
  const start = state.journal.page * PAGE_SIZE;
  renderTradeTable($('#journal-table'), list.slice(start, start + PAGE_SIZE));

  const pager = $('#journal-pager');
  pager.replaceChildren(
    el('span', { text: list.length ? `${start + 1}-${Math.min(start + PAGE_SIZE, list.length)} of ${list.length.toLocaleString('en-US')}` : '0 trades' }),
    el('button', { class: 'btn btn-sm', disabled: state.journal.page === 0, onclick: () => { state.journal.page--; renderJournal(); }, text: 'Previous' }),
    el('button', { class: 'btn btn-sm', disabled: state.journal.page >= pages - 1, onclick: () => { state.journal.page++; renderJournal(); }, text: 'Next' })
  );
}

async function reloadTrades() {
  state.trades = await state.source.listTrades();
  recompute();
  renderAll();
}

function setupJournal() {
  $('#journal-search').addEventListener('input', debounce((e) => {
    state.journal.query = e.target.value;
    state.journal.page = 0;
    renderJournal();
  }, 120));
  $('#journal-symbol').addEventListener('change', (e) => {
    state.journal.symbol = e.target.value;
    state.journal.page = 0;
    renderJournal();
  });

  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-delete]');
    const analyzeBtn = e.target.closest('[data-analyze]');
    const action = e.target.closest('[data-action]')?.dataset.action;

    if (del) {
      const trade = state.trades.find((t) => t.id === del.dataset.delete);
      if (!trade || !confirm(`Delete this ${trade.symbol} trade from ${date(trade.timestamp)}?`)) return;
      await state.source.deleteTrade(trade.id);
      state.trades = state.trades.filter((t) => t.id !== trade.id);
      recompute();
      renderAll();
      toast('Trade deleted');
    } else if (analyzeBtn) {
      const trade = state.trades.find((t) => t.id === analyzeBtn.dataset.analyze);
      if (trade) analyzeTradeInChat(trade);
    } else if (action === 'add-trade') {
      openTradeDialog();
    } else if (action === 'import') {
      $('#csv-file').click();
    } else if (action === 'export') {
      const blob = new Blob([tradesToCsv(state.trades)], { type: 'text/csv' });
      const link = el('a', { href: URL.createObjectURL(blob), download: `alpha-trades-${new Date().toISOString().slice(0, 10)}.csv` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }
  });

  $('#csv-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast('CSV is larger than 5 MB', 'error');
    const { inputs, error } = tradesFromCsv(await file.text());
    if (error) return toast(error, 'error');
    const { imported, rejected } = await state.source.importTrades(inputs);
    await reloadTrades();
    toast(`Imported ${imported} trades${rejected ? `, skipped ${rejected} invalid rows` : ''}`, imported ? 'success' : 'warning');
  });

  $('#dataset').addEventListener('change', async (e) => {
    const kind = e.target.value;
    e.target.value = '';
    if (!kind || !state.source.loadDataset) return;
    await state.source.loadDataset(kind);
    await reloadTrades();
    toast(kind === 'big' ? 'Loaded 2,000 trades: the engine analysed them in your browser' : 'Demo journal restored');
  });
}

// ---------------------------------------------------------------------------
// Add-trade dialog
// ---------------------------------------------------------------------------
function localInputValue(dateValue) {
  const d = new Date(dateValue.getTime() - dateValue.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

function openTradeDialog() {
  const form = $('#trade-form');
  form.reset();
  form.elements.timestamp.value = localInputValue(new Date());
  $('#trade-errors').textContent = '';
  $('#trade-dialog').showModal();
  form.elements.symbol.focus();
}

function setupDialog() {
  const dialog = $('#trade-dialog');
  const form = $('#trade-form');
  form.addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'save') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    for (const key of Object.keys(data)) if (data[key] === '') delete data[key];
    if (data.timestamp) data.timestamp = new Date(data.timestamp).toISOString();
    if (data.duration) data.duration = Number(data.duration);

    const { errors } = buildTrade(data, { id: 'preview' });
    if (errors) {
      $('#trade-errors').textContent = errors.join('. ');
      return;
    }
    const button = $('#save-trade');
    button.disabled = true;
    try {
      const trade = await state.source.addTrade(data);
      state.trades = [trade, ...state.trades].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      recompute();
      renderAll();
      dialog.close();
      toast(`${trade.symbol} ${trade.status} saved: ${money(trade.profit)}`);
    } catch (error) {
      $('#trade-errors').textContent = error.details?.join('. ') || error.message;
    } finally {
      button.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Coach chat
// ---------------------------------------------------------------------------
function messageNode({ role, text, source, highlights = [], meta }) {
  const isUser = role === 'user';
  const bubble = el('div', { class: 'bubble' }, [el('div', { class: 'bubble-text', text })]);
  if (highlights?.length) {
    bubble.append(
      el('div', { class: 'chips' }, highlights.map((h) => el('span', { class: 'chip', 'data-tone': h.tone || '' }, [el('span', { text: h.label }), el('b', { text: h.value })])))
    );
  }
  const metaText = isUser ? 'You' : [SOURCE_LABELS[source] || 'Alpha Engine', meta].filter(Boolean).join(' · ');
  return el('div', { class: `msg ${isUser ? 'msg-user' : 'msg-ai'}` }, [
    el('span', { class: 'msg-avatar', html: icon(isUser ? 'user' : 'coach') }),
    el('div', {}, [bubble, el('div', { class: 'msg-meta', text: metaText })])
  ]);
}

function renderChat() {
  const box = $('#messages');
  const welcome = ask('hello', state.trades);
  box.replaceChildren(messageNode({ role: 'assistant', text: welcome.reply, source: 'alpha-engine', highlights: welcome.highlights }));
  for (const m of state.chat) box.append(messageNode(m));
  box.append(el('div', { class: 'typing', id: 'typing', 'aria-label': 'Coach is typing' }, [el('i'), el('i'), el('i')]));
  box.scrollTop = box.scrollHeight;
}

function pushMessage(message) {
  state.chat.push(message);
  const box = $('#messages');
  box.insertBefore(messageNode(message), $('#typing'));
  box.scrollTop = box.scrollHeight;
  state.source.saveChat?.(state.chat);
}

function setBusy(busy) {
  state.busy = busy;
  $('#send-button').disabled = busy;
  $('#typing')?.classList.toggle('show', busy);
  const box = $('#messages');
  box.scrollTop = box.scrollHeight;
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || state.busy) return;
  pushMessage({ role: 'user', text: message });
  setBusy(true);
  try {
    const answer = await state.source.chat(message);
    pushMessage({
      role: 'assistant',
      text: answer.reply,
      source: answer.source,
      highlights: answer.highlights,
      meta: answer.intent && answer.intent !== 'empty' ? `intent: ${answer.intent} (${Math.round((answer.confidence || 0) * 100)}%)` : ''
    });
  } catch (error) {
    console.warn('Coach request failed, answering locally:', error);
    const local = ask(message, state.trades);
    pushMessage({ role: 'assistant', text: local.reply, source: 'offline', highlights: local.highlights });
  } finally {
    setBusy(false);
  }
}

async function analyzeTradeInChat(trade) {
  showView('coach');
  pushMessage({ role: 'user', text: `Analyze my ${trade.symbol} ${trade.type === 'sell' ? 'short' : 'long'} from ${date(trade.timestamp)}` });
  setBusy(true);
  try {
    const { analysis: a, source } = await state.source.analyzeTrade(trade);
    const lines = [
      `${trade.symbol} ${trade.type === 'sell' ? 'short' : 'long'} on ${date(trade.timestamp)}: ${money(trade.profit)}`,
      '',
      a.successFactors.length ? `What went well:\n${a.successFactors.map((s) => `- ${s}`).join('\n')}` : '',
      a.mistakes.length ? `\nMistakes:\n${a.mistakes.map((s) => `- ${s}`).join('\n')}` : '',
      `\n${a.behavioralInsights}`,
      `\nNext time:\n${a.improvementSuggestions.map((s) => `- ${s}`).join('\n')}`
    ];
    pushMessage({
      role: 'assistant',
      text: lines.filter((l) => l !== '').join('\n'),
      source,
      highlights: [
        { label: 'Plan adherence', value: `${a.confidenceScore}/100`, tone: a.confidenceScore >= 70 ? 'positive' : a.confidenceScore < 45 ? 'negative' : 'warning' },
        { label: 'Risk', value: a.riskAssessment, tone: a.riskAssessment === 'high' ? 'negative' : a.riskAssessment === 'low' ? 'positive' : 'warning' },
        ...(a.metrics.rMultiple !== null ? [{ label: 'Result', value: `${a.metrics.rMultiple}R` }] : [])
      ],
      meta: 'trade analysis'
    });
  } catch (error) {
    toast(`Could not analyse the trade: ${error.message}`, 'error');
  } finally {
    setBusy(false);
  }
}

function setupChat() {
  const input = $('#message-input');
  const resize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(140, input.scrollHeight)}px`;
  };
  input.addEventListener('input', resize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    resize();
    sendMessage(text);
  });
  $('#suggestions').replaceChildren(
    ...SUGGESTIONS.map((q) => el('button', { class: 'suggestion', type: 'button', text: q, onclick: () => sendMessage(q) }))
  );
  $('#clear-chat').addEventListener('click', async () => {
    await state.source?.clearChat();
    state.chat = [];
    renderChat();
    toast('Started a new conversation');
  });
}

async function restoreChat() {
  try {
    state.chat = (await state.source.chatHistory()) || [];
  } catch {
    state.chat = [];
  }
  renderChat();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  hydrateIcons();
  setupTheme();
  setupNav();
  setupToggles();
  setupHorizon();
  setupJournal();
  setupDialog();
  setupChat();
  showView(location.hash.slice(1) || 'dashboard');

  state.source = await connect();
  state.trades = state.source.initialTrades ?? (await state.source.listTrades());
  recompute();
  renderAll();
  await restoreChat();

  if (state.source.mode === 'local' && state.source.reason === 'no-database') {
    toast('Running in local mode: your trades are saved in this browser', 'warning');
  } else if (state.source.mode === 'local') {
    toast('API not reachable: running fully in your browser', 'warning');
  }

  let lastWidth = window.innerWidth;
  window.addEventListener(
    'resize',
    debounce(() => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      renderView(state.view);
    }, 150)
  );
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', renderThemeButton);
}

boot().catch((error) => {
  console.error(error);
  toast(`Failed to start: ${error.message}`, 'error');
});
