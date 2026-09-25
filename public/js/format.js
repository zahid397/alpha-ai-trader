// Formatting + DOM helpers shared by the dashboard.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Safe for element content and quoted attribute values.
export function escapeHtml(value) {
  return (value === null || value === undefined ? '' : String(value)).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function money(value, { decimals = 2, sign = true } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  const abs = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const prefix = num < 0 ? '-' : sign && num > 0 ? '+' : '';
  return `${prefix}$${abs}`;
}

export function compactMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 'N/A';
  const abs = Math.abs(num);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}M` : abs >= 1e4 ? `${(abs / 1e3).toFixed(1)}K` : abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return `${num < 0 ? '-' : ''}$${text}`;
}

export function number(value, decimals = 2) {
  const num = Number(value);
  return Number.isFinite(num) ? num.toLocaleString('en-US', { maximumFractionDigits: decimals }) : 'N/A';
}

export function percent(value, decimals = 1) {
  const num = Number(value);
  return Number.isFinite(num) ? `${num.toFixed(decimals).replace(/\.0+$/, '')}%` : 'N/A';
}

export function date(timestamp, withTime = false) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(withTime && { hour: '2-digit', minute: '2-digit' })
  });
}

export const toneClass = (value) => (value > 0 ? 'up' : value < 0 ? 'down' : '');

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function debounce(fn, ms = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
