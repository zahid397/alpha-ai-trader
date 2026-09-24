// Newest first; ties broken by id so ordering is stable across backends.
export function byNewest(a, b) {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

// Filters are pre-normalised by the route (upper-case symbol, ISO dates),
// so plain string comparison matches the D1 query exactly.
export function matchesFilters(trade, { symbol, startDate, endDate } = {}) {
  if (symbol && trade.symbol !== symbol) return false;
  if (startDate && trade.timestamp < startDate) return false;
  if (endDate && trade.timestamp > endDate) return false;
  return true;
}
