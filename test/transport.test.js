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
  setTimeout(() => o.onload({ status: r.status, responseText: r.text }), 0);
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
