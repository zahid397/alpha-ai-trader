// Data layer. Two interchangeable sources:
//   cloud - the Worker/Vercel API with persistent D1 storage
//   local - the Alpha Engine running in this browser, trades in localStorage
// The app picks cloud only when the API is reachable AND persistent; anything
// else (static hosting, Vercel without a database, offline) runs locally, so
// the dashboard always works.

import { analyzeTrade, ask, buildTrade, generateSampleTrades, generateTrades, newTradeId } from '../engine/index.js';

const API_BASE = (window.API_BASE_URL || document.querySelector('meta[name="api-base"]')?.content || '').replace(/\/+$/, '');
const KEYS = {
  trades: 'alpha-ai-trader:trades:v3',
  chat: 'alpha-ai-trader:chat:v3',
  session: 'alpha-ai-trader:session-id'
};
const MAX_CHAT = 60;
const IMPORT_CHUNK = 1000;

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
};

async function request(path, { method = 'GET', body, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json().catch(() => null) : null;
    if (!res.ok || !data) {
      const error = new Error(data?.error || `Request failed (${res.status})`);
      error.status = res.status;
      error.details = data?.details;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const byNewest = (a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : a.id < b.id ? 1 : -1);

function newSessionId() {
  const random = crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `session_${random}`;
}

// ---------------------------------------------------------------------------
// Cloud source
// ---------------------------------------------------------------------------
function cloudSource(health) {
  let sessionId = storage.get(KEYS.session, null);
  const validSession = typeof sessionId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(sessionId);
  if (!validSession) sessionId = null;

  return {
    mode: 'cloud',
    health,
    persistent: true,

    async listTrades() {
      const data = await request('/api/trades');
      if (!Array.isArray(data.trades)) throw new Error('Unexpected trades response');
      return data.trades;
    },

    async addTrade(input) {
      const data = await request('/api/trades', { method: 'POST', body: input });
      return data.trade;
    },

    async deleteTrade(id) {
      await request(`/api/trades/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async importTrades(inputs) {
      let imported = 0;
      let rejected = 0;
      for (let i = 0; i < inputs.length; i += IMPORT_CHUNK) {
        try {
          const data = await request('/api/trades/import', { method: 'POST', body: { trades: inputs.slice(i, i + IMPORT_CHUNK) }, timeout: 60000 });
          imported += data.imported;
          rejected += data.rejected;
        } catch (error) {
          if (error.status !== 400) throw error;
          rejected += Math.min(IMPORT_CHUNK, inputs.length - i);
        }
      }
      return { imported, rejected };
    },

    async chat(message) {
      if (!sessionId) sessionId = newSessionId();
      const data = await request('/api/coach/chat', { method: 'POST', body: { message, sessionId } });
      storage.set(KEYS.session, sessionId);
      return data;
    },

    async chatHistory() {
      if (!sessionId) return [];
      try {
        const data = await request(`/api/session/${sessionId}/history?type=chat&limit=30`);
        return data.messages.map((m) => ({ role: m.role, text: m.content, source: m.source, highlights: m.highlights }));
      } catch (error) {
        if (error.status === 404) return [];
        throw error;
      }
    },

    async clearChat() {
      if (!sessionId) return;
      await request(`/api/session/${sessionId}/messages`, { method: 'DELETE' }).catch(() => {});
    },

    async analyzeTrade(trade) {
      const data = await request(`/api/coach/analyze/${encodeURIComponent(trade.id)}`, { method: 'POST', body: {} });
      return { analysis: data.analysis, source: data.source };
    }
  };
}

// ---------------------------------------------------------------------------
// Local source (browser-only, same engine)
// ---------------------------------------------------------------------------
function localSource(health, reason) {
  let trades = storage.get(KEYS.trades, null);
  if (!Array.isArray(trades) || !trades.every((t) => t && typeof t.id === 'string')) {
    trades = generateSampleTrades();
    storage.set(KEYS.trades, trades);
  }
  const save = () => {
    if (!storage.set(KEYS.trades, trades)) console.warn('Could not save trades to localStorage (quota or private mode).');
  };
  // An LLM on the server (Groq/Workers AI) can still polish answers for a
  // browser-local journal: the trades are sent along with the question.
  const serverLlm = health && health.aiMode && health.aiMode !== 'alpha';

  return {
    mode: 'local',
    health,
    reason,
    persistent: false,

    async listTrades() {
      return [...trades].sort(byNewest);
    },

    async addTrade(input) {
      const { trade, errors } = buildTrade(input, { id: newTradeId() });
      if (errors) {
        const error = new Error('Invalid trade');
        error.details = errors;
        throw error;
      }
      trades.push(trade);
      save();
      return trade;
    },

    async deleteTrade(id) {
      trades = trades.filter((t) => t.id !== id);
      save();
    },

    async importTrades(inputs) {
      let rejected = 0;
      for (const input of inputs) {
        const { trade } = buildTrade(input, { id: newTradeId() });
        if (trade) trades.push(trade);
        else rejected++;
      }
      save();
      return { imported: inputs.length - rejected, rejected };
    },

    async loadDataset(kind) {
      trades = kind === 'big' ? generateTrades({ count: 2000, seed: 42 }) : generateSampleTrades();
      save();
    },

    async chat(message) {
      if (serverLlm) {
        try {
          return await request('/api/coach/chat', { method: 'POST', body: { message, trades } });
        } catch (error) {
          console.warn('Server LLM unavailable, answering locally:', error);
        }
      }
      return { ...ask(message, trades), source: 'alpha-engine' };
    },

    async chatHistory() {
      return storage.get(KEYS.chat, []);
    },

    saveChat(messages) {
      storage.set(KEYS.chat, messages.slice(-MAX_CHAT));
    },

    async clearChat() {
      storage.remove(KEYS.chat);
    },

    async analyzeTrade(trade) {
      return { analysis: analyzeTrade(trade, trades), source: 'alpha-engine' };
    }
  };
}

/**
 * Probe the API and choose a source. Never throws: every failure path ends
 * in local mode.
 */
export async function connect() {
  let health = null;
  try {
    health = await request('/api/health', { timeout: 5000 });
  } catch {
    return localSource(null, 'offline');
  }
  if (health?.status !== 'healthy') return localSource(null, 'offline');
  if (health.storage !== 'd1') return localSource(health, 'no-database');

  const cloud = cloudSource(health);
  try {
    // Validate the API end to end before trusting it (and keep the result).
    cloud.initialTrades = await cloud.listTrades();
    return cloud;
  } catch {
    return localSource(health, 'api-error');
  }
}
