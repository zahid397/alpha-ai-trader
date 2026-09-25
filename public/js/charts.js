// Dependency-free SVG charts. Colours come from CSS roles (see app.css), so
// light/dark themes need no re-render. Every chart has a hover/focus tooltip
// and a table-view twin (renderTable) so no value is gated behind hover.

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, value, attrs = {}) {
  const node = svg('text', { x, y, ...attrs }, parent);
  node.textContent = value;
  return node;
}

// ---------------------------------------------------------------------------
// Tooltip (one shared element, DOM built with textContent only)
// ---------------------------------------------------------------------------
let tooltipEl = null;

function tooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

export function showTooltip({ title, rows = [] }, clientX, clientY) {
  const tip = tooltip();
  tip.replaceChildren();
  if (title) {
    const t = document.createElement('div');
    t.className = 'tt-title';
    t.textContent = title;
    tip.appendChild(t);
  }
  for (const row of rows) {
    const r = document.createElement('div');
    r.className = 'tt-row';
    const b = document.createElement('b');
    b.textContent = row.value;
    const label = document.createElement('span');
    if (row.color) {
      const key = document.createElement('i');
      key.className = 'tt-key';
      key.style.background = row.color;
      label.appendChild(key);
    }
    label.appendChild(document.createTextNode(row.label));
    r.append(b, label);
    tip.appendChild(r);
  }
  tip.classList.add('show');
  const { width, height } = tip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - height - 12;
  if (left + width > window.innerWidth - 8) left = clientX - width - 14;
  if (top < 8) top = clientY + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

export function hideTooltip() {
  tooltipEl?.classList.remove('show');
}

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------
export function niceTicks(min, max, count = 5) {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return { min: lo, max: hi, ticks };
}

const linear = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function prepare(container, height) {
  container.replaceChildren();
  const width = Math.max(260, Math.floor(container.clientWidth || container.parentElement?.clientWidth || 600));
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' }, container);
  return { root, width };
}

function empty(container, message) {
  container.replaceChildren();
  const div = document.createElement('div');
  div.className = 'chart-empty';
  div.textContent = message;
  container.appendChild(div);
}

function gridAndYAxis(root, { ticks, y, left, right, format }) {
  const g = svg('g', {}, root);
  for (const t of ticks) {
    const yy = Math.round(y(t)) + 0.5;
    svg('line', { x1: left, x2: right, y1: yy, y2: yy, class: t === 0 ? 'c-axis' : 'c-grid' }, g);
    text(g, left - 8, yy + 4, format(t), { class: 'c-tick', 'text-anchor': 'end' });
  }
  return g;
}

// Rounded data-end, square at the baseline (4px radius).
function barPath(x, y, w, h, side, radius = 4) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (w <= 0 || h <= 0) return '';
  switch (side) {
    case 'top':
      return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
    case 'bottom':
      return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
    case 'right':
      return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
    default:
      return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
  }
}

function attachHover(target, getTip) {
  const show = (e) => {
    const box = target.getBoundingClientRect();
    const x = e.clientX ?? box.left + box.width / 2;
    const y = e.clientY ?? box.top;
    showTooltip(getTip(), x, y);
  };
  target.addEventListener('pointermove', show);
  target.addEventListener('pointerenter', show);
  target.addEventListener('pointerleave', hideTooltip);
  target.addEventListener('focus', (e) => {
    const box = target.getBoundingClientRect();
    showTooltip(getTip(), box.left + box.width / 2, box.top);
  });
  target.addEventListener('blur', hideTooltip);
}

// ---------------------------------------------------------------------------
// Crosshair (line + fan charts): snaps to the nearest index, keyboard-driven
// ---------------------------------------------------------------------------
function crosshair(root, { count, x, top, bottom, left, right, focusY, getTip, label }) {
  const line = svg('line', { y1: top, y2: bottom, class: 'c-crosshair', visibility: 'hidden' }, root);
  const dot = svg('circle', { r: 4.5, class: 'c-dot', visibility: 'hidden', style: 'fill: var(--series-1)' }, root);
  const overlay = svg('rect', { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), class: 'c-hit', tabindex: 0, 'aria-label': label }, root);
  let index = count - 1;

  const place = (i, clientX, clientY) => {
    index = Math.max(0, Math.min(count - 1, i));
    const xx = x(index);
    line.setAttribute('x1', xx);
    line.setAttribute('x2', xx);
    dot.setAttribute('cx', xx);
    dot.setAttribute('cy', focusY(index));
    line.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    const box = root.getBoundingClientRect();
    const scale = box.width / Number(root.getAttribute('viewBox').split(' ')[2]);
    showTooltip(getTip(index), clientX ?? box.left + xx * scale, clientY ?? box.top + focusY(index) * scale);
  };
  const hide = () => {
    line.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    hideTooltip();
  };

  overlay.addEventListener('pointermove', (e) => {
    const box = root.getBoundingClientRect();
    const scale = Number(root.getAttribute('viewBox').split(' ')[2]) / box.width;
    const px = (e.clientX - box.left) * scale;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < count; i++) {
      const d = Math.abs(x(i) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    place(best, e.clientX, e.clientY);
  });
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('focus', () => place(index));
  overlay.addEventListener('blur', hide);
  overlay.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowLeft') place(index - step);
    else if (e.key === 'ArrowRight') place(index + step);
    else if (e.key === 'Home') place(0);
    else if (e.key === 'End') place(count - 1);
    else return;
    e.preventDefault();
  });
}

// ---------------------------------------------------------------------------
// Line / area chart (single series: the title names it, no legend box)
// ---------------------------------------------------------------------------
export function lineChart(container, { points, value, xLabel, yFormat, tooltip: tip, height = 260, negative = false, baseline = null, emptyText = 'Not enough data yet' }) {
  if (!points || points.length < 2) return empty(container, emptyText);
  const { root, width } = prepare(container, height);
  const m = { top: 12, right: 16, bottom: 28, left: 64 };
  const values = points.map(value);
  const lo = Math.min(...values, baseline ?? Infinity);
  const hi = Math.max(...values, baseline ?? -Infinity);
  const { min, max, ticks } = niceTicks(lo, hi, 4);
  const x = linear(0, points.length - 1, m.left, width - m.right);
  const y = linear(min, max, height - m.bottom, m.top);

  gridAndYAxis(root, { ticks, y, left: m.left, right: width - m.right, format: yFormat });

  const labelCount = Math.min(5, points.length);
  for (let k = 0; k < labelCount; k++) {
    const i = Math.round((k / Math.max(1, labelCount - 1)) * (points.length - 1));
    text(root, x(i), height - 8, xLabel(points[i], i), { class: 'c-tick', 'text-anchor': k === 0 ? 'start' : k === labelCount - 1 ? 'end' : 'middle' });
  }

  if (baseline !== null) {
    const yb = Math.round(y(baseline)) + 0.5;
    svg('line', { x1: m.left, x2: width - m.right, y1: yb, y2: yb, class: 'c-ref' }, root);
  }

  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const floor = negative ? y(Math.min(max, 0)) : height - m.bottom;
  svg('path', { d: `${d}L${x(values.length - 1).toFixed(1)},${floor}L${x(0).toFixed(1)},${floor}Z`, class: negative ? 'c-area-neg' : 'c-area' }, root);
  svg('path', { d, class: negative ? 'c-line-neg' : 'c-line' }, root);

  const endX = x(values.length - 1);
  const endY = y(values[values.length - 1]);
  svg('circle', { cx: endX, cy: endY, r: 4.5, class: 'c-dot', style: `fill: var(${negative ? '--neg' : '--series-1'})` }, root);

  crosshair(root, {
    count: points.length,
    x,
    top: m.top,
    bottom: height - m.bottom,
    left: m.left,
    right: width - m.right,
    focusY: (i) => y(values[i]),
    getTip: (i) => tip(points[i], i),
    label: 'Chart: use left and right arrow keys to read values'
  });
}

// ---------------------------------------------------------------------------
// Monte Carlo fan chart: 5-95% and 25-75% bands + median, one hue
// ---------------------------------------------------------------------------
export function fanChart(container, { bands, startingBalance, yFormat, height = 300 }) {
  if (!bands || bands.length < 2) return empty(container, 'Need at least 5 trades to simulate the future');
  const { root, width } = prepare(container, height);
  const m = { top: 12, right: 16, bottom: 28, left: 64 };
  const { min, max, ticks } = niceTicks(Math.min(...bands.map((b) => b.p5), startingBalance), Math.max(...bands.map((b) => b.p95), startingBalance), 5);
  const lastStep = bands[bands.length - 1].step;
  const x = linear(0, lastStep, m.left, width - m.right);
  const y = linear(min, max, height - m.bottom, m.top);

  gridAndYAxis(root, { ticks, y, left: m.left, right: width - m.right, format: yFormat });
  for (const b of [bands[0], bands[Math.floor(bands.length / 2)], bands[bands.length - 1]]) {
    text(root, x(b.step), height - 8, b.step === 0 ? 'Now' : `+${b.step} trades`, { class: 'c-tick', 'text-anchor': b.step === 0 ? 'start' : b.step === lastStep ? 'end' : 'middle' });
  }

  const area = (lo, hi) => {
    const top = bands.map((b, i) => `${i ? 'L' : 'M'}${x(b.step).toFixed(1)},${y(b[hi]).toFixed(1)}`).join('');
    const bottom = [...bands].reverse().map((b) => `L${x(b.step).toFixed(1)},${y(b[lo]).toFixed(1)}`).join('');
    return `${top}${bottom}Z`;
  };
  svg('path', { d: area('p5', 'p95'), class: 'c-band-outer' }, root);
  svg('path', { d: area('p25', 'p75'), class: 'c-band-inner' }, root);
  const yb = Math.round(y(startingBalance)) + 0.5;
  svg('line', { x1: m.left, x2: width - m.right, y1: yb, y2: yb, class: 'c-ref' }, root);
  text(root, m.left + 6, yb - 6, 'Break-even', { class: 'c-tick' });
  const median = bands.map((b, i) => `${i ? 'L' : 'M'}${x(b.step).toFixed(1)},${y(b.p50).toFixed(1)}`).join('');
  svg('path', { d: median, class: 'c-line' }, root);
  const last = bands[bands.length - 1];
  svg('circle', { cx: x(last.step), cy: y(last.p50), r: 4.5, class: 'c-dot', style: 'fill: var(--series-1)' }, root);

  crosshair(root, {
    count: bands.length,
    x: (i) => x(bands[i].step),
    top: m.top,
    bottom: height - m.bottom,
    left: m.left,
    right: width - m.right,
    focusY: (i) => y(bands[i].p50),
    getTip: (i) => {
      const b = bands[i];
      return {
        title: b.step === 0 ? 'Today' : `After ${b.step} more trades`,
        rows: [
          { label: '95th percentile', value: yFormat(b.p95) },
          { label: '75th percentile', value: yFormat(b.p75) },
          { label: 'Median', value: yFormat(b.p50), color: 'var(--series-1)' },
          { label: '25th percentile', value: yFormat(b.p25) },
          { label: '5th percentile', value: yFormat(b.p5) }
        ]
      };
    },
    label: 'Monte Carlo forecast: use arrow keys to read percentiles'
  });

  const legend = document.createElement('div');
  legend.className = 'legend';
  for (const [label, style] of [
    ['Median path', 'background: var(--series-1); height: 3px'],
    ['25-75% of futures', 'background: color-mix(in srgb, var(--series-1) 30%, transparent)'],
    ['5-95% of futures', 'background: color-mix(in srgb, var(--series-1) 12%, transparent)']
  ]) {
    const span = document.createElement('span');
    const key = document.createElement('i');
    key.setAttribute('style', style);
    span.append(key, document.createTextNode(label));
    legend.appendChild(span);
  }
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Diverging bar chart (profit blue, loss red, zero baseline)
// ---------------------------------------------------------------------------
export function barChart(container, { items, format, tooltip: tip, orientation = 'horizontal', height, labelWidth = 76, showValues = true, emptyText = 'No data yet' }) {
  if (!items || !items.length) return empty(container, emptyText);
  const values = items.map((d) => d.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);

  if (orientation === 'horizontal') {
    const band = 34;
    const h = height ?? items.length * band + 28;
    const { root, width } = prepare(container, h);
    const m = { top: 6, right: showValues ? 70 : 16, bottom: 22, left: labelWidth + (lo < 0 && showValues ? 62 : 8) };
    const { min, max, ticks } = niceTicks(lo, hi, 4);
    const x = linear(min, max, m.left, width - m.right);
    for (const t of ticks) {
      const xx = Math.round(x(t)) + 0.5;
      svg('line', { x1: xx, x2: xx, y1: m.top, y2: h - m.bottom, class: t === 0 ? 'c-axis' : 'c-grid' }, root);
      text(root, xx, h - 6, format(t, true), { class: 'c-tick', 'text-anchor': 'middle' });
    }
    items.forEach((d, i) => {
      const cy = m.top + i * band + band / 2;
      const thickness = Math.min(20, band - 12);
      const x0 = x(0);
      const x1 = x(d.value);
      const positive = d.value >= 0;
      text(root, 8, cy + 4, d.label, { class: 'c-label' });
      svg('path', { d: barPath(Math.min(x0, x1), cy - thickness / 2, Math.abs(x1 - x0), thickness, positive ? 'right' : 'left'), class: `c-bar ${positive ? 'c-pos' : 'c-neg'}` }, root);
      if (showValues) text(root, positive ? x1 + 6 : x1 - 6, cy + 4, format(d.value), { class: 'c-value', 'text-anchor': positive ? 'start' : 'end' });
      const hit = svg('rect', { x: 0, y: cy - band / 2, width, height: band, class: 'c-hit', tabindex: 0, 'aria-label': `${d.label}: ${format(d.value)}` }, root);
      attachHover(hit, () => tip(d));
    });
    return;
  }

  const h = height ?? 240;
  const { root, width } = prepare(container, h);
  const m = { top: 18, right: 12, bottom: 30, left: 56 };
  const { min, max, ticks } = niceTicks(lo, hi, 4);
  const y = linear(min, max, h - m.bottom, m.top);
  gridAndYAxis(root, { ticks, y, left: m.left, right: width - m.right, format: (v) => format(v, true) });
  const slot = (width - m.left - m.right) / items.length;
  const thickness = Math.max(4, Math.min(24, slot - 2));
  const labelEvery = Math.ceil(items.length / Math.max(1, Math.floor((width - m.left) / 46)));
  items.forEach((d, i) => {
    const cx = m.left + slot * i + slot / 2;
    const y0 = y(0);
    const y1 = y(d.value);
    const positive = d.value >= 0;
    const cls = d.tone ? `c-${d.tone}` : positive ? 'c-pos' : 'c-neg';
    svg('path', { d: barPath(cx - thickness / 2, Math.min(y0, y1), thickness, Math.abs(y1 - y0), positive ? 'top' : 'bottom'), class: `c-bar ${cls}` }, root);
    if (showValues && items.length <= 14 && thickness >= 14 && d.value !== 0) {
      text(root, cx, positive ? y1 - 5 : y1 + 13, format(d.value, true), { class: 'c-value', 'text-anchor': 'middle' });
    }
    if (i % labelEvery === 0) text(root, cx, h - 10, d.label, { class: 'c-tick', 'text-anchor': 'middle' });
    const hit = svg('rect', { x: cx - slot / 2, y: m.top, width: slot, height: h - m.top - m.bottom, class: 'c-hit', tabindex: 0, 'aria-label': `${d.label}: ${format(d.value)}` }, root);
    attachHover(hit, () => tip(d));
  });
}

// ---------------------------------------------------------------------------
// Heatmap (diverging: loss red <- grey -> profit blue)
// ---------------------------------------------------------------------------
export function heatmap(container, { rows, cols, cells, format, tooltip: tip, height }) {
  if (!cells.some((c) => c.trades > 0)) return empty(container, 'No trades yet');
  const labelW = 76;
  const cellH = 40;
  const h = height ?? rows.length * cellH + 30;
  const { root, width } = prepare(container, h);
  const cellW = (width - labelW) / cols.length;
  const maxAbs = Math.max(...cells.map((c) => Math.abs(c.value)), 1);

  cols.forEach((col, j) => text(root, labelW + cellW * j + cellW / 2, 14, col, { class: 'c-tick', 'text-anchor': 'middle' }));
  rows.forEach((row, i) => {
    const yy = 22 + i * cellH;
    text(root, 0, yy + cellH / 2 + 4, row, { class: 'c-label' });
    cols.forEach((col, j) => {
      const cell = cells.find((c) => c.row === row && c.col === col) || { value: 0, trades: 0 };
      const rect = svg('rect', { x: labelW + cellW * j, y: yy, width: Math.max(0, cellW), height: cellH, rx: 6, class: 'c-cell' }, root);
      const strength = cell.trades ? 14 + 66 * (Math.abs(cell.value) / maxAbs) : 0;
      rect.style.fill = cell.trades
        ? `color-mix(in srgb, var(${cell.value >= 0 ? '--pos' : '--neg'}) ${strength.toFixed(0)}%, var(--mid))`
        : 'var(--surface-2)';
      const label = cell.trades ? format(cell.value, true) : '·';
      if (cellW >= 46 || !cell.trades) text(root, labelW + cellW * j + cellW / 2, yy + cellH / 2 + 4, label, { class: 'c-cell-text', 'text-anchor': 'middle', style: 'fill: var(--text)' });
      rect.setAttribute('tabindex', 0);
      rect.setAttribute('aria-label', `${row} ${col}: ${cell.trades ? format(cell.value) : 'no trades'}`);
      attachHover(rect, () => tip(row, col, cell));
    });
  });

  const legend = document.createElement('div');
  legend.className = 'legend';
  const scale = document.createElement('span');
  const bar = document.createElement('i');
  bar.style.width = '120px';
  bar.style.background = 'linear-gradient(90deg, var(--neg), var(--mid), var(--pos))';
  scale.append('Loss', bar, 'Profit');
  legend.appendChild(scale);
  container.appendChild(legend);
}

// ---------------------------------------------------------------------------
// Sparkline (de-emphasised trend inside a stat tile)
// ---------------------------------------------------------------------------
export function sparkline(container, values, { negative = false } = {}) {
  container.replaceChildren();
  if (!values || values.length < 2) return;
  const width = Math.max(80, container.clientWidth || 160);
  const height = 34;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, height, 'aria-hidden': 'true' }, container);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = linear(0, values.length - 1, 2, width - 4);
  const y = linear(lo, hi, height - 3, 3);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  svg('path', { d: `${d}L${x(values.length - 1)},${height}L${x(0)},${height}Z`, class: negative ? 'c-area-neg' : 'c-area' }, root);
  svg('path', { d, class: negative ? 'c-line-neg' : 'c-line', style: 'stroke-width: 1.5' }, root);
  svg('circle', { cx: x(values.length - 1), cy: y(values[values.length - 1]), r: 3, class: 'c-dot', style: `fill: var(${negative ? '--neg' : '--series-1'})` }, root);
}

// ---------------------------------------------------------------------------
// Table view: the accessible twin of every chart
// ---------------------------------------------------------------------------
export function renderTable(container, { columns, rows }) {
  container.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'data';
  const head = table.createTHead().insertRow();
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.num) th.className = 'num';
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const col of columns) {
      const td = tr.insertCell();
      const raw = row[col.key];
      td.textContent = col.format ? col.format(raw, row) : raw ?? '';
      if (col.num) td.className = 'num';
      if (col.wrap) td.className = 'notes';
      if (col.tone) {
        const tone = col.tone(raw, row);
        if (tone) td.classList.add(tone);
      }
    }
  }
  wrap.appendChild(table);
  container.appendChild(wrap);
}
