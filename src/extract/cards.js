import { DEFAULT_SETTINGS, getSettings } from '../core/settings.js';
import { clip, money, num, str } from '../core/util.js';
import { gate, locationGate, skipsVerdict, titleGate } from '../core/gates.js';
import { STATUS_LABEL } from '../core/jobs.js';
import { siteFor } from './sites.js';
import { cleanNodeText, safeQueryAll } from './dom.js';

/* ------------------------------ cheap gates on a results-list card
   A search page lists twenty or so cards with a title, a company, a place and
   often a pay chip. That is enough to rule a job OUT without opening it and
   without an API call. Only a definite fail counts: a card that shows no pay
   chip is not a posting with no pay (the figure may sit in the description),
   and "Remote in Vista, CA" does not say who may apply, so neither dims a card.
   ------------------------------------------------------------------------ */

// "$160,000 - $185,000 a year", "$30 an hour", "Up to $120,000 a year" ->
// the annualised top figure, or null when the chip is not a pay figure.
export function cheapPay(text) {
  const s = String(text || '');
  const figs = [];
  const re = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k)?/ig;
  let m;
  while ((m = re.exec(s))) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (m[2]) n *= 1000;
    if (Number.isFinite(n)) figs.push(n);
  }
  if (!figs.length) return null;
  const unit = /\b(?:an?|per)\s+(hour|day|week|month|year)\b|\b(hourly|daily|weekly|monthly|annually)\b/i.exec(s);
  const u = unit ? String(unit[1] || unit[2]).toLowerCase() : (Math.max.apply(null, figs) < 1000 ? 'hour' : 'year');
  const mult = { hour: 2080, hourly: 2080, day: 260, daily: 260, week: 52, weekly: 52, month: 12, monthly: 12, year: 1, annually: 1 }[u] || 1;
  return Math.round(Math.max.apply(null, figs) * mult);
}

// card = { title, location, pay }. Returns the first definite fail, or null.
export function cheapGates(card, cfg) {
  cfg = cfg || DEFAULT_SETTINGS;
  card = card || {};
  const title = str(card.title);
  const location = str(card.location);
  if (title) {
    const t = titleGate({ title: title, page_title: title }, cfg);
    if (skipsVerdict(t, cfg)) return t;
  }
  const floor = num(cfg.gates.pay.floor, DEFAULT_SETTINGS.gates.pay.floor);
  const top = cheapPay(card.pay);
  if (top !== null && top < floor && cfg.gates.pay.onFail === 'skip') {
    return gate('Pay', 'fail', 'Pay shown on the card tops out at ' + money(top) + ', under ' + money(floor), clip(card.pay, 80));
  }
  if (location) {
    const l = locationGate({
      title: title || '', page_title: title || '', page_location: location,
      work_arrangement: 'unclear', location_scope: 'unclear',
      _text: [title, location].filter(Boolean).join('\n'),
    }, cfg);
    if (skipsVerdict(l, cfg)) return l;
  }
  return null;
}

// One Indeed results-list card -> { title, company, location, pay } (any may be
// null). Only the structure seen on the saved search page is relied on:
// h3.jobTitle, [data-testid="company-name"], [data-testid="text-location"] and
// .salary-snippet-container. Anything missing is simply not judged.
export function cardFields(card) {
  const txt = (sel) => {
    const el = safeQueryAll(card, sel)[0];
    return el ? str(cleanNodeText(el)) : null;
  };
  return {
    title: txt('h3.jobTitle span[title], h3.jobTitle, [data-testid="jobTitle"]'),
    company: txt('[data-testid="company-name"]'),
    location: txt('[data-testid="text-location"]'),
    pay: txt('.salary-snippet-container, [data-testid*="salary-snippet"]'),
  };
}

// One LinkedIn results-list card. Verified 2026-10-15 against a saved signed-in
// search page (25 cards): the card is div[role=button] with
// componentkey="job-card-component-ref-<job id>", and its text paragraphs run
// title, company, place ("Texas, United States (Remote)"). The title paragraph
// holds a visible copy and a screen-reader copy that ends "(Verified job)", so
// only the first span is read. Pay, when shown, is a span like "$110K/yr - $125K/yr".
export function linkedinCardFields(card) {
  const ps = safeQueryAll(card, 'p').filter((p) => str(p.textContent));
  const text = (el) => (el ? str(cleanNodeText(el)) : null);
  let title = null;
  if (ps[0]) {
    const span = safeQueryAll(ps[0], 'span').find((s) => str(s.textContent));
    title = text(span || ps[0]);
    if (title) title = title.replace(/\s*\(Verified job\)\s*$/i, '').trim() || null;
  }
  const pay = safeQueryAll(card, 'span').find((s) => !s.querySelector('span') && /\$\s?\d/.test(s.textContent));
  return { title: title, company: text(ps[1]), location: text(ps[2]), pay: text(pay) };
}

// The results cards each board renders, and how to read one.
export const CARD_SITES = {
  Indeed: { selector: '.cardOutline.result, [data-testid="job-card-container"]', fields: cardFields },
  LinkedIn: { selector: 'div[role="button"][componentkey^="job-card-component-ref-"]', fields: linkedinCardFields },
};
export const CARD_SELECTOR = Object.values(CARD_SITES).map((s) => s.selector).join(', ');

/* ------------------------------ the reason label on a card
   A short coloured label ("SKIP: pay $88K < $125K", "Applied 10-12") drawn by a
   ::after pseudo-element from the card's data-jobscore-label attribute, so no
   node is ever added to the site's DOM. The stylesheet is a constructable sheet
   adopted by the document, which a page Content-Security-Policy cannot block.
   Only the card's CHILDREN fade, so the label stays readable on a dimmed card.
   If the sheet cannot be installed, dimming falls back to the card's own opacity. */
const LABEL_COLORS = {
  title: '#8e44ad', pay: '#d63031', location: '#e17055', gate: '#636e72',
  passed: '#7f8c8d', applied: '#1e9e57', todo: '#2d7ff9', new: '#c9930a',
};
export const CARD_CSS = [
  '[data-jobscore-label]{position:relative !important}',
  '[data-jobscore-label]::after{content:attr(data-jobscore-label);position:absolute;right:10px;bottom:8px;z-index:5;' +
    'padding:2px 8px;border-radius:10px;font:600 11px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;' +
    'letter-spacing:.2px;color:#fff;background:#636e72;white-space:nowrap;pointer-events:none;box-shadow:0 1px 2px rgba(0,0,0,.25)}',
].concat(Object.keys(LABEL_COLORS).map((k) => '[data-jobscore-kind="' + k + '"]::after{background:' + LABEL_COLORS[k] + '}'))
  .concat(['[data-jobscore-dim]>*{opacity:.35}'])
  .join('\n');

let cardSheetDoc = null;
export function ensureCardStyles(doc) {
  if (cardSheetDoc === doc) return true;
  try {
    const view = doc.defaultView || (typeof window !== 'undefined' ? window : null);
    if (view && typeof view.CSSStyleSheet === 'function' && 'adoptedStyleSheets' in doc) {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(CARD_CSS);
      doc.adoptedStyleSheets = Array.from(doc.adoptedStyleSheets || []).concat([sheet]);
      cardSheetDoc = doc;
      return true;
    }
  } catch (e) { /* fall back to inline opacity, below */ }
  return false;
}

const shortMoney = (n) => '$' + Math.round(n / 1000) + 'K';

// The label for a card a cheap gate rules out.
function failLook(fail, f, cfg) {
  if (fail.name === 'Title') return { kind: 'title', label: 'SKIP: title' };
  if (fail.name === 'Pay') {
    const top = cheapPay(f.pay);
    const floor = num(cfg.gates.pay.floor, DEFAULT_SETTINGS.gates.pay.floor);
    return { kind: 'pay', label: top !== null ? 'SKIP: pay ' + shortMoney(top) + ' < ' + shortMoney(floor) : 'SKIP: pay' };
  }
  if (fail.name === 'Location') return { kind: 'location', label: 'SKIP: location' };
  return { kind: 'gate', label: 'SKIP: ' + String(fail.name).toLowerCase() };
}

// Dim every card a cheap gate already rules out. Style and title attributes
// only: no nodes are added or removed, so it cannot feed the page observer,
// and it never clicks, navigates or fetches anything.
// A short, stable hash so a settings change re-judges cards already looked at.
function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

// What a tracked job looks like on a results card. Style and attributes only.
function jobLook(job) {
  const s = job.status;
  const when = s === 'applied' && job.appliedAt ? ' ' + job.appliedAt.slice(5, 10) : '';
  if (s === 'applied' || s === 'interview' || s === 'offer') return { kind: 'applied', outline: '2px solid #2ecc71', label: STATUS_LABEL[s] + when };
  if (s === 'to_apply' || s === 'asked' || s === 'follow_up') return { kind: 'todo', outline: '2px solid #4aa3ff', label: STATUS_LABEL[s] };
  if (s === 'new') return { kind: 'new', outline: '2px solid #f1c40f', label: 'Needs a look' };
  return { kind: 'passed', dim: true, label: (STATUS_LABEL[s] || s) + (job.fail_gate ? ' (' + job.fail_gate + ')' : '') };
}

function clearCard(card) {
  for (const a of ['data-jobscore-sig', 'data-jobscore-skip', 'data-jobscore-job', 'data-jobscore-dim', 'data-jobscore-label', 'data-jobscore-kind']) card.removeAttribute(a);
  if (card.hasAttribute('data-jobscore-title')) { card.removeAttribute('title'); card.removeAttribute('data-jobscore-title'); }
  card.style.opacity = '';
  card.style.outline = '';
}

// Judge every result card. Two things can happen to one, both with style and
// attributes only: no nodes are added or removed, so it cannot feed the page
// observer, and nothing is clicked, navigated or fetched.
//   - a cheap gate already rules it out (title, pay chip, place): dimmed
//   - you already track that company + title (any site): outlined by status,
//     or dimmed if you passed on it
// `lookup(company, title)` returns the tracked job for a card, or null.
export function scanCards(doc, cfg, lookup) {
  cfg = cfg || getSettings();
  const gates = !!cfg.general.cardPrefilter;
  const labels = cfg.general.cardLabels !== false;
  const site = siteFor((doc.location && doc.location.hostname) || '');
  const spec = site ? CARD_SITES[site.name] : null;
  const cards = spec ? safeQueryAll(doc, spec.selector) : [];
  const styled = labels && cards.length ? ensureCardStyles(doc) : false;
  if (!gates && !lookup) {
    // Both features are off: put back anything we changed earlier.
    for (const card of cards) if (card.hasAttribute('data-jobscore-sig')) clearCard(card);
    return { scanned: 0, dimmed: 0, badged: 0 };
  }
  let scanned = 0, dimmed = 0, badged = 0;
  const cfgSig = hashString(JSON.stringify(cfg.gates) + JSON.stringify(cfg.home) + (gates ? '1' : '0') + (labels ? '1' : '0'));
  for (const card of cards) {
    const f = spec.fields(card);
    if (!f.title) continue;
    scanned++;
    const job = lookup ? lookup(f.company, f.title) : null;
    const jobSig = job ? job.status + ':' + (job.fail_gate || '') + ':' + (job.appliedAt || '') : '';
    const sig = [f.title, f.company, f.location, f.pay, cfgSig, jobSig].join('|');
    if (card.getAttribute('data-jobscore-sig') === sig) {
      if (card.getAttribute('data-jobscore-skip') || card.getAttribute('data-jobscore-dim')) dimmed++;
      if (card.getAttribute('data-jobscore-job')) badged++;
      continue;
    }
    clearCard(card);
    card.setAttribute('data-jobscore-sig', sig);
    const tips = [];
    let dim = false;
    let shown = null;   // the label: your own decision on a job wins over a cheap gate

    const fail = gates ? cheapGates(f, cfg) : null;
    if (fail) {
      card.setAttribute('data-jobscore-skip', fail.name);
      tips.push('JobScore: SKIP - ' + fail.name + ': ' + fail.detail);
      dim = true;
      shown = failLook(fail, f, cfg);
    }
    if (job) {
      const look = jobLook(job);
      card.setAttribute('data-jobscore-job', job.status);
      tips.push('JobScore: ' + look.label + (job.site ? ' (seen on ' + job.site + ')' : ''));
      if (look.outline) card.style.outline = look.outline;
      if (look.dim) dim = true;
      shown = look;
      badged++;
    }
    if (shown && labels) {
      card.setAttribute('data-jobscore-label', shown.label);
      card.setAttribute('data-jobscore-kind', shown.kind);
    }
    if (dim) {
      card.setAttribute('data-jobscore-dim', '1');
      // With the stylesheet only the contents fade and the label stays readable.
      if (!styled) card.style.opacity = '0.35';
      dimmed++;
    }
    if (tips.length) {
      card.setAttribute('title', tips.join('\n'));
      card.setAttribute('data-jobscore-title', '1');
    }
  }
  return { scanned: scanned, dimmed: dimmed, badged: badged };
}
