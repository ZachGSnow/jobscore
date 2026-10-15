import { cleanNodeText, safeQueryAll } from './dom.js';

/* ------------------------------ LinkedIn: the open job's header
   Verified 2026-10-15 against saved signed-in pages (the two-pane search
   results page and a single /jobs/view/ page). LinkedIn's classes are hashed,
   but the posting section has a stable id that carries the job number:

      <div id="JobDetails_AboutTheJob_4479560761"> About the job ... </div>

   The header above it has no handles at all, only a fixed shape:

      [logo link] [company link "NinjaOne"]          (a[href*="/company/"])
      [title]  [Verified job badge]                   (a link on search pages,
                                                       plain text on /jobs/view/)
      "California, United States" . "22 hours ago" . "12 people clicked apply"
      [Remote] [Full-time]                            (chips linking to the job)

   So it is read by position: only elements that come BEFORE the posting
   section, inside the details pane, and never inside a results-list card.
   ------------------------------------------------------------------------ */

const WORKPLACE = /^(remote|hybrid|on-?site)$/i;

export function linkedinAbout(root) {
  return safeQueryAll(root, '[id^="JobDetails_AboutTheJob_"]')[0] || null;
}

export function linkedinHeader(pane) {
  const about = linkedinAbout(pane);
  if (!about) return null;
  const jobKey = (/JobDetails_AboutTheJob_(\d+)/.exec(about.id || '') || [])[1] || null;
  // Node.DOCUMENT_POSITION_FOLLOWING: `about` comes after the element.
  const before = (el) => !!(el.compareDocumentPosition(about) & 4) && !el.closest('li');
  const text = (el) => cleanNodeText(el).replace(/\s+/g, ' ').trim();

  const companyLink = safeQueryAll(pane, 'a[href*="/company/"]').find((a) => before(a) && text(a));
  const company = companyLink ? text(companyLink) : null;

  // Title: a /jobs/view/ link with text (search page), else the paragraph that
  // carries the Verified-job badge (single page). Unverified postings have no
  // badge, so the caller falls back to the tab title.
  let title = null;
  const titleLink = safeQueryAll(pane, 'a[href*="/jobs/view/"]').find((a) => before(a) && text(a) && !WORKPLACE.test(text(a)) && !/^(full-time|part-time|contract|internship|temporary)$/i.test(text(a)));
  if (titleLink) title = text(titleLink);
  if (!title) {
    const badge = safeQueryAll(pane, '[aria-label="Verified job"]').find(before);
    const p = badge && badge.closest('p, h1, h2');
    if (p) title = text(p) || null;
  }

  // Location: the first part of the "place . posted . applicants" line.
  let location = null;
  const meta = safeQueryAll(pane, 'p').find((p) => before(p) && /\bago\b/i.test(p.textContent) && p.querySelector('span'));
  if (meta) {
    const first = safeQueryAll(meta, 'span').map(text).find((s) => s && !/\bago\b/i.test(s) && !/\bapplicants?|clicked apply\b/i.test(s));
    location = first || null;
  }
  // Workplace chips ("Remote", "Hybrid", "On-site") sit under the header.
  const chips = safeQueryAll(pane, 'a[href*="/jobs/"] span, button span').filter(before).map(text).filter((s) => WORKPLACE.test(s));
  const workplace = chips[0] || null;
  if (workplace) location = location ? location + ' / ' + workplace : workplace;

  return { title, company, location, jobKey };
}
