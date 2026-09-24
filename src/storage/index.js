import sampleTrades from '../../data/sampleTrades.json' with { type: 'json' };
import { createD1Store } from './d1Store.js';
import { createMemoryStore } from './memoryStore.js';

// One store per D1 binding per isolate, so schema setup runs only once.
const d1Stores = new WeakMap();
let memoryStore = null;

export function getStore(env = {}) {
  if (env.DB && typeof env.DB.prepare === 'function') {
    let store = d1Stores.get(env.DB);
    if (!store) {
      store = createD1Store(env.DB, sampleTrades);
      d1Stores.set(env.DB, store);
    }
    return store;
  }

  if (!memoryStore) memoryStore = createMemoryStore(sampleTrades);
  return memoryStore;
}

export { sampleTrades };
