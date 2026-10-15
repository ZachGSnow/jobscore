import { LIMITS } from '../core/config.js';
import { daysBetween, esc, str } from '../core/util.js';
import { siteFor } from './sites.js';
import { cleanNodeText, closestPaneWithJobLink, firstEl, looksLikeFullPosting, pickDescription, readLdJson, stripLocationLabel, trySelectors, trySelectorsJoined } from './dom.js';
import { urlJobKey } from './indeed.js';

/* ------------------------------ header fields from the body
   Sites we do not list have no selectors for the header, but ATS pages very
   often print the facts in the body itself:

     Job Title:\nJunior Solutions Engineer
     Location: Remote - US based candidates only

   These are labelled fields sent alongside the body; nothing here is scored
   directly, so a miss is cheap and a hit saves the model from guessing.
   ------------------------------------------------------------------------ */

export const BODY_TITLE_LABEL_RE = /^(?:job\s*title|job\s*position|position|job\s*role)\s*[:\-]\s*(.*)$/i;
export const BODY_LOCATION_LABEL_RE = /^(?:job\s*)?(?:location|work\s*location|office\s*location|based\s*in)\s*[:\-]\s*(.*)$/i;
export const NOT_A_TITLE_RE = /^(?:overview|summary|description|purpose|details|responsibilities|requirements|about|role|title)\s*:?$/i;

export function bodyLineValue(body, labelRe) {
  const lines = String(body || '').split('\n').map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const m = labelRe.exec(lines[i]);
    if (!m) continue;
    const clean = (v) => {
      const s = String(v || '').replace(/[|\u2022\u00B7].*$/, '').trim();
      if (s.length < 3 || s.length > 120) return null;
      if (s.endsWith(':')) return null;
      if (NOT_A_TITLE_RE.test(s)) return null;
      return s;
    };
    const inline = clean(m[1]);
    if (inline) return inline;
    // Label on its own line, value on the next one.
    for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
      const next = clean(lines[j]);
      if (next) return next;
    }
  }
  return null;
}

export function headerFromBody(body) {
  return {
    title: bodyLineValue(body, BODY_TITLE_LABEL_RE),
    location: bodyLineValue(body, BODY_LOCATION_LABEL_RE),
  };
}

// "Junior Solutions Engineer | Trellix" -> "Junior Solutions Engineer"
export function titleFromDocTitle(docTitle) {
  const first = String(docTitle || '').split(/\s[|\-\u2013\u2014]\s/)[0].trim();
  return first.length >= 3 ? first : null;
}

/* ------------------------------------------------------- employer from URL
   Not every board prints the employer. A Greenhouse posting can have no
   company element and no hiringOrganization in its ld+json, but the board
   path names the employer (/wasabi/jobs/1) - which is how a human reads it
   too. Used only when the header and the structured data both come back
   empty, and the panel says where the name came from.
   ------------------------------------------------------------------------ */

// Hosts that say where the posting lives, not who is hiring.
export const ATS_HOSTS = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workday\.com|icims\.com|smartrecruiters\.com|bamboohr\.com|jobvite\.com|workable\.com|recruitee\.com|taleo\.net|successfactors\.com|linkedin\.com|indeed\.com|builtin\.com|ziprecruiter\.com|glassdoor\.com)$/i;
// Tested against the slug both with spaces and collapsed, so an underscore in
// this list would never match anything.
export const URL_PATH_STOPWORDS = /^(jobs?|careers?|apply|boards?|jobboards|embed|jobapp|api|v\d+|position|positions|opening|openings|detail|details|view|home|index|en|us|external|internal)$/i;

// A TLD is not a company name, and neither is the two-letter tail of one.
export const TLD_WORDS = /^(com|net|org|co|io|gov|edu|ac|uk|us|ca|au|de|fr|nl|nz|ie)$/i;

export function companyFromSlug(slug) {
  const s = String(slug || '').replace(/[-_]+/g, ' ').trim();
  if (s.length < 2 || s.length > 40) return null;
  if (TLD_WORDS.test(s)) return null;
  if (/^[a-z]{2}(?:[\s-][a-z]{2})?$/i.test(s)) return null;   // en-US is a locale, not a company
  if (URL_PATH_STOPWORDS.test(s) || URL_PATH_STOPWORDS.test(s.replace(/\s+/g, ''))) return null;
  if (!/^[a-z0-9 ]+$/i.test(s)) return null;
  if (/\d/.test(s)) return null;   // ids and requisition numbers are not names
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function companyFromUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const segments = u.pathname.split('/').filter(Boolean);

  // Workday names its tenant in the subdomain (arcticwolf.wd1.myworkdayjobs.com),
  // and its paths are all locale/site/job-slug noise, so read it from there.
  const wd = /^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i.exec(host);
  if (wd) return companyFromSlug(wd[1]);

  if (ATS_HOSTS.test(host)) {
    // An embedded Greenhouse board hides the employer in a query param
    // (boards.greenhouse.io/embed/job_app?for=wasabi&token=123) and its path
    // is all housekeeping, so read the param before the path segments.
    for (const key of ['for', 'company']) {
      const name = companyFromSlug(u.searchParams.get(key) || '');
      if (name) return name;
    }
    // /wasabi/jobs/1 -> wasabi ; skip the housekeeping segments first.
    for (const seg of segments) {
      const name = companyFromSlug(seg);
      if (name) return name;
    }
    return null;
  }
  // careers.acme.com -> acme ; www.acme.com -> acme ; acme.co.uk -> acme.
  // Whichever label comes first after the housekeeping subdomain is the one
  // that names the employer, so the last label (the TLD) is never used.
  let labels = host.split('.');
  if (labels[0] === 'www') labels = labels.slice(1);
  if (labels.length < 2) return null;
  let candidate = labels[0];
  if (URL_PATH_STOPWORDS.test(candidate)) candidate = labels[1] || '';
  return candidate ? companyFromSlug(candidate) : null;
}
export function extractPosting(doc, win) {
  const host = (win && win.location && win.location.hostname) || (doc.location && doc.location.hostname) || '';
  const url = (win && win.location && win.location.href) || (doc.location && doc.location.href) || '';
  const site = siteFor(host);
  const strict = !!(site && site.strict);
  const ld = readLdJson(doc);

  // A strict site (Indeed's two-pane search) is read from the open job's pane
  // and nothing else. If the pane is not there yet the result is "not
  // captured", never a guess from the rest of the page.
  const paneRoot = strict ? firstEl(doc, site.paneRoot) : null;
  const root = strict ? paneRoot : doc;

  // 1. The description: the candidate that actually reads like a whole
  //    posting, so a results-list card snippet cannot win over the open one.
  let desc = root ? pickDescription(root, site, { noGeneric: strict }) : null;
  // 2. Scope the header fields to the details pane derived from that node.
  let pane = null;
  if (strict) pane = paneRoot;
  else if (desc && desc.el && site && site.paneFromDescription) pane = closestPaneWithJobLink(desc.el, site);
  if (!strict && !desc && site && site.pane) {
    const paneEl = trySelectors(doc, site.pane);
    if (paneEl) { pane = paneEl.el; desc = pickDescription(pane, site); }
  }

  // Many careers pages ship the whole posting in their schema.org JobPosting
  // data. When the selectors found only a fragment (or nothing), that is a better
  // source than a snippet, and it works on sites with no entry at all.
  const ldText = String(ld.description || '');
  if (!strict && ldText && looksLikeFullPosting(ldText) &&
      (!desc || (!looksLikeFullPosting(desc.text) && ldText.length > desc.text.length))) {
    desc = { el: null, text: ldText, selector: 'ld+json description', generic: false };
  }

  const scope = pane || doc;
  // A site-specific header reader (Indeed, LinkedIn), run inside the details pane.
  const hdr = (pane && site && typeof site.header === 'function') ? (site.header(pane) || {}) : {};
  const titleHit = site ? trySelectors(scope, site.title) : null;
  const companyHit = site ? trySelectors(scope, site.company) : null;
  const locationHit = site ? trySelectors(scope, site.location) : null;
  const locationAllHit = site ? trySelectorsJoined(scope, site.locationAll) : null;

  // Labelled side blocks that sit OUTSIDE the description but hold facts the
  // gates need (Indeed's "Job details" box carries the pay). They are sent
  // as their own sections, so the model sees them and quotes can verify.
  // On a strict site they are read from the open pane only; elsewhere from the
  // page (Ashby's left pane sits beside the description, not inside it).
  const blockParts = [];
  let payBlock = '';
  const blockRoot = strict ? pane : (pane || doc);
  if (site && site.blocks && blockRoot) {
    for (const b of site.blocks) {
      const el = firstEl(blockRoot, [b.selector]);
      const text = el ? cleanNodeText(el) : '';
      if (!text) continue;
      blockParts.push('=== ' + b.label + ' ===\n' + text);
      if (b.pay) payBlock = text;
    }
  }

  let descText = (desc && desc.text) || '';
  if (!strict) descText = descText || ld.description || '';
  let body = blockParts.length && descText
    ? blockParts.join('\n\n') + '\n\n=== JOB DESCRIPTION ===\n' + descText
    : (descText || blockParts.join('\n\n'));
  if (body.length > LIMITS.MAX_BODY_CHARS) body = body.slice(0, LIMITS.MAX_BODY_CHARS);

  const bodyHdr = headerFromBody(descText);
  // On a strict site a missing title stays missing. The h1 and the tab title
  // are the search page's own heading, not this job.
  const title = hdr.title || (titleHit && titleHit.text) || (strict ? '' : (ld.title || titleFromDocTitle(doc.title) || bodyHdr.title || (doc.title || '')));
  // The employer is not always in the header. Keep where it came from so the
  // panel can admit that a name was inferred rather than scraped.
  const headerCompany = hdr.company || (companyHit && companyHit.text) || (strict ? '' : ld.company) || '';
  const urlCompany = (headerCompany || strict) ? null : companyFromUrl(url);
  const company = headerCompany || urlCompany || '';
  const locationRaw = hdr.location || (locationAllHit && locationAllHit.text) || (locationHit && locationHit.text) || (strict ? '' : (ld.location || bodyHdr.location)) || '';
  const location = stripLocationLabel(locationRaw);
  // Workday's "locations" block can be a long list; keep it to a couple of lines.
  const locationLine = String(location).split('\n').slice(0, 3).join(' / ').slice(0, 300);

  // Does the open pane belong to the job the URL names? A mismatch means the
  // pane is still showing the previous job (or has not loaded the new one).
  const wantKey = (strict || (site && site.header)) ? urlJobKey(url) : null;
  const paneKey = hdr.jobKey || null;
  const paneStale = !!(wantKey && paneKey && wantKey !== paneKey);

  return {
    url,
    host,
    site: site ? site.name : 'generic',
    selector_used: (desc && desc.selector) || (blockParts.length ? 'pane blocks' : null),
    pane_scoped: !!pane,
    strict: strict,
    pane_found: strict ? !!paneRoot : null,
    pane_stale: paneStale,
    job_key: wantKey || paneKey || null,
    pay_block: payBlock,
    used_generic: !!(desc && desc.generic),
    title: str(title),
    company: str(company),
    company_source: headerCompany ? 'header' : (urlCompany ? 'url' : null),
    location: str(locationLine),
    tab_title: str(doc.title),
    body,
    body_length: body.length,
    ld,
    posted_days_ago: ld.datePosted ? daysBetween(ld.datePosted) : null,
    header_from_body: !!(bodyHdr.title || bodyHdr.location),
  };
}

// The haystack evidence quotes are checked against: exactly the text we send
// to the model, so a quote can never be "verified" against something the
// model never saw.
// The URL belongs in here: buildUserPrompt sends it as PAGE URL, and the
// company on an ATS board is usually only inferable from that path. Leaving it
// out meant a quote the model copied from the URL could never verify.
// The page's schema.org JobPosting facts as one line. Built In, Ashby and many
// careers pages state remote work and pay there and only in header chips, so it
// is sent to the model AND is part of the evidence haystack: a quote taken from
// it must verify, or the fact would be dropped as "quoted but not found".
export function structuredDataLine(page) {
  const ld = page && page.ld;
  if (!ld) return '';
  const bits = [];
  if (ld.title) bits.push('title=' + ld.title);
  if (ld.company) bits.push('company=' + ld.company);
  if (ld.location) bits.push('location=' + ld.location);
  if (ld.jobLocationType) bits.push('jobLocationType=' + ld.jobLocationType);
  if (ld.salary) bits.push('baseSalary=' + ld.salary);
  if (ld.datePosted) bits.push('datePosted=' + ld.datePosted);
  return bits.length ? 'STRUCTURED DATA (schema.org JobPosting): ' + bits.join(' | ') : '';
}

export function evidenceHaystack(page) {
  return [page.title, page.company, page.location, page.tab_title, page.url, structuredDataLine(page), page.body]
    .filter(Boolean).join('\n');
}
