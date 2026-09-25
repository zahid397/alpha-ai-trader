import {
  ENGINE_NAME,
  analyze,
  analyzeTrade as engineAnalyzeTrade,
  ask,
  biasSummary,
  coachingAdvice as engineAdvice
} from '../../public/engine/index.js';
import { getAiMode } from '../config.js';
import { extractJson, generateText } from './aiService.js';
import { buildBiasSummaryPrompt, buildChatSystemPrompt, buildCoachingPrompt, buildTradeAnalysisPrompt } from './promptBuilder.js';

// The Alpha Engine answers every request on its own (no API key needed).
// When an optional LLM is configured it only rephrases or extends the
// engine's grounded draft; if the LLM fails, the engine answer is returned.

const RECENT_FOR_PROMPT = 8;
// Server-side simulations use 500 runs to stay well inside Worker CPU limits.
const SERVER_ANALYSIS = { runs: 500 };
export const ENGINE_SOURCE = 'alpha-engine';

export async function coachChat(env, trades, { message, history = [] }) {
  const engine = ask(message, trades, SERVER_ANALYSIS);
  const base = { reply: engine.reply, intent: engine.intent, confidence: engine.confidence, highlights: engine.highlights };
  if (getAiMode(env) === 'alpha') return { ...base, source: ENGINE_SOURCE, engine: ENGINE_NAME };

  const report = analyze(trades, { ...SERVER_ANALYSIS, simulate: false });
  const llm = await generateText(env, {
    system: buildChatSystemPrompt(report, trades.slice(0, RECENT_FOR_PROMPT), engine.reply),
    messages: [...history, { role: 'user', content: message }],
    temperature: 0.4,
    maxTokens: 500
  });

  if (llm) return { ...base, reply: llm.text, source: llm.source, engine: ENGINE_NAME };
  return { ...base, source: ENGINE_SOURCE, engine: ENGINE_NAME };
}

const stringList = (value) =>
  Array.isArray(value) && value.length && value.every((v) => typeof v === 'string') ? value : null;
const nonEmptyString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

// Trust the LLM only for fields it returned in the expected shape.
function mergeAnalysis(base, ai) {
  const score = Number(ai.confidenceScore);
  const risk = typeof ai.riskAssessment === 'string' ? ai.riskAssessment.toLowerCase() : '';
  return {
    successFactors: stringList(ai.successFactors) || base.successFactors,
    mistakes: stringList(ai.mistakes) || base.mistakes,
    confidenceScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : base.confidenceScore,
    behavioralInsights: nonEmptyString(ai.behavioralInsights) || base.behavioralInsights,
    improvementSuggestions: stringList(ai.improvementSuggestions) || base.improvementSuggestions,
    riskAssessment: ['low', 'medium', 'high'].includes(risk) ? risk : base.riskAssessment,
    technicalAnalysis: nonEmptyString(ai.technicalAnalysis) || base.technicalAnalysis,
    metrics: base.metrics
  };
}

export async function analyzeTrade(env, trade, trades, marketCondition) {
  const base = engineAnalyzeTrade(trade, trades);
  if (getAiMode(env) === 'alpha') return { analysis: base, source: ENGINE_SOURCE };

  const prompt = buildTradeAnalysisPrompt(trade, analyze(trades, { ...SERVER_ANALYSIS, simulate: false }), marketCondition);
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.3,
    maxTokens: 700,
    json: true
  });

  const parsed = result && extractJson(result.text);
  if (parsed) return { analysis: mergeAnalysis(base, parsed), source: result.source };
  return { analysis: base, source: ENGINE_SOURCE };
}

export async function coachingAdvice(env, trades, marketContext, traderProfile) {
  const report = analyze(trades, { ...SERVER_ANALYSIS, simulate: false });
  if (getAiMode(env) === 'alpha') return { advice: engineAdvice(report, marketContext), source: ENGINE_SOURCE };

  const prompt = buildCoachingPrompt(marketContext, traderProfile, report, trades.slice(0, RECENT_FOR_PROMPT));
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.4,
    maxTokens: 300
  });
  if (result) return { advice: result.text, source: result.source };
  return { advice: engineAdvice(report, marketContext), source: ENGINE_SOURCE };
}

export async function biasReport(env, trades) {
  const report = analyze(trades, SERVER_ANALYSIS);
  const findings = {
    detectedBiases: report.biases,
    overallRiskScore: report.riskScore,
    riskLevel: report.riskLevel,
    behavioralPattern: report.behavioralPattern,
    patterns: report.patterns,
    dna: report.dna
  };
  if (!report.biases.length || getAiMode(env) === 'alpha') return { ...findings, summary: biasSummary(report), source: ENGINE_SOURCE };

  const prompt = buildBiasSummaryPrompt(report);
  const result = await generateText(env, {
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    temperature: 0.4,
    maxTokens: 250
  });
  return { ...findings, summary: result ? result.text : biasSummary(report), source: result ? result.source : ENGINE_SOURCE };
}

export { SERVER_ANALYSIS };
