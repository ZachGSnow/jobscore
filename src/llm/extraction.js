import { boolish, norm, normQuote, num, oneOf, str } from '../core/util.js';
import {
  BASE_SOURCES, BUYER_PERSONAS, ELIGIBILITY, EMPLOYER_TYPES, LOCATION_SCOPES, REQUIREMENT_KINDS, ROLE_TYPES,
  TRAVEL_PURPOSES, TRAVEL_SCOPES, WORK_ARRANGEMENTS, YEARS_KINDS,
} from '../core/enums.js';

export function stripCodeFences(text) {
  let t = String(text || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first > 0 || (last !== -1 && last < t.length - 1)) {
    if (first !== -1 && last > first) t = t.slice(first, last + 1);
  }
  return t;
}

export function parseModelJson(text) {
  return JSON.parse(stripCodeFences(text));
}

// The schema wraps most fields as {value, present, evidence, explanation}.
// Unwrap defensively: a plain value or a missing attribute must not throw.
export function unwrap(field) {
  if (field === null || field === undefined) return { value: null, present: null, evidence: null, explanation: null };
  if (typeof field === 'object' && !Array.isArray(field)) {
    return {
      value: Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : null,
      present: Object.prototype.hasOwnProperty.call(field, 'present') ? field.present : null,
      evidence: field.evidence === undefined ? null : field.evidence,
      explanation: field.explanation === undefined ? null : field.explanation,
    };
  }
  return { value: field, present: null, evidence: null, explanation: null };
}

export function asStringArray(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

export function normalizeExtraction(raw) {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const x = {};
  const evidence = {};

  const simple = [
    'title', 'company', 'location_restriction', 'product_name', 'product_category', 'one_line_summary',
    'eligibility_text', 'office_location',
  ];
  for (const k of simple) {
    const u = unwrap(r[k]);
    x[k] = str(u.value);
    evidence[k] = str(u.evidence);
  }

  const wa = unwrap(r.work_arrangement);
  x.work_arrangement = oneOf(wa.value, WORK_ARRANGEMENTS, 'unclear');
  evidence.work_arrangement = str(wa.evidence);

  const scope = unwrap(r.location_scope);
  x.location_scope = oneOf(scope.value, LOCATION_SCOPES, 'unclear');
  evidence.location_scope = str(scope.evidence);

  // Can someone who lives in the home region apply? Unclear unless the posting says.
  // eligibility_ky is the same field under its old name (replies cached before the rename).
  const elig = unwrap(r.eligibility_home !== undefined ? r.eligibility_home : r.eligibility_ky);
  x.eligibility_home = oneOf(elig.value, ELIGIBILITY, 'unclear');
  evidence.eligibility_home = str(elig.evidence);

  const purpose = unwrap(r.travel_purpose);
  x.travel_purpose = oneOf(purpose.value, TRAVEL_PURPOSES, null);
  evidence.travel_purpose = str(purpose.evidence);

  const role = unwrap(r.role_type);
  x.role_type = oneOf(role.value, ROLE_TYPES, 'other');
  evidence.role_type = str(role.evidence);

  const buyer = unwrap(r.buyer_persona);
  x.buyer_persona = oneOf(buyer.value, BUYER_PERSONAS, 'other');
  evidence.buyer_persona = str(buyer.evidence);

  const emp = unwrap(r.employer_type);
  x.employer_type = oneOf(emp.value, EMPLOYER_TYPES, null);
  evidence.employer_type = str(emp.evidence);

  // Travel: where, not just how much. Unknown stays 'unspecified' so the
  // Travel gate asks instead of assuming the trips are local.
  const tscope = unwrap(r.travel_scope);
  x.travel_scope = oneOf(tscope.value, TRAVEL_SCOPES, 'unspecified');
  evidence.travel_scope = str(tscope.evidence);

  const kind = unwrap(r.years_required_kind);
  x.years_required_kind = oneOf(kind.value, YEARS_KINDS, 'none');
  evidence.years_required_kind = str(kind.evidence);

  // How the base was obtained. No evidence quote: it describes the answer,
  // not a fact in the posting, so there is nothing to verify it against.
  const bsrc = unwrap(r.base_source);
  x.base_source = oneOf(bsrc.value, BASE_SOURCES, null);

  const numeric = ['base_min', 'base_max', 'ote_min', 'ote_max', 'years_required', 'travel_percent', 'posted_days_ago'];
  for (const k of numeric) {
    const u = unwrap(r[k]);
    x[k] = num(u.value, null);
    evidence[k] = str(u.evidence);
  }

  const fam = unwrap(r.pay_range_is_job_family_wide);
  x.pay_range_is_job_family_wide = boolish(fam.value) === true;
  evidence.pay_range_is_job_family_wide = str(fam.evidence);

  const posted = unwrap(r.pay_posted);
  x.pay_posted = boolish(posted.value) === true;
  evidence.pay_posted = str(posted.evidence);

  // named_tools: {"value":[..],"evidence":[..]} or a bare array of names
  const toolsField = r.named_tools;
  if (toolsField && typeof toolsField === 'object' && !Array.isArray(toolsField)) {
    x.named_tools = asStringArray(toolsField.value);
    const ev = toolsField.evidence;
    x.__tool_evidence = Array.isArray(ev) ? ev.map(str) : (str(ev) ? x.named_tools.map(() => str(ev)) : []);
  } else {
    x.named_tools = asStringArray(toolsField);
    x.__tool_evidence = [];
  }

  // requirements: {"value":[{text,kind}],"evidence":[quote,...]} (parallel arrays)
  x.requirements = [];
  x.__req_evidence = [];
  const reqField = r.requirements;
  if (reqField && typeof reqField === 'object' && !Array.isArray(reqField) && Array.isArray(reqField.value)) {
    const ev = Array.isArray(reqField.evidence) ? reqField.evidence : [];
    reqField.value.slice(0, 12).forEach((item, i) => {
      const text = str(item && typeof item === 'object' ? item.text : item);
      if (!text) return;
      const k = item && typeof item === 'object' ? oneOf(item.kind, REQUIREMENT_KINDS, 'required') : 'required';
      x.requirements.push({ text: text, kind: k });
      x.__req_evidence.push(str(ev[i]));
    });
  }

  // present / explanation for every field the model returned. Collected by
  // key here so the per-field unwraps above do not each have to carry them.
  const present = {};
  const explanation = {};
  for (const key of Object.keys(r)) {
    if (key === 'named_tools' || key === 'requirements') continue;
    const u = unwrap(r[key]);
    const p = boolish(u.present);
    present[key] = (p === true || p === false) ? p : null;
    explanation[key] = str(u.explanation);
  }
  x.__present = present;
  x.__explanation = explanation;

  return { x, evidence };
}

/* ======================================================================
   SECTION 7 - EVIDENCE VERIFICATION
   A quote that is not in the page text marks its field unverified, and an
   unverified value is treated as null for scoring.
   ====================================================================== */

export function verifyEvidence(x, evidence, haystack) {
  const hay = normQuote(haystack);
  const out = Object.assign({}, x);
  const claimedPresent = out.__present || {};
  const claimedExplanation = out.__explanation || {};
  delete out.__present;
  delete out.__explanation;
  const status = {};
  const droppedTools = [];

  const check = (key, quote) => {
    if (!quote) { status[key] = 'missing'; return true; }
    const ok = hay.includes(normQuote(quote));
    status[key] = ok ? 'verified' : 'unverified';
    return ok;
  };

  for (const key of Object.keys(evidence)) {
    if (key === 'named_tools') continue;
    const quote = evidence[key];
    const ok = check(key, quote);
    if (!ok && key in out) out[key] = null;
  }

  // Numbers / enums / booleans that were nulled need sane fallbacks.
  if (out.work_arrangement === null) out.work_arrangement = 'unclear';
  if (out.location_scope === null) out.location_scope = 'unclear';
  if (out.role_type === null) out.role_type = 'other';
  if (out.buyer_persona === null) out.buyer_persona = 'other';
  if (out.years_required_kind === null) out.years_required_kind = 'none';
  if (out.travel_scope === null) out.travel_scope = 'unspecified';
  if (out.eligibility_home === null) out.eligibility_home = 'unclear';
  if (out.pay_range_is_job_family_wide === null) out.pay_range_is_job_family_wide = false;
  if (out.pay_posted === null) out.pay_posted = false;

  // Each named tool carries its own quote.
  const tools = [];
  const toolEvidence = x.__tool_evidence || [];
  (x.named_tools || []).forEach((tool, i) => {
    const quote = toolEvidence[i];
    if (quote && !hay.includes(normQuote(quote))) { droppedTools.push(tool); return; }
    tools.push(tool);
  });
  out.named_tools = tools;
  delete out.__tool_evidence;

  status.named_tools = droppedTools.length ? 'unverified' : 'verified';

  // Each requirement carries its own quote. One whose quote is not on the page is
  // dropped; one with no quote at all is kept but shown as unquoted.
  const reqs = [];
  const droppedReqs = [];
  const reqEvidence = x.__req_evidence || [];
  (x.requirements || []).forEach((r, i) => {
    const quote = reqEvidence[i];
    if (quote && !hay.includes(normQuote(quote))) { droppedReqs.push(r.text); return; }
    reqs.push({ text: r.text, kind: r.kind, quote: quote || null });
  });
  out.requirements = reqs;
  delete out.__req_evidence;
  status.requirements = droppedReqs.length ? 'unverified' : 'verified';

  // present: true only when a value survived verification AND the model did
  // not itself mark the field as not stated. That keeps "this posting states
  // no base pay" (present=false) apart from "a base pay was there but could
  // not be read" (present=false too, but the reason differs and the
  // verification status says which). explanation carries the model's own
  // one-line answer to "why is this null", shown to the reader only.
  const present = {};
  const explanation = {};
  for (const key of Object.keys(out)) {
    if (key === 'named_tools' || key === 'requirements') continue;
    const v = out[key];
    const hasValue = !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
    present[key] = hasValue && claimedPresent[key] !== false;
    explanation[key] = claimedExplanation[key] || null;
  }

  const unverified = Object.keys(status).filter((k) => status[k] === 'unverified');
  // "No quote supplied" is only worth showing when the field actually carries a
  // fact. A summary has no source quote to give, a `false` boolean is the
  // model declining to claim something, and an enum sitting on its fallback
  // (unclear / other / none) is an absence rather than an assertion.
  const ENUM_FALLBACK = {
    work_arrangement: 'unclear', location_scope: 'unclear', role_type: 'other',
    buyer_persona: 'other', years_required_kind: 'none', travel_scope: 'unspecified',
    eligibility_home: 'unclear',
  };
  const noQuote = Object.keys(status).filter((k) => {
    if (status[k] !== 'missing') return false;
    if (k === 'one_line_summary' || k === 'posted_days_ago') return false;
    const v = out[k];
    if (v === null || v === undefined || v === '') return false;
    if (typeof v === 'boolean') return v === true;
    if (Object.prototype.hasOwnProperty.call(ENUM_FALLBACK, k) && v === ENUM_FALLBACK[k]) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  return { x: out, status, present, explanation, unverified, noQuote, droppedTools, droppedReqs };
}
