// capture -> (cache | model) -> verify -> score. No DOM rendering and no Svelte:
// everything here takes settings as an argument, so a settings change can
// re-score a finished run without touching the network.
import { LIMITS } from './core/config.js';
import { score } from './core/gates.js';
import { extractionFingerprint, modelFor } from './core/settings.js';
import { cacheGet, cachePut, canonicalKey, fitGet, fitPut } from './core/store.js';
import { log, str } from './core/util.js';
import { siteFor } from './extract/sites.js';
import { firstEl } from './extract/dom.js';
import { evidenceHaystack, extractPosting } from './extract/posting.js';
import {
  coverageHaltsEarly, coverageReport, coverageTolerable, extractionWarnings, pageFullText,
} from './extract/coverage.js';
import { buildFitPrompt, buildPrompt } from './llm/prompt.js';
import { normalizeExtraction, parseModelJson, verifyEvidence } from './llm/extraction.js';
import { callLLM } from './llm/transport.js';

// How the posting text is gathered. 'page' is the normal scrape.
//   selection  - only the text you highlighted (replaces the scrape)
//   addition   - the scrape plus your highlighted text, selection first
//   fulltext   - the whole page text instead of the description selector
export const MODES = ['page', 'selection', 'addition', 'fulltext'];

function fullTextOf(doc, site) {
  const root = site && site.strict ? firstEl(doc, site.paneRoot) : null;
  return (site && site.strict && !root) ? '' : pageFullText(doc, root);
}

export function capturePage(doc, win, opts) {
  opts = opts || {};
  const mode = MODES.includes(opts.mode) ? opts.mode : 'page';
  const selected = String(opts.selection || '').trim();

  if (mode === 'selection') {
    const body = selected.slice(0, LIMITS.MAX_BODY_CHARS);
    return {
      url: win.location.href, host: win.location.hostname, site: 'selection', selector_used: 'user selection',
      title: '(selected text)', company: '', location: '', tab_title: doc.title,
      body: body, body_length: body.length, ld: {}, posted_days_ago: null,
    };
  }

  const site = siteFor(win.location.hostname);
  const page = extractPosting(doc, win);
  // Whole-page text, kept for the coverage checks only (and for 'fulltext').
  // On a strict site only the open job's pane counts as "the page".
  page.full_text = fullTextOf(doc, site);

  if (mode === 'fulltext') {
    const body = page.full_text.slice(0, LIMITS.MAX_BODY_CHARS);
    page.body = body;
    page.body_length = body.length;
    page.selector_used = 'full page text';
    page.used_generic = false;
  } else if (mode === 'addition' && selected) {
    const body = ('=== TEXT SELECTED BY THE USER ===\n' + selected + '\n\n=== PAGE TEXT ===\n' + page.body).slice(0, LIMITS.MAX_BODY_CHARS);
    page.body = body;
    page.body_length = body.length;
    page.selector_used = (page.selector_used || 'none') + ' + selection';
    page.selection_added = true;
  }
  return page;
}

function cacheKeyFor(page, mode) {
  return canonicalKey(page.url) + (mode && mode !== 'page' ? ':' + mode : '');
}

export function attachPage(x, page) {
  const out = Object.assign({}, x);
  out.page_location = page.location || '';
  out.page_title = page.title || '';
  out._pay_uncaptured = !!(page.strict && !page.pay_block);
  out._text = [page.title, page.location, page.body].filter(Boolean).join('\n');
  if (!out.title) out.title = page.title || null;
  if (!out.company) out.company = page.company || null;
  return out;
}

// Score an extraction. Used for a fresh run AND for re-scoring after a settings
// change, so it must never touch the network.
export function finalize(run, settings) {
  const { evidence, verification, page, meta } = run;
  const x = attachPage(verification.x, page);
  const result = score(x, settings);
  // A hand-selected run is text you chose, so the scrape checks do not apply to
  // it - only the model-vs-text cross-checks do.
  const report = coverageReport(page, x, { skipTextChecks: page.site === 'selection' }, verification);
  // The model answered, but the text it answered from may not support the
  // answer. Refuse unless the verdict was decided by a gate the gaps cannot touch.
  const tolerated = coverageTolerable(report, result);
  const rawText = (meta && meta.rawText) || '';
  if (report.blockers.length && !tolerated) {
    return {
      halted: true, page: page, report: report, x: x, evidence: evidence || {}, verification: verification,
      meta: meta || {}, rawText: rawText, warnings: report.notes,
    };
  }
  const warnings = extractionWarnings(page).concat(
    tolerated ? report.blockers.map((b) => 'Not used for this verdict: ' + b.message) : []
  );
  return { x, result, evidence: evidence || {}, verification, page, meta: meta || {}, rawText, warnings, unresolved: tolerated };
}

export function logEntryFor(out) {
  const r = out.result;
  const x = out.x;
  return {
    // The canonical posting id, not the cache key: a selection run is still the same job.
    id: canonicalKey(out.page.url),
    url: out.page.url,
    timestamp: new Date().toISOString(),
    company: x.company || out.page.company,
    title: x.title || out.page.title,
    location: x.office_location || out.page.location || x.location_restriction || '',
    product: x.product_name || '',
    verdict: r.verdict,
    fail_gate: r.fail_gate,
    fail_detail: r.fail_detail,
    reason: r.reason,
    flags: r.flags.map((f) => f.gate),
    questions: r.questions,
    base_min: x.base_min, base_max: x.base_max, ote_min: x.ote_min, ote_max: x.ote_max,
    cached: !!(out.meta && out.meta.cached),
    provider: out.meta && out.meta.provider,
    model: out.meta && out.meta.model,
  };
}

export async function runPipeline(opts, settings, doc, win) {
  opts = opts || {};
  const mode = MODES.includes(opts.mode) ? opts.mode : 'page';
  const page = capturePage(doc, win, opts);
  const key = cacheKeyFor(page, mode);
  const fp = extractionFingerprint(settings);
  const hit = (mode === 'page' && !opts.force) ? cacheGet(key) : null;
  const cached = hit && hit.fp === fp ? hit : null;

  // Never spend an API call on text with nothing in it. Anything less severe
  // than an empty or collapsed body goes to the model, because only once there
  // is a verdict can we tell whether the gap actually mattered. A cache hit is
  // still honoured: it came from a page that passed this check when captured.
  if (mode !== 'selection' && !cached) {
    const report = coverageReport(page);
    if (coverageHaltsEarly(report)) {
      log('halted before the model call', report.blockers.map((b) => b.id).join(', '));
      return { halted: true, page, report, x: null, evidence: {}, verification: null, meta: {}, rawText: '', warnings: report.notes, key };
    }
  }

  if (cached) {
    log('cache hit', key);
    const verification = verifyEvidence(cached.extraction, cached.evidence || {}, evidenceHaystack(page));
    const run = {
      evidence: cached.evidence || {}, verification, page,
      // On a cache hit "Show raw JSON" shows the cached extraction.
      meta: { cached: true, provider: cached.provider, model: cached.model, rawText: JSON.stringify(cached.extraction, null, 2) },
    };
    return Object.assign(finalize(run, settings), { key, run });
  }

  const prompt = buildPrompt(settings, page);
  const first = await callLLM(prompt.system, prompt.user);
  let text = first.text;
  let meta = { cached: false, provider: first.provider, model: first.model };

  let raw;
  try {
    raw = parseModelJson(text);
  } catch (e) {
    // One retry with an explicit repair instruction.
    log('invalid JSON, retrying once', e.message);
    const repair = await callLLM(
      prompt.system,
      'Your previous reply was not valid JSON. Return ONLY the JSON object described by the schema, ' +
      'with no prose and no code fences.\n\n' + prompt.user
    );
    meta = { cached: false, provider: repair.provider, model: repair.model };
    text = repair.text;
    raw = parseModelJson(repair.text);
  }
  meta.rawText = text;

  const normalized = normalizeExtraction(raw);
  const verification = verifyEvidence(normalized.x, normalized.evidence, evidenceHaystack(page));
  if (mode === 'page') {
    cachePut(key, {
      extraction: normalized.x, evidence: normalized.evidence, fp: fp,
      page: { url: page.url, title: page.title, company: page.company, location: page.location },
      provider: meta.provider, model: meta.model,
    });
  }
  const run = { evidence: normalized.evidence, verification, page, meta };
  return Object.assign(finalize(run, settings), { key, run });
}

/* --------------------------------------------------------------- fit notes */

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

const MEETS = ['yes', 'partial', 'no', 'unknown'];

export function normalizeFit(raw, requirements) {
  const items = [];
  const list = raw && Array.isArray(raw.items) ? raw.items : [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    const i = Number(it.i);
    if (!Number.isInteger(i) || i < 0 || i >= requirements.length) continue;
    const meets = MEETS.includes(String(it.meets).toLowerCase()) ? String(it.meets).toLowerCase() : 'unknown';
    items.push({ i: i, text: requirements[i].text, kind: requirements[i].kind, meets: meets, note: str(it.note) || '' });
  }
  items.sort((a, b) => a.i - b.i);
  return { items: items, summary: str(raw && raw.summary) || '' };
}

// Compare the requirements the posting lists with your profile. Informational:
// it never changes a verdict. Cached per (posting, profile, requirements).
export async function runFitNotes(x, key, settings) {
  const requirements = (x && x.requirements) || [];
  if (!settings.general.fitNotes || !requirements.length) return null;
  const fitKey = 'fit:' + key + ':' + hashString(settings.profile + '|' + modelFor(settings) + '|' + requirements.map((r) => r.text).join('|'));
  const hit = fitGet(fitKey);
  if (hit) return Object.assign({}, hit, { cached: true });
  const prompt = buildFitPrompt(settings, requirements);
  // Room for thinking (on by default on current Claude and OpenAI models) plus the
  // small JSON reply; only the tokens used are billed.
  const reply = await callLLM(prompt.system, prompt.user, { maxTokens: 6000 });
  const fit = normalizeFit(parseModelJson(reply.text), requirements);
  fitPut(fitKey, fit);
  return fit;
}
