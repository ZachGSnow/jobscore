import { getv, setv } from '../core/gm.js';
import { LIMITS, PROVIDERS } from '../core/config.js';
import { getSettings, modelFor } from '../core/settings.js';

// API keys live in Violentmonkey storage, never in the settings blob, so an
// exported settings file cannot leak one.
export function keyName(provider) { return 'apikey.' + provider; }
export function getApiKey(provider) { return String(getv(keyName(provider), '') || ''); }
export function setApiKey(provider, key) { setv(keyName(provider), String(key || '').trim()); }
export function modelName(provider) { return modelFor(getSettings(), provider); }

// Pure request builder - easy to unit test.
export function buildHttpRequest(providerName, opts, systemPrompt, userPrompt) {
  const p = PROVIDERS[providerName];
  if (!p) throw new Error('Unknown provider: ' + providerName);
  const model = opts.model || p.defaultModel;
  const forceJson = opts.forceJson !== false;

  if (providerName === 'anthropic') {
    const messages = [{ role: 'user', content: userPrompt }];
    let prefill = false;
    if (forceJson && p.prefillJson && opts.prefill !== false) { messages.push({ role: 'assistant', content: '{' }); prefill = true; }
    return {
      url: p.url,
      prefill,
      headers: {
        'content-type': 'application/json',
        'x-api-key': opts.key || '',
        'anthropic-version': p.apiVersion,
      },
      body: {
        model,
        max_tokens: opts.maxTokens || p.maxTokens,
        ...(opts.temperature === true ? { temperature: 0 } : {}),
        system: systemPrompt,
        messages,
      },
    };
  }

  if (providerName === 'openai') {
    return {
      url: p.url,
      prefill: false,
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + (opts.key || ''),
      },
      body: {
        model,
        ...(opts.temperature === true ? { temperature: 0 } : {}),
        // max_completion_tokens replaced max_tokens; reasoning models reject max_tokens.
        max_completion_tokens: opts.maxTokens || p.maxTokens,
        response_format: forceJson ? { type: 'json_object' } : undefined,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt + '\n\nRespond with JSON only.' },
        ],
      },
    };
  }

  if (providerName === 'ollama') {
    const headers = { 'content-type': 'application/json' };
    if (opts.key) headers.authorization = 'Bearer ' + opts.key;
    return {
      url: opts.url || p.url,
      prefill: false,
      headers,
      body: {
        model,
        stream: false,
        format: forceJson ? 'json' : undefined,
        options: opts.temperature === false ? {} : { temperature: 0 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
    };
  }

  throw new Error('Unhandled provider: ' + providerName);
}

// A reply that ended for a reason other than finishing: a safety refusal, or the
// token cap cutting the JSON off. Said plainly instead of "empty completion" or
// a JSON parse error further down. Returns null when the reply finished normally.
export function unfinishedReplyMessage(providerName, json) {
  const label = (PROVIDERS[providerName] || {}).label || providerName;
  if (providerName === 'anthropic') {
    if (json.stop_reason === 'refusal') {
      const cat = json.stop_details && json.stop_details.category;
      return label + ' declined to process this posting (safety refusal' + (cat ? ': ' + cat : '') + '). Try Rescore, or another model in Settings > Model.';
    }
    if (json.stop_reason === 'max_tokens') return label + "'s reply was cut off at the token limit before the JSON was complete. Try Rescore.";
  }
  if (providerName === 'openai') {
    const reason = ((json.choices || [])[0] || {}).finish_reason;
    if (reason === 'content_filter') return label + ' declined to process this posting (content filter). Try Rescore, or another model in Settings > Model.';
    if (reason === 'length') return label + "'s reply was cut off at the token limit before the JSON was complete. Try Rescore.";
  }
  return null;
}

export function extractAssistantText(providerName, json) {
  if (providerName === 'anthropic') {
    return (json.content || []).map((c) => c.text || '').join('');
  }
  if (providerName === 'openai') {
    const choice = (json.choices || [])[0] || {};
    return (choice.message && choice.message.content) || '';
  }
  if (providerName === 'ollama') {
    return (json.message && json.message.content) || '';
  }
  return '';
}

export function gmRequest(opts) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest !== 'function') {
      reject(new Error('GM_xmlhttpRequest is not available (run this inside Violentmonkey).'));
      return;
    }
    GM_xmlhttpRequest({
      method: opts.method || 'POST',
      url: opts.url,
      headers: opts.headers || {},
      data: opts.data,
      timeout: opts.timeout || LIMITS.REQUEST_TIMEOUT_MS,
      onload: (r) => resolve({ status: r.status, text: r.responseText }),
      onerror: () => reject(new Error('Network error talking to ' + safeHost(opts.url) + ' (is the host in @connect?)')),
      ontimeout: () => reject(new Error('Request to ' + safeHost(opts.url) + ' timed out after ' + Math.round((opts.timeout || LIMITS.REQUEST_TIMEOUT_MS) / 1000) + 's')),
      onabort: () => reject(new Error('Request aborted')),
    });
  });
}

export function safeHost(url) { try { return new URL(url).host; } catch (e) { return url; } }

export function httpErrorMessage(providerName, status, bodyText) {
  const snippet = String(bodyText || '').slice(0, 400).replace(/\s+/g, ' ');
  if (status === 401 || status === 403) return 'HTTP ' + status + ' - the API key was rejected for ' + providerName + '. Set it again in Settings > Model. ' + snippet;
  if (status === 404) return 'HTTP 404 - check the model name and API URL for ' + providerName + '. ' + snippet;
  if (status === 429) return 'HTTP 429 - rate limited or out of credit. ' + snippet;
  return 'HTTP ' + status + ' from ' + providerName + ': ' + snippet;
}

export async function callLLM(systemPrompt, userPrompt, opts) {
  const settings = getSettings();
  const providerName = settings.model.provider;
  const p = PROVIDERS[providerName];
  if (!p) throw new Error('Unknown provider "' + providerName + '". Pick one in Settings > Model.');
  const key = getApiKey(providerName);
  if (p.needsKey && !key) {
    throw new Error('No API key set for ' + p.label + '. Open Settings > Model and paste one.');
  }
  const model = modelName(providerName);
  const url = providerName === 'ollama' ? (settings.model.ollamaUrl || p.url) : p.url;
  // Models differ in what they accept, and newer ones drop parameters older ones
  // took. On a 400 that names a parameter we sent, retry without it instead of
  // failing the score: temperature first, then the assistant-prefill trick.
  const flags = { temperature: !!p.sendsTemperature, prefill: true };
  let req;
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    req = buildHttpRequest(providerName, { key, model, url, maxTokens: opts && opts.maxTokens, temperature: flags.temperature, prefill: flags.prefill }, systemPrompt, userPrompt);
    res = await gmRequest({ method: 'POST', url: req.url, headers: req.headers, data: JSON.stringify(req.body) });
    if (res.status !== 400) break;
    const body = String(res.text || '');
    if (flags.temperature && /temperature/i.test(body)) { flags.temperature = false; continue; }
    if (flags.prefill && req.prefill && /prefill|assistant message|final assistant/i.test(body)) { flags.prefill = false; continue; }
    break;
  }
  if (res.status < 200 || res.status >= 300) throw new Error(httpErrorMessage(p.label, res.status, res.text));
  let json;
  try { json = JSON.parse(res.text); }
  catch (e) { throw new Error(p.label + ' returned a non-JSON HTTP body: ' + String(res.text).slice(0, 250)); }
  const unfinished = unfinishedReplyMessage(providerName, json);
  if (unfinished) throw new Error(unfinished);
  let text = extractAssistantText(providerName, json);
  if (req.prefill && !text.trim().startsWith('{')) text = '{' + text;
  if (!text.trim()) throw new Error(p.label + ' returned an empty completion.');
  return { text, provider: providerName, model };
}
