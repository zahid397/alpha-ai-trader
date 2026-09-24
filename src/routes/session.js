import { Hono } from 'hono';
import { httpError, readJson } from '../lib/http.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import {
  MAX_MESSAGE_LENGTH,
  appendMessages,
  isChatRole,
  isValidSessionId,
  makeMessage,
  newSession
} from '../services/sessionService.js';

const session = new Hono();
const MAX_METADATA_BYTES = 4096;

async function loadSession(c) {
  const id = c.req.param('sessionId');
  if (!isValidSessionId(id)) throw httpError(400, 'Invalid session id');
  return c.get('store').getSession(id);
}

const notFound = (c) => c.json({ success: false, error: 'Session not found' }, 404);

// List all sessions (admin only).
session.get('/admin/sessions', requireAdmin(), async (c) => {
  const sessions = await c.get('store').listSessions();
  return c.json({
    success: true,
    sessions: sessions.map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      messageCount: s.messages.length,
      metadata: s.metadata
    })),
    total: sessions.length
  });
});

// Get or create a session. Without an id a new random one is issued.
session.get('/:sessionId?', async (c) => {
  const store = c.get('store');
  const requested = c.req.param('sessionId');
  if (requested !== undefined && !isValidSessionId(requested)) throw httpError(400, 'Invalid session id');

  const existing = requested ? await store.getSession(requested) : null;
  const current = existing || newSession(requested);
  current.lastActive = new Date().toISOString();
  await store.saveSession(current);
  return c.json({ success: true, session: current });
});

session.post('/:sessionId/message', async (c) => {
  const current = await loadSession(c);
  if (!current) return notFound(c);

  const { role, content, type = 'coaching' } = await readJson(c);
  if (!isChatRole(role)) throw httpError(400, 'role must be "user" or "assistant"');
  if (typeof content !== 'string' || !content.trim()) throw httpError(400, 'content is required');
  if (content.length > MAX_MESSAGE_LENGTH) throw httpError(400, `content must be at most ${MAX_MESSAGE_LENGTH} characters`);

  const message = makeMessage(role, content.trim(), String(type).slice(0, 32));
  appendMessages(current, message);
  await c.get('store').saveSession(current);
  return c.json({ success: true, message, sessionId: current.id });
});

session.put('/:sessionId/metadata', async (c) => {
  const current = await loadSession(c);
  if (!current) return notFound(c);

  const updates = await readJson(c);
  const metadata = { ...current.metadata, ...updates };
  if (JSON.stringify(metadata).length > MAX_METADATA_BYTES) {
    throw httpError(400, `metadata must be at most ${MAX_METADATA_BYTES} bytes`);
  }

  current.metadata = metadata;
  current.lastActive = new Date().toISOString();
  await c.get('store').saveSession(current);
  return c.json({ success: true, metadata });
});

// Conversation history, optionally filtered by message type.
session.get('/:sessionId/history', async (c) => {
  const current = await loadSession(c);
  if (!current) return notFound(c);

  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit'), 10) || 20, 1), 50);
  const type = c.req.query('type');
  const messages = (type && type !== 'all' ? current.messages.filter((m) => m.type === type) : current.messages).slice(-limit);

  return c.json({ success: true, messages, total: current.messages.length, sessionId: current.id });
});

session.delete('/:sessionId/messages', async (c) => {
  const current = await loadSession(c);
  if (!current) return notFound(c);

  current.messages = [];
  current.lastActive = new Date().toISOString();
  await c.get('store').saveSession(current);
  return c.json({ success: true, message: 'Session messages cleared' });
});

export default session;
