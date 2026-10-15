import { esc } from '../core/util.js';
import { score } from '../core/gates.js';
import { GENERIC_DESC_SELECTORS, candidateScore, cleanNodeText, postingSignalCount, safeQueryAll } from './dom.js';

// Every description candidate on the page, ranked the way pickDescription
// ranks them. Used only by the debug report, so it can afford to look at the
// generic selectors even when the site entry already matched.
export function rankDescriptionCandidates(doc, site) {
  const list = [];
  const seen = new Set();
  const add = (el, selector, generic) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    let text;
    try { text = cleanNodeText(el); } catch (e) { return; }
    if (!text || text.length < 200) return;
    list.push({
      selector,
      generic: !!generic,
      chars: text.length,
      signals: postingSignalCount(text),
      score: candidateScore({ text }),
    });
  };
  for (const sel of ((site && site.description) || [])) {
    for (const el of safeQueryAll(doc, sel)) add(el, sel, false);
  }
  for (const sel of GENERIC_DESC_SELECTORS) {
    for (const el of safeQueryAll(doc, sel)) add(el, sel, true);
  }
  list.sort((a, b) => b.score - a.score);
  return list;
}

export function cssPathOf(el) {
  if (!el || el.nodeType !== 1) return '?';
  const tag = el.tagName.toLowerCase();
  let s = tag;
  if (el.id) s += '#' + el.id;
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3);
  if (cls.length) s += '.' + cls.join('.');
  return s;
}
