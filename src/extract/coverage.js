import { LIMITS } from '../core/config.js';
import { mentionsHomeRegion } from '../core/location.js';
import { getSettings } from '../core/settings.js';
import { esc, str } from '../core/util.js';
import { JUNK_SELECTORS, blockText, cleanText, looksLikeFullPosting } from './dom.js';

// "... more", "\u2026 more", "show more", "see more" - LinkedIn and others hide the
// rest of the description behind one of these until you click it.
export const COLLAPSED_TAIL_RE = /(?:(?:\.{2,}|\u2026)\s*more|show more|see more|read more)\s*$/i;

/* ------------------------------------------------------- coverage report
   The scorer is only as good as the text it captured, and the failure mode
   that matters is silent: a selector misses the location banner, the model
   never sees "United States of America", and the run ends in a confident
   SKIP that looks like a real judgement. So the text is checked BEFORE the
   model call and, when it does not look complete, the pipeline stops and
   reports instead of scoring.

   `page.full_text` is the whole page, captured only for these checks. It is
   never sent to the model, so widening the check does not widen the prompt.
   ------------------------------------------------------------------------ */

// A money figure: $140,000, $140k, 140,000.
export const MONEY_FIGURE_RE = /(?:\$\s?\d[\d,.]*|\b\d{2,3}[,.]?\d{3}\b|\b\d{2,3}\s?k\b)/i;
// Wording that makes a money figure a BASE PAY figure. Deliberately narrow:
// "revenue", "budget" and "funding" must not count, and OTE/commission-only
// lines are exactly the case where a null base is correct.
// "a year" / "an hour" is how Indeed prints a pay chip ("$160,000 - $185,000 a year").
export const BASE_PAY_WORD_RE = /\b(base|salary|salaries|pay\s+range|pay\s+band|pay\s+grade|pay\s+scale|annual\s+pay|hourly\s+rate|per\s+year|per\s+hour|an?\s+(?:year|hour|month|week|day))\b/i;
// A place-ish token. "remote", "hybrid" and "onsite" only matter when the
// location field came back empty, which is rare enough to keep the noise down.
// Your own territory words (Settings > Home) count too.
export const PLACE_TOKEN_RE = /\b(united states(?: of america)?|nationwide|remote|telecommut\w*|hybrid|on-?site|onsite)\b/i;
// Case-sensitive on purpose: a stray "contact us" must not read as US-based.
export const PLACE_TOKEN_US_RE = /\b(?:US|USA|U\.S\.A?\.?)\b/;

export function hasPlaceToken(text, cfg) {
  const s = String(text || '');
  return PLACE_TOKEN_RE.test(s) || PLACE_TOKEN_US_RE.test(s) || mentionsHomeRegion(s, cfg || getSettings());
}

// Every money figure on the page that sits next to base-pay wording. The
// window before the figure is wider than the one after because the label
// comes first ("Base Salary - $140,000"), which is the trap that made the old
// range parser misread labelled ranges.
export function payLines(text) {
  const s = String(text || '');
  const out = [];
  const re = new RegExp(MONEY_FIGURE_RE.source, 'ig');
  let m;
  while ((m = re.exec(s)) && out.length < 8) {
    const win = s.slice(Math.max(0, m.index - 140), m.index + 90);
    if (BASE_PAY_WORD_RE.test(win)) out.push(win.replace(/\s+/g, ' ').trim().slice(0, 180));
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// The whole page, cleaned and capped, for the coverage checks only.
// `root` narrows it to one element (the open job's pane on a search page), so
// a salary or "Remote" on some OTHER result card cannot satisfy or trip a check.
export function pageFullText(doc, root) {
  try {
    const body = root || (doc && doc.body);
    if (!body) return '';
    const clone = body.cloneNode(true);
    try { clone.querySelectorAll(JUNK_SELECTORS).forEach((n) => n.remove()); } catch (e) { /* ignore */ }
    // Our own panel lives inside body; it must not count as page text.
    const host = clone.querySelector('#jobscore-host');
    if (host) host.remove();
    let raw = '';
    try { raw = blockText(clone); } catch (e) { raw = ''; }
    if (!raw.trim()) raw = clone.innerText || clone.textContent || '';
    return cleanText(raw.replace(/\u00a0/g, ' ')).slice(0, LIMITS.MAX_FULL_CHARS);
  } catch (e) {
    return '';
  }
}

// Text-only checks, run before the model so a bad scrape costs nothing.
// Returns {blockers, notes, checks}. Blockers stop the run; notes are shown
// but do not.
export function extractionIssues(page) {
  page = page || {};
  const body = String(page.body || '');
  const full = String(page.full_text || body);
  const blockers = [];
  const notes = [];

  // A strict site read from the open job's pane. No pane, or a pane still
  // showing the previous job, means there is nothing trustworthy to score.
  if (page.strict && page.pane_found === false) {
    blockers.push({ id: 'pane_missing', message: 'The open job pane was not found on the page yet. Nothing was read from the rest of the page, because on a search page that would score the wrong job.' });
  }
  if (page.pane_stale) {
    blockers.push({ id: 'pane_stale', message: 'The job pane still shows a different job than the URL (pane ' + page.job_key + ' vs the address bar). It has not finished loading the one you clicked.' });
  }
  const ldLocation = (page.ld && page.ld.location) || '';
  const tail = body.trim().split('\n').slice(-3).join(' ').trim();
  const collapsed = COLLAPSED_TAIL_RE.test(tail) || /(?:\.{2,}|\u2026)\s*more\b/i.test(body);
  const onPage = payLines(full);
  const inBody = payLines(body);
  const head = body.slice(0, 160);
  const dupes = head.length >= 80 ? full.split(head).length - 1 : 0;

  if (page.body_length < LIMITS.MIN_DESC_CHARS) {
    blockers.push({
      id: 'body_too_short',
      message: 'Only ' + page.body_length + ' characters of posting text found (need ' + LIMITS.MIN_DESC_CHARS + '). The description selector missed, or the posting is behind a modal or a "... more" link.',
    });
  } else if (page.body_length < 800) {
    notes.push('Only ' + page.body_length + ' characters of posting text found - the description may be truncated or behind a modal.');
  }

  if (collapsed) {
    blockers.push({
      id: 'collapsed',
      message: 'This posting looks collapsed (the text ends with a "more" link). Click it on the page to expand the description, then press Alt+1 to rescore.',
    });
  }

  // The location banner is a separate element from the description, so a
  // miss here is invisible to the model. If the page names a place but the
  // banner came back empty, the extraction is not trustworthy.
  if (!page.strict && !str(page.location) && !str(ldLocation) && hasPlaceToken(body + '\n' + full)) {
    blockers.push({
      id: 'location_banner_missing',
      message: 'The location banner was not captured (the selectors returned nothing) but the page text names a place ("United States", "remote", your home state, ...). A location fix was scored on text the model never received.',
    });
  }

  // Pay wording on the page but outside the captured description - the same
  // class of miss, one section over.
  if (onPage.length && !inBody.length) {
    blockers.push({
      id: 'pay_outside_description',
      message: 'Pay wording with a figure appears on the page ("' + onPage[0] + '") but not inside the captured description, so the Pay gate has nothing to read.',
    });
  }

  // An unlisted careers page is normal, and the fallback usually captures it
  // whole; only say so when what it found does not read like a full posting.
  if (page.site === 'generic') {
    if (!looksLikeFullPosting(page.body)) {
      notes.push('This site has no dedicated selectors and the page-wide fallback found only part of a posting. Use "+ Selection" or "Full page text" now, and run "JobScore: copy selector report" to get a selector added.');
    }
  } else if (page.used_generic) {
    notes.push('The ' + page.site + ' selectors did not find a whole posting, so the page-wide fallback was used. Run "JobScore: copy selector report" to get it fixed.');
  }

  if (page.body_length >= LIMITS.MIN_DESC_CHARS && page.body_length < LIMITS.MIN_DESC_CHARS * 3) {
    notes.push('Short text: the extraction may be missing the responsibilities and requirements sections.');
  }

  if (dupes > 1) {
    notes.push('The description text appears ' + dupes + ' times on the page (a results list may be present), so the match may not be the open posting.');
  }

  return {
    blockers: blockers,
    notes: notes,
    checks: {
      site: page.site || 'unknown',
      selector: page.selector_used || 'none',
      body_chars: page.body_length,
      page_chars: full.length,
      location_banner: str(page.location) || null,
      location_from_ld: str(ldLocation) || null,
      place_token_on_page: hasPlaceToken(body + '\n' + full),
      pay_lines_on_page: onPage.length,
      pay_lines_in_description: inBody.length,
      duplicate_text_runs: dupes,
      collapsed: collapsed,
      pane_scoped: !!page.pane_scoped,
    },
  };
}

// Post-model checks: facts the model returned that the captured text
// contradicts. These catch a model dropout (a pay line it did not read) and a
// page with no location information anywhere.
export function factCrossChecks(page, x, verification) {
  page = page || {};
  x = x || {};
  const unver = (verification && verification.unverified) || [];
  const body = String(page.body || '');
  const full = String(page.full_text || body);
  const blockers = [];
  const checks = {};

  const onPage = payLines(full.length ? full : body);
  const missingBaseMin = x.base_min === null || x.base_min === undefined;
  const missingBaseMax = x.base_max === null || x.base_max === undefined;
  checks.base_min = missingBaseMin ? null : x.base_min;
  checks.base_max = missingBaseMax ? null : x.base_max;
  if (onPage.length && missingBaseMin && missingBaseMax) {
    blockers.push({
      id: 'pay_not_extracted',
      message: onPage[0] && (unver.indexOf('base_min') !== -1 || unver.indexOf('base_max') !== -1)
        ? 'The captured text contains a base-pay figure ("' + onPage[0] + '") and the model read one, but its quote was not found in the page text, so the value was dropped as unverified. See the Unverified line below.'
        : 'The captured text contains a base-pay figure ("' + onPage[0] + '") but no base pay was extracted.',
    });
  }

  const hasBanner = !!(str(page.location) || str(page.ld && page.ld.location));
  const hasLimit = !!str(x.location_restriction);
  const scope = str(x.location_scope);
  checks.location_banner = hasBanner;
  checks.location_restriction = hasLimit ? x.location_restriction : null;
  checks.location_scope = scope;
  // The Location gate now answers 'unknown' (REVIEW) when nothing decides it,
  // so this is no longer a blocker: the panel says what is missing instead of
  // refusing to score. It stays a note.

  return { blockers: blockers, notes: [], checks: checks };
}

// The merged report a caller actually uses. `x` is optional: before the model
// call only the text checks can run. `after_model` records which stage this is,
// because "nothing was sent to the model" is only true of the first one.
// `skipTextChecks` is for a hand-selected run: there is no banner to miss and
// no selector to blame when the user chose the text themselves.
export function coverageReport(page, x, opts, verification) {
  const skip = !!(opts && opts.skipTextChecks);
  const base = extractionIssues(page);
  // Keep the checks and notes even when the blockers do not apply, so the
  // report still says what the page gave us.
  const a = skip ? { blockers: [], notes: base.notes, checks: base.checks } : base;
  const b = x ? factCrossChecks(page, x, verification) : { blockers: [], notes: [], checks: {} };
  // Once the model has read who may apply from the posting text itself, a banner
  // the selectors missed no longer undermines the Location gate.
  const elig = x && (x.eligibility_home || x.eligibility_ky);
  const modelKnowsEligibility = elig === 'yes' || elig === 'no';
  const keep = (bl) => !(modelKnowsEligibility && bl.id === 'location_banner_missing');
  return {
    blockers: a.blockers.filter(keep).concat(b.blockers),
    notes: a.notes.concat(b.notes),
    checks: Object.assign({}, a.checks, b.checks),
    after_model: !!x,
  };
}

/* Which gate a blocker can actually undermine. A missing location banner
   cannot change a Title or Pay finding, and an unread pay paragraph cannot
   change a Location finding. '*' means the text is too broken for any gate.
   An id that is not listed here is treated as '*' - a blocker nobody has
   classified is not a blocker to be clever about. */
export const BLOCKER_BLAST = {
  body_too_short: '*',
  pane_missing: '*',
  pane_stale: '*',
  collapsed: '*',
  location_banner_missing: ['Location'],
  no_location_anywhere: ['Location'],
  pay_outside_description: ['Pay'],
  pay_not_extracted: ['Pay'],
};

// Stop before the model call only when there is nothing worth reading.
export function coverageHaltsEarly(report) {
  return ((report && report.blockers) || []).some((b) => {
    const blast = BLOCKER_BLAST[b.id];
    return !blast || blast === '*';
  });
}

// A SKIP decided by a gate the blockers do not touch is still a SKIP: this
// run could only have been wrong in the direction of a missed APPLY, and the
// warning list says so. An APPLY is never trusted while anything is
// unresolved, because that is the direction where missing text bites.
export function coverageTolerable(report, result) {
  const blockers = (report && report.blockers) || [];
  if (!blockers.length) return false;
  const implied = new Set();
  for (const b of blockers) {
    const blast = BLOCKER_BLAST[b.id];
    if (!blast || blast === '*') return false;
    blast.forEach((g) => implied.add(g));
  }
  if (!result || result.verdict !== 'SKIP') return false;
  return !implied.has(result.fail_gate);
}

// Back-compat: the flat list of messages the debug report and tests use.
export function extractionWarnings(page) {
  const r = extractionIssues(page);
  return r.notes.concat(r.blockers.map((b) => b.message));
}

export function coverageAsText(report, page) {
  const lines = ['JobScore: NO SCORE - the page text was not captured well enough to trust a verdict.'];
  lines.push('URL: ' + ((page && page.url) || ''));
  (report.blockers || []).forEach((b) => lines.push('  BLOCKER ' + b.message));
  (report.notes || []).forEach((n) => lines.push('  note    ' + n));
  const c = report.checks || {};
  lines.push('  site=' + c.site + ' selector=' + c.selector +
    ' body=' + c.body_chars + ' chars page=' + c.page_chars + ' chars');
  lines.push('  location banner=' + JSON.stringify(c.location_banner) +
    ' ld=' + JSON.stringify(c.location_from_ld) +
    ' limit=' + JSON.stringify(c.location_restriction) +
    ' scope=' + JSON.stringify(c.location_scope));
  lines.push('  pay lines on page=' + c.pay_lines_on_page +
    ' in description=' + c.pay_lines_in_description +
    ' base=' + JSON.stringify(c.base_min) + '-' + JSON.stringify(c.base_max));
  if (page) lines.push('  page location: ' + JSON.stringify(page.location || '') + '  title: ' + JSON.stringify(page.title || ''));
  return lines.join('\n');
}
