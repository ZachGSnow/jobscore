// The floating host element: an inline-styled box appended to <html>, carrying
// the shadow root. Position and size are set with CSSOM assignments, which a
// page Content-Security-Policy cannot block (unlike a <style> element), so the
// panel stays visible even on sites that refuse inline styles.
import { getv, setv } from '../core/gm.js';
import { log } from '../core/util.js';

export const host = {
  el: null,
  shadow: null,
  root: null,
  pos: getv('pos', null),          // {x, y} in viewport pixels
  adopted: false,
  remounts: 0,
  maximized: false,
};

export function createHost(cssText) {
  const el = document.createElement('div');
  el.id = 'jobscore-host';
  const s = el.style;
  s.position = 'fixed';
  s.top = '16px';
  s.right = '16px';
  s.left = 'auto';
  s.zIndex = '2147483000';
  s.display = 'block';
  s.width = 'auto';
  s.height = 'auto';
  s.maxWidth = 'none';
  s.maxHeight = 'none';
  s.margin = '0';
  s.padding = '0';
  s.overflow = 'visible';
  s.opacity = '1';
  s.visibility = 'visible';
  s.pointerEvents = 'auto';

  host.el = el;
  host.shadow = el.attachShadow({ mode: 'open' });
  applyStyles(cssText);
  host.root = document.createElement('div');
  host.root.id = 'jobscore-root';
  host.shadow.appendChild(host.root);
  // Appended to <html>, not <body>, so a framework re-render of body cannot
  // delete it (LinkedIn's React root lives in body).
  document.documentElement.appendChild(el);
  applyPosition();
  return host;
}

// Constructable stylesheets are not blocked by CSP. The <style> element is the
// fallback for engines without them.
function applyStyles(cssText) {
  try {
    if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in host.shadow) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      host.shadow.adoptedStyleSheets = [sheet];
      host.adopted = true;
      return;
    }
  } catch (e) { /* fall through to the <style> element */ }
  const style = document.createElement('style');
  style.textContent = cssText;
  host.shadow.appendChild(style);
  host.adopted = false;
}

// Where the panel may sit so that ALL of it is on screen. The panel is much wider
// expanded than as a pill, so a position saved while it was small must not push the
// expanded panel off the edge of the window.
function clampPos(x, y) {
  const w = Math.max(60, host.el.offsetWidth || 0);
  const h = Math.max(30, host.el.offsetHeight || 0);
  return {
    x: Math.max(0, Math.min(window.innerWidth - w, x)),
    y: Math.max(0, Math.min(window.innerHeight - h, y)),
  };
}

export function applyPosition() {
  if (!host.el || host.maximized) return;
  const s = host.el.style;
  if (host.pos && Number.isFinite(host.pos.x) && Number.isFinite(host.pos.y)) {
    const p = clampPos(host.pos.x, host.pos.y);
    s.left = p.x + 'px';
    s.top = p.y + 'px';
    s.right = 'auto';
  } else {
    s.top = '16px';
    s.right = '16px';
    s.left = 'auto';
  }
}

// A large overlay for the Jobs table. The saved position is only suspended, not
// lost, so shrinking the panel puts it back where you left it.
export function setMaximized(on) {
  if (!host.el) return;
  host.maximized = !!on;
  const st = host.el.style;
  if (on) {
    st.top = '2vh';
    st.left = '3vw';
    st.right = 'auto';
  } else {
    applyPosition();
  }
}

export function resetPosition() {
  host.pos = null;
  setv('pos', null);
  applyPosition();
}

// Drag by the handle. Buttons inside the handle keep working.
export function startDrag(e) {
  if (e.target && e.target.closest && e.target.closest('button')) return;
  const rect = host.el.getBoundingClientRect();
  const startX = e.clientX, startY = e.clientY, origX = rect.left, origY = rect.top;
  e.preventDefault();
  const onMove = (ev) => {
    const p = clampPos(origX + (ev.clientX - startX), origY + (ev.clientY - startY));
    const x = p.x, y = p.y;
    host.el.style.left = x + 'px';
    host.el.style.top = y + 'px';
    host.el.style.right = 'auto';
    host.pos = { x, y };
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mouseup', onUp, true);
    if (host.pos) setv('pos', host.pos);
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mouseup', onUp, true);
}

/* ---------------------------------------------------- keeping it on screen
   Some sites rebuild the document under us. Greenhouse's job board wipes the
   page about a second after load, which removed the panel and made it look
   like the script had failed. The shadow content survives (the element object
   is ours), so putting the host back is enough to restore the whole UI. */

export function ensureHostMounted() {
  if (!host.el) return false;
  try {
    if (document.documentElement.contains(host.el)) return false;
    document.documentElement.appendChild(host.el);
  } catch (e) {
    return false;
  }
  host.remounts++;
  log('the page removed the panel - re-mounted it (#' + host.remounts + ')');
  return true;
}

export function watchHost() {
  // Direct children of <html> only change when the site swaps out <body> or
  // wipes the document, so this observer stays quiet in normal use.
  try {
    const mo = new MutationObserver(() => ensureHostMounted());
    mo.observe(document.documentElement, { childList: true });
  } catch (e) { /* ignore */ }
  // Backstop for anything the observer misses.
  setInterval(() => {
    if (host.remounts > 50) return;   // something is actively fighting us; stop
    ensureHostMounted();
  }, 2000);
  window.addEventListener('pageshow', ensureHostMounted);
  window.addEventListener('load', ensureHostMounted);
}
