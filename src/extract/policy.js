import { getSettings } from '../core/settings.js';
import { siteFor } from './sites.js';
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
  if (siteFor(page.host)) return true;          // a listed site: always
  if (!getSettings().general.allSites) return false;          // unknown host and ALL_SITES off
  if (hostBlocked(page.host)) return false;
  if (isJobLikeUrl(page.url)) return true;      // /jobs/... on a company site
  return looksLikeJobPage(page);                // some other URL, but it reads like a posting
}
