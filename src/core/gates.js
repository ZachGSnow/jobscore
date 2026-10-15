// Gates and the verdict. Pure: no DOM, no network, no clock. The same extracted
// facts and the same settings always give the same answer.
//
// A gate looks at the facts and says pass / fail / unknown. What a fail or an
// unknown MEANS for the verdict (skip, review, flag, ignore) is a setting, so
// loosening a rule never needs a code change or a new API call.
import { DEFAULT_SETTINGS } from './settings.js';
import { clip, money, norm, num, str } from './util.js';
import {
  containsWord, firstPhrase, homeAliasMatch, homeLabel, homeState, inHomeMetro, mentionsHomeRegion,
  metroMatch, US_STATE_CODES,
} from './location.js';

/* ------------------------------------------------------------ gate shape */

const GATE_ID = {
  Title: 'title', Location: 'location', Travel: 'travel', Pay: 'pay', Experience: 'experience',
  Product: 'product', Employer: 'employer', Language: 'language', Clearance: 'clearance',
};

// extra: { kind, modeKey, bucket, soft:[{text,effect,ask}], ask:[string], notes:[string] }
export function gate(name, status, detail, quote, extra) {
  return Object.assign({
    id: GATE_ID[name] || norm(name),
    name: name,
    status: status,
    detail: detail,
    quote: quote || '',
    evidenceKeys: [],
    kind: null,
    modeKey: null,
    bucket: null,
    soft: [],
    ask: [],
    notes: [],
  }, extra || {});
}

function gc(cfg, id) {
  const fromCfg = (cfg && cfg.gates && cfg.gates[id]) || {};
  return Object.assign({}, DEFAULT_SETTINGS.gates[id], fromCfg);
}

const DEFAULT_EFFECT = { fail: 'skip', unknown: 'review' };

export function effectOf(g, cfg) {
  if (g.status === 'pass') return 'none';
  const conf = gc(cfg, g.id);
  const key = g.modeKey || (g.status === 'fail' ? 'onFail' : 'onUnknown');
  return conf[key] || DEFAULT_EFFECT[g.status] || 'review';
}

/* ------------------------------------------------------------ text helpers */

export function postingText(x) {
  return [x && x.page_title, x && x.title, x && x.page_location, x && x.location_restriction, x && x._text].filter(Boolean).join('\n');
}
export function headerBlob(x) {
  const parts = [x && x.page_title, x && x.title, x && x.page_location].map(str).filter(Boolean);
  // page_title and title are usually the same string, so a gate that quotes the
  // blob read "Sr. Solutions Architect Sr. Solutions Architect". A quote that
  // repeats itself looks like a bug rather than a fact about the page.
  return parts.filter((p, i) => parts.indexOf(p) === i).join('\n');
}

// The line of a field that contains the match, so a gate can quote the real
// line instead of the whole blob.
export function lineContaining(text, needle) {
  const n = norm(needle);
  if (!n) return '';
  for (const line of String(text || '').split('\n')) {
    if (norm(line).indexOf(n) !== -1) return line.trim();
  }
  return '';
}
// The exact substring a gate matched on, so a gate quotes what it actually
// read instead of the whole header blob (which repeats the title and reads as
// a quotation without being one).
export function matchText(re, text) {
  const m = re.exec(String(text || ''));
  return m ? clip(m[0], 160) : '';
}
// The narrowest real text for a gate quote: the phrase that matched, then the
// model's own location limit, and only then the header.
export function firstQuote() {
  for (let i = 0; i < arguments.length; i++) {
    const v = str(arguments[i]);
    if (v) return clip(v, 160);
  }
  return '';
}

function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* ------------------------------------------------------------------ title */

// Remove one phrase from a title, ignoring case and punctuation, so
// "Technical Account Manager" does not trip the generic "manager" block.
function removePhrase(text, phrase) {
  const flat = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const h = ' ' + flat(text) + ' ';
  const p = ' ' + flat(phrase) + ' ';
  return h.replace(p, ' ').trim();
}

const SUPPORT_LIKE = ['support', 'implementation_or_professional_services'];
const ADJACENT_ROLES = ['technical_account_manager', 'customer_success_or_account_management'];

export function titleGate(x, cfg) {
  const T = gc(cfg, 'title');
  const title = str(x.title) || str(x.page_title) || '';
  // No title is a capture gap, not a finding about the job.
  if (!title) return gate('Title', 'unknown', 'No job title was captured', '');
  const role = x.role_type || null;

  const adjacent = firstPhrase(title, T.adjacentKeywords);
  const rest = adjacent ? removePhrase(title, adjacent) : title;
  const blocked = firstPhrase(rest, T.blockKeywords);
  if (blocked) return gate('Title', 'fail', 'Title contains "' + blocked + '", which is blocked in settings', title);
  if (adjacent) return gate('Title', 'pass', 'Adjacent role (' + adjacent + '), not pre-sales', title, { bucket: 'adjacent' });

  if (T.blockQuota && (x.quota_carrying === true || role === 'sales_ae_or_quota')) {
    return gate('Title', 'fail', 'The role carries a sales quota', title);
  }
  if (role === 'non_it') return gate('Title', 'fail', 'The model reads this as a non-IT role', title);

  const hit = firstPhrase(title, T.passKeywords);
  if (hit) {
    const strong = (T.passKeywords || []).filter((k) => !(T.ambiguousKeywords || []).includes(k));
    const onlyAmbiguous = !firstPhrase(title, strong);
    if (onlyAmbiguous) {
      if (role === 'presales') return gate('Title', 'pass', 'Title "' + hit + '" and the model reads it as pre-sales', title);
      if (ADJACENT_ROLES.includes(role)) return gate('Title', 'pass', 'Title "' + hit + '" but the model reads it as ' + role.replace(/_/g, ' '), title, { bucket: 'adjacent' });
      if (SUPPORT_LIKE.includes(role)) return gate('Title', 'fail', 'Title "' + hit + '" but the model reads the role as ' + role.replace(/_/g, ' '), title);
      return gate('Title', 'unknown', 'Title "' + hit + '" is only sometimes pre-sales and the model could not confirm', title, {
        kind: 'ambiguous_title',
        ask: ['Is this seat pre-sales (supporting a sales team), or an internal engineering role?'],
      });
    }
    const g = gate('Title', 'pass', 'Pre-sales title', title);
    if (SUPPORT_LIKE.includes(role)) {
      g.soft.push({ effect: 'flag', text: 'The title reads as pre-sales but the model classifies the role as ' + role.replace(/_/g, ' ') + ' - confirm' });
    }
    return g;
  }

  if (T.useModelRole) {
    if (role === 'presales') {
      const g = gate('Title', 'pass', 'Title "' + title + '" is not a standard pre-sales title, but the model reads the role as pre-sales', title);
      g.soft.push({ effect: 'flag', text: 'Unusual title for a pre-sales role - confirm what the seat actually does' });
      return g;
    }
    if (ADJACENT_ROLES.includes(role)) {
      return gate('Title', 'pass', 'Adjacent role (' + role.replace(/_/g, ' ') + '), not pre-sales', title, { bucket: 'adjacent' });
    }
  }
  return gate('Title', 'fail', 'Title is not a pre-sales title (no keyword in settings matches it)', title);
}

/* --------------------------------------------------------------- location */

export const REGION_FAIL = /\b(new england|northeast|north\/northeast|tola|austin|cleveland|alpharetta|san jose|conshohocken|newark|boston|philadelphia|chicago|denver|seattle|latam)\b/i;
export const NATIONAL_REMOTE = /remote anywhere in the (?:united states|u\.?s\.?)|work from anywhere in the (?:united states|u\.?s\.?)|fully remote|100%\s*remote|remote,?\s+united states|united states,?\s+remote|remote\s*[-\u2013\u2014]\s*u\.?s\.?|remote united states|#li-remote/i;
export const OFFICE_FAIL = /\b(hybrid workplace|hybrid work|office culture|we value our office|on-?site|onsite|in-office|field sales)\b/i;
// A card/location line that names the whole United States (nothing narrower)
// counts as remote from home. Checked AFTER the foreign-city and office
// checks, so a named city or a hybrid/onsite line still wins.
export const US_WIDE = /\bunited states(?: of america)?\b|\busa\b|\bremote[\s,\u2013\u2014-]*u\.?s\.?a?\.?(?!\w)|\bu\.?s\.?a?\.?[\s,\u2013\u2014-]*remote\b/i;
// Loosely "the posting mentions remote work at all". Used only to let a US
// region/zone count, per the rule that a zone alone is not enough.
export const MENTIONS_REMOTE = /\b(remote|telecommut\w*|work from home|wfh|work from anywhere)\b/i;
// A US region / timezone / territory ("EST Zone", "West Coast territory",
// "US Central"), with no named city. Counts only when remote is also stated.
export const US_REGION = /\b(est|cst|mst|pst|edt|cdt|mdt|pdt)\b[^.\n]{0,20}\b(zone|time|territory|region)\b|\b(eastern|central|mountain|pacific)\b[^.\n]{0,20}\b(zone|time|territory|region)\b|\b(united states|u\.?s\.?a?)\b[^.\n]{0,20}\b(est|cst|mst|pst|eastern|central|mountain|pacific)\b/i;

const US_STATES = Object.keys(US_STATE_CODES);
const stateRe = (name) => new RegExp('\\b' + name.replace(/\s+/g, '\\s+') + '\\b', 'i');

// A place that is not home: a hard-coded region from REGION_FAIL, a US state,
// or a ", XX" postal code. The home state (from the territory words) and any
// territory / metro word are never foreign.
export function mentionsForeignPlace(text, cfg) {
  const t = String(text || '');
  const home = homeState(cfg);
  const region = REGION_FAIL.exec(t);
  if (region && !homeAliasMatch(region[0], cfg) && !metroMatch(region[0], cfg)) return region[0];
  for (let i = 0; i < US_STATES.length; i++) {
    if (home && US_STATES[i] === home.name.toLowerCase()) continue;
    const m = stateRe(US_STATES[i]).exec(t);
    if (!m) continue;
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    if (/\b(not|no|outside|excluding|except|other than)\b/i.test(before)) continue;
    return m[0];
  }
  // Cards print "Indianapolis, IN 46204" with the two-letter code only. The home
  // state's code is skipped. The comma is required so a bare "IN" or "OR" in
  // running text is never read as a state.
  const re = /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\s+\d{5})?(?=\s*(?:$|[,.;|\u2022()\/\u2013\u2014-]))/gm;
  let abbr;
  while ((abbr = re.exec(t))) {
    if (home && abbr[1] === home.code) continue;
    return abbr[0].replace(/^,\s*/, '');
  }
  return null;
}

// "Open to candidates in Alabama, Connecticut, Ohio, ..." style allow-lists:
// a territory word appears among four or more named states.
export function allowlistIncludesHome(text, cfg) {
  if (!mentionsHomeRegion(text, cfg)) return false;
  let hits = 0;
  for (let i = 0; i < US_STATES.length; i++) {
    if (stateRe(US_STATES[i]).test(text)) hits++;
  }
  return hits >= 4;
}
// A place the card names next to the word Remote ("Remote in Vista, CA",
// "Vista, CA \u2022 Remote") is where the employer sits, not a limit on who can
// be hired. Strip the filler and see whether any place is left.
export const REMOTE_WORD_RE = /\b(remote|telecommut\w*|work from home|wfh|work from anywhere)\b/i;
export function placeBesideRemote(loc) {
  if (!REMOTE_WORD_RE.test(loc)) return '';
  return String(loc || '')
    .replace(/\b(remote|in|work from home|wfh|hybrid|united states(?: of america)?|america|anywhere|nationwide)\b/ig, ' ')
    .replace(/\bu\.?s\.?a?(?![a-z])/ig, ' ')
    .replace(/[\u2022\u00B7|,()\-\u2013\u2014\/]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
// The posting itself says it hires across the US (not just mentions the country).
export const HIRES_US_RE = /\b(?:anywhere|across|throughout|within|in)\s+the\s+(?:united states|u\.?s\.?a?)(?![a-z])|\bu\.?s\.?a?[- ]based\b|\bunited states[- ]based\b|\bremote\b[^.\n]{0,20}\b(?:united states|u\.?s\.?a?)(?![a-z])|\b(?:united states|u\.?s\.?a?)(?![a-z])[,\s\u2013\u2014-]*remote\b/i;
// Wording that turns a named place into a real restriction on the candidate.
export const HARD_LOCAL_RE = /\b(?:must|required to|need to)\b[^.\n]{0,60}\b(?:live|reside|located|based|work from|be in)\b|\bonly (?:candidates|applicants)\b|\bresidents? of\b|\blocal candidates\b|\bin[- ]office\b|\bon-?site\b/i;

// The deterministic reading of the page text. It is the fallback when the model
// cannot say who may apply, and the cross-check when it can.
function textLocation(x, cfg) {
  const L = gc(cfg, 'location');
  const header = headerBlob(x);
  const body = postingText(x);
  const loc = str(x.page_location) || '';
  const title = str(x.title) || str(x.page_title) || '';
  const locRemote = REMOTE_WORD_RE.test(loc);
  const wa = x.work_arrangement;
  const region = (cfg && cfg.home && cfg.home.region) || DEFAULT_SETTINGS.home.region;
  const homeName = homeLabel(cfg);

  const must = /must\s+(?:live|reside|be\s+based|be\s+located|be\s+a\s+resident)[^.\n]{0,180}/i.exec(body);
  if (must && mentionsHomeRegion(must[0], cfg)) return gate('Location', 'pass', 'Territory includes ' + region, clip(must[0], 180));
  if (must && !mentionsHomeRegion(must[0], cfg)) return gate('Location', 'fail', 'Must live somewhere other than ' + homeName, clip(must[0], 180));
  if (allowlistIncludesHome(body, cfg)) return gate('Location', 'pass', 'Allowed-state list includes ' + homeName, homeName);
  // A place beside the word Remote is the employer's base, so it is only a
  // reason to fail when it sits in the title or the card is not remote.
  const foreign = mentionsForeignPlace(title, cfg) || (locRemote ? null : mentionsForeignPlace(loc, cfg));
  if (foreign) {
    if (inHomeMetro(header, cfg) && L.allowHybridInMetro) {
      // fall through: a metro place beats a stray state token
    } else {
      return gate('Location', 'fail', 'Card or title names ' + foreign + ', not ' + homeName,
        firstQuote(lineContaining(header, foreign), foreign, clip(header, 180)));
    }
  }
  const office = OFFICE_FAIL.exec(body);
  if (office && wa !== 'remote' && !/hybrid\s+(cloud|environment|infrastructure|identity)/i.test(office[0])) {
    if (L.allowHybridInMetro && inHomeMetro(header + '\n' + str(x.location_restriction), cfg)) {
      return gate('Location', 'pass', 'Office or hybrid wording, but the place is in the ' + region + ' metro', clip(office[0], 120));
    }
    return gate('Location', 'fail', 'Hybrid, onsite, office, or field sales', clip(office[0], 120));
  }

  // The model's evidence-verified location_scope. The card's named city/state
  // already failed above, so a scope can never override a real place elsewhere.
  const scope = x.location_scope || 'unclear';
  const remoteMention = wa === 'remote' || MENTIONS_REMOTE.test(body) || MENTIONS_REMOTE.test(header);
  const limit = str(x.location_restriction);
  if (scope === 'non_us') return gate('Location', 'fail', 'Posting names a non-US location',
    firstQuote(matchText(REGION_FAIL, header), mentionsForeignPlace(header, cfg), limit));
  if (scope === 'us_wide') return gate('Location', 'pass', 'Posting offers US-wide remote work',
    firstQuote(matchText(US_WIDE, header), matchText(US_WIDE, body), limit));
  if (scope === 'us_region' && remoteMention) return gate('Location', 'pass', 'US region/territory with remote work',
    firstQuote(matchText(US_REGION, body), matchText(US_REGION, header), matchText(US_WIDE, header), limit));
  if (scope === 'named_place') {
    const home = homeAliasMatch(header, cfg) || homeAliasMatch(body, cfg);
    if (home) return gate('Location', 'pass', 'Named location includes ' + region, clip(home, 160));
    // The model called the employer's city a work location, but the card says
    // Remote and nothing in the text ties the candidate to that city.
    if (locRemote && !HARD_LOCAL_RE.test(body)) {
      return gate('Location', 'unknown', 'Remote, but only the employer location is named; the posting never says which states it hires in', clip(loc, 160), {
        kind: 'eligibility', ask: ['Is this remote role open to candidates in ' + homeName + '?'],
      });
    }
    return gate('Location', 'fail', 'Named work location is outside ' + homeName,
      firstQuote(mentionsForeignPlace(header, cfg), limit, matchText(US_WIDE, header)));
  }

  // Remote with a place beside it ("Remote in Vista, CA"): fine if the posting
  // says it hires across the United States, otherwise nobody has said so.
  if (placeBesideRemote(loc)) {
    const us = matchText(HIRES_US_RE, body) || matchText(NATIONAL_REMOTE, body);
    if (us) return gate('Location', 'pass', 'Remote, and the posting says it hires across the United States', us);
    return gate('Location', 'unknown', 'Remote, based in ' + clip(placeBesideRemote(loc), 60) + ', but the posting never says it hires across the United States', clip(loc, 160), {
      kind: 'eligibility', ask: ['The role is remote and based in ' + clip(placeBesideRemote(loc), 40) + '. Is it open to candidates in ' + homeName + '?'],
    });
  }

  // The card itself names the United States ("United States of America",
  // "Remote, United States"). Quote only the phrase that matched.
  if (NATIONAL_REMOTE.test(body) || NATIONAL_REMOTE.test(header) || US_WIDE.test(header)) {
    const nat = matchText(NATIONAL_REMOTE, header) || matchText(NATIONAL_REMOTE, body);
    return gate('Location', 'pass', 'Card names the United States', nat || matchText(US_WIDE, header) || clip(header, 160));
  }

  // A US region / timezone / territory counts only when the posting also says
  // remote (a zone alone can just as easily be an onsite territory).
  if (US_REGION.test(body) && remoteMention) {
    return gate('Location', 'pass', 'US region/territory with remote work', clip(body, 160));
  }
  // A place in your own metro with no word on remote / hybrid / onsite.
  if (L.allowHybridInMetro && inHomeMetro(loc + '\n' + (limit || ''), cfg)) {
    return gate('Location', 'unknown', 'A ' + region + '-area posting that never says remote, hybrid or onsite', firstQuote(loc, limit), {
      kind: 'arrangement', ask: ['Is this role remote, hybrid or onsite?'],
    });
  }
  // A place or region is named and remote never is: that is a finding.
  if (!remoteMention && (loc || limit || US_REGION.test(body))) {
    return gate('Location', 'fail', 'Names a place or region and never says the role is remote', firstQuote(loc, limit, matchText(US_REGION, body)));
  }
  // Nothing decides it either way. Say so rather than guess.
  return gate('Location', 'unknown', remoteMention
    ? 'Remote, but nothing says where the work may be done from'
    : 'No location information in the captured text', '', {
    kind: 'eligibility', ask: ['Where can this role be worked from? Is it open to candidates in ' + homeName + '?'],
  });
}

// The role has to be doable from the home region: fully remote and open to
// the home state, or hybrid / onsite inside the home metro. The model reads who may
// apply; the page text is the fallback and the cross-check. Every branch that
// cannot tell returns 'unknown' instead of guessing a pass or a fail.
export function locationGate(x, cfg) {
  const L = gc(cfg, 'location');
  const region = (cfg && cfg.home && cfg.home.region) || DEFAULT_SETTINGS.home.region;
  const loc = str(x.page_location) || '';
  const header = headerBlob(x);
  const wa = x.work_arrangement;

  if (wa === 'hybrid_work' || wa === 'onsite') {
    const word = wa === 'onsite' ? 'onsite' : 'hybrid';
    const place = str(x.office_location) || str(x.location_restriction) || loc;
    const quote = firstQuote(str(x.office_location), str(x.location_restriction), loc);
    if (inHomeMetro(place, cfg) || inHomeMetro(header, cfg)) {
      if (L.allowHybridInMetro) return gate('Location', 'pass', 'Not remote (' + word + '), but the office is in the ' + region + ' metro', quote);
      return gate('Location', 'fail', 'Not remote: ' + word + ' (hybrid / onsite is turned off in settings)', quote);
    }
    if (!place) {
      return gate('Location', 'unknown', 'The posting says ' + word + ' but does not say where the office is', '', {
        kind: 'office', ask: ['Where is the office, and how many days a week are in person?'],
      });
    }
    return gate('Location', 'fail', 'Not 100% remote: ' + word + ' in ' + clip(place, 60), quote);
  }

  // eligibility_ky is the field's name in facts cached before it was renamed.
  const eligibility = x.eligibility_home || x.eligibility_ky || null;
  const said = str(x.eligibility_text);
  const homeName = homeLabel(cfg);
  if (eligibility === 'yes' || eligibility === 'no') {
    const text = textLocation(x, cfg);
    if (eligibility === 'no') {
      return gate('Location', 'fail', 'The posting limits who may apply, and ' + homeName + ' is not included', firstQuote(said, str(x.location_restriction), loc));
    }
    const g = gate('Location', 'pass', 'The posting is open to candidates in ' + homeName, firstQuote(said, str(x.location_restriction), loc));
    if (text.status === 'fail') {
      g.soft.push({ effect: 'flag', text: 'The page text suggests otherwise (' + text.detail + ') - confirm eligibility',
        ask: ['Can you confirm this role is open to candidates in ' + homeName + '?'] });
    }
    return g;
  }

  const g = textLocation(x, cfg);
  if (g.status === 'pass' && wa === 'remote' && OFFICE_FAIL.test(postingText(x)) && !/hybrid\s+(cloud|environment|infrastructure|identity)/i.test(postingText(x))) {
    g.soft.push({ effect: 'flag', text: 'The text mentions office / on-site wording ("' + clip(matchText(OFFICE_FAIL, postingText(x)), 40) + '") although the role reads as remote - confirm' });
  }
  return g;
}

/* ----------------------------------------------------------------- travel */

// The percent is read from the text too, so a model miss cannot hide it.
export const TRAVEL_PCT_RE = /(\d{1,3})\s*%\s*(?:of\s+(?:the\s+|your\s+)?time\s*)?(?:travel|travell?ing)|travel(?:l?ing)?\b[^.\n]{0,60}?(\d{1,3})\s*%/i;
export const TRAVEL_VAGUE_RE = /willing(?:ness)? to travel|travel (?:is )?required|occasional travel|some travel|travel as needed|ability to travel|able to travel|overnight travel|domestic travel|regular travel/i;

export function travelGate(x, cfg) {
  const T = gc(cfg, 'travel');
  const region = (cfg && cfg.home && cfg.home.region) || DEFAULT_SETTINGS.home.region;
  const maxOut = num(T.maxPercentOutside, 10);
  const maxIn = num(T.maxPercentMetro, 50);
  const text = postingText(x);
  let pct = num(x.travel_percent, null);
  if (pct === null) {
    const m = TRAVEL_PCT_RE.exec(text);
    if (m) pct = parseInt(m[1] || m[2], 10);
  }
  let scope = x.travel_scope || 'unspecified';
  if (pct !== null && pct > 0 && scope === 'none') scope = 'unspecified';
  const quote = firstQuote(matchText(TRAVEL_PCT_RE, text), matchText(TRAVEL_VAGUE_RE, text));
  const askAmount = ['How much travel is expected, and where would it be?'];

  if (pct === 0 || (pct === null && scope === 'none')) return gate('Travel', 'pass', 'No travel', quote);
  if (pct === null && scope === 'unspecified') {
    if (TRAVEL_VAGUE_RE.test(text)) {
      return gate('Travel', 'unknown', 'Travel is mentioned with no amount and no place', quote, { kind: 'travel', ask: askAmount });
    }
    return gate('Travel', 'pass', 'No travel stated', '');
  }
  const amount = pct === null ? 'Some travel' : pct + '% travel';
  if (pct !== null && pct > maxIn) return gate('Travel', 'fail', amount + ' is over the ' + maxIn + '% limit', quote);

  if (scope === 'other_region') {
    if (T.blockCustomerOutside && (x.travel_purpose === 'customer' || x.travel_purpose === 'both')) {
      return gate('Travel', 'fail', 'Customer-site travel outside the ' + region + ' area (blocked in settings)', quote);
    }
    if (pct === null) return gate('Travel', 'unknown', amount + ' outside the ' + region + ' area, with no amount given', quote, { kind: 'travel', ask: askAmount });
    if (pct > maxOut) return gate('Travel', 'fail', amount + ' outside the ' + region + ' area is over the ' + maxOut + '% limit', quote);
    return gate('Travel', 'pass', amount + ' outside the ' + region + ' area, within the ' + maxOut + '% limit', quote);
  }
  if (scope === 'home_region') {
    return gate('Travel', 'pass', amount + ', inside the ' + region + ' area', quote);
  }
  // Travel exists but the posting does not say where.
  if (pct !== null && pct <= maxOut) return gate('Travel', 'pass', amount + ', under the ' + maxOut + '% limit wherever it is', quote);
  return gate('Travel', 'unknown', amount + ', but the posting does not say where', quote, { kind: 'travel', ask: askAmount });
}

/* -------------------------------------------------------------------- pay */

export function parseRanges(text) {
  const re = /\$?\s*(\d{2,3}(?:,\d{3})+|\d{5,6})(?:\.\d+)?\s*(?:-|\u2013|\u2014|to)\s*\$?\s*(\d{2,3}(?:,\d{3})+|\d{5,6})(?:\.\d+)?/gi;
  const out = [];
  const src = String(text || '');
  let m;
  while ((m = re.exec(src))) {
    const min = parseInt(m[1].replace(/,/g, ''), 10);
    const max = parseInt(m[2].replace(/,/g, ''), 10);
    if (!(min >= 20000 && max <= 1000000 && max >= min)) continue;
    // ctx stays wide because rangeKind() reads it to tell a base range from an
    // OTE one; `display` is what the gate actually quotes, kept tight.
    const ctx = src.slice(Math.max(0, m.index - 180), m.index + m[0].length + 80);
    const display = src.slice(Math.max(0, m.index - 70), m.index + m[0].length + 20);
    out.push({ min: min, max: max, kind: rangeKind(ctx), quote: clip(ctx, 220), display: clip(display, 140) });
  }
  return out;
}
export function rangeKind(quote) {
  const q = String(quote || '').toLowerCase();
  if ((/base\s+salary\s*\+\s*commission|base\s*\+\s*commission|commission target|on-target|\bote\b|total compensation/.test(q)) && /range|expected|listed below|annually/.test(q)) return 'not_base';
  if (/base salary|base pay|expected salary|salary range|yearly salary|estimated yearly salary/.test(q)) return 'base';
  return 'unlabeled';
}

const ASK_BASE = ['What is the base salary range for this role?'];

// Which figure of the posted range is held against the floor. A single figure is
// all three. 'top' never skips a role that might pay enough; 'midpoint' is the
// realistic read for a hire without the exact title; 'bottom' is the guarantee.
export const COMPARE_POINTS = ['top', 'midpoint', 'bottom'];

export function payFigure(min, max, mode) {
  const lo = min !== null && min !== undefined ? min : max;
  const hi = max !== null && max !== undefined ? max : min;
  if (lo === null || lo === undefined) return { value: null, verb: '' };
  if (mode === 'bottom') return { value: lo, verb: 'starts at' };
  if (mode === 'midpoint') return { value: Math.round((lo + hi) / 2), verb: lo === hi ? 'is' : 'midpoint is' };
  return { value: hi, verb: 'tops at' };
}

function payVerdict(label, min, max, floor, mode, quote) {
  const f = payFigure(min, max, mode);
  const range = (min !== null && max !== null && min !== max) ? ' (range ' + money(min) + ' - ' + money(max) + ')' : '';
  if (f.value < floor) {
    // Keep the long-standing wording for the default comparison.
    const text = mode === 'top' || !mode
      ? label + ' tops out at ' + money(f.value) + ', under ' + money(floor)
      : label + ' ' + f.verb + ' ' + money(f.value) + range + ', under ' + money(floor);
    return gate('Pay', 'fail', text, quote || '');
  }
  const text = mode === 'top' || !mode
    ? label + ' tops at ' + money(f.value)
    : label + ' ' + f.verb + ' ' + money(f.value) + range;
  return gate('Pay', 'pass', text, quote || '');
}

function addPayNotes(g, x, P) {
  const point = payFigure(num(x.base_min, null), num(x.base_max, null), P.compareAt).value;
  const top = point;
  const bottom = num(x.base_min, null) !== null ? num(x.base_min, null) : num(x.base_max, null);
  const floor = num(P.floor, DEFAULT_SETTINGS.gates.pay.floor);
  const preferred = num(P.preferred, 0);
  if (top !== null && g.status === 'pass') {
    if (preferred && top >= preferred) g.notes.push('Meets your preferred base of ' + money(preferred));
    else g.notes.push('Clears your floor, under your preferred ' + money(preferred));
    if (bottom !== null && bottom < floor) {
      g.soft.push({
        effect: P.onStraddle || 'flag',
        modeKey: 'onStraddle',
        text: 'The range starts at ' + money(bottom) + ', under your ' + money(floor) + ' floor',
        ask: ['Where in the posted range would this role land?'],
      });
    }
  }
  const omin = num(x.ote_min, null);
  const omax = num(x.ote_max, null);
  if (omin !== null || omax !== null) g.notes.push('OTE: ' + (omin !== null ? money(omin) : '?') + ' - ' + (omax !== null ? money(omax) : '?'));
  return g;
}

// The Pay gate reads the extraction, because only the extraction can do the
// arithmetic ("$150k-$175k OTE with a 75/25 split" is a base of
// $112,500-$131,250). parseRanges survives as a fallback for the case where the
// model said nothing at all about pay.
//
// No pay listed is NOT a skip by default: it is APPLY plus a question for the
// recruiter. If the pay section was never captured at all (a scrape gap) it is
// a separate unknown, because "not posted" cannot be confirmed.
export function payGate(x, cfg) {
  const P = gc(cfg, 'pay');
  const g = payGateInner(x, cfg, P);
  if (x && x._pay_uncaptured && g.status === 'unknown' && g.kind === 'not_posted') {
    return gate('Pay', 'unknown', 'The pay section of the page was not captured, so "no pay listed" cannot be confirmed', '', { kind: 'uncaptured' });
  }
  return addPayNotes(g, x || {}, P);
}

function payGateInner(x, cfg, P) {
  const floor = num(P.floor, DEFAULT_SETTINGS.gates.pay.floor);
  const min = num(x.base_min, null);
  const max = num(x.base_max, null);
  const source = str(x.base_source);
  const top = max !== null ? max : min;
  const notPosted = (detail, quote, kind) => gate('Pay', 'unknown', detail, quote, { kind: kind || 'not_posted', modeKey: 'onNotPosted', ask: ASK_BASE });

  if (top !== null) {
    const label = source === 'derived_from_ote' ? 'Base derived from the posted OTE' : 'Stated base';
    return payVerdict(label, min, max, floor, P.compareAt, '');
  }

  const ranges = parseRanges(postingText(x));
  const shown = (r) => r.display || r.quote;
  const oteOnly = (r) => notPosted('The only range is OTE or base plus commission, not a base', shown(r), 'ote_only');

  // The model looked and found no base. Respect it rather than re-deriving one
  // from a range in the text, which is how an OTE figure became "base pay".
  if (source === 'not_stated') {
    const bundled = ranges.find(function (r) { return r.kind === 'not_base'; });
    if (bundled) return oteOnly(bundled);
    return notPosted('No base pay stated', '');
  }

  // The model said nothing usable about pay, so read the text instead.
  const base = ranges.filter(function (r) { return r.kind === 'base'; });
  const chosen = base.length ? base[base.length - 1] : null;
  if (!chosen) {
    const bundled = ranges.find(function (r) { return r.kind === 'not_base'; });
    if (bundled) return oteOnly(bundled);
    return notPosted('No base pay posted', '');
  }
  return payVerdict('Stated base (read from the text)', chosen.min, chosen.max, floor, P.compareAt, shown(chosen));
}

/* ------------------------------------------------- the smaller text gates */

export function experienceGate(text, cfg, x) {
  const E = gc(cfg, 'experience');
  const maxYears = num(E.maxYears, 5);
  const src = String(text || '');
  const re = /(\d{1,2})\s*\+?\s*(?:-|\u2013|to)?\s*\d{0,2}\s*\+?\s*years?(?:\s+of)?\s+experience[^.\n]{0,200}/gi;
  let m;
  while ((m = re.exec(src))) {
    const years = parseInt(m[1], 10);
    const sentence = m[0];
    if (!/pre-?\s?sales|sales engineering|solutions engineering|solutions consulting/i.test(sentence)) continue;
    if (/preferably|preferred|ideally|a plus/i.test(sentence)) continue;
    if (/systems engineering|technical support|customer-facing/i.test(sentence)) continue;
    if (years > maxYears) return gate('Experience', 'fail', years + '+ years of pre-sales required, with no systems-engineering alternative (limit ' + maxYears + ')', clip(sentence, 200));
  }
  // The model's own reading of the years requirement.
  const years = x ? num(x.years_required, null) : null;
  const kind = x ? x.years_required_kind : null;
  if (years !== null && years > maxYears && (kind === 'presales_or_se' || kind === 'selling_or_quota')) {
    return gate('Experience', 'fail', years + '+ years of ' + kind.replace(/_/g, ' ') + ' required (limit ' + maxYears + ')', '');
  }
  const g = gate('Experience', 'pass', 'No pre-sales requirement above ' + maxYears + ' years', '');
  const word = firstPhrase(src, E.salesWords);
  if (word) {
    g.soft.push({
      effect: E.onSalesWords || 'flag',
      modeKey: 'onSalesWords',
      text: 'Mentions formal sales methodology ("' + word + '") - confirm how much sales experience is expected',
      ask: ['How much formal sales experience do you expect for this seat?'],
    });
  }
  return g;
}

export const PRODUCT_ALIASES = {
  'Arctic Wolf': ['arcticwolf'],
  'Fortinet': ['fortios'],
  'SonicWall': ['sonic wall'],
  'Microsoft 365': ['m365', 'office 365', 'o365'],
  'Entra ID': ['azure ad', 'azure active directory', 'entra'],
  'Hyper-V': ['hyperv', 'hyper v'],
  'VMware': ['vsphere', 'esxi', 'vcenter'],
  'FortiGate': ['fortigate', 'forti gate'],
};

export function productMatch(x, cfg) {
  const known = (gc(cfg, 'product').knownProducts || []).slice();
  const tools = [];
  if (x.product_name) tools.push(x.product_name);
  (x.named_tools || []).forEach((t) => { if (t) tools.push(t); });
  for (const tool of tools) {
    const t = norm(tool);
    for (const k of known) {
      const kn = norm(k);
      const knFlat = kn.replace(/[^a-z0-9]/g, '');
      const tFlat = t.replace(/[^a-z0-9]/g, '');
      if (t === kn || t.includes(kn) || kn.includes(t)) return k;
      if (knFlat && tFlat && (tFlat.includes(knFlat) || knFlat.includes(tFlat))) return k;
      const aliasList = PRODUCT_ALIASES[k] || [];
      if (aliasList.some((a) => norm(a) === t || t.includes(norm(a)))) return k;
    }
  }
  return null;
}

export function categoryMatch(x, cfg) {
  const cat = norm(x.product_category);
  if (!cat) return null;
  for (const c of (gc(cfg, 'product').knownCategories || [])) {
    const cn = norm(c);
    const head = cn.split('/')[0].trim();               // "backup", "mdr", "virtualization"
    const words = cn.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (cat === cn || cat.includes(cn)) return c;
    if (head && head.length > 2 && cat.includes(head)) return c;
    if (words.length && words.every((w) => cat.includes(w))) return c;
  }
  return null;
}

export function productGate(text, cfg, x) {
  const P = gc(cfg, 'product');
  const t = String(text || '');
  const bad = firstPhrase(t, P.blockKeywords);
  if (bad) return gate('Product', 'fail', 'Product is outside what you want to sell ("' + bad + '" is blocked in settings)', bad);
  if (x) {
    const known = productMatch(x, cfg);
    if (known) return gate('Product', 'pass', 'You know ' + known, known);
    const cat = categoryMatch(x, cfg);
    if (cat) return gate('Product', 'pass', 'Category you can already explain (' + cat + ')', str(x.product_category) || cat);
  }
  const good = firstPhrase(t, P.goodKeywords);
  if (good) return gate('Product', 'pass', 'Category is one you can already explain', good);
  return gate('Product', 'unknown', 'A product or category you have not listed as familiar', str(x && x.product_name) || '', {
    kind: 'unfamiliar', ask: ['What are the product and the typical buyer for this role?'],
  });
}

export function employerGate(text, x, cfg) {
  const E = gc(cfg, 'employer');
  const t = String(text || '');
  const contract = firstPhrase(t, E.contractWords);
  if (contract) return gate('Employer', 'fail', 'Contract, not a direct full-time seat', contract);
  const company = (x && x.company) || '';
  if (x && x.employer_type === 'staffing_or_hidden_client') return gate('Employer', 'fail', 'Staffing firm or hidden client', company || 'staffing');
  // A pass here means only that nothing staffing- or contract-shaped turned up.
  return gate('Employer', 'pass', company ? 'Direct hire (' + company + ')' : 'No staffing or contract wording found', company);
}

export function languageGate(text, cfg) {
  const G = gc(cfg, 'language');
  const src = String(text || '');
  for (const lang of (G.languages || [])) {
    const l = esc(lang);
    const re = new RegExp(l + '\\s+(?:fluency|required)|fluency in ' + l + '|bilingual[^.\\n]{0,12}' + l, 'i');
    const m = re.exec(src);
    if (m && !/preferred|a plus|nice to have/i.test(m[0])) return gate('Language', 'fail', 'A language other than English is required', m[0]);
  }
  const bi = /must be bilingual/i.exec(src);
  if (bi) return gate('Language', 'fail', 'A language other than English is required', bi[0]);
  return gate('Language', 'pass', 'English only', '');
}

export function clearanceGate(text, cfg) {
  const C = gc(cfg, 'clearance');
  const m = firstPhrase(text, C.words);
  if (m) return gate('Clearance', 'fail', 'National-security clearance required', m);
  return gate('Clearance', 'pass', 'No Secret or TS clearance', '');
}

/* ---------------------------------------------------------------- verdict */

export const VERDICTS = ['APPLY', 'ADJACENT', 'REVIEW', 'SKIP'];

// Turn gate outcomes into a verdict, using each gate's settings.
export function assemble(gates, cfg) {
  const items = [];
  for (const g of gates) {
    g.effect = effectOf(g, cfg);
    if (g.status !== 'pass' && g.effect !== 'ignore') {
      items.push({ gate: g.name, id: g.id, status: g.status, effect: g.effect, text: g.detail, ask: g.ask || [], modeKey: g.modeKey || (g.status === 'fail' ? 'onFail' : 'onUnknown') });
    }
    for (const s of (g.soft || [])) {
      if (s.effect === 'ignore') continue;
      items.push({ gate: g.name, id: g.id, status: 'soft', effect: s.effect, text: s.text, ask: s.ask || [], modeKey: s.modeKey || null });
    }
  }
  const skips = items.filter((i) => i.effect === 'skip');
  const reviews = items.filter((i) => i.effect === 'review');
  const flags = items.filter((i) => i.effect === 'flag');
  const adjacent = gates.find((g) => g.bucket === 'adjacent') || null;
  const first = skips[0] || null;

  let verdict = 'APPLY';
  if (skips.length) verdict = 'SKIP';
  else if (reviews.length) verdict = 'REVIEW';
  else if (adjacent) verdict = 'ADJACENT';

  // Questions for the recruiter: every flagged item that knows what to ask,
  // without repeating itself.
  const questions = [];
  for (const i of flags.concat(reviews)) {
    for (const q of i.ask) if (q && questions.indexOf(q) === -1) questions.push(q);
  }

  let reason;
  if (verdict === 'SKIP') {
    reason = first.status === 'fail' ? first.gate + ' fail: ' + first.text : first.gate + ': ' + first.text;
  } else if (verdict === 'REVIEW') {
    reason = 'Needs a look: ' + reviews.map((i) => i.gate + ' - ' + i.text).join('; ');
  } else if (verdict === 'ADJACENT') {
    reason = (adjacent.detail || 'Adjacent role') + (flags.length ? '; ' + flags.length + ' thing(s) to ask' : '');
  } else {
    reason = flags.length ? 'Every gate passed, with ' + flags.length + ' thing(s) to ask the recruiter.' : 'Every gate passed.';
  }

  return {
    gates: gates,
    items: items,
    verdict: verdict,
    askRecruiter: verdict !== 'SKIP' && flags.length > 0,
    reason: reason,
    fail_gate: first ? first.gate : null,
    fail_detail: first ? first.text : null,
    unknown_gates: gates.filter((g) => g.status === 'unknown' && g.effect !== 'ignore').map((g) => g.name),
    flags: flags.map((i) => ({ gate: i.gate, text: i.text })),
    questions: questions,
    notes: gates.reduce((acc, g) => acc.concat((g.notes || []).map((n) => ({ gate: g.name, text: n }))), []),
    cautions: flags.map((i) => i.text),
    gateFailed: skips.length > 0,
  };
}

export function score(x, cfg) {
  cfg = cfg || DEFAULT_SETTINGS;
  x = x || {};
  const text = postingText(x);
  const gates = [
    titleGate(x, cfg), locationGate(x, cfg), travelGate(x, cfg), payGate(x, cfg),
    experienceGate(text, cfg, x), productGate(text, cfg, x), employerGate(text, x, cfg),
    languageGate(text, cfg), clearanceGate(text, cfg),
  ];
  return assemble(gates, cfg);
}

// Used by the results-list prefilter: a gate result that would end in SKIP.
export function skipsVerdict(g, cfg) {
  return g && g.status !== 'pass' && effectOf(g, cfg) === 'skip';
}

// Kept for callers that only need to know whether a phrase is in a string.
export { containsWord, metroMatch };
