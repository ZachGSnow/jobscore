import { DEFAULT_SETTINGS } from './settings.js';
import { norm, str } from './util.js';

function homeOf(cfg) {
  return (cfg && cfg.home) || DEFAULT_SETTINGS.home;
}

export function homeAliases(cfg) {
  return (homeOf(cfg).aliases || []).map((a) => norm(a)).filter(Boolean);
}

export function metroAliases(cfg) {
  return (homeOf(cfg).metro || []).map((a) => norm(a)).filter(Boolean);
}

// Whole-word match so "oh" does not fire inside unrelated words. Punctuation
// is ignored on both sides so "St. Louis" matches "st louis".
export function containsWord(haystack, needle) {
  const flat = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const h = flat(haystack);
  const n = flat(needle);
  if (!n || !h) return false;
  return (' ' + h + ' ').indexOf(' ' + n + ' ') !== -1;
}

// The alias that matched, so a gate can quote the word it actually found
// rather than the whole header.
export function homeAliasMatch(text, cfg) {
  const t = str(text);
  if (!t) return null;
  for (const a of homeAliases(cfg)) {
    if (containsWord(t, a)) return a;
  }
  return null;
}

export function mentionsHomeRegion(text, cfg) {
  return !!homeAliasMatch(text, cfg);
}

// US states by name and postal code. The home state is never configured on its
// own: it is whichever state the territory words (home.aliases) name, so any
// existing settings keep working and there is one source of truth.
export const US_STATE_CODES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

// { name: 'Ohio', code: 'OH' } for the first territory word that is a US
// state name or postal code, or null when none is.
export function homeState(cfg) {
  const byCode = {};
  for (const [name, code] of Object.entries(US_STATE_CODES)) byCode[code.toLowerCase()] = name;
  for (const a of homeAliases(cfg)) {
    const name = US_STATE_CODES[a] ? a : byCode[a];
    if (name) {
      const title = name.replace(/\b[a-z]/g, (c) => c.toUpperCase());
      return { name: title, code: US_STATE_CODES[name] };
    }
  }
  return null;
}

// How the home region is named in gate messages and recruiter questions: the
// state when one is known ("Ohio"), otherwise the configured region text.
export function homeLabel(cfg) {
  const st = homeState(cfg);
  if (st) return st.name;
  return str(homeOf(cfg).region) || 'your area';
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A place you can commute to. Narrower than mentionsHomeRegion: a state is a
// territory you may live in, a city across that state is not a commute.
export function metroMatch(text, cfg) {
  const t = str(text);
  if (!t) return null;
  for (const a of metroAliases(cfg)) {
    if (containsWord(t, a)) return a;
  }
  return null;
}

export function inHomeMetro(text, cfg) {
  return !!metroMatch(text, cfg);
}

// True when the posting actively rules the home region out, or names a
// different "must live in X" region with no mention of home.
// This is a heuristic - read it and adjust to taste.
export function locationExcludesHome(text, cfg) {
  const t = str(text);
  if (!t) return false;
  const words = homeAliases(cfg).map((a) => escapeRe(a).replace(/\s+/g, '\\s+'));
  if (words.length) {
    const negated = new RegExp('(?:^|[^a-z])(not|no|outside(?:\\s+of)?|excluding|except|other than)(?![a-z])[^.;]{0,60}?(' + words.join('|') + ')(?![a-z])', 'i');
    if (negated.test(t)) return true;
  }
  const mustLive = /must\s+(?:live|reside|be\s+based|be\s+located|be\s+a\s+resident)[^.;]{0,120}/i.exec(t);
  if (mustLive && !mentionsHomeRegion(mustLive[0], cfg)) return true;
  return false;
}

// Whole-phrase match against free text, ignoring case and punctuation.
// "pre-sales" matches "Pre Sales Engineer" and "presales" matches itself.
export function phraseIn(text, phrase) {
  return containsWord(text, phrase);
}

export function firstPhrase(text, phrases) {
  for (const p of (phrases || [])) {
    if (phraseIn(text, p)) return p;
  }
  return null;
}
