// Time bucketing helpers. Everything is UTC so results never depend on the
// server's or viewer's time zone.

export const SESSIONS = [
  { key: 'asian', name: 'Asian', from: 0, to: 7 },
  { key: 'european', name: 'European', from: 7, to: 13 },
  { key: 'us', name: 'US', from: 13, to: 21 },
  { key: 'lateUs', name: 'Late US', from: 21, to: 24 }
];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const DAY_MS = 86400000;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/;

// Stored timestamps are normalised ISO strings in UTC, so the hour can be
// read straight from the string (fast path); anything else is parsed.
export function utcHour(timestamp) {
  return ISO_UTC.test(timestamp) ? Number(timestamp.slice(11, 13)) : new Date(timestamp).getUTCHours();
}

export const daysSinceEpoch = (timestamp) => Math.floor(Date.parse(timestamp) / DAY_MS);

export function sessionOf(timestamp) {
  const hour = utcHour(timestamp);
  return SESSIONS.find((s) => hour >= s.from && hour < s.to);
}

export const sessionLabel = (s) => `${s.name} (${String(s.from).padStart(2, '0')}-${String(s.to).padStart(2, '0')} UTC)`;

// 0 = Sunday. 1970-01-01 was a Thursday (4).
export const weekdayOf = (timestamp) => (((daysSinceEpoch(timestamp) + 4) % 7) + 7) % 7;

export const monthKey = (timestamp) => timestamp.slice(0, 7);

// ISO-8601 week key, e.g. "2026-W14": the week belongs to the year of its
// Thursday, and week 1 is the week containing that year's first Thursday.
export function weekKey(timestamp) {
  const day = daysSinceEpoch(timestamp);
  const isoWeekday = (((day + 3) % 7) + 7) % 7; // Monday = 0
  const thursday = day - isoWeekday + 3;
  const year = new Date(thursday * DAY_MS).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1) / DAY_MS) / 7) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Minutes between the close of `prev` (entry + duration) and the entry of `cur`.
export function minutesBetween(prev, cur) {
  return (Date.parse(cur.timestamp) - Date.parse(prev.timestamp)) / 60000 - (prev.duration || 0);
}
