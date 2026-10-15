// Aggregates over the local score log, and the paste-ready text blocks. Pure, so
// they can be unit-tested without a GM store or a DOM.
import { money, norm, str } from './util.js';

export function tally(list, keyOf) {
  const map = new Map();
  for (const item of list) {
    const k = keyOf(item);
    if (!k) continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
}

export function computeHistory(entries, now) {
  const log = Array.isArray(entries) ? entries.filter((e) => e && typeof e === 'object') : [];
  const cutoff = (now || Date.now()) - 7 * 86400000;
  const verdicts = {};
  for (const e of log) {
    const v = e.verdict || '?';
    verdicts[v] = (verdicts[v] || 0) + 1;
  }
  const count = (v) => verdicts[v] || 0;
  return {
    total: log.length,
    verdicts,
    apply: count('APPLY'),
    adjacent: count('ADJACENT'),
    review: count('REVIEW'),
    skip: log.length - count('APPLY') - count('ADJACENT') - count('REVIEW'),
    asked: log.filter((e) => e.verdict !== 'SKIP' && Array.isArray(e.flags) && e.flags.length).length,
    failGates: tally(log, (e) => str(e.fail_gate) || null),
    flagGates: tally(log.reduce((acc, e) => acc.concat(Array.isArray(e.flags) ? e.flags : []), []), (f) => str(f)),
    companies: tally(log, (e) => str(e.company) || '(unknown company)'),
    last7: log.filter((e) => Date.parse(e.timestamp) >= cutoff).length,
    last: log.length ? log[log.length - 1] : null,
    log,
  };
}

// The exact page wording behind the work-arrangement finding, so the copyable
// summary quotes the posting rather than paraphrasing it. Pure: it only reads
// the extraction and the verified quotes. Returns null when nothing was
// verified, and the caller says so instead of inventing wording.
export function buildSummarySource(x, evidence) {
  const ev = evidence || {};
  const wa = (x && x.work_arrangement) || 'unclear';
  const parts = [];
  const push = (label, quote) => { if (quote) parts.push(label + ': "' + quote + '"'); };
  if (wa === 'unclear') {
    push('location', ev.location_restriction);
  } else {
    push('work arrangement', ev.work_arrangement);
    if (ev.location_restriction && norm(ev.location_restriction) !== norm(ev.work_arrangement)) {
      push('location', ev.location_restriction);
    }
  }
  return parts.length ? parts.join(' | ') : null;
}

export function payText(x) {
  if (!x) return 'not posted';
  const lo = x.base_min;
  const hi = x.base_max;
  if (lo != null && hi != null && lo !== hi) return money(lo) + ' - ' + money(hi);
  if (hi != null) return money(hi);
  if (lo != null) return 'from ' + money(lo);
  return x.pay_posted ? 'posted, unparsed' : 'not posted';
}

// Paste-ready note (TealHQ and the like): who, what, verdict, pay, and the
// questions still open.
export function buildSummary(result, x, page, nowIso) {
  x = x || {};
  if (!result) return 'JobScore: nothing scored yet for ' + ((page && page.url) || '');
  const lines = [
    'JobScore: ' + (x.company || '?') + ' - ' + (x.title || '?'),
    result.verdict + (result.askRecruiter ? ' (ask the recruiter)' : '') + ': ' + (result.reason || ''),
    'Base: ' + payText(x) + (x.ote_max != null ? ' | OTE: ' + (x.ote_min != null ? money(x.ote_min) + ' - ' : '') + money(x.ote_max) : ''),
  ];
  if (result.questions && result.questions.length) {
    lines.push('Ask: ' + result.questions.join(' / '));
  }
  lines.push('URL: ' + ((page && page.url) || ''));
  lines.push('Scored: ' + (nowIso || new Date().toISOString()));
  return lines.join('\n');
}

// The first message to a recruiter. Short on purpose.
export function buildRecruiterMessage(result, x) {
  x = x || {};
  const qs = (result && result.questions) || [];
  if (!qs.length) return '';
  const role = (x.title ? 'the ' + x.title : 'this') + ' role' + (x.company ? ' at ' + x.company : '');
  return 'Hi - I am interested in ' + role + '. Before we go further, a few quick questions:\n\n' +
    qs.map((q, i) => (i + 1) + '. ' + q).join('\n') + '\n\nThanks!';
}

export function historyAsText(h) {
  const lines = [
    'JobScore history - ' + h.total + ' scored',
    'apply=' + h.apply + ' adjacent=' + h.adjacent + ' review=' + h.review + ' skip=' + h.skip + ' asked=' + h.asked + ' last7=' + h.last7,
    'skipped by (' + h.failGates.length + '):',
  ];
  if (!h.failGates.length) lines.push('  (none recorded)');
  h.failGates.forEach((f) => lines.push('  ' + String(f.n).padStart(3) + '  ' + f.key));
  lines.push('questions raised by:');
  if (!h.flagGates.length) lines.push('  (none recorded)');
  h.flagGates.forEach((f) => lines.push('  ' + String(f.n).padStart(3) + '  ' + f.key));
  lines.push('recent:');
  h.log.slice(-20).reverse().forEach((e) => {
    const when = e.timestamp ? String(e.timestamp).slice(0, 10) : '';
    lines.push('  ' + (e.verdict || '?') + '  ' + (str(e.company) || '?') + ' - ' + (str(e.title) || '?') +
      (e.fail_gate ? '  | ' + e.fail_gate + (e.fail_detail ? ': ' + e.fail_detail : '') : '') + (when ? '  (' + when + ')' : ''));
  });
  return lines.join('\n');
}
