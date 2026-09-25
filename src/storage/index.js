import { generateSampleTrades } from '../../public/engine/index.js';
import { createD1Store } from './d1Store.js';
import { createMemoryStore } from './memoryStore.js';

// One store per D1 binding per isolate, so schema setup runs only once.
const d1Stores = new WeakMap();
let memoryStore = null;

export function getStore(env = {}) {
  const db = env.DB;
  if (db && typeof db.prepare === 'function') {
    let store = d1Stores.get(db);
    if (!store) {
      store = createD1Store(db, generateSampleTrades());
      d1Stores.set(db, store);
    }
    return store;
  }

  // No database (e.g. Vercel, plain Node): non-persistent memory store. The
  // dashboard detects `storage: "memory"` and keeps trades in the browser.
  if (!memoryStore) memoryStore = createMemoryStore(generateSampleTrades());
  return memoryStore;
}
