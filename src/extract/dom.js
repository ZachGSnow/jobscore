import { esc, num, str } from '../core/util.js';

export function trySelectors(root, selectors) {
  if (!selectors) return null;
  for (const sel of selectors) {
    let el = null;
    try { el = root.querySelector(sel); } catch (e) { el = null; }
    if (el) {
      const text = cleanNodeText(el);
      if (text) return { el, text, selector: sel };
    }
  }
  return null;
}

// For a header field the page repeats (Workday lists every location a
// requisition covers): collect every match and join, so the second and third
// lines are not silently dropped in favour of the first.
export function trySelectorsJoined(root, selectors, max) {
  if (!selectors) return null;
  for (const sel of selectors) {
    const parts = [];
    for (const el of safeQueryAll(root, sel)) {
      const text = cleanNodeText(el);
      // Workday renders the same location in nested elements; keep each once.
      if (text && !parts.includes(text)) parts.push(text);
      if (parts.length >= (max || 6)) break;
    }
    if (parts.length) return { el: null, text: parts.join(' / '), selector: sel };
  }
  return null;
}

// A scraped field block can carry its own label as text: Workday's locations
// <dl> renders "locations" before the values, so the value would start with
// the field name.
export function stripLocationLabel(text) {
  const s = String(text || '').trim();
  // The label may be any case, but the value after it must actually start like
  // a place: /i would make the [A-Z] check case-insensitive too, so it is a
  // separate test.
  const m = /^(?:locations?|work\s+location)\s*/i.exec(s);
  if (m && /[A-Z]/.test(s.charAt(m[0].length))) return s.slice(m[0].length).trim();
  return s;
}

export function safeQueryAll(root, sel) {
  try { return Array.from(root.querySelectorAll(sel)); } catch (e) { return []; }
}

// Picking the description is the one place where "first selector match" is not
// good enough. On a LinkedIn search page the left-hand results list comes first
// in the DOM and its cards carry the same data-testid as the open posting, so a
// ~600 character card snippet would win and the model would never see the
// Compensation or Location lines. Candidates are therefore scored on whether
// they look like a whole posting, not on DOM order or raw length.
export const POSTING_SIGNALS = [
  /responsibilit/i,
  /qualification|requirements?\b/i,
  /compensation|salary|pay range|base pay|hourly rate/i,
  /location|remote|hybrid|on-?site/i,
  /\byears?\b|\bexperience\b/i,
];
// Page-wide fallback, tried in order, only when the site selectors miss.
// The id/class substring entries catch the very common naming used by job
// boards that are not in SITE_SELECTORS yet (Built In uses #job-post-body-<id>).
export const GENERIC_DESC_SELECTORS = [
  'main', 'article', '[role="main"]',
  '[id*="job-description"]', '[id*="jobDescription"]', '[id*="job-description-body"]',
  '[id*="job-post-body"]', '[id*="jobPosting"]', '[id*="job-body"]',
  '[class*="job-description"]', '[class*="jobDescription"]', '[class*="job-post-body"]',
  '[class*="job-details"]', '[class*="posting-description"]',
  'body > div', 'body',
];

export function postingSignalCount(text) {
  return POSTING_SIGNALS.filter((re) => re.test(text)).length;
}

// A candidate is "strong" when it is long enough to be a whole posting AND
// reads like one (sections, pay, location, experience). A card snippet fails
// this; a real description passes.
export function looksLikeFullPosting(text) {
  if (!text) return false;
  if (text.length >= 3000) return true;
  return text.length >= 1200 && postingSignalCount(text) >= 3;
}

export function candidateScore(c) {
  // Length helps, but only up to a point: past ~6000 characters a block is
  // probably page chrome, so posting signals decide from there.
  return Math.min(c.text.length, 6000) + 1500 * postingSignalCount(c.text);
}

// First element matching any selector, in priority order. No text read.
export function firstEl(root, selectors) {
  for (const sel of (selectors || [])) {
    const hit = safeQueryAll(root, sel)[0];
    if (hit) return hit;
  }
  return null;
}

export function pickDescription(doc, site, opts) {
  let best = null;
  const consider = (el, selector, generic) => {
    if (!el) return;
    let text;
    try { text = nodeTextLoose(el); } catch (e) { return; }
    if (!text || text.length < 200) return;
    const c = { el, text, selector, generic: !!generic };
    if (!best || candidateScore(c) > candidateScore(best)) best = c;
  };

  // Pass 1: the site's own selectors, in priority order. Stop as soon as one
  // of them yields a whole posting.
  for (const sel of ((site && site.description) || [])) {
    for (const el of safeQueryAll(doc, sel)) consider(el, sel, false);
    if (best && looksLikeFullPosting(best.text)) return best;
  }
  if (best && looksLikeFullPosting(best.text)) return best;

  // Pass 2: page-wide fallback, only when no site selector found a posting.
  // A strict site never falls back to the page: on a search page that would
  // hand the model the results list and score the wrong job.
  if (opts && opts.noGeneric) return best;
  for (const sel of GENERIC_DESC_SELECTORS) {
    for (const el of safeQueryAll(doc, sel)) consider(el, sel, true);
    if (best && looksLikeFullPosting(best.text)) return best;
  }
  return best;
}

// Walk up from the description until we reach the container that also holds
// the job's header link: that is the details pane, found without relying on
// class names. The header is ABOVE the description, so only a link that comes
// before it counts; "similar jobs" links below the posting would otherwise stop
// the walk one level short of the header (LinkedIn's /jobs/view/ page).
export function closestPaneWithJobLink(el, site) {
  let node = el;
  const doc = (el && el.ownerDocument) || document;
  const precedes = (a) => !!(a.compareDocumentPosition(el) & 4);
  for (let i = 0; i < 12 && node && node !== doc.body && node !== doc.documentElement; i++) {
    if (site && site.pane) {
      const hit = site.pane.some((sel) => {
        try { return node.matches(sel); } catch (e) { return false; }
      });
      if (hit) return node;
    }
    try {
      if (node.querySelectorAll && Array.from(node.querySelectorAll('a[href*="/jobs/view/"]')).some(precedes)) return node;
    } catch (e) { /* ignore */ }
    node = node.parentElement;
  }
  return null;
}

export const JUNK_SELECTOR_LIST = [
  'script', 'style', 'noscript', 'svg', 'iframe', 'form', 'nav', 'footer',
  '[role="navigation"]', '[role="banner"]',
  '[class*="cookie"]', '[id*="cookie"]', '[class*="apply-form"]', '[id*="apply-form"]',
];
export const JUNK_SELECTORS = JUNK_SELECTOR_LIST.concat(['[aria-hidden="true"]']).join(',');
// The same list without the aria-hidden rule. Design systems use aria-hidden
// as a rendering trick (Workday marks containers hidden while they hydrate),
// so stripping it can delete the whole description and report "0 chars" on a
// page that visibly has one. Used only as a second attempt.
export const JUNK_SELECTORS_KEEP_ARIA = JUNK_SELECTOR_LIST.join(',');

// Markers that start a "not part of this posting" tail. Everything from the
// first hit onward is cut.
export const CUT_MARKERS = [
  /^\s*similar jobs\b/i,
  /^\s*recommended (?:jobs|for you)\b/i,
  /^\s*related jobs\b/i,
  /^\s*people also viewed\b/i,
  /^\s*other jobs you may like\b/i,
  /^\s*jobs you may like\b/i,
  /^\s*more jobs\b/i,
  /^\s*apply for this job\b/i,
];

export const JUNK_LINE_RES = [
  /equal (?:employment )?opportunity|eeo\b/i,
  /\bcookie (?:policy|settings|preferences)\b/i,
  /\bprivacy (?:policy|notice)\b/i,
  /\bterms of (?:use|service)\b/i,
  /^\s*(?:sign in|join now|create an account)\s*$/i,
  // LinkedIn chrome that lives inside the job pane itself.
  /^\s*show match details\s*$/i,
  /^\s*is this information helpful\?\s*$/i,
  /^\s*your profile and resume match\b/i,
  /^\s*(?:easy )?apply(?: for this job)?\s*$/i,
  /^\s*save\s*$/i,
  /^\s*beta\s*[\u2022\u00B7]\s*is this information helpful\?\s*$/i,
];

// innerText on a DETACHED clone has no layout to consult, so per spec it
// returns plain textContent: every block boundary vanishes and a header reads
// "NewRocket\u00b73.0Vista, CA\u2022Remote". This walks the tree and puts a line
// break at each block boundary instead, so a clone reads like the page does.
export const BLOCK_TAG_RE = /^(?:ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;
export function blockText(node) {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { out.push(String(n.nodeValue).replace(/\s+/g, ' ')); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { out.push('\n'); return; }
    const block = BLOCK_TAG_RE.test(tag);
    if (block) out.push('\n');
    else if (tag === 'TD' || tag === 'TH') out.push(' ');
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (block) out.push('\n');
  };
  walk(node);
  return out.join('');
}

export function cleanNodeText(el, opts) {
  if (!el) return '';
  let clone;
  try { clone = el.cloneNode(true); } catch (e) { return (el.innerText || '').trim(); }
  const junk = (opts && opts.keepAriaHidden) ? JUNK_SELECTORS_KEEP_ARIA : JUNK_SELECTORS;
  try {
    clone.querySelectorAll(junk).forEach((n) => n.remove());
  } catch (e) { /* ignore */ }
  let raw = '';
  try { raw = blockText(clone); } catch (e) { raw = ''; }
  if (!raw.trim()) raw = clone.innerText || clone.textContent || '';
  return cleanText(raw.replace(/\u00a0/g, ' '));
}

// Read a node, falling back to a pass that keeps aria-hidden content when the
// first pass comes back empty. Only for the description, where an empty result
// is the difference between scoring and refusing.
export function nodeTextLoose(el) {
  let text = '';
  try { text = cleanNodeText(el); } catch (e) { text = ''; }
  if (text && text.length >= 200) return text;
  let loose = '';
  try { loose = cleanNodeText(el, { keepAriaHidden: true }); } catch (e) { loose = ''; }
  return loose.length > text.length ? loose : text;
}

export function cleanText(raw) {
  let lines = String(raw || '')
    // Workday prints "&nbsp;" as literal text in the company name, so the
    // entity survives as four characters.
    .replace(/&nbsp;|&#160;|&#x?a0;/gi, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim());

  // Cut the related-jobs tail. A marker is only a tail when real text comes
  // before it: Lever prints an "Apply for this job" button ABOVE the posting,
  // and cutting there kept the 140-character header and dropped the job.
  const total = lines.reduce((n, l) => n + l.length, 0);
  let before = 0;
  for (let i = 0; i < lines.length; i++) {
    if (CUT_MARKERS.some((re) => re.test(lines[i])) && (before >= 300 || before >= total / 2)) {
      lines = lines.slice(0, i);
      break;
    }
    before += lines[i].length;
  }
  lines = lines.filter((l) => {
    if (!l) return false;
    if (JUNK_LINE_RES.some((re) => re.test(l))) return false;
    return true;
  });
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function readLdJson(doc) {
  const out = {};
  const nodes = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object') return;
    const type = node['@type'];
    const isJob = type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    if (isJob) {
      out.title = str(node.title) || out.title;
      const org = node.hiringOrganization;
      out.company = str(org && (org.name || org)) || out.company;
      const loc = Array.isArray(node.jobLocation) ? node.jobLocation[0] : node.jobLocation;
      const addr = loc && loc.address;
      if (addr) {
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry && (addr.addressCountry.name || addr.addressCountry)]
          .map(str).filter(Boolean);
        out.location = parts.join(', ') || out.location;
      }
      out.jobLocationType = str(node.jobLocationType) || out.jobLocationType;
      const sal = node.baseSalary && (node.baseSalary.value || node.baseSalary);
      if (sal && typeof sal === 'object') {
        const lo = num(sal.minValue, null);
        const hi = num(sal.maxValue, null);
        const one = num(sal.value, null);
        const unit = str(sal.unitText) || 'YEAR';
        if (lo !== null || hi !== null || one !== null) {
          out.salary = [lo !== null ? String(lo) : '', hi !== null ? String(hi) : '', one !== null ? String(one) : '']
            .filter(Boolean).join('-') + ' ' + (str(node.baseSalary.currency) || str(sal.currency) || 'USD') + '/' + unit;
        }
      }
      out.datePosted = str(node.datePosted) || out.datePosted;
      if (node.description) out.description = cleanText(String(node.description).replace(/<[^>]+>/g, '\n'));
    }
    if (node['@graph']) visit(node['@graph']);
    if (node.mainEntity) visit(node.mainEntity);
  };
  for (const s of nodes) {
    try { visit(JSON.parse(s.textContent)); } catch (e) { /* ignore bad json-ld */ }
  }
  return out;
}
