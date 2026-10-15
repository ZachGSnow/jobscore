// Reports for when a selector misses. Both copy their output to the clipboard
// so it can be pasted straight back into a bug report.
import { get } from 'svelte/store';
import { log } from './core/util.js';
import { modelFor } from './core/settings.js';
import { CARD_SELECTOR } from './extract/cards.js';
import { cleanNodeText } from './extract/dom.js';
import { cssPathOf, rankDescriptionCandidates } from './extract/debugtools.js';
import { extractPosting } from './extract/posting.js';
import { coverageReport, extractionWarnings, pageFullText } from './extract/coverage.js';
import { shouldAutoScore } from './extract/policy.js';
import { siteFor } from './extract/sites.js';
import { safeQueryAll } from './extract/dom.js';
import { host } from './ui/host.js';
import { copyText, session, settings, ui } from './ui/state.js';

export function selectorDebugReport() {
  const lines = [];
  const hostname = location.hostname;
  const site = siteFor(hostname);
  const page = extractPosting(document, window);
  // The coverage checks need the whole page; the debug report is exactly the
  // place a missing location banner should be visible.
  page.full_text = pageFullText(document);
  const s = get(settings);
  const hostEl = document.getElementById('jobscore-host');
  const rect = hostEl ? hostEl.getBoundingClientRect() : null;

  lines.push('JobScore selector report');
  lines.push('version: ' + (typeof GM_info === 'object' && GM_info.script ? GM_info.script.version : '?'));
  lines.push('url: ' + location.href);
  lines.push('hostname: ' + hostname);
  lines.push('SITE_SELECTORS entry: ' + (site ? site.name : 'NONE - generic fallback in use'));
  lines.push('provider/model: ' + s.model.provider + ' / ' + modelFor(s));
  lines.push('panel host present: ' + !!hostEl + (rect ? ' at ' + Math.round(rect.left) + ',' + Math.round(rect.top) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) : ''));
  lines.push('');
  lines.push('chosen description selector: ' + (page.selector_used || 'none') + '  (' + page.body_length + ' chars)');
  lines.push('header scoped to details pane: ' + !!page.pane_scoped);
  if (page.strict) {
    lines.push('strict site: pane found=' + page.pane_found + ' | pane shows the URL\'s job=' + !page.pane_stale +
      ' | job key=' + (page.job_key || 'none') + ' | pay block=' + (page.pay_block ? page.pay_block.length + ' chars' : 'NOT CAPTURED'));
    const cards = safeQueryAll(document, CARD_SELECTOR);
    lines.push('result cards found: ' + cards.length + ' | dimmed by a cheap gate: ' + cards.filter((c) => c.getAttribute('data-jobscore-skip')).length);
  }
  lines.push('title:    ' + JSON.stringify(page.title));
  lines.push('company:  ' + JSON.stringify(page.company));
  lines.push('location: ' + JSON.stringify(page.location));
  lines.push('ld+json:  ' + JSON.stringify(page.ld || {}).slice(0, 400));
  lines.push('warnings: ' + JSON.stringify(extractionWarnings(page)));
  const cov = coverageReport(page);
  lines.push('coverage blockers: ' + (cov.blockers.length ? cov.blockers.map((b) => b.id).join(', ') : 'none'));
  cov.blockers.forEach((b) => lines.push('   ' + b.id + ': ' + b.message));
  lines.push('coverage checks: ' + JSON.stringify(cov.checks));
  lines.push('');

  if (site) {
    for (const group of ['description', 'title', 'company', 'location', 'locationAll']) {
      lines.push('-- ' + group + ' candidates');
      for (const sel of (site[group] || [])) {
        let el = null;
        try { el = document.querySelector(sel); } catch (e) { el = null; }
        const n = el ? cleanNodeText(el).length : 0;
        lines.push('   ' + (el ? 'MATCH ' + String(n).padStart(6) : 'no       ') + '  ' + sel);
      }
    }
    lines.push('');
  } else {
    lines.push('-- no site entry; add one to SITE_SELECTORS (src/extract/sites.js)');
    lines.push('');
  }

  // Every candidate the description picker considered, in the order it ranks
  // them: characters / posting signals / score / selector.
  lines.push('-- description candidates, best first (chars / signals / score / site selector?)');
  rankDescriptionCandidates(document, site).slice(0, 12).forEach((c) => {
    lines.push('   ' + String(c.chars).padStart(6) + ' / ' + c.signals + ' / ' +
      String(c.score).padStart(6) + ' / ' + (c.generic ? 'generic ' : 'SITE    ') + c.selector);
  });
  lines.push('');

  // Largest text blocks on the page, so a better selector can be picked.
  const blocks = [];
  document.querySelectorAll('main, article, [role="main"], div, section').forEach((el) => {
    const text = (el.innerText || '').trim();
    if (text.length < 400) return;
    blocks.push({ el, len: text.length, paras: el.querySelectorAll('p, li').length });
  });
  blocks.sort((a, b) => (b.len + b.paras * 40) - (a.len + a.paras * 40));
  lines.push('-- largest text blocks (len / <p>+<li> / selector)');
  blocks.slice(0, 8).forEach((b) => {
    lines.push('   ' + String(b.len).padStart(6) + ' / ' + String(b.paras).padStart(4) + ' / ' + cssPathOf(b.el));
  });
  lines.push('');
  lines.push('-- first 500 chars of the text we send to the model');
  lines.push(page.body.slice(0, 500));

  const report = lines.join('\n');
  log(report);
  copyText(report);
  return report;
}

export function diagnosePanel() {
  const rect = host.el ? host.el.getBoundingClientRect() : null;
  const sess = get(session);
  const s = get(settings);
  const lines = [
    'JobScore panel diagnosis',
    'url: ' + location.href,
    'host in DOM: ' + !!document.getElementById('jobscore-host') + ' (attached: ' + !!(host.el && document.documentElement.contains(host.el)) + ')',
    're-mounts after the page removed it: ' + host.remounts,
    'shadow root: ' + !!(host.shadow && host.shadow.host),
    'stylesheets: ' + (host.adopted ? 'adoptedStyleSheets (CSP-safe)' : '<style> element (may be blocked by CSP)'),
    'rect: ' + (rect ? Math.round(rect.left) + ',' + Math.round(rect.top) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height) : 'none'),
    'state: ' + sess.status + (sess.error ? ' (' + sess.error + ')' : ''),
    'provider/model: ' + s.model.provider + ' / ' + modelFor(s),
    'auto-score: ' + s.general.autoScore + ' | all-sites: ' + s.general.allSites,
    'should auto-score this page: ' + shouldAutoScore(extractPosting(document, window)),
    'in a frame: ' + (window.top !== window.self),
    'saved position: ' + JSON.stringify(host.pos),
    'collapsed: ' + get(ui).collapsed,
  ];
  const report = lines.join('\n');
  log(report);
  copyText(report);
  return report;
}
