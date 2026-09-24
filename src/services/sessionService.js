const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const CHAT_ROLES = new Set(['user', 'assistant']);

export const MAX_SESSION_MESSAGES = 50;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_CHAT_INPUT_LENGTH = 2000;
export const CHAT_HISTORY_TURNS = 10;

export function isValidSessionId(id) {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
}

export function newSession(id = `session_${crypto.randomUUID()}`, now = new Date()) {
  const timestamp = now.toISOString();
  return {
    id,
    createdAt: timestamp,
    lastActive: timestamp,
    messages: [],
    metadata: { tradeCount: 0, totalProfit: 0, winRate: 0, biasesDetected: [] }
  };
}

export function makeMessage(role, content, type = 'coaching', extra = {}) {
  return {
    id: `msg_${crypto.randomUUID()}`,
    role,
    content,
    type,
    timestamp: new Date().toISOString(),
    ...extra
  };
}

export function appendMessages(session, ...messages) {
  session.messages = [...session.messages, ...messages].slice(-MAX_SESSION_MESSAGES);
  session.lastActive = new Date().toISOString();
  return session;
}

export function isChatRole(role) {
  return CHAT_ROLES.has(role);
}

// Conversation context for the model. Only user/assistant turns are kept, so
// neither stored data nor client input can smuggle in a system prompt.
export function toChatHistory(messages = [], limit = CHAT_HISTORY_TURNS) {
  return messages
    .filter((m) => m && isChatRole(m.role) && typeof m.content === 'string' && m.content.trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHAT_INPUT_LENGTH) }));
}
