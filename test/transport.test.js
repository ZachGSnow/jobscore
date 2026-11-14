// callLLM against a fake GM_xmlhttpRequest. Request shapes follow each provider's
// current API (checked 2026-10-15); a model that rejects a parameter costs a
// silent retry, and a reply that did not finish says why.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';

const sent = [];
let responder = () => ({ status: 500, text: '' });
let keys = { 'apikey.anthropic': 'test-key', 'apikey.openai': 'k' };
globalThis.GM_getValue = (k, d) => (k in keys ? keys[k] : d);
globalThis.GM_setValue = () => {};
globalThis.GM_xmlhttpRequest = (o) => {
  const body = JSON.parse(o.data);
  sent.push(body);
  const r = responder(body, sent.length);
  setTimeout(() => o.onload({ status: r.status, responseText: r.text, responseHeaders: r.headers || '' }), 0);
};
const J = await import('../src/all.js');

const useProvider = (p) => J.setCurrentSettings(J.setPath(J.DEFAULT_SETTINGS, 'model.provider', p));
beforeEach(() => { sent.length = 0; useProvider('anthropic'); });

const claude = (text, extra) => ({ status: 200, text: JSON.stringify(Object.assign({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }, extra || {})) });
const openai = (content, finish) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content }, finish_reason: finish || 'stop' }] }) });
const bad = (msg) => ({ status: 400, text: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: msg } }) });

test('Anthropic: one request, no temperature, no prefilled assistant turn, the JSON read as sent', async () => {
  responder = () => claude('{"ok":true}');
  const out = await J.callLLM('sys', 'user');
  assert.equal(sent.length, 1, 'no rejected prefill attempt before the real one');
  assert.equal(sent[0].temperature, undefined);
  assert.equal(sent[0].messages.length, 1);
  assert.equal(sent[0].messages[0].role, 'user');
  assert.equal(sent[0].max_tokens, 16000);
  assert.equal(out.text, '{"ok":true}');
});

test('Anthropic: thinking blocks before the text are ignored', async () => {
  responder = () => ({ status: 200, text: JSON.stringify({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn' }) });
  assert.equal((await J.callLLM('sys', 'user')).text, '{"ok":true}');
});

test('OpenAI: max_completion_tokens and no temperature, in one request', async () => {
  useProvider('openai');
  responder = () => openai('{"ok":true}');
  const out = await J.callLLM('sys', 'user');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'gpt-6-luna');
  assert.equal(sent[0].temperature, undefined);
  assert.equal(sent[0].max_tokens, undefined);
  assert.equal(sent[0].max_completion_tokens, 16000);
  assert.equal(out.text, '{"ok":true}');
});

test('Ollama: temperature 0 is sent, and a model that rejects it costs one silent retry', async () => {
  useProvider('ollama');
  responder = (body) => (body.options && 'temperature' in body.options
    ? bad('temperature is not supported by this model')
    : { status: 200, text: JSON.stringify({ message: { content: '{"ok":true}' } }) });
  const out = await J.callLLM('sys', 'user');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].options.temperature, 0);
  assert.ok(!('temperature' in sent[1].options));
  assert.equal(out.text, '{"ok":true}');
});

test('a safety refusal or a reply cut off at the token cap is said plainly', async () => {
  responder = () => claude('', { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } });
  await assert.rejects(() => J.callLLM('sys', 'user'), /declined to process this posting \(safety refusal: cyber\)/);
  responder = () => claude('{"title": "Solutions Eng', { stop_reason: 'max_tokens' });
  await assert.rejects(() => J.callLLM('sys', 'user'), /cut off at the token limit/);
  useProvider('openai');
  responder = () => openai('{"title": "Sol', 'length');
  await assert.rejects(() => J.callLLM('sys', 'user'), /cut off at the token limit/);
  responder = () => openai('', 'content_filter');
  await assert.rejects(() => J.callLLM('sys', 'user'), /declined to process this posting \(content filter\)/);
});

test('any other 400 still fails with the provider message, after a single attempt', async () => {
  responder = () => bad('model: claude-nope not found');
  await assert.rejects(() => J.callLLM('sys', 'user'), /HTTP 400.*not found/);
  assert.equal(sent.length, 1);
});

test('Ollama: the URL must be on this machine, from an import or typed in', async () => {
  assert.equal(J.isLocalOllamaUrl('http://localhost:11434/api/chat'), true);
  assert.equal(J.isLocalOllamaUrl('http://127.0.0.1:11434/api/chat'), true);
  assert.equal(J.isLocalOllamaUrl('https://localhost:8443/api/chat'), true);
  assert.equal(J.isLocalOllamaUrl('https://evil.example/api/chat'), false);
  assert.equal(J.isLocalOllamaUrl('http://localhost.evil.example/api/chat'), false);
  assert.equal(J.isLocalOllamaUrl('http://user:pw@localhost:11434/'), false);
  assert.equal(J.isLocalOllamaUrl('file:///etc/passwd'), false);

  // An imported settings file cannot point it elsewhere.
  const imported = J.mergeSettings({ model: { provider: 'ollama', ollamaUrl: 'https://evil.example/api/chat' } });
  assert.equal(imported.model.ollamaUrl, J.DEFAULT_SETTINGS.model.ollamaUrl);
  assert.equal(J.mergeSettings({ model: { ollamaUrl: ' http://127.0.0.1:11500/api/chat ' } }).model.ollamaUrl, 'http://127.0.0.1:11500/api/chat');

  // A URL typed into the panel is refused at request time, before anything is sent.
  J.setCurrentSettings(J.setPath(J.setPath(J.DEFAULT_SETTINGS, 'model.provider', 'ollama'), 'model.ollamaUrl', 'https://evil.example/api/chat'));
  keys['apikey.ollama'] = 'secret';
  try {
    await assert.rejects(J.callLLM('sys', 'user'), /must be on this computer/);
    assert.equal(sent.length, 0, 'no request left the machine');
  } finally {
    delete keys['apikey.ollama'];
  }
});

test('rate limits and server errors are retried with a backoff, then said plainly', async () => {
  const waits = [];
  const realSleep = J.timing.sleep;
  J.timing.sleep = async (ms) => { waits.push(ms); };
  try {
    // 429 then 529 then success: two quiet retries, the second honouring Retry-After.
    responder = (body, n) => (n === 1 ? { status: 429, text: 'slow down' }
      : n === 2 ? { status: 529, text: 'overloaded', headers: 'content-type: application/json\r\nretry-after: 5\r\n' }
        : claude('{"ok":true}'));
    assert.equal((await J.callLLM('sys', 'user')).text, '{"ok":true}');
    assert.equal(sent.length, 3);
    assert.deepEqual(waits, [J.RETRY_DELAYS_MS[0], 5000]);

    // Still failing after the retries: one clear message, no endless loop.
    sent.length = 0; waits.length = 0;
    responder = () => ({ status: 503, text: 'unavailable' });
    await assert.rejects(() => J.callLLM('sys', 'user'), /HTTP 503 .*overloaded or having trouble, still after 2 retries/);
    assert.equal(sent.length, 1 + J.RETRY_DELAYS_MS.length);

    // A 4xx that is not a rate limit is never retried.
    sent.length = 0;
    responder = () => ({ status: 401, text: 'bad key' });
    await assert.rejects(() => J.callLLM('sys', 'user'), /API key was rejected/);
    assert.equal(sent.length, 1);
  } finally {
    J.timing.sleep = realSleep;
  }
});

test('Retry-After is read as seconds or a date, and capped', () => {
  assert.equal(J.retryDelayMs('retry-after: 3', 0), 3000);
  assert.equal(J.retryDelayMs('Retry-After: 600', 0), 30000, 'capped at 30 s');
  assert.equal(J.retryDelayMs('retry-after: Wed, 21 Oct 2026 07:28:10 GMT', 0, Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')), 10000);
  assert.equal(J.retryDelayMs('', 1), J.RETRY_DELAYS_MS[1]);
  assert.equal(J.retryDelayMs('retry-after: soon', 0), J.RETRY_DELAYS_MS[0]);
  assert.equal(J.isRetryableStatus(429), true);
  assert.equal(J.isRetryableStatus(529), true);
  assert.equal(J.isRetryableStatus(502), true);
  assert.equal(J.isRetryableStatus(400), false);
  assert.equal(J.isRetryableStatus(404), false);
});
