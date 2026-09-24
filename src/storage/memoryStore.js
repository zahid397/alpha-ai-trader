import { normalizeSeedTrade } from '../services/tradeModel.js';
import { byNewest, matchesFilters } from './filters.js';

// Non-persistent store: used when no D1 binding is configured and in tests.
// On Workers this lives per isolate, so data can reset at any time.
export function createMemoryStore(seedTrades = []) {
  let trades = seedTrades.map(normalizeSeedTrade);
  const sessions = new Map();
  const clone = (value) => (value == null ? value : structuredClone(value));

  return {
    kind: 'memory',

    async listTrades(filters = {}) {
      return trades.filter((t) => matchesFilters(t, filters)).sort(byNewest).map(clone);
    },

    async getTrade(id) {
      return clone(trades.find((t) => t.id === id) || null);
    },

    async insertTrade(trade) {
      trades.push(clone(trade));
      return clone(trade);
    },

    async updateTrade(trade) {
      const index = trades.findIndex((t) => t.id === trade.id);
      if (index === -1) return false;
      trades[index] = clone(trade);
      return true;
    },

    async deleteTrade(id) {
      const before = trades.length;
      trades = trades.filter((t) => t.id !== id);
      return trades.length !== before;
    },

    async getSession(id) {
      return clone(sessions.get(id) || null);
    },

    async saveSession(session) {
      sessions.set(session.id, clone(session));
      return clone(session);
    },

    async listSessions() {
      return [...sessions.values()].map(clone);
    }
  };
}
