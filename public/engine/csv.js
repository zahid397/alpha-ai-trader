// CSV import/export for trade journals (broker exports, spreadsheets).
// Header names are matched loosely so most exports work unchanged.

const HEADER_ALIASES = {
  symbol: ['symbol', 'ticker', 'instrument', 'market', 'pair', 'asset'],
  type: ['type', 'side', 'direction', 'action'],
  entryPrice: ['entryprice', 'entry', 'open', 'openprice', 'buyprice', 'entry_price'],
  exitPrice: ['exitprice', 'exit', 'close', 'closeprice', 'sellprice', 'exit_price'],
  positionSize: ['positionsize', 'size', 'qty', 'quantity', 'volume', 'lots', 'amount', 'units', 'position_size'],
  stopLoss: ['stoploss', 'stop', 'sl', 'stop_loss'],
  takeProfit: ['takeprofit', 'target', 'tp', 'take_profit'],
  timestamp: ['timestamp', 'time', 'date', 'datetime', 'opentime', 'entrytime', 'open_time'],
  duration: ['duration', 'minutes', 'holdtime', 'duration_min'],
  notes: ['notes', 'note', 'comment', 'comments', 'journal', 'reason']
};

const EXPORT_COLUMNS = ['id', 'symbol', 'type', 'entryPrice', 'exitPrice', 'positionSize', 'profit', 'stopLoss', 'takeProfit', 'timestamp', 'duration', 'notes'];

// RFC 4180-style parser: quoted fields, escaped quotes, CRLF/LF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text).replace(/^﻿/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// Map parsed CSV rows to raw trade inputs (validated later by buildTrade).
export function tradesFromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { inputs: [], unmapped: [], error: 'The file needs a header row and at least one trade.' };

  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s()$]/g, ''));
  const columnFor = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex((h) => aliases.includes(h));
    if (index !== -1) columnFor[field] = index;
  }
  const missing = ['symbol', 'type', 'entryPrice', 'exitPrice', 'positionSize'].filter((f) => columnFor[f] === undefined);
  if (missing.length) return { inputs: [], unmapped: missing, error: `Missing required columns: ${missing.join(', ')}` };

  const inputs = rows.slice(1).map((cells) => {
    const input = {};
    for (const [field, index] of Object.entries(columnFor)) {
      const value = (cells[index] ?? '').trim();
      if (value !== '') input[field] = value;
    }
    return input;
  });
  return { inputs, unmapped: [], error: null };
}

const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function tradesToCsv(trades) {
  return [EXPORT_COLUMNS.join(','), ...trades.map((t) => EXPORT_COLUMNS.map((c) => csvCell(t[c])).join(','))].join('\n');
}
