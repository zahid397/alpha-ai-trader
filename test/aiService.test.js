import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { extractJson, generateText } from '../src/services/aiService.js';

const fakeAi = (reply) => ({
  calls: [],
  async run(model, input) {
    this.calls.push({ model, input });
    if (reply instanceof Error) throw reply;
    return { response: reply };
  }
});

describe('generateText', () => {
  afterEach(() => mock.restoreAll());

  it('returns null when no provider is configured', async () => {
    assert.equal(await generateText({}, { system: 's' }), null);
  });

  it('uses Workers AI with the system prompt as the only system message', async () => {
    const AI = fakeAi('hello');
    const result = await generateText(
      { AI },
      { system: 'server prompt', messages: [{ role: 'user', content: 'hi' }] }
    );
    assert.deepEqual(result, { text: 'hello', source: 'workers-ai', model: '@cf/meta/llama-3.1-8b-instruct' });
    const { messages } = AI.calls[0].input;
    assert.deepEqual(messages[0], { role: 'system', content: 'server prompt' });
    assert.equal(messages.filter((m) => m.role === 'system').length, 1);
  });

  it('prefers Groq when a key is set', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: 'from groq' } }] }), { status: 200 })
    );
    const AI = fakeAi('from workers ai');
    const result = await generateText({ GROQ_API_KEY: 'k', AI }, { system: 's' });
    assert.equal(result.source, 'groq');
    assert.equal(AI.calls.length, 0);

    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer k');
    assert.equal(JSON.parse(init.body).model, 'llama-3.3-70b-versatile');
  });

  it('falls back from Groq to Workers AI, then to null', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('rate limited', { status: 429 }));
    mock.method(console, 'warn', () => {});

    const ok = await generateText({ GROQ_API_KEY: 'k', AI: fakeAi('backup') }, { system: 's' });
    assert.equal(ok.source, 'workers-ai');

    const none = await generateText({ GROQ_API_KEY: 'k', AI: fakeAi(new Error('down')) }, { system: 's' });
    assert.equal(none, null);
  });

  it('WORKERS_AI_ENABLED=false skips the AI binding', async () => {
    const AI = fakeAi('x');
    assert.equal(await generateText({ AI, WORKERS_AI_ENABLED: 'false' }, { system: 's' }), null);
    assert.equal(AI.calls.length, 0);
  });

  it('USE_MOCK_AI=true forces the rule-based coach', async () => {
    const AI = fakeAi('x');
    assert.equal(await generateText({ AI, USE_MOCK_AI: 'true' }, { system: 's' }), null);
    assert.equal(AI.calls.length, 0);
  });
});

describe('extractJson', () => {
  it('parses fenced or wrapped JSON and rejects garbage', () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Sure! {"a": {"b": 2}} Hope this helps'), { a: { b: 2 } });
    assert.equal(extractJson('no json here'), null);
    assert.equal(extractJson('{broken'), null);
  });
});
