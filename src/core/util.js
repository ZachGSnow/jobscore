
export const log = (...a) => console.log('[JobScore]', ...a);

export function num(v, fallback) {
  const n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : (fallback === undefined ? null : fallback);
}
export function str(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}
export function boolish(v) {
  if (v === true || v === false) return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes') return true;
    if (s === 'false' || s === 'no') return false;
  }
  return null;
}
export function oneOf(v, allowed, fallback) {
  const s = str(v);
  if (s) {
    const hit = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
    if (hit) return hit;
  }
  return fallback === undefined ? null : fallback;
}
export function money(n) {
  if (n === null || n === undefined) return 'n/a';
  return '$' + Math.round(n).toLocaleString('en-US');
}
export function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

// Evidence verification only. The captured text loses its line breaks on
// pages that concatenate without separators (Built In yields
// "...and equity.Base Salary Range$140,000\u2014$190,000 USDBring Your Whole..."),
// so a faithful quote can fail a plain substring test. Folding whitespace away
// and mapping unicode dashes and quotes onto ASCII asks the only question that
// matters: did the model read this page? It must NOT be used for the
// home-region or product matching, where word boundaries carry the meaning.
export function normQuote(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, '');
}
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function debounce(fn, ms) {
  let t = null;
  const wrapped = function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(this, args); }, ms);
  };
  wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return wrapped;
}
export function wordCount(s) {
  return String(s || '').split(/\s+/).filter(Boolean).length;
}
export function daysBetween(iso, now) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.round(((now || Date.now()) - then) / 86400000));
}
export function clip(s, n) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '\u2026' : t;
}
