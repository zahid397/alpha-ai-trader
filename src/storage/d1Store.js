import { normalizeSeedTrade, toTrade } from '../services/tradeModel.js';

// Schema is applied at runtime (idempotent) so a fresh, auto-provisioned D1
// database works on the very first request, with no manual migration step.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    position_size REAL NOT NULL,
    profit REAL NOT NULL,
    duration INTEGER NOT NULL DEFAULT 0,
    timestamp TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    stop_loss REAL,
    take_profit REAL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades (timestamp DESC)',
  'CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol)',
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    last_active TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    messages TEXT NOT NULL DEFAULT '[]'
  )`,
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
];

const TRADE_COLUMNS =
  'id, symbol, type, entry_price, exit_price, position_size, profit, duration, timestamp, notes, status, stop_loss, take_profit';

const tradeParams = (t) => [
  t.id, t.symbol, t.type, t.entryPrice, t.exitPrice, t.positionSize, t.profit,
  t.duration, t.timestamp, t.notes, t.status, t.stopLoss, t.takeProfit
];

const rowToTrade = (row) =>
  toTrade({
    id: row.id,
    symbol: row.symbol,
    type: row.type,
    entryPrice: row.entry_price,
    exitPrice: row.exit_price,
    positionSize: row.position_size,
    profit: row.profit,
    duration: row.duration,
    timestamp: row.timestamp,
    notes: row.notes,
    status: row.status,
    stopLoss: row.stop_loss,
    takeProfit: row.take_profit
  });

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const rowToSession = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  lastActive: row.last_active,
  metadata: parseJson(row.metadata, {}),
  messages: parseJson(row.messages, [])
});

export function createD1Store(db, seedTrades = []) {
  let ready = null;

  async function init() {
    await db.batch(SCHEMA.map((sql) => db.prepare(sql)));

    // Seed the demo trades exactly once, even if the user later deletes them.
    const seeded = await db.prepare("SELECT value FROM meta WHERE key = 'seeded'").first();
    if (seeded) return;

    const insert = db.prepare(
      `INSERT OR IGNORE INTO trades (${TRADE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    await db.batch([
      ...seedTrades.map((t) => insert.bind(...tradeParams(normalizeSeedTrade(t)))),
      db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', ?)").bind(new Date().toISOString())
    ]);
  }

  // Run schema setup once per isolate; retry on the next request if it failed.
  const ensureReady = () => {
    if (!ready) {
      ready = init().catch((error) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  };

  return {
    kind: 'd1',

    async listTrades({ symbol, startDate, endDate } = {}) {
      await ensureReady();
      const where = [];
      const params = [];
      if (symbol) { where.push('symbol = ?'); params.push(symbol); }
      if (startDate) { where.push('timestamp >= ?'); params.push(startDate); }
      if (endDate) { where.push('timestamp <= ?'); params.push(endDate); }

      const sql = `SELECT ${TRADE_COLUMNS} FROM trades${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY timestamp DESC, id DESC`;
      const { results } = await db.prepare(sql).bind(...params).all();
      return results.map(rowToTrade);
    },

    async getTrade(id) {
      await ensureReady();
      const row = await db.prepare(`SELECT ${TRADE_COLUMNS} FROM trades WHERE id = ?`).bind(id).first();
      return row ? rowToTrade(row) : null;
    },

    async insertTrade(trade) {
      await ensureReady();
      await db
        .prepare(`INSERT INTO trades (${TRADE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...tradeParams(trade))
        .run();
      return trade;
    },

    async updateTrade(trade) {
      await ensureReady();
      const [, ...rest] = tradeParams(trade);
      const result = await db
        .prepare(
          `UPDATE trades SET symbol = ?, type = ?, entry_price = ?, exit_price = ?, position_size = ?, profit = ?,
             duration = ?, timestamp = ?, notes = ?, status = ?, stop_loss = ?, take_profit = ? WHERE id = ?`
        )
        .bind(...rest, trade.id)
        .run();
      return result.meta.changes > 0;
    },

    async deleteTrade(id) {
      await ensureReady();
      const result = await db.prepare('DELETE FROM trades WHERE id = ?').bind(id).run();
      return result.meta.changes > 0;
    },

    async getSession(id) {
      await ensureReady();
      const row = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
      return row ? rowToSession(row) : null;
    },

    async saveSession(session) {
      await ensureReady();
      await db
        .prepare(
          `INSERT INTO sessions (id, created_at, last_active, metadata, messages) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET last_active = excluded.last_active,
             metadata = excluded.metadata, messages = excluded.messages`
        )
        .bind(
          session.id,
          session.createdAt,
          session.lastActive,
          JSON.stringify(session.metadata || {}),
          JSON.stringify(session.messages || [])
        )
        .run();
      return session;
    },

    async listSessions() {
      await ensureReady();
      const { results } = await db.prepare('SELECT * FROM sessions ORDER BY last_active DESC LIMIT 200').all();
      return results.map(rowToSession);
    }
  };
}
