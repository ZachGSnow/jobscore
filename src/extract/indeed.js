import { cleanNodeText, firstEl, safeQueryAll } from './dom.js';

/* ------------------------------ Indeed: the open job's header
   On the two-pane search page the header is a handful of bare divs inside
   [data-testid="company-info-metadata"]:

      NewRocket  (the /cmp/ link)  \u00b7  3.0  (rating)
      Vista, CA  \u2022  Remote

   Nothing marks the location row, so it is read as "what is left in that
   block once the company link, the rating and the bullet separators are
   removed". The company link also carries fromjk=<job key>, which is how the
   pane proves it is showing the job the URL (vjk) says it is.
   ------------------------------------------------------------------------ */
export function indeedHeader(pane) {
  const meta = firstEl(pane, ['[data-testid="company-info-metadata"]']);
  if (!meta) return null;
  const link = safeQueryAll(meta, 'a[href*="/cmp/"]')[0];
  // Without the company link there is no way to tell the company line from
  // the location line, so no location is better than a wrong one.
  if (!link) return { location: null, company: null, jobKey: null };
  const company = cleanNodeText(link);
  const href = String(link.getAttribute('href') || '');
  const jobKey = (/[?&]fromjk=([a-f0-9]+)/i.exec(href) || [])[1] || null;
  const lines = cleanNodeText(meta).split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => l !== company && !/^[\u00b7\u2022|]$/.test(l) && !/^\d(?:\.\d)?$/.test(l));
  return { location: lines.join(' \u2022 ') || null, company: company || null, jobKey: jobKey };
}

// The job key the URL is pointing at. Indeed's two-pane page puts it in vjk.
export function urlJobKey(url) {
  try {
    const u = new URL(url);
    // Indeed: vjk / jk. LinkedIn: currentJobId on search pages, /jobs/view/<id> otherwise.
    return u.searchParams.get('vjk') || u.searchParams.get('jk') || u.searchParams.get('currentJobId') ||
      (/\/jobs\/view\/(?:[^/]*?-)?(\d+)/.exec(u.pathname) || [])[1] || null;
  } catch (e) { return null; }
}
