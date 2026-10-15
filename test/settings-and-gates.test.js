// Behaviour added in v2: settings, gate modes, the verdict set, hybrid in the
// metro, model-read eligibility, title buckets, OTE, requirements and fit notes.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as J from '../src/all.js';
import { testConfig } from './fixtures.js';

const cfg = testConfig();
const gateOf = (res, name) => res.gates.find((g) => g.name === name);

function mk(overrides) {
  return Object.assign({
    title: 'Solutions Engineer', page_title: 'Solutions Engineer', company: 'Acme',
    page_location: 'Remote - United States', _text: 'Remote - United States. Firewall. 3 years experience.',
    work_arrangement: 'remote', eligibility_home: 'yes', eligibility_text: 'Remote - United States',
    location_restriction: null, location_scope: 'us_wide',
    base_min: 130000, base_max: 150000, base_source: 'stated', pay_posted: true,
    role_type: 'presales', quota_carrying: false, years_required: 3, years_required_kind: 'customer_facing_technical',
    product_name: 'Fortinet', product_category: 'firewall / network security', named_tools: [],
    travel_percent: null, travel_scope: 'none', travel_purpose: null, employer_type: 'direct',
  }, overrides || {});
}

/* ------------------------------------------------------------- settings */

test('settings: a saved blob merges over the defaults and drops junk', () => {
  const merged = J.mergeSettings({
    gates: { pay: { floor: '130000', preferred: 'abc', onNotPosted: 'skip' }, nonsense: { a: 1 } },
    general: { autoScore: false, allSites: 'yes' },
    home: { aliases: ['Columbus', '  ', 7] },
    bogus: true,
  });
  assert.equal(merged.gates.pay.floor, 130000, 'a numeric string is accepted');
  assert.equal(merged.gates.pay.preferred, J.DEFAULT_SETTINGS.gates.pay.preferred, 'a non-number falls back');
  assert.equal(merged.gates.pay.onNotPosted, 'skip');
  assert.equal(merged.general.autoScore, false);
  assert.equal(merged.general.allSites, true, 'a non-boolean falls back');
  assert.deepEqual(merged.home.aliases, ['Columbus', '7']);
  assert.equal(merged.gates.nonsense, undefined);
  assert.equal(merged.bogus, undefined);
  assert.equal(merged.gates.title.blockQuota, true, 'untouched keys keep their defaults');
});

test('settings: getPath / setPath are immutable and isModified compares to the default', () => {
  const base = J.DEFAULT_SETTINGS;
  const next = J.setPath(base, 'gates.pay.floor', 140000);
  assert.equal(J.getPath(next, 'gates.pay.floor'), 140000);
  assert.equal(J.getPath(base, 'gates.pay.floor'), J.DEFAULT_SETTINGS.gates.pay.floor, 'the original is untouched');
  assert.equal(J.isModified(next, 'gates.pay.floor'), true);
  assert.equal(J.isModified(next, 'gates.pay.preferred'), false);
});

test('settings: export and import round-trip, and a bad file is a readable error', () => {
  const edited = J.setPath(cfg, 'gates.travel.maxPercentOutside', 20);
  const back = J.importSettings(J.exportSettings(edited));
  assert.equal(back.gates.travel.maxPercentOutside, 20);
  assert.throws(() => J.importSettings('not json'), /valid JSON/);
  assert.throws(() => J.importSettings('42'), /No settings object/);
});

test('settings: a full backup file imports its settings, and text with no settings is refused, never reset to defaults', () => {
  const mine = J.setPath(J.setPath(cfg, 'home.region', 'Denver, Colorado'), 'profile', 'My own profile text.');
  const backup = J.buildBackup(mine, {}, Date.now());
  const back = J.importSettings(backup);
  assert.equal(back.home.region, 'Denver, Colorado', 'the settings inside a backup are used');
  assert.equal(back.profile, 'My own profile text.');
  assert.throws(() => J.importSettings('{"jobscore":"backup","jobs":{}}'), /No settings object/);
  assert.throws(() => J.importSettings('{"hello":"world"}'), /No JobScore settings found/, 'unrelated JSON is not silently imported as defaults');
});

test('settings: only the model choice changes the extraction fingerprint', () => {
  const a = J.extractionFingerprint(cfg);
  assert.equal(J.extractionFingerprint(J.setPath(cfg, 'gates.pay.floor', 1)), a);
  assert.equal(J.extractionFingerprint(J.setPath(cfg, 'profile', 'new profile')), a);
  assert.notEqual(J.extractionFingerprint(J.setPath(cfg, 'model.anthropic', 'claude-haiku-5-5')), a);
});

/* --------------------------------------------------------------- verdicts */

test('verdict: the pay floor and the preferred base are settings, and re-scoring needs no new extraction', () => {
  const x = mk({ base_min: 118000, base_max: 128000 });
  const base = J.score(x, cfg);
  assert.equal(base.verdict, 'APPLY');
  assert.equal(gateOf(base, 'Pay').notes.some((n) => /under your preferred/.test(n)), true);
  assert.ok(base.flags.some((f) => /starts at \$118,000/.test(f.text)), 'a range straddling the floor is flagged');

  const raised = J.score(x, J.setPath(cfg, 'gates.pay.floor', 130000));
  assert.equal(raised.verdict, 'SKIP');
  assert.equal(raised.fail_gate, 'Pay');

  const preferred = J.score(mk({ base_min: 135000, base_max: 150000 }), cfg);
  assert.ok(gateOf(preferred, 'Pay').notes.some((n) => /Meets your preferred base/.test(n)));
  assert.equal(preferred.askRecruiter, false);
});

test('verdict: a gate set to ignore disappears, flag keeps the verdict, review and skip escalate', () => {
  const lowPay = mk({ base_min: 90000, base_max: 100000 });
  const at = (mode) => J.score(lowPay, J.setPath(cfg, 'gates.pay.onFail', mode));
  assert.equal(at('skip').verdict, 'SKIP');
  assert.equal(at('review').verdict, 'REVIEW');
  const flagged = at('flag');
  assert.equal(flagged.verdict, 'APPLY');
  assert.equal(flagged.askRecruiter, true);
  const ignored = at('ignore');
  assert.equal(ignored.verdict, 'APPLY');
  assert.equal(ignored.askRecruiter, false);
  assert.equal(ignored.items.length, 0);
});

test('verdict: questions are collected once each and built into a recruiter message', () => {
  const x = mk({ base_min: null, base_max: null, base_source: 'not_stated', travel_scope: 'unspecified',
    _text: 'Remote - United States. Willingness to travel is required.' });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'APPLY');
  assert.equal(res.questions.length, 2, 'pay and travel');
  const msg = J.buildRecruiterMessage(res, x);
  assert.match(msg, /Solutions Engineer role at Acme/);
  assert.match(msg, /1\. .*travel/i);
  assert.match(msg, /2\. .*base salary/i);
  assert.equal(J.buildRecruiterMessage(J.score(mk(), cfg), mk()), '', 'nothing to ask, nothing to send');
  assert.match(J.buildSummary(res, x, { url: 'https://x/y' }), /Ask: /);
});

/* ---------------------------------------------------------------- title */

const titleOf = (o) => gateOf(J.score(mk(o), cfg), 'Title');

test('title: pre-sales titles pass, Principal / Lead / management and non-SE titles fail', () => {
  for (const t of ['Solutions Engineer', 'Senior Sales Engineer', 'Sr. Solutions Architect', 'Partner Solutions Engineer',
    'Channel Sales Engineer', 'Pre-Sales Engineer', 'Presales Consultant', 'Technical Solutions Architect']) {
    assert.equal(titleOf({ title: t, page_title: t }).status, 'pass', t);
  }
  for (const t of ['Principal Solutions Engineer', 'Lead Sales Engineer', 'Director of Sales Engineering', 'Sales Engineering Manager',
    'Account Executive', 'Support Engineer', 'HVAC Sales Engineer', 'Staff Solutions Architect']) {
    assert.equal(titleOf({ title: t, page_title: t, role_type: 'other' }).status, 'fail', t);
  }
});

test('title: "Systems Engineer" is only pre-sales when the model says so', () => {
  const t = { title: 'Systems Engineer', page_title: 'Systems Engineer' };
  assert.equal(titleOf(Object.assign({ role_type: 'presales' }, t)).status, 'pass');
  assert.equal(titleOf(Object.assign({ role_type: 'other' }, t)).status, 'unknown');
  assert.equal(titleOf(Object.assign({ role_type: 'support' }, t)).status, 'fail');
});

test('title: Technical Account Manager is ADJACENT, not blocked by "manager" and not APPLY', () => {
  const x = mk({ title: 'Technical Account Manager', page_title: 'Technical Account Manager', role_type: 'technical_account_manager' });
  const res = J.score(x, cfg);
  assert.equal(gateOf(res, 'Title').bucket, 'adjacent');
  assert.equal(res.verdict, 'ADJACENT');
  const lead = J.score(mk({ title: 'Lead Technical Account Manager', page_title: 'Lead Technical Account Manager' }), cfg);
  assert.equal(lead.verdict, 'SKIP', 'a blocked word still wins on the rest of the title');
});

test('title: an unusual title the model reads as pre-sales passes with a flag; a quota role fails', () => {
  const odd = J.score(mk({ title: 'Field Technologist', page_title: 'Field Technologist', role_type: 'presales' }), cfg);
  assert.equal(gateOf(odd, 'Title').status, 'pass');
  assert.equal(odd.askRecruiter, true);
  const quota = J.score(mk({ quota_carrying: true }), cfg);
  assert.equal(quota.verdict, 'SKIP');
  assert.match(quota.fail_detail, /quota/);
});

/* ------------------------------------------------------------- location */

const locOf = (o) => gateOf(J.score(mk(o), cfg), 'Location');

test('location: hybrid or onsite in the Columbus metro passes; elsewhere fails; no office is a question', () => {
  const near = locOf({ work_arrangement: 'hybrid_work', office_location: 'Columbus, OH', eligibility_home: 'unclear' });
  assert.equal(near.status, 'pass');
  assert.match(near.detail, /metro/);
  assert.equal(locOf({ work_arrangement: 'onsite', office_location: 'Westerville, OH' }).status, 'pass');
  assert.equal(locOf({ work_arrangement: 'hybrid_work', office_location: 'Cincinnati, OH', page_location: '' }).status, 'fail',
    'Ohio is a territory, not a commute');
  assert.equal(locOf({ work_arrangement: 'hybrid_work', office_location: 'Austin, TX' }).status, 'fail');
  const none = locOf({ work_arrangement: 'hybrid_work', office_location: null, page_location: '', location_restriction: null });
  assert.equal(none.status, 'unknown');
  assert.equal(none.kind, 'office');

  const off = J.score(mk({ work_arrangement: 'hybrid_work', office_location: 'Columbus, OH' }), J.setPath(cfg, 'gates.location.allowHybridInMetro', false));
  assert.equal(gateOf(off, 'Location').status, 'fail');
});

test('location: the model\'s eligibility answer decides, with the page text as a cross-check', () => {
  const no = locOf({ eligibility_home: 'no', eligibility_text: 'must reside in the Pacific Northwest', page_location: 'Remote' });
  assert.equal(no.status, 'fail');
  assert.match(no.quote, /Pacific Northwest/);

  const yes = locOf({ eligibility_home: 'yes', eligibility_text: 'Remote - US only', page_location: 'Remote in Vista, CA',
    location_scope: 'unclear', _text: 'Sells firewalls.' });
  assert.equal(yes.status, 'pass', 'the model read the posting; the employer city does not override it');

  // The model says yes but the card names Newark: still a pass, with a flag to confirm.
  const conflict = locOf({ eligibility_home: 'yes', eligibility_text: 'Remote', page_location: 'Newark, NJ' });
  assert.equal(conflict.status, 'pass');
  assert.equal(conflict.soft.length, 1);
});

test('location: "unclear" from the model falls back to the text rules, and an unresolved case is a recruiter question', () => {
  const g = locOf({ eligibility_home: 'unclear', page_location: 'Remote in New York', location_scope: 'unclear', _text: 'Sells firewalls.' });
  assert.equal(g.status, 'unknown');
  assert.ok(g.ask.length >= 1);
  const res = J.score(mk({ eligibility_home: 'unclear', page_location: 'Remote in New York', location_scope: 'unclear', _text: 'Sells firewalls. Firewall.' }), cfg);
  assert.equal(res.verdict, 'APPLY');
  assert.equal(res.askRecruiter, true);
});

test('location: a Columbus-area posting that never says how you work is a question, not a fail', () => {
  const g = locOf({ eligibility_home: 'unclear', work_arrangement: 'unclear', page_location: 'Columbus, OH', location_scope: 'unclear', _text: 'Sells firewalls.' });
  assert.equal(g.status, 'unknown');
  assert.equal(g.kind, 'arrangement');
});

/* --------------------------------------------------------------- experience */

test('experience: the cap is a setting, the model\'s years count, and sales-method words are a flag', () => {
  const eight = mk({ years_required: 8, years_required_kind: 'presales_or_se' });
  assert.equal(gateOf(J.score(eight, cfg), 'Experience').status, 'fail');
  assert.equal(gateOf(J.score(eight, J.setPath(cfg, 'gates.experience.maxYears', 10)), 'Experience').status, 'pass');
  const general = mk({ years_required: 10, years_required_kind: 'general_it' });
  assert.equal(gateOf(J.score(general, cfg), 'Experience').status, 'pass', '10 years of general IT is not a pre-sales requirement');

  const meddpicc = J.score(mk({ _text: 'Remote - United States. Firewall. Familiarity with MEDDPICC.' }), cfg);
  assert.equal(meddpicc.verdict, 'APPLY');
  assert.equal(meddpicc.askRecruiter, true);
  assert.ok(meddpicc.flags.some((f) => /MEDDPICC/i.test(f.text)));
});

/* ------------------------------------------------------------------ product */

test('product: an unfamiliar product is a question; a blocked one is a skip; a known one is a plus', () => {
  const odd = J.score(mk({ product_name: 'Zorblax', product_category: 'widgets', _text: 'Remote - United States. We sell zorblax.' }), cfg);
  assert.equal(gateOf(odd, 'Product').status, 'unknown');
  assert.equal(odd.verdict, 'APPLY');
  assert.equal(odd.askRecruiter, true);
  const bad = J.score(mk({ _text: 'Remote - United States. Datadog style observability platform.' }), cfg);
  assert.equal(gateOf(bad, 'Product').status, 'fail');
  assert.equal(bad.verdict, 'SKIP');
  const known = gateOf(J.score(mk({ product_name: 'Wasabi' }), cfg), 'Product');
  assert.equal(known.status, 'pass');
  assert.match(known.detail, /You know Wasabi/);
});

/* ----------------------------------------------------------- extraction v12 */

test('extraction: the new fields normalise, and unknown enum values fall back', () => {
  const { x, evidence } = J.normalizeExtraction({
    eligibility_home: { value: 'YES', evidence: 'Remote - US only' },
    eligibility_text: { value: 'Remote - US only', evidence: 'Remote - US only' },
    office_location: { value: 'Columbus, OH', evidence: null },
    travel_purpose: { value: 'sideways' },
    ote_min: { value: '$160,000' }, ote_max: { value: 180000 },
  });
  assert.equal(x.eligibility_home, 'yes');
  assert.equal(evidence.eligibility_home, 'Remote - US only');
  assert.equal(x.office_location, 'Columbus, OH');
  assert.equal(x.travel_purpose, null);
  assert.equal(x.ote_min, 160000);
  assert.equal(J.normalizeExtraction({}).x.eligibility_home, 'unclear');
  assert.equal(J.verifyEvidence({ eligibility_home: 'yes' }, { eligibility_home: 'not on the page' }, 'Remote.').x.eligibility_home, 'unclear');
});

test('extraction: requirements are verified per item; a bad quote drops that item only', () => {
  const page = 'Requirements: 3+ years of pre-sales experience. Salesforce required. CISSP preferred.';
  const { x, evidence } = J.normalizeExtraction({
    requirements: {
      value: [
        { text: '3+ years pre-sales', kind: 'required' },
        { text: 'Salesforce', kind: 'required' },
        { text: 'AWS certification', kind: 'preferred' },
        { text: 'Anything unquoted' },
      ],
      evidence: ['3+ years of pre-sales experience', 'Salesforce required', 'AWS cert is a plus'],
    },
  });
  const v = J.verifyEvidence(x, evidence, page);
  assert.deepEqual(v.x.requirements.map((r) => r.text), ['3+ years pre-sales', 'Salesforce', 'Anything unquoted']);
  assert.equal(v.x.requirements[2].quote, null, 'kept but shown as unquoted');
  assert.deepEqual(v.droppedReqs, ['AWS certification']);
  assert.ok(v.unverified.includes('requirements'));
});

test('extraction: OTE is displayed as a note and never gated', () => {
  const g = gateOf(J.score(mk({ ote_min: 170000, ote_max: 210000 }), cfg), 'Pay');
  assert.ok(g.notes.some((n) => /OTE: \$170,000 - \$210,000/.test(n)));
});

/* --------------------------------------------------------------- fit notes */

test('fit notes: the fit prompt carries the requirements and the profile, never the posting', () => {
  const p = J.buildFitPrompt(cfg, [{ text: 'Salesforce', kind: 'required' }, { text: 'CISSP', kind: 'preferred' }]);
  assert.match(p.user, /0\. \[required\] Salesforce/);
  assert.match(p.user, /1\. \[preferred\] CISSP/);
  assert.match(p.system, /Sample profile/);
  assert.doesNotMatch(p.user, /POSTING TEXT/);
});

test('fit notes: the reply is validated against the requirement list', () => {
  const reqs = [{ text: 'Salesforce', kind: 'required' }, { text: 'Fortinet', kind: 'preferred' }];
  const fit = J.normalizeFit({
    items: [{ i: 1, meets: 'YES', note: 'Has used Fortinet' }, { i: 0, meets: 'maybe?', note: 'no CRM' }, { i: 9, meets: 'yes' }, null],
    summary: 'Salesforce is the gap.',
  }, reqs);
  assert.deepEqual(fit.items.map((i) => [i.i, i.meets]), [[0, 'unknown'], [1, 'yes']], 'sorted, bad index and bad enum handled');
  assert.equal(fit.items[1].text, 'Fortinet');
  assert.equal(fit.summary, 'Salesforce is the gap.');
});

/* ------------------------------------------------------------- results cards */

test('cards: the prefilter respects the gate modes', () => {
  const card = { title: 'Solutions Engineer', location: 'Remote', pay: '$90,000 - $110,000 a year' };
  assert.equal(J.cheapGates(card, cfg).name, 'Pay');
  assert.equal(J.cheapGates(card, J.setPath(cfg, 'gates.pay.onFail', 'flag')), null, 'a flagged gate does not dim a card');
  const metro = { title: 'Solutions Engineer', location: 'Columbus, OH (Hybrid)', pay: null };
  assert.equal(J.cheapGates(metro, cfg), null, 'hybrid in the metro is not provably a fail');
});

/* ------------------------------------------------------------ policy + log */

test('log: looking at the same posting twice replaces its entry', () => {
  const store = [];
  const upsert = (entry) => {
    const last = store[store.length - 1];
    if (last && last.url === entry.url) store[store.length - 1] = entry; else store.push(entry);
  };
  upsert({ url: 'a', verdict: 'SKIP' });
  upsert({ url: 'a', verdict: 'APPLY' });
  upsert({ url: 'b', verdict: 'SKIP' });
  assert.deepEqual(store.map((e) => e.verdict), ['APPLY', 'SKIP']);
});

/* ------------------------------------------------------- pay: compare point */

test('pay: the floor can be held against the top, the midpoint or the bottom of the range', () => {
  const at = (min, max, mode) => J.score(mk({ base_min: min, base_max: max }), J.setPath(cfg, 'gates.pay.compareAt', mode));
  const pay = (r) => gateOf(r, 'Pay');

  // default is top: a $100k-$170k band passes, and is flagged because it starts under the floor
  assert.equal(J.DEFAULT_SETTINGS.gates.pay.compareAt, 'top');
  const top = at(100000, 170000, 'top');
  assert.equal(pay(top).status, 'pass');
  assert.match(pay(top).detail, /tops at \$170,000/);
  assert.ok(top.flags.some((f) => /starts at \$100,000/.test(f.text)), 'the straddle flag is the safety net');

  // midpoint: $100k-$170k is $135k, passes; $100k-$140k is $120k, fails
  assert.equal(pay(at(100000, 170000, 'midpoint')).status, 'pass');
  assert.match(pay(at(100000, 170000, 'midpoint')).detail, /midpoint is \$135,000 \(range \$100,000 - \$170,000\)/);
  const low = at(100000, 140000, 'midpoint');
  assert.equal(pay(low).status, 'fail');
  assert.match(pay(low).detail, /midpoint is \$120,000.*under \$125,000/);
  assert.equal(low.verdict, 'SKIP');
  assert.equal(at(100000, 140000, 'top').verdict, 'APPLY', 'the same posting under the default comparison');

  // bottom: only a range that starts at the floor passes
  assert.equal(pay(at(100000, 170000, 'bottom')).status, 'fail');
  assert.match(pay(at(100000, 170000, 'bottom')).detail, /starts at \$100,000/);
  assert.equal(pay(at(125000, 170000, 'bottom')).status, 'pass');
  assert.equal(at(125000, 170000, 'bottom').flags.length, 0, 'nothing to flag when the bottom clears the floor');
});

test('pay: one posted figure is the top, the midpoint and the bottom', () => {
  for (const mode of ['top', 'midpoint', 'bottom']) {
    const res = J.score(mk({ base_min: 130000, base_max: 130000 }), J.setPath(cfg, 'gates.pay.compareAt', mode));
    assert.equal(gateOf(res, 'Pay').status, 'pass', mode);
    const only = J.score(mk({ base_min: null, base_max: 118000, base_source: 'stated' }), J.setPath(cfg, 'gates.pay.compareAt', mode));
    assert.equal(gateOf(only, 'Pay').status, 'fail', mode);
  }
  assert.deepEqual(J.payFigure(null, null, 'top'), { value: null, verb: '' });
});

test('pay: the preferred base is judged on the same point of the range', () => {
  const note = (mode) => gateOf(J.score(mk({ base_min: 125000, base_max: 150000 }), J.setPath(cfg, 'gates.pay.compareAt', mode)), 'Pay').notes.join(' ');
  assert.match(note('top'), /Meets your preferred/);
  assert.match(note('midpoint'), /Meets your preferred/, 'midpoint 137,500');
  assert.match(note('bottom'), /under your preferred/);
});

test('pay: the same rule applies to a range read from the text when the model returned nothing', () => {
  const x = (mode) => J.score(mk({ base_min: null, base_max: null, base_source: null,
    _text: 'The base salary range is $100,000 to $140,000 per year.' }), J.setPath(cfg, 'gates.pay.compareAt', mode));
  assert.equal(gateOf(x('top'), 'Pay').status, 'pass');
  assert.equal(gateOf(x('midpoint'), 'Pay').status, 'fail');
  assert.match(gateOf(x('midpoint'), 'Pay').detail, /read from the text/);
});

test('pay: the setting is in the form, as a select with the three choices', () => {
  const field = J.SCHEMA.flatMap((s) => s.fields).find((f) => f.path === 'gates.pay.compareAt');
  assert.deepEqual(field.options.map((o) => o[0]), ['top', 'midpoint', 'bottom']);
});

/* ------------------------------------------------- any home region, not one */

// A second home, unrelated to the sample defaults, so these prove the location
// logic is driven by settings rather than by any one place.
const denver = J.setPath(cfg, 'home', {
  region: 'Denver, Colorado',
  aliases: ['denver', 'denver metro', 'colorado', 'co'],
  metro: ['denver', 'denver metro', 'aurora', 'lakewood', 'englewood'],
});
const locIn = (home, o) => gateOf(J.score(mk(o), home), 'Location');

test('home: the home state is read from the territory words, by name or by code', () => {
  assert.deepEqual(J.homeState(cfg), { name: 'Ohio', code: 'OH' });
  assert.deepEqual(J.homeState(denver), { name: 'Colorado', code: 'CO' });
  assert.deepEqual(J.homeState(J.setPath(cfg, 'home.aliases', ['austin', 'tx'])), { name: 'Texas', code: 'TX' });
  assert.deepEqual(J.homeState(J.setPath(cfg, 'home.aliases', ['north carolina'])), { name: 'North Carolina', code: 'NC' });
  const noState = J.setPath(cfg, 'home', { region: 'Greater Toronto Area', aliases: ['toronto'], metro: ['toronto'] });
  assert.equal(J.homeState(noState), null);
  assert.equal(J.homeLabel(noState), 'Greater Toronto Area', 'with no state, messages name the region');
});

test('home: a different home state changes what counts as foreign, with no code change', () => {
  assert.equal(J.mentionsForeignPlace('Denver, CO 80202', denver), null, 'home city and code are never foreign');
  assert.equal(J.mentionsForeignPlace('Denver, CO 80202', cfg), 'Denver', 'the same card is foreign from Ohio');
  assert.equal(J.mentionsForeignPlace('Columbus, OH 43215', denver), 'OH 43215');
  assert.equal(J.mentionsForeignPlace('Columbus, OH 43215', cfg), null);
  assert.equal(locIn(denver, { work_arrangement: 'hybrid_work', office_location: 'Lakewood, CO', eligibility_home: 'unclear' }).status, 'pass');
  assert.equal(locIn(denver, { work_arrangement: 'hybrid_work', office_location: 'Columbus, OH', eligibility_home: 'unclear' }).status, 'fail');
});

test('home: gate wording and recruiter questions name the configured home', () => {
  const no = locIn(denver, { eligibility_home: 'no', eligibility_text: 'must reside in the Pacific Northwest', page_location: 'Remote' });
  assert.match(no.detail, /Colorado is not included/);
  const ask = locIn(denver, { eligibility_home: 'unclear', page_location: 'Remote in New York', location_scope: 'unclear', _text: 'Sells firewalls.' });
  assert.equal(ask.status, 'unknown');
  assert.match(ask.ask.join(' '), /open to candidates in Colorado\?/);
  assert.doesNotMatch(JSON.stringify(ask), /Ohio|Columbus/, 'nothing from the sample home leaks into another home');
  assert.match(J.buildSystemPrompt(denver), /lives in Denver, Colorado/);
  assert.doesNotMatch(J.buildSystemPrompt(denver), /Columbus|Ohio/);
});

test('home: facts cached under the old eligibility_ky name still score', () => {
  const old = locOf({ eligibility_home: undefined, eligibility_ky: 'no', eligibility_text: 'must reside in the Pacific Northwest', page_location: 'Remote' });
  assert.equal(old.status, 'fail');
  assert.equal(J.normalizeExtraction({ eligibility_ky: { value: 'yes', evidence: 'Remote - US' } }).x.eligibility_home, 'yes');
});
