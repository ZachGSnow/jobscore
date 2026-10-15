// Fixed constants. Nothing here is user-editable: everything you may want to
// change lives in settings.js and is edited from the panel.

// Bump when the extraction schema, the extraction prompt, or the page
// extraction changes, to discard cached extractions built from worse text.
// 6 adds the per-field "present" and "explanation" attributes.
// 7 drops unmet_requirements and adds employer inference from the URL.
// 8 joins repeated header fields (Workday's location list) and strips labels.
// 9 adds base_source, so the gate can tell a stated base from an OTE-derived one.
// 10 folds whitespace and dashes when checking evidence quotes.
// 11 adds travel_scope and the REVIEW (unknown) gate state.
// 12 adds eligibility, office location, travel purpose, OTE and the requirement list.
// 13 renames eligibility_ky to eligibility_home (the home region is configurable).
export const SCHEMA_VERSION = 13;

export const LIMITS = {
  MAX_BODY_CHARS: 12000,     // body text cap sent to the model
  MIN_DESC_CHARS: 300,       // below this, treat the page as "posting not found"
  // Whole-page text kept ONLY for the coverage report (finding the location
  // banner, pay lines and duplicated cards a selector missed). It is never
  // sent to the model.
  MAX_FULL_CHARS: 20000,
  CACHE_TTL_DAYS: 14,
  CACHE_MAX_ENTRIES: 80,
  LOG_MAX: 200,
  DEBOUNCE_MS: 1200,         // SPA / DOM settle time before asking the API
  REQUEST_TIMEOUT_MS: 90000,
  PROMPT_PROFILE_MAX_WORDS: 200,
};

// Transport details per provider. The model id, like everything else you might
// want to change, is a setting (settings.model.<provider>); `defaultModel` here
// is only the fallback.
export const PROVIDERS = {
  // Checked 2026-10-15 against each provider's current documentation.
  anthropic: {
    label: 'Anthropic',
    url: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-5-5',   // a current Claude model; any model id works (Settings > Model)
    apiVersion: '2023-06-01',            // the Messages API version header
    // Current Claude models think by default and thinking counts toward this cap,
    // so a low cap can cut the JSON off. Only the tokens used are billed.
    maxTokens: 16000,
    // Current Claude models reject a prefilled assistant turn with a 400. The JSON
    // is asked for in the prompt and parsed tolerantly (code fences, stray text).
    prefillJson: false,
    sendsTemperature: false,             // current Claude models reject non-default temperature
    needsKey: true,
  },
  openai: {
    label: 'OpenAI',
    url: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-6-luna',          // OpenAI's low-cost current model; any model id works
    maxTokens: 16000,                    // sent as max_completion_tokens; includes reasoning tokens
    prefillJson: false,                  // uses response_format json_object instead
    sendsTemperature: false,             // current OpenAI models are reasoning models and reject it
    needsKey: true,
  },
  ollama: {
    label: 'Ollama (local)',
    // Ollama's default address. If you set OLLAMA_HOST, change the URL in Settings > Model.
    url: 'http://localhost:11434/api/chat',
    defaultModel: 'llama3.1:8b',         // must be a model you have pulled (`ollama pull <name>`)
    maxTokens: 16000,
    prefillJson: false,                  // uses "format": "json" instead
    sendsTemperature: true,              // local models accept temperature 0
    needsKey: false,                     // local, no key
  },
};

export const DEFAULT_PROVIDER = 'anthropic';
