// Entry point: decide whether this page deserves a panel, wire the menu, the
// hotkey and the navigation watchers, then get out of the way.
import { get } from 'svelte/store';
import { LIMITS } from './core/config.js';
import { modelFor } from './core/settings.js';
import { debounce, log } from './core/util.js';
import { extractPosting } from './extract/posting.js';
import { hostBlocked, isJobLikeUrl, shouldAutoScore } from './extract/policy.js';
import { siteFor } from './extract/sites.js';
import { ensurePanel, panelIsUp } from './ui/mount.js';
import {
  currentSelection, isBusy, isSameSignature, kickoffScore, pageSignature, patchUi,
  rememberSignature, scanCardsSafe, session, settings, ui,
} from './ui/state.js';

/* ------------------------------------------------------------ navigation */

function hookHistory() {
  for (const fn of ['pushState', 'replaceState']) {
    const orig = history[fn];
    if (typeof orig !== 'function' || orig.__jobscore) continue;
    const patched = function () {
      const r = orig.apply(this, arguments);
      window.dispatchEvent(new Event('jobscore:locationchange'));
      return r;
    };
    patched.__jobscore = true;
    history[fn] = patched;
  }
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('jobscore:locationchange')));
}

const onMaybeChanged = debounce(() => {
  const s = get(settings);
  if (!s.general.autoScore) return;
  if (isBusy()) return;
  if (hostBlocked(location.hostname)) return;
  scanCardsSafe();
  const page = extractPosting(document, window);
  if (page.body_length < LIMITS.MIN_DESC_CHARS) return;                          // pane still loading
  if ((page.strict && page.pane_found === false) || page.pane_stale) return;      // pane not on this job yet (Indeed, LinkedIn)
  if (!shouldAutoScore(page)) return;                                             // not a job posting
  const sig = pageSignature(page);
  if (sig === undefined || isSameSignature(sig)) return;                          // same posting, already scored
  // Remember the signature before the attempt so a failed call (no key, no
  // network) is not retried on every mutation. Alt+1 still forces a retry.
  rememberSignature(sig);
  kickoffScore({});
}, LIMITS.DEBOUNCE_MS);

function watchPage() {
  window.addEventListener('jobscore:locationchange', () => {
    // The pane takes a moment to render after the URL changes.
    setTimeout(onMaybeChanged, 400);
  });
  const mo = new MutationObserver(() => onMaybeChanged());
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/* ----------------------------------------------------------- menu + keys */

// If the panel cannot be built on a page, say so instead of doing nothing.
function guarded(what, fn) {
  try {
    fn();
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    log('could not ' + what + ' on this page', e);
    window.alert('JobScore could not ' + what + ' on this page:\n\n' + msg + '\n\nThe page may be blocking it. It should work on an ordinary website; if it does not, copy this message.');
  }
}

function openPanel(patch) {
  guarded('open its panel', () => {
    ensurePanel();
    patchUi(Object.assign({ collapsed: false }, patch));
    log('panel opened (' + (patch && patch.view ? patch.view : 'score') + ')');
  });
}

// Alt+2: open the panel on any page, or close it again. Nothing is scored.
function togglePanel() {
  guarded('toggle its panel', () => {
    if (!panelIsUp()) { openPanel({ view: 'jobs' }); return; }
    const u = get(ui);
    if (!u.collapsed) { patchUi({ collapsed: true }); return; }
    // Re-open where you were if this page has a verdict; otherwise on your jobs.
    patchUi({ collapsed: false, view: get(session).result ? u.view : 'jobs' });
  });
}

// Three entries on purpose. Everything else (selector report, backups, cache,
// panel position) lives in the panel under Settings > Data.
function registerMenus() {
  if (typeof GM_registerMenuCommand !== 'function') return;
  GM_registerMenuCommand('JobScore: score this page', () => guarded('score this page', () => { ensurePanel(); patchUi({ collapsed: false, view: 'score' }); kickoffScore({ force: true }); }));
  GM_registerMenuCommand('JobScore: jobs and follow-ups', () => openPanel({ view: 'jobs' }));
  GM_registerMenuCommand('JobScore: settings', () => openPanel({ view: 'settings' }));
}

function installHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    // e.code as well as e.key: on a Mac, Alt+1 types a symbol and e.key is not "1".
    const which = (e.code === 'Digit1' || e.key === '1') ? 1 : ((e.code === 'Digit2' || e.key === '2') ? 2 : 0);
    if (!which) return;
    // Do not steal the hotkey from a text field (job boards have search boxes).
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    if (which === 2) { togglePanel(); return; }
    // Alt+1: expand and score. A selection is scored on its own.
    guarded('score this page', () => {
      ensurePanel();
      log('hotkey pressed');
      patchUi({ collapsed: false, view: 'score' });
      const sel = currentSelection();
      if (sel) kickoffScore({ mode: 'selection', selection: sel });
      else kickoffScore({ force: true });
    });
  }, true);
}

/* ------------------------------------------------------------------ boot */

function boot() {
  const hostname = location.hostname;
  const listed = !!siteFor(hostname);
  // The catch-all @match also loads this in every iframe on every page. A frame
  // is only worth a panel when it IS a listed job board (an embedded Greenhouse
  // board, say); an ad or a widget frame stays silent.
  if (window.top !== window.self && !listed) return;

  registerMenus();
  installHotkeys();
  hookHistory();

  const s = get(settings);
  const jobUrl = isJobLikeUrl(location.href);

  if (listed || jobUrl) {
    // A site we know, or a URL that looks like a job page.
    ensurePanel();
    watchPage();
    setTimeout(scanCardsSafe, 800);
    if (s.general.autoScore) setTimeout(() => kickoffScore({}), 600);
  } else {
    // Unknown page. Stay out of the way: no panel, no observers. Alt+1 or the
    // menu command will set everything up and score whatever is here.
    log('idle on this page (unknown host and the URL is not job-like). Alt+1 or menu -> "score this page" to score it anyway.');
  }

  log('JobScore ready. Provider:', s.model.provider, '| model:', modelFor(s),
    '| site:', listed ? siteFor(hostname).name : 'unlisted',
    '| auto-score:', s.general.autoScore, '| all-sites:', s.general.allSites);
}

if (typeof document !== 'undefined' && document.documentElement) boot();
