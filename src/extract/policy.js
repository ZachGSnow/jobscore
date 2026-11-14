import { LIMITS } from '../core/config.js';
import { getSettings } from '../core/settings.js';
import { siteFor, siteForUrl } from './sites.js';
import { postingSignalCount } from './dom.js';

/* ------------------------------------------------- sites we do not list
   With the catch-all @match line this script runs everywhere, so it needs a
   cheap way to decide whether a page is worth a look. Auto-scoring on an
   unknown host needs either a job-ish URL or page text that reads like a
   whole posting. The panel is built on demand when neither is true, so Alt+1
   still works on any page.
   ------------------------------------------------------------------------ */

export const JOB_URL_RE = /\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies)|employment|opportunit(?:y|ies)|apply|roles?)(?:[\/?#]|$)/i;
export const JOB_HOST_BLOCKLIST = /(^|\.)(google|bing|duckduckgo|youtube|facebook|twitter|x|instagram|reddit|wikipedia|amazon|ebay|netflix|spotify|gmail|outlook|office|github|stackoverflow|chatgpt|claude|anthropic|localhost)\./i;
export const JOB_WORDS = ['apply', 'hiring', 'candidate', 'resume', 'requirements', 'responsibilities', 'qualifications', 'compensation', 'salary', 'benefits', 'position', 'role'];

export function isJobLikeUrl(url) {
  try { return JOB_URL_RE.test(new URL(url).pathname); } catch (e) { return false; }
}

export function hostBlocked(hostname) {
  return JOB_HOST_BLOCKLIST.test(String(hostname || ''));
}

// Text-based "is this a job posting" test, used only for unknown hosts.
export function looksLikeJobPage(page) {
  if (!page || !page.body || page.body.length < 800) return false;
  const body = page.body;
  const hits = JOB_WORDS.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(body)).length;
  return hits >= 4 && postingSignalCount(body) >= 3;
}

// Should this page be scored without being asked?
export function shouldAutoScore(page) {
  if (!page) return false;
  if (siteFor(page.host)) return !!siteForUrl(page.url);     // a listed site: on its job pages only
  if (!getSettings().general.allSites) return false;          // unknown host and ALL_SITES off
  if (hostBlocked(page.host)) return false;
  if (isJobLikeUrl(page.url)) return true;      // /jobs/... on a company site
  return looksLikeJobPage(page);                // some other URL, but it reads like a posting
}

// Is this URL worth a panel and a page watcher, before anything is read?
// Listed boards on their job pages, or a job-like URL on an unlisted host that
// all-sites allows and the blocklist does not rule out.
export function isWatchedUrl(url, settings) {
  if (siteForUrl(url)) return true;
  let host;
  try { host = new URL(url).hostname; } catch (e) { return false; }
  if (siteFor(host)) return false;              // a listed host, off its job pages
  const s = settings || getSettings();
  return !!s.general.allSites && !hostBlocked(host) && isJobLikeUrl(url);
}

// Why this page should NOT be auto-scored now, or '' when it should. The first
// score after load and every later page change both go through this one check.
export function autoScoreBlocker(page, settings) {
  const s = settings || getSettings();
  if (!s.general.autoScore) return 'auto-score is off';
  if (!page) return 'no page';
  if (hostBlocked(page.host)) return 'host is on the blocklist';
  if (page.body_length < LIMITS.MIN_DESC_CHARS) return 'posting not loaded yet';
  if ((page.strict && page.pane_found === false) || page.pane_stale) return 'pane not on this job yet';
  if (!shouldAutoScore(page)) return 'not a job posting';
  return '';
}

// Does this page embed a listed board in a frame? Greenhouse's embed (a
// #grnhse_app div that its script fills with the job_app iframe) and Ashby's
// (#ashby_embed) put the whole posting in a cross-origin frame, which the
// script also runs in and gives its own panel. Checked at load, so the markers
// the embed code starts from count as well as the frame itself.
export const EMBEDDED_BOARD_SELECTOR = [
  '#grnhse_app', '#grnhse_iframe', 'iframe[src*="greenhouse.io/embed"]', 'script[src*="greenhouse.io/embed"]',
  '#ashby_embed', 'iframe[src*="jobs.ashbyhq.com"]', 'script[src*="jobs.ashbyhq.com"]',
].join(', ');

export function embedsListedBoard(doc) {
  try { return !!(doc && doc.querySelector(EMBEDDED_BOARD_SELECTOR)); } catch (e) { return false; }
}
