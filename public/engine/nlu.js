// NLU engine: a small machine-learning intent classifier that runs anywhere
// with no API key. Features are word unigrams plus character trigrams (so
// typos like "perfomance" or "risck" still match), weighted by TF-IDF; a
// nearest-centroid model is "trained" once from the labelled examples below.

const TRAINING = {
  greeting: [
    'hi', 'hello', 'hey coach', 'good morning', 'good evening', 'salam', 'assalamu alaikum', 'yo whats up', 'hey there', 'hola'
  ],
  help: [
    'what can you do', 'help', 'how does this work', 'what questions can i ask', 'who are you', 'what are your features',
    'how do i use this', 'what is alpha engine', 'which ai engine are you', 'are you chatgpt'
  ],
  performance: [
    'how am i doing', 'analyze my performance', 'summary of my trading', 'give me a report', 'overall stats', 'review my trades',
    'performance review', 'how is my trading going', 'analyze my recent trades', 'show my statistics', 'am i profitable',
    'my results', 'dashboard summary', 'analyze my recent trade performance'
  ],
  risk: [
    'how is my risk', 'am i risking too much', 'risk management', 'what is my drawdown', 'stop loss discipline', 'my risk score',
    'is my risk too high', 'suggest risk management improvements', 'how do i protect my account', 'do i respect my stops',
    'how much can i lose', 'account safety'
  ],
  sizing: [
    'how much should i risk per trade', 'position size', 'kelly criterion', 'optimal bet size', 'lot size',
    'how big should my trades be', 'how many contracts', 'what size should i trade', 'risk per trade percent'
  ],
  improve: [
    'how to improve my win rate', 'tips to increase my win rate', 'why do i lose so much', 'improve my results',
    'how can i be more profitable', 'how to become a better trader', 'give me tips to increase my win rate', 'win rate tips',
    'what should i change', 'how do i make more money'
  ],
  psychology: [
    'what biases do you see', 'am i emotional', 'revenge trading', 'trading psychology', 'do i have fomo', 'loss aversion',
    'what trading patterns do you see in my history', 'what are my mistakes', 'bad habits', 'am i overconfident', 'am i on tilt',
    'emotional control', 'behavioral analysis', 'identify patterns'
  ],
  forecast: [
    'what will happen in the next 50 trades', 'monte carlo simulation', 'future projection', 'risk of ruin', 'probability of profit',
    'simulate my strategy', 'forecast my equity', 'chance to blow my account', 'what if i keep trading like this',
    'predict my future results', 'expected return next month'
  ],
  symbol: [
    'how do i trade btc', 'which symbol is best', 'which asset makes me money', 'worst market for me', 'performance on eth',
    'should i stop trading sol', 'which pair is most profitable', 'gold performance', 'best instrument', 'bitcoin results'
  ],
  timing: [
    'best time to trade', 'which session is best', 'best day of the week', 'when do i lose money', 'time of day analysis',
    'london session', 'new york session', 'asian session results', 'what hours should i trade', 'worst trading day'
  ],
  extremes: [
    'best trade', 'worst trade', 'biggest loss', 'biggest win', 'largest losing trade', 'my top trades', 'most profitable trade'
  ],
  plan: [
    'give me a plan', 'action plan', 'what should i do next', 'improvement plan for next week', 'rules to follow',
    'build me a trading plan', 'checklist', 'what should i focus on', 'daily routine', 'next steps'
  ],
  explain: [
    'what is sharpe ratio', 'explain profit factor', 'what does expectancy mean', 'what is sqn', 'define drawdown',
    'what is an r multiple', 'explain kelly', 'what is sortino', 'meaning of payoff ratio', 'what is alpha score', 'explain trader dna'
  ]
};

const SYMBOL_ALIASES = {
  btc: 'BTC', bitcoin: 'BTC', xbt: 'BTC', eth: 'ETH', ethereum: 'ETH', ether: 'ETH', sol: 'SOL', solana: 'SOL',
  gold: 'XAU', xau: 'XAU', silver: 'XAG', eur: 'EUR', euro: 'EUR', nasdaq: 'NAS', spx: 'SPX'
};

const METRICS = {
  sharpe: 'sharpe', sortino: 'sortino', 'profit factor': 'profitFactor', expectancy: 'expectancy', sqn: 'sqn',
  drawdown: 'drawdown', 'r multiple': 'rMultiple', 'r-multiple': 'rMultiple', kelly: 'kelly', 'payoff': 'payoff',
  'win rate': 'winRate', 'alpha score': 'alphaScore', 'trader dna': 'dna', 'risk of ruin': 'riskOfRuin', 'monte carlo': 'monteCarlo'
};

const SESSION_WORDS = { asian: 'Asian', asia: 'Asian', tokyo: 'Asian', london: 'European', european: 'European', europe: 'European', 'new york': 'US', ny: 'US', us: 'US', american: 'US' };

const STOP_WORDS = new Set(['the', 'a', 'an', 'my', 'me', 'i', 'is', 'are', 'to', 'of', 'in', 'on', 'for', 'do', 'does', 'it', 'and', 'you', 'your', 'this', 'that', 'please', 'can', 'could', 'would']);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function features(text) {
  const feats = new Map();
  const add = (f, w) => feats.set(f, (feats.get(f) || 0) + w);
  for (const word of tokenize(text)) {
    if (STOP_WORDS.has(word)) continue;
    add(`w:${word}`, 1);
    const padded = `#${word}#`;
    for (let i = 0; i + 3 <= padded.length; i++) add(`c:${padded.slice(i, i + 3)}`, 0.35);
  }
  return feats;
}

function train() {
  const docs = [];
  for (const [intent, examples] of Object.entries(TRAINING)) {
    for (const example of examples) docs.push({ intent, feats: features(example) });
  }
  const df = new Map();
  for (const { feats } of docs) for (const f of feats.keys()) df.set(f, (df.get(f) || 0) + 1);
  const idf = new Map([...df].map(([f, count]) => [f, Math.log((docs.length + 1) / (count + 1)) + 1]));

  const vectorize = (feats) => {
    const vec = new Map();
    let norm = 0;
    for (const [f, tf] of feats) {
      const w = tf * (idf.get(f) || 0);
      if (w) {
        vec.set(f, w);
        norm += w * w;
      }
    }
    norm = Math.sqrt(norm) || 1;
    for (const [f, w] of vec) vec.set(f, w / norm);
    return vec;
  };

  const centroids = new Map();
  for (const { intent, feats } of docs) {
    const vec = vectorize(feats);
    const c = centroids.get(intent) || new Map();
    for (const [f, w] of vec) c.set(f, (c.get(f) || 0) + w);
    centroids.set(intent, c);
  }
  for (const c of centroids.values()) {
    const norm = Math.sqrt([...c.values()].reduce((s, w) => s + w * w, 0)) || 1;
    for (const [f, w] of c) c.set(f, w / norm);
  }
  return { vectorize, centroids };
}

let model = null;
const getModel = () => (model ||= train());

function extractEntities(text, knownSymbols = []) {
  const lower = ` ${String(text).toLowerCase()} `;
  const tokens = tokenize(text);
  const symbols = new Set();
  for (const token of tokens) {
    const alias = SYMBOL_ALIASES[token] || token.toUpperCase();
    for (const s of knownSymbols) {
      if (s === token.toUpperCase() || (alias.length >= 3 && s.startsWith(alias))) symbols.add(s);
    }
  }
  const metric = Object.keys(METRICS)
    .sort((a, b) => b.length - a.length)
    .find((m) => lower.includes(` ${m}`) || lower.includes(`${m} `));
  const session = Object.keys(SESSION_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(lower));
  const horizonMatch = lower.match(/next\s+(\d{1,4})\s*(trades?)?/);
  return {
    symbols: [...symbols],
    metric: metric ? METRICS[metric] : null,
    session: session ? SESSION_WORDS[session] : null,
    horizon: horizonMatch ? Math.min(500, Math.max(5, Number(horizonMatch[1]))) : null
  };
}

/**
 * Classify a message. Returns the best intent, a 0-1 confidence, the runner-up
 * and extracted entities (symbols, metric, session, forecast horizon).
 */
export function understand(text, { knownSymbols = [] } = {}) {
  const { vectorize, centroids } = getModel();
  const vec = vectorize(features(text));
  const scores = [...centroids].map(([intent, c]) => {
    let dot = 0;
    for (const [f, w] of vec) dot += w * (c.get(f) || 0);
    return { intent, score: dot };
  });
  scores.sort((a, b) => b.score - a.score);

  const entities = extractEntities(text, knownSymbols);
  let { intent, score } = scores[0];
  const lower = String(text).toLowerCase();

  // Entities sharpen ambiguous predictions.
  if (entities.metric && /\b(what|explain|define|mean|meaning|how is .* calculated)\b/.test(lower) && intent !== 'forecast') intent = 'explain';
  else if (entities.symbols.length && !['explain', 'forecast'].includes(intent) && score < 0.45) intent = 'symbol';
  else if (entities.session && score < 0.45) intent = 'timing';
  if (entities.horizon && score < 0.5) intent = 'forecast';

  const confidence = Math.max(0, Math.min(1, score));
  return {
    intent: confidence < 0.12 && !entities.symbols.length && !entities.metric ? 'unknown' : intent,
    confidence: Math.round(confidence * 100) / 100,
    alternatives: scores.slice(1, 3).map((s) => ({ intent: s.intent, confidence: Math.round(s.score * 100) / 100 })),
    entities
  };
}

export const INTENTS = Object.keys(TRAINING);
