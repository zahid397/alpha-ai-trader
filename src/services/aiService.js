import { getConfig, hasWorkersAi } from '../config.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 20_000;

async function callGroq(config, messages, { temperature, maxTokens, json }) {
  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.groqApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.groqModel,
      messages,
      temperature,
      max_tokens: maxTokens,
      ...(json && { response_format: { type: 'json_object' } })
    }),
    signal: AbortSignal.timeout(GROQ_TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callWorkersAi(ai, model, messages, { temperature, maxTokens }) {
  const result = await ai.run(model, { messages, temperature, max_tokens: maxTokens });
  const output = result?.response ?? result?.choices?.[0]?.message?.content ?? '';
  return typeof output === 'string' ? output : JSON.stringify(output);
}

/**
 * Generate a completion with a provider fallback chain:
 *   Groq (if GROQ_API_KEY is set) -> Cloudflare Workers AI (if the AI binding
 *   exists) -> null, in which case callers use the Alpha Engine answer.
 * `system` always becomes the single system-role message.
 */
export async function generateText(env, { system, messages = [], temperature = 0.4, maxTokens = 400, json = false }) {
  const config = getConfig(env);
  if (config.engineOnly) return null;

  const chat = [{ role: 'system', content: system }, ...messages];

  if (config.groqApiKey) {
    try {
      const text = (await callGroq(config, chat, { temperature, maxTokens, json })).trim();
      if (text) return { text, source: 'groq', model: config.groqModel };
    } catch (error) {
      console.warn(`Groq request failed, trying next provider: ${error.message}`);
    }
  }

  if (hasWorkersAi(env)) {
    try {
      const text = (await callWorkersAi(env.AI, config.workersAiModel, chat, { temperature, maxTokens })).trim();
      if (text) return { text, source: 'workers-ai', model: config.workersAiModel };
    } catch (error) {
      console.warn(`Workers AI request failed, using the Alpha Engine answer: ${error.message}`);
    }
  }

  return null;
}

// Pull the first JSON object out of a model reply (handles ```json fences
// and leading/trailing prose). Returns null when nothing parses.
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
