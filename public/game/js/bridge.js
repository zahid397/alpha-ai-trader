// Bridge to the native host when the game runs inside the Crimson Arena
// mobile app (mobile/, Flutter + webview_flutter).
//
//   game -> app : window.CrimsonBridge.postMessage(JSON)   (a JavaScriptChannel)
//   app  -> game: window.CrimsonNative.receive({ type, ... })  (runJavaScript)
//
// Messages the game sends:
//   ready             {protocol}       game booted; the app answers with `entitlement`
//   unlockBoss        {}               player tapped "Unlock Main Boss"
//   restorePurchases  {}
//   haptic            {style}          light | medium | heavy
//   gameOver          {score, wave, kills}
//
// Messages the app sends:
//   entitlement       {unlocked, price?, demo?}
//   bossUnlocked      {}               purchase (or restore) succeeded: spawn the boss
//   purchaseCancelled {}
//   purchaseFailed    {message}
//   pause             {}               app went to the background
//
// In a normal browser there is no host, `bridge.native` is false and the
// Main Boss can be summoned for free (web demo).

export const PROTOCOL = 1;

const listeners = new Map();

export const bridge = {
  get native() {
    return typeof globalThis.CrimsonBridge?.postMessage === 'function';
  },

  send(type, data = {}) {
    if (!this.native) return false;
    try {
      globalThis.CrimsonBridge.postMessage(JSON.stringify({ ...data, type }));
      return true;
    } catch {
      return false;
    }
  },

  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  }
};

/** Entry point the app calls. Accepts an object or a JSON string. */
function receive(message) {
  let msg = message;
  if (typeof msg === 'string') {
    try {
      msg = JSON.parse(msg);
    } catch {
      return false;
    }
  }
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  const handlers = listeners.get(msg.type);
  if (!handlers) return false;
  for (const fn of handlers) {
    try {
      fn(msg);
    } catch (err) {
      console.error(`bridge handler for ${msg.type} failed`, err);
    }
  }
  return true;
}

Object.defineProperty(globalThis, 'CrimsonNative', {
  value: Object.freeze({ receive, protocol: PROTOCOL }),
  configurable: false,
  writable: false
});
