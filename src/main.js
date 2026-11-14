// Entry point: decide whether this page deserves a panel, wire the menu, the
// hotkey and the navigation watchers, then get out of the way.
import { get } from 'svelte/store';
import { LIMITS } from './core/config.js';
import { modelFor } from './core/settings.js';
import { debounce, isTypingTarget, log } from './core/util.js';
import { extractPosting } from './extract/posting.js';
import { autoScoreBlocker, embedsListedBoard, hostBlocked, isWatchedUrl } from './extract/policy.js';
import { siteFor, siteForUrl } from './extract/sites.js';
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
  if (autoScoreBlocker(page, s)) return;     // loading, stale pane, blocklist, all-sites, not a posting
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
  GM_registerMenuCommand('JobScore: score this page', () => guarded('score this page', () => { ensurePanel(); startWatching(); patchUi({ collapsed: false, view: 'score' }); kickoffScore({ force: true }); }));
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
    // composedPath()[0] is the real element: e.target is retargeted to the host
    // of a shadow root, so typing in the panel's own fields (or a page's web
    // component input) would otherwise look like typing on the page.
    if (isTypingTarget(e)) return;
    e.preventDefault();
    if (which === 2) { togglePanel(); return; }
    // Alt+1: expand and score. A selection is scored on its own.
    guarded('score this page', () => {
      ensurePanel();
      startWatching();
      log('hotkey pressed');
      patchUi({ collapsed: false, view: 'score' });
      const sel = currentSelection();
      if (sel) kickoffScore({ mode: 'selection', selection: sel });
      else kickoffScore({ force: true });
    });
  }, true);
}

/* ------------------------------------------------------------------ boot */

let armed = false;
let watching = false;

// The page watcher and card labels. Alt+1 on an idle page starts them too, so a
// single-page careers site you chose to score keeps up when you move on.
function startWatching() {
  if (watching) return;
  watching = true;
  watchPage();
  setTimeout(scanCardsSafe, 800);
}

// Panel, page watcher and card labels. The first score goes through
// onMaybeChanged like every later one, so the blocklist, the all-sites setting
// and the "is this a posting" test apply from the start.
function arm() {
  if (armed) return;
  armed = true;
  ensurePanel();
  startWatching();
  onMaybeChanged();
}

// Arm on a job page, unless this careers page embeds a listed board (the
// posting then lives in the board's frame, which has its own panel).
function wantsPanel(listed) {
  if (!isWatchedUrl(location.href, get(settings))) return false;
  return !(window.top === window.self && !listed && embedsListedBoard(document));
}

function boot() {
  const hostname = location.hostname;
  const listed = !!siteForUrl(location.href);
  // The catch-all @match also loads this in every iframe on every page. A frame
  // is only worth a panel when it IS a listed job board (an embedded Greenhouse
  // board, say); an ad or a widget frame stays silent.
  if (window.top !== window.self && !listed) return;

  registerMenus();
  installHotkeys();
  hookHistory();

  const s = get(settings);

  const embedded = window.top === window.self && !listed && embedsListedBoard(document);
  if (isWatchedUrl(location.href, s) && !embedded) {
    // A job board's job pages, or a URL that looks like a job page.
    arm();
  } else if (embedded) {
    // A careers page that embeds a listed board (Greenhouse's job_app iframe):
    // the posting lives in the frame, and the frame gets the panel. Arming here
    // too gave two panels and two model calls for one job.
    log('idle on this page: the posting is in an embedded job-board frame, which has its own panel.');
  } else {
    // Stay out of the way: no panel, no observers. Alt+1 or the menu command
    // will set everything up and score whatever is here. Single-page sites
    // change the URL without a reload (LinkedIn's feed -> Jobs), so a move to
    // a job page arms it then.
    window.addEventListener('jobscore:locationchange', () => {
      setTimeout(() => { if (!armed && wantsPanel(!!siteForUrl(location.href))) arm(); }, 400);
    });
    log('idle on this page (not a listed job page and the URL is not job-like). Alt+1 or menu -> "score this page" to score it anyway.');
  }

  log('JobScore ready. Provider:', s.model.provider, '| model:', modelFor(s),
    '| site:', siteFor(hostname) ? siteFor(hostname).name + (listed ? '' : ' (not a job page)') : 'unlisted',
    '| auto-score:', s.general.autoScore, '| all-sites:', s.general.allSites);
}

if (typeof document !== 'undefined' && document.documentElement) boot();
