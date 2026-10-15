/*
 * Dependency-free unit tests for the pure parts of JobScore.user.js.
 *
 *   node test/score.test.cjs
 *
 * These cover the same scenarios as the manual checklist in README.md, so a
 * scoring change can be checked in a second without opening a job board.
 * They do NOT test the DOM extraction or the LLM call - those are manual.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as J from '../src/all.js';
import { testConfig } from './fixtures.js';

const cfg = testConfig();

// A full, already-verified extraction object (the shape score() receives).
function mk(overrides) {
  return Object.assign({
    title: 'Solutions Engineer',
    company: 'Acme Security',
    page_title: 'Solutions Engineer',
    page_location: 'Remote - United States',
    _text: 'Remote - United States',
    work_arrangement: 'remote',
    location_restriction: 'Remote US',
    location_text: 'Remote - United States',
    base_min: 130000,
    base_max: 150000,
    pay_range_is_job_family_wide: false,
    pay_posted: true,
    role_type: 'presales',
    quota_carrying: false,
    years_required: 3,
    years_required_kind: 'customer_facing_technical',
    buyer_persona: 'it_director',
    product_name: 'Fortinet',
    product_category: 'firewall / network security',
    named_tools: ['FortiGate'],
    travel_percent: null,
    travel_scope: 'none',
    posted_days_ago: 5,
    employer_type: 'direct',
    one_line_summary: 'Pre-sales SE for a firewall vendor selling to IT directors.',
  }, overrides || {});
}

const byKey = (res, key) => res.components.find((c) => c.key === key);
const gateOf = (res, name) => res.gates.find((g) => g.name === name);


console.log('score()');

test('1. Palo Alto Solutions Consultant 2 in Newark with a base-plus-commission range is SKIP', () => {
  const x = mk({
    title: 'Solutions Consultant 2',
    page_title: 'Solutions Consultant 2',
    page_location: 'Newark, NJ',
    base_min: null,
    base_max: null,
    base_source: 'not_stated',
    _text: 'Palo Alto Networks - Solutions Consultant 2, Newark NJ. ' +
      'Compensation: base plus commission, on-target earnings range $180,000 - $220,000 annually. ' +
      '6+ years experience in pre-sales/sales engineering required.',
  });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'SKIP');
  assert.notEqual(res.verdict, 'APPLY');
  assert.equal(gateOf(res, 'Title').status, 'pass', 'a Solutions Consultant title passes the title gate');
  assert.equal(gateOf(res, 'Location').status, 'fail', 'a Newark, NJ card fails the location gate');
});

test('2. no base posted is no longer a SKIP: APPLY, with the question for the recruiter', () => {
  const x = mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Remote, United States',
    base_min: null,
    base_max: null,
    base_source: 'not_stated',
    _text: 'Sales Engineer. Remote, United States. Responsibilities: run demos. Requirements: 3 years experience.',
  });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'APPLY');
  assert.equal(res.askRecruiter, true);
  assert.equal(gateOf(res, 'Pay').status, 'unknown');
  assert.equal(gateOf(res, 'Pay').kind, 'not_posted');
  assert.ok(res.questions.some((q) => /base salary/i.test(q)), 'the recruiter question is built for you');
  assert.equal(gateOf(res, 'Location').status, 'pass');
  assert.equal(res.fail_gate, null);

  // The same posting with the setting turned back to the old behaviour.
  const strict = J.setPath(cfg, 'gates.pay.onNotPosted', 'skip');
  const old = J.score(x, strict);
  assert.equal(old.verdict, 'SKIP');
  assert.equal(old.fail_gate, 'Pay');
  assert.match(old.reason, /No base pay stated/);
});
test('3. a stated base whose top is under $125,000 is SKIP', () => {
  const x = mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Remote, United States',
    base_min: 90000,
    base_max: 110000,
    base_source: 'stated',
    _text: 'Sales Engineer. Remote, United States. The base salary range is $90,000 - $110,000 per year. ' +
      'Requirements: 3 years experience.',
  });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'SKIP');
  assert.equal(res.fail_gate, 'Pay');
  assert.match(res.fail_detail, /under/);
});

test('4. Arctic Wolf Senior Sales Engineer with a Columbus territory and base over the floor is APPLY', () => {
  const x = mk({
    title: 'Senior Sales Engineer',
    page_title: 'Senior Sales Engineer',
    page_location: 'Columbus, OH',
    _text: 'Senior Sales Engineer, Arctic Wolf. Managed Detection and Response (MDR) platform. ' +
      'This role must live in Columbus or Cincinnati. Compensation: base salary range $130,000 - $160,000. ' +
      '5+ years customer-facing experience, preferably presales.',
  });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'APPLY');
  assert.equal(gateOf(res, 'Location').status, 'pass', 'must-live Columbus territory passes');
  assert.equal(gateOf(res, 'Title').status, 'pass', 'Senior is allowed');
  assert.equal(gateOf(res, 'Product').status, 'pass');
});

test('5. "Hybrid cloud" does not fail location, but "hybrid workplace" and "field sales" do', () => {
  const cloud = J.score(mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Remote, United States',
    _text: 'Experience with hybrid cloud and hybrid identity. This is a fully remote role in the United States.',
  }), cfg);
  assert.equal(gateOf(cloud, 'Location').status, 'pass', 'hybrid cloud is a technology, not hybrid work');
  assert.deepEqual(gateOf(cloud, 'Location').soft, [], 'and it raises no office-wording flag either');

  // Model could not tell: the regex over the text decides, and says hybrid.
  const workplace = J.score(mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Remote, United States',
    work_arrangement: 'unclear',
    eligibility_home: 'unclear',
    _text: 'We have a hybrid workplace; three days a week in the office.',
  }), cfg);
  assert.equal(gateOf(workplace, 'Location').status, 'fail');

  // Model read the posting as remote: it wins, and the office wording is only a flag.
  const modelRemote = J.score(mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Remote, United States',
    _text: 'Our hybrid workplace is optional; this role is fully remote.',
  }), cfg);
  const loc = gateOf(modelRemote, 'Location');
  assert.equal(loc.status, 'pass');
  assert.equal(loc.soft.length, 1, 'office wording on a remote role is a flag to confirm');

  const field = J.score(mk({
    title: 'Sales Engineer',
    page_title: 'Sales Engineer',
    page_location: 'Denver, CO',
    _text: 'This is a field sales role covering the Rocky Mountains.',
  }), cfg);
  assert.equal(gateOf(field, 'Location').status, 'fail');
});
test('6. APPLY only when every gate passes', () => {
  const res = J.score(mk({
    title: 'Solutions Engineer',
    page_title: 'Solutions Engineer',
    page_location: 'Remote, United States',
    _text: 'Solutions Engineer. Remote anywhere in the United States. Firewall and network security. ' +
      'Base salary range $140,000 - $170,000. 3 years experience.',
  }), cfg);
  assert.equal(res.verdict, 'APPLY');
  assert.equal(res.gateFailed, false);
  assert.equal(res.askRecruiter, false, 'nothing to ask');
  assert.equal(res.fail_gate, null);
  assert.deepEqual(res.questions, []);
});
test('7. every gate carries status, name, detail and a quote, and verdict follows from the fails', () => {
  assert.equal(typeof J.score, 'function');
  assert.equal(J.score.length, 2, 'score(x, cfg) must keep two parameters');
  assert.equal(J.buildPrompt.length, 2, 'buildPrompt(cfg, page) must keep two parameters');

  const res = J.score(mk({ title: 'Sales Engineer', page_title: 'Sales Engineer', page_location: 'Boston, MA', _text: 'Remote.' }), cfg);
  assert.equal(res.verdict, res.gateFailed ? 'SKIP' : 'APPLY');
  for (const g of res.gates) {
    assert.ok(g.name, 'a gate must have a name');
    assert.ok(['pass', 'fail', 'caution', 'unknown'].indexOf(g.status) !== -1, 'unexpected status ' + g.status);
    assert.equal(typeof g.detail, 'string');
    assert.equal(typeof g.quote, 'string');
  }
});

test('7b. Solutions Architect titles pass, Enterprise/Software/Data Architect do not', () => {
  const body = 'Remote. Firewall. Base salary range $150,000 - $170,000. 3 years experience.';
  const base = { _text: body, page_location: 'United States' };
  for (const title of ['Solutions Architect', 'Sr. Solutions Architect', 'Cloud Solutions Architect', 'Technical Solutions Architect', 'Sales Architect']) {
    const res = J.score(mk(Object.assign({ title: title, page_title: title }, base)), cfg);
    assert.equal(gateOf(res, 'Title').status, 'pass', title + ' should pass the title gate');
  }
  for (const title of ['Enterprise Architect', 'Software Architect', 'Data Architect']) {
    const res = J.score(mk(Object.assign({ title: title, page_title: title, role_type: 'other' }, base)), cfg);
    assert.equal(gateOf(res, 'Title').status, 'fail', title + ' should not pass the title gate');
  }
});

test('7c. a US-wide card passes location, a named city does not', () => {
  const body = 'Remote. Firewall. Base salary range $150,000 - $170,000. 3 years experience.';
  for (const loc of ['United States', 'United States of America', 'USA', 'Remote US', 'US Remote']) {
    const res = J.score(mk({ title: 'Solutions Engineer', page_title: 'Solutions Engineer', page_location: loc, _text: body }), cfg);
    assert.equal(gateOf(res, 'Location').status, 'pass', 'card ' + loc + ' should pass location');
  }
  const city = J.score(mk({ title: 'Solutions Engineer', page_title: 'Solutions Engineer', page_location: 'Newark, NJ', _text: body }), cfg);
  assert.equal(gateOf(city, 'Location').status, 'fail', 'a named city should still fail location');
});

test('7d. Wasabi Sr. Solutions Architect, US-wide card, base $140k-170k is APPLY', () => {
  const x = mk({
    title: 'Sr. Solutions Architect',
    page_title: 'Sr. Solutions Architect',
    page_location: 'United States of America',
    _text: 'Sr. Solutions Architect. Wasabi hot cloud storage. Serve as a technical resource throughout the sales process. ' +
      '5+ years of experience in Solution Architecture, Sales Engineering, Support Engineering, Cloud Engineering, ' +
      'or a similar customer-facing technical role. Compensation: Base Salary - $140,000 - 170,000.',
  });
  const res = J.score(x, cfg);
  assert.equal(res.verdict, 'APPLY', 'expected APPLY, got ' + res.reason);
  assert.equal(gateOf(res, 'Title').status, 'pass');
  assert.equal(gateOf(res, 'Location').status, 'pass');
});

test('7e. Greenhouse selectors cover the job__title / job__description / job__location handles', () => {
  const gh = J.SITE_SELECTORS.find((s) => /greenhouse/i.test(String(s.match)));
  assert.ok(gh, 'Greenhouse site entry must exist');
  assert.ok(gh.location.some((sel) => sel.indexOf('job__location') !== -1),
    'Greenhouse location must match .job__location so the banner location is captured');
  assert.ok(gh.title.some((sel) => sel.indexOf('job__title') !== -1),
    'Greenhouse title must match the heading inside .job__title (the h1.section-header)');
  assert.equal(gh.description[0], '.job__description',
    'Greenhouse description must lead with .job__description, the real posting body');
});

test('7f. location_scope drives the gate; a zone alone still needs remote', () => {
  const body = 'Sr. Solutions Architect. Wasabi. EST Zone. Base salary range $150,000 - $170,000. Firewall. 3 years experience.';
  const base = { title: 'Sr. Solutions Architect', page_title: 'Sr. Solutions Architect', page_location: '', location_restriction: null, work_arrangement: 'unclear', _text: body };
  const at = (extra) => gateOf(J.score(mk(Object.assign({}, base, extra)), cfg), 'Location').status;

  assert.equal(at({}), 'fail', 'EST Zone with no remote statement and no scope is not enough');
  assert.equal(at({ location_scope: 'us_region' }), 'fail', 'us_region without a remote statement is not enough');
  assert.equal(at({ location_scope: 'us_region', _text: body + ' This is a remote position.' }), 'pass');
  assert.equal(at({ location_scope: 'us_wide' }), 'pass');
  assert.equal(at({ location_scope: 'non_us' }), 'fail');
  assert.equal(at({ location_scope: 'named_place', _text: body + ' Based in Austin, TX.' }), 'fail');
  assert.equal(at({ location_scope: 'named_place', _text: body + ' Based in Columbus, OH.' }), 'pass');
});

test('7g. normalizeExtraction parses location_scope and an unverified quote falls back to unclear', () => {
  const ok = J.normalizeExtraction({ location_scope: { value: 'US_Region', evidence: 'EST Zone' } });
  assert.equal(ok.x.location_scope, 'us_region');
  assert.equal(ok.evidence.location_scope, 'EST Zone');

  const bad = J.normalizeExtraction({ location_scope: { value: 'nonsense', evidence: null } });
  assert.equal(bad.x.location_scope, 'unclear');

  const v = J.verifyEvidence({ location_scope: 'us_wide' }, { location_scope: 'nowhere on the page' }, 'Sales engineer. Remote.');
  assert.equal(v.x.location_scope, 'unclear');
  assert.ok(v.unverified.indexOf('location_scope') !== -1);
});

console.log('canonicalKey()');

test('8. LinkedIn search click-through keys on the job id, not the URL', () => {
  const a = J.canonicalKey('https://www.linkedin.com/jobs/search/?keywords=se&currentJobId=4012345678&position=1&pageNum=0');
  const b = J.canonicalKey('https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=xyz');
  assert.equal(a, 'linkedin:job:4012345678');
  assert.equal(b, 'linkedin:job:4012345678');
  assert.equal(a, b);
});

test('9. other sites drop tracking parameters but keep real query params', () => {
  const u = J.canonicalKey('https://boards.greenhouse.io/acme/jobs/123?utm_source=alert&gh_src=x&foo=bar#apply');
  assert.equal(u, 'https://boards.greenhouse.io/acme/jobs/123?foo=bar');
});

console.log('verifyEvidence()');

test('10. a quote that is not in the page text nulls its own field', () => {
  const x = mk({ base_min: 300000, base_max: 400000, work_arrangement: 'remote', pay_posted: true });
  const bad = 'base salary range is $300,000 to $400,000';   // not on the page
  const pageText = 'We are hiring a Solutions Engineer. This role is fully remote within the US.';

  // Only the fields that carry a quote are checked. base_max has none here, so it
  // survives - which is exactly why the prompt asks for a quote on every field.
  const out = J.verifyEvidence(x, { base_min: bad, work_arrangement: 'this role is fully remote' }, pageText);
  assert.ok(out.unverified.includes('base_min'));
  assert.equal(out.x.base_min, null);
  assert.equal(out.x.work_arrangement, 'remote', 'a verbatim quote is kept');

  const both = J.verifyEvidence(x, { base_min: bad, base_max: bad, pay_posted: bad }, pageText);
  assert.equal(both.x.base_min, null);
  assert.equal(both.x.base_max, null);
  assert.equal(both.x.pay_posted, false, 'a bad quote must not leave pay_posted true');
});

test('10b. whitespace and case differences still verify', () => {
  const out = J.verifyEvidence(
    mk({ company: 'Acme' }),
    { company: 'ACME   Security' },
    'About ACME Security\nWe sell firewalls.'
  );
  assert.deepEqual(out.unverified, []);
});

test('10c. unmet_requirements is gone from the schema, the prompt and the extraction', () => {
  // It was never read by score() after the gate-only rewrite, so its dropped
  // quotes only produced an "unverified" row with nothing behind it.
  assert.doesNotMatch(J.buildSystemPrompt(cfg), /unmet_requirements/);
  const { x } = J.normalizeExtraction({
    unmet_requirements: [{ requirement: 'CISSP required', severity: 'blocking', evidence: 'x' }],
  });
  assert.equal(x.unmet_requirements, undefined);
  assert.equal(J.verifyEvidence(x, {}, 'anything').droppedRequirements, undefined);
});

console.log('buildPrompt() / buildHttpRequest()');

test('11. the system prompt states the hybrid-cloud rule; the profile goes only to the fit call', () => {
  const p = J.buildPrompt(cfg, { url: 'https://x/y', body: 'text', title: 'SE', company: 'Acme', location: 'Remote' });
  assert.match(p.system, /"Hybrid cloud"/);
  assert.match(p.system, /must NOT be treated as hybrid work/);
  assert.match(p.system, /base_min and base_max are BASE pay only/);
  assert.match(p.system, /derived_from_ote/, 'the prompt must ask for the OTE-to-base arithmetic');
  assert.match(p.system, /base_min and base_max stay null/, 'an OTE with no split cannot become a base');
  assert.match(p.system, /Do not paraphrase, tidy up, or translate a quote/);
  assert.doesNotMatch(p.system, /Sample profile/, 'the profile is for the fit-notes call, not extraction');
  assert.match(J.buildFitPrompt(cfg, [{ text: 'Salesforce', kind: 'required' }]).system, /Sample profile/);
  assert.match(p.system, /eligibility_home/);
  assert.doesNotMatch(p.system, /unmet_requirements: judge ONLY/);
  assert.match(p.system, /Do not decide APPLY or SKIP/);

  assert.match(p.user, /PAGE URL: https:\/\/x\/y/);
  assert.match(p.user, /--- POSTING TEXT START ---/);
});

test('11b. ld+json data and the posted-days hint are passed through', () => {
  const p = J.buildPrompt(cfg, {
    url: 'https://x/y', body: 'text', title: 'SE', company: 'Acme',
    ld: { datePosted: '2026-09-01', salary: '120000-140000 USD/YEAR' },
    posted_days_ago: 12,
  });
  assert.match(p.user, /datePosted=2026-09-01/);
  assert.match(p.user, /POSTED-DAYS-AGO HINT \(computed from the posting date\): 12/);
});

test('12. provider request shapes: temperature only where accepted, and JSON forcing', () => {
  const sys = 'sys', user = 'user';

  const anthropic = J.buildHttpRequest('anthropic', { key: 'k', model: 'm' }, sys, user);
  assert.equal(anthropic.body.temperature, undefined, 'newer Claude models reject temperature, so it is not sent');
  assert.equal(J.buildHttpRequest('anthropic', { key: 'k', model: 'm', temperature: true }, sys, user).body.temperature, 0);
  assert.equal(anthropic.headers['x-api-key'], 'k');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.prefill, false, 'current Claude models reject a prefilled assistant turn');
  assert.equal(anthropic.body.messages.length, 1);
  assert.equal(anthropic.body.messages[0].role, 'user');
  assert.equal(anthropic.body.max_tokens, 16000, 'room for default thinking plus the JSON');

  const openai = J.buildHttpRequest('openai', { key: 'k', model: 'm' }, sys, user);
  assert.equal(openai.body.temperature, undefined, 'current OpenAI models are reasoning models and reject temperature');
  assert.equal(openai.body.max_tokens, undefined, 'reasoning models reject max_tokens');
  assert.equal(openai.body.max_completion_tokens, 16000);
  assert.equal(J.buildHttpRequest('openai', { key: 'k', model: 'm', temperature: true }, sys, user).body.temperature, 0);
  assert.deepEqual(openai.body.response_format, { type: 'json_object' });
  assert.equal(openai.headers.authorization, 'Bearer k');

  const ollama = J.buildHttpRequest('ollama', { key: '', model: 'llama3.1:8b', url: 'http://localhost:11434/api/chat' }, sys, user);
  assert.equal(ollama.body.format, 'json');
  assert.equal(ollama.body.options.temperature, 0);
  assert.equal(ollama.body.stream, false);
  assert.match(ollama.url, /^http:\/\/localhost:11434\//);
});

test('13. defensive JSON parsing strips code fences and prose', () => {
  const obj = J.parseModelJson('```json\n{"title":{"value":"SE","evidence":"SE"}}\n```');
  assert.equal(obj.title.value, 'SE');
  const bare = J.parseModelJson('Sure! Here you go:\n{"a":1}\nHope that helps.');
  assert.deepEqual(bare, { a: 1 });
});

test('14. normalizeExtraction defaults unknown enums instead of trusting them', () => {
  const { x } = J.normalizeExtraction({
    title: { value: 'SE', evidence: 'SE' },
    work_arrangement: { value: 'HYBRID', evidence: null },
    role_type: { value: 'solutions_engineer', evidence: null },
    named_tools: { value: ['FortiGate', 42, ''], evidence: ['FortiGate'] },
    base_max: { value: '$150,000', evidence: 'base 150k' },
  });
  assert.equal(x.work_arrangement, 'unclear');
  assert.equal(x.role_type, 'other');
  assert.deepEqual(x.named_tools, ['FortiGate', '42']);
  assert.equal(x.base_max, 150000);
});

console.log('extractionWarnings()');

test('15. a LinkedIn-style collapsed posting is flagged', () => {
  const w = J.extractionWarnings({
    site: 'LinkedIn',
    body_length: 900,
    body: 'About the job\nFor our client, we are seeking a Solutions Engineer... show more',
  });
  assert.ok(w.some((s) => /collapsed/.test(s)), 'expected a collapsed-posting warning');
});

test('15b. a full posting from a known site produces no warnings', () => {
  const w = J.extractionWarnings({
    site: 'Greenhouse',
    body_length: 4200,
    body: 'We are hiring. Responsibilities:\n' + 'Lead technical discovery. '.repeat(40) + '\nRequirements: 3+ years.',
  });
  assert.deepEqual(w, []);
});

test('15c. the generic fallback is reported only when it found part of a posting', () => {
  const part = 'About us. We build firewall software. '.repeat(30);
  const w = J.extractionWarnings({ site: 'generic', body_length: part.length, body: part });
  assert.ok(w.some((s) => /no dedicated selectors/.test(s)), 'a fragment from an unlisted site is called out');
  const whole = J.extractionWarnings({ site: 'generic', body_length: 3000, body: 'x'.repeat(3000) });
  assert.ok(!whole.some((s) => /no dedicated selectors/.test(s)), 'a whole posting from an unlisted site is normal, not a warning');
});

console.log('description candidate picking');

test('16. a results-list card snippet is not a full posting', () => {
  // The opening paragraph of the Ladders posting, as it appears in a LinkedIn
  // results card. This is the text that was winning over the open posting.
  const snippet = 'For our client, we are seeking a Solutions Engineer to join the team of a leader in the ' +
    'Telecommunications & Hardware space. In this role, you will partner closely with enterprise ' +
    'customers to translate business priorities into practical technical strategies and solution designs.';
  assert.ok(snippet.length > 200, 'the snippet must be long enough to be considered at all');
  assert.equal(J.looksLikeFullPosting(snippet), false);
});

test('16b. the whole posting is a full posting', () => {
  const full = 'About the job\n' + 'For our client, we are seeking a Solutions Engineer. '.repeat(25) +
    '\nLocation: Remote - US based candidates only\nCompensation: $218,600 - $286,100 annually\n' +
    'Responsibilities\n- Lead technical discovery\nQualifications\n- 7+ years in solutions engineering\n';
  assert.ok(full.length >= 1200);
  assert.equal(J.looksLikeFullPosting(full), true);
  assert.ok(J.postingSignalCount(full) >= 3);
});

test('16c. a very long block counts as a posting even with few keywords', () => {
  assert.equal(J.looksLikeFullPosting('x'.repeat(3000)), true);
});

test('17. Built In descriptions are picked up by the id heuristic', () => {
  // The real element is <div id="job-post-body-11396424">. The generic selector
  // list is what catches it when the site entry misses.
  const generics = J.GENERIC_DESC_SELECTORS;
  assert.ok(generics.some((s) => s.includes('job-post-body')), 'expected a job-post-body selector');
});

console.log('unknown-site policy');

test('18. a job URL on an unlisted host is job-like', () => {
  assert.equal(J.isJobLikeUrl('https://careers.trellix.com/jobs/junior-solutions-engineer/'), true);
  assert.equal(J.isJobLikeUrl('https://acme.com/careers/1234'), true);
  assert.equal(J.isJobLikeUrl('https://acme.com/position/abc'), true);
  assert.equal(J.isJobLikeUrl('https://mail.google.com/mail/u/0/'), false);
  assert.equal(J.isJobLikeUrl('https://news.ycombinator.com/item?id=1'), false);
});

test('18b. known job-board hosts are never auto-scored by the catch-all', () => {
  assert.equal(J.hostBlocked('www.google.com'), true);
  assert.equal(J.hostBlocked('mail.google.com'), true);
  assert.equal(J.hostBlocked('github.com'), true);
  assert.equal(J.hostBlocked('careers.trellix.com'), false);
});

test('18c. an unlisted page has to read like a posting to auto-score', () => {
  const page = {
    host: 'careers.trellix.com',
    url: 'https://careers.trellix.com/jobs/junior-solutions-engineer/',
    body: 'About the role. '.repeat(80) +
      'Responsibilities: deliver demonstrations. Qualifications: 1-3 years experience. ' +
      'Compensation: competitive. Location: Remote. Benefits: medical.',
  };
  assert.equal(J.shouldAutoScore(page), true);

  const blog = {
    host: 'example.com',
    url: 'https://example.com/blog/post/1',
    body: 'A short blog post about hiring trends and nothing else. '.repeat(30),
  };
  assert.equal(J.shouldAutoScore(blog), false);
});

test('18d. labelled body fields become the header values', () => {
  const body = [
    'Job Title:',
    'Junior Solutions Engineer',
    'About Trellix',
    'Role Overview:',
    'Location: Remote - US based candidates only, no visa sponsorship',
    'Responsibilities',
  ].join('\n');
  const hdr = J.headerFromBody(body);
  assert.equal(hdr.title, 'Junior Solutions Engineer');
  assert.match(hdr.location, /^Remote/);
});

test('18e. a bare "Title:" or "Role:" label is not a job title', () => {
  assert.equal(J.headerFromBody('Role:\n\nOverview\n').title, null);
  assert.equal(J.headerFromBody('Summary: this is a summary of things that happened today at work')
    .title, null);
});

test('18f. a document title becomes a fallback job title', () => {
  assert.equal(J.titleFromDocTitle('Junior Solutions Engineer | Trellix Careers'), 'Junior Solutions Engineer');
  assert.equal(J.titleFromDocTitle('Solutions Engineer - Acme'), 'Solutions Engineer');
});

console.log('gate source quotes');

test('19. every gate still exposes evidenceKeys for the old UI and a quote string', () => {
  const res = J.score(mk({}), cfg);
  for (const g of res.gates) {
    assert.ok(Array.isArray(g.evidenceKeys), g.name + ' must expose evidenceKeys');
    assert.equal(typeof g.quote, 'string');
  }
});

test('19c. an unverified work-arrangement quote leaves the gate with no quote', () => {
  const pageText = 'We are hiring a Solutions Engineer. Responsibilities: sell things. Requirements: 3 years.';
  const { x, evidence } = J.normalizeExtraction({
    title: { value: 'Solutions Engineer', evidence: 'Solutions Engineer' },
    work_arrangement: { value: 'hybrid_work', evidence: '3 days a week in our office' },
    location_restriction: { value: null, evidence: null },
    role_type: { value: 'presales', evidence: null },
  });
  const v = J.verifyEvidence(x, evidence, pageText);
  assert.equal(v.x.work_arrangement, 'unclear', 'the invented quote must null the field');
  assert.equal(v.status.work_arrangement, 'unverified', 'the UI shows "not found" rather than a quote');
  assert.ok(v.unverified.includes('work_arrangement'));
  assert.equal(evidence.work_arrangement, '3 days a week in our office');

  // A quote that IS in the page survives, so the gate has something real to show.
  const good = J.verifyEvidence(x, Object.assign({}, evidence, { work_arrangement: 'Solutions Engineer' }), pageText);
  assert.equal(good.x.work_arrangement, 'hybrid_work');
  assert.equal(good.status.work_arrangement, 'verified');
});

console.log('history metrics');

test('20. computeHistory tallies totals, verdicts, flags and companies', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const entries = [
    { company: 'Acme', verdict: 'APPLY', flags: ['Pay'], timestamp: '2026-09-30T10:00:00Z' },
    { company: 'Acme', verdict: 'SKIP', fail_gate: 'Location', flags: [], timestamp: '2026-09-29T10:00:00Z' },
    { company: 'Globex', verdict: 'APPLY', flags: [], timestamp: '2026-09-01T10:00:00Z' },
    { company: null, verdict: 'ADJACENT', flags: ['Travel', 'Pay'], timestamp: '2026-08-01T10:00:00Z' },
    null,
  ];
  const h = J.computeHistory(entries, now);
  assert.equal(h.total, 4, 'junk entries are ignored');
  assert.equal(h.apply, 2);
  assert.equal(h.adjacent, 1);
  assert.equal(h.skip, 1);
  assert.equal(h.asked, 2, 'non-skip verdicts that carried a question');
  assert.deepEqual(h.companies[0], { key: 'Acme', n: 2 }, 'companies are ranked by count');
  assert.equal(h.companies.length, 3, 'a missing company becomes (unknown company)');
  assert.deepEqual(h.flagGates[0], { key: 'Pay', n: 2 });
  assert.equal(h.last7, 2, 'only the last 7 days are counted');
  assert.equal(h.last.company, null);
});
test('20b. an empty log is a clean zero state', () => {
  const h = J.computeHistory([], Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(h.total, 0);
  assert.equal(h.apply, 0);
  assert.equal(h.last7, 0);
  assert.deepEqual(h.companies, []);
  assert.equal(h.last, null);
});

test('21. the copyable summary quotes the posting, never invents wording', () => {
  const x = mk({ work_arrangement: 'hybrid_work' });
  const src = J.buildSummarySource(x, {
    work_arrangement: '2 days working from the office and 3 days of remote work, each week',
    location_restriction: 'Columbus, OH',
  });
  assert.match(src, /^work arrangement: "2 days working from the office and 3 days of remote work, each week"/);
  assert.match(src, /location: "Columbus, OH"/);

  // Nothing verified -> null, so the caller can say so instead of guessing.
  assert.equal(J.buildSummarySource(x, {}), null);
  assert.equal(J.buildSummarySource(x, null), null);

  // An identical location quote is not repeated.
  const dup = J.buildSummarySource(mk({ work_arrangement: 'remote' }), {
    work_arrangement: 'Remote - United States',
    location_restriction: 'remote - united states',
  });
  assert.equal(dup, 'work arrangement: "Remote - United States"');
});

console.log('coverage report (the Wasabi shape)');

// The real failure this guards: Greenhouse's location banner was not matched by
// any selector, so "United States of America" reached neither the model nor the
// scorer. Nothing in the old pipeline noticed, and the run ended in a confident
// "Location fail" that looked like a judgement.
const wasabiBody = 'Role Description: Sr. Solutions Architect - EST Zone.\n' +
  'Serve as a technical resource throughout the sales process. '.repeat(20) +
  '\nRequirements: 5+ years of experience in Solution Architecture, Sales Engineering, ' +
  'Support Engineering, Cloud Engineering, or a similar customer-facing technical role.\n' +
  'Compensation: Base Salary - $140,000 - 170,000.';

function wasabiPage(overrides) {
  const body = wasabiBody;
  return Object.assign({
    url: 'https://job-boards.greenhouse.io/wasabi/jobs/1',
    site: 'Greenhouse',
    selector_used: '#content',
    body: body,
    body_length: body.length,
    location: '',
    full_text: 'Sr. Solutions Architect\nUnited States of America\n' + body,
    ld: {},
  }, overrides || {});
}

test('22. a page that names the US while the location banner is empty is NOT scored', () => {
  const rep = J.coverageReport(wasabiPage());
  assert.ok(rep.blockers.some((b) => b.id === 'location_banner_missing'),
    'expected a location_banner_missing blocker, got: ' + JSON.stringify(rep.blockers));
  assert.equal(rep.checks.location_banner, null);
  assert.equal(rep.checks.place_token_on_page, true);
});

test('22b. the same page WITH the banner captured passes the coverage report', () => {
  const rep = J.coverageReport(wasabiPage({ location: 'United States of America' }));
  assert.deepEqual(rep.blockers, [], 'a captured banner must clear the blocker');
});

test('22c. a posting with no place anywhere is left to the gates, not blocked', () => {
  const body = 'We are hiring a Solutions Engineer. '.repeat(40) + '\nRequirements: 3 years.';
  const rep = J.coverageReport({ site: 'Greenhouse', selector_used: '#content', body: body, body_length: body.length, location: '', full_text: body, ld: {} });
  assert.deepEqual(rep.blockers, []);
});

test('23. a collapsed posting and a too-short body both block', () => {
  const collapsed = 'About the job\nFor our client, we are seeking a Solutions Engineer... show more';
  const rep = J.coverageReport({ site: 'LinkedIn', body: collapsed, body_length: collapsed.length, location: '', full_text: collapsed, ld: {} });
  const ids = rep.blockers.map((b) => b.id);
  assert.ok(ids.includes('collapsed'), 'expected the collapsed blocker');
  assert.ok(ids.includes('body_too_short'), 'expected the short-body blocker');
});

test('24. a complete capture from a known site has no blockers', () => {
  const body = 'About the role\n' + 'Lead technical discovery with enterprise customers. '.repeat(30) +
    '\nLocation: Remote - United States\nCompensation: The base salary range is $140,000 - $170,000 per year.\n' +
    'Requirements: 5+ years in a customer-facing technical role.';
  const page = {
    site: 'Greenhouse', selector_used: '#content', pane_scoped: true,
    body: body, body_length: body.length, location: 'Remote - United States',
    full_text: 'Solutions Architect\nRemote - United States\n' + body, ld: {},
  };
  assert.deepEqual(J.coverageReport(page).blockers, []);
  assert.deepEqual(J.coverageReport(page).notes, []);
});

test('25. pay wording outside the captured description blocks (found on the page, not in the body)', () => {
  const body = 'We are hiring a Solutions Engineer. '.repeat(40) + '\nRequirements: 3 years.';
  const page = {
    site: 'Greenhouse', selector_used: '#content', body: body, body_length: body.length,
    location: 'Remote - United States',
    full_text: body + '\nCompensation: Base salary range $140,000 - $170,000.',
    ld: {},
  };
  const rep = J.coverageReport(page);
  assert.ok(rep.blockers.some((b) => b.id === 'pay_outside_description'));
  assert.equal(rep.checks.pay_lines_on_page >= 1, true);
  assert.equal(rep.checks.pay_lines_in_description, 0);
});

test('25b. payLines wants base-pay wording near the figure, not just a dollar sign', () => {
  assert.equal(J.payLines('Our customers spend $500,000 on security each year.').length, 0,
    'a spend figure is not a pay figure');
  assert.ok(J.payLines('The base salary range is $140,000 - $170,000 per year.').length >= 1,
    'a labelled base range is a pay figure');
  assert.equal(J.payLines('On-target earnings: $180,000 - $220,000 annually.').length, 0,
    'an OTE-only line is where a null base is correct');
  assert.equal(J.payLines('$170,000').length, 0, 'a bare figure has no label to trust');
});

console.log('fact cross-checks (the model vs the text)');

test('26. a base-pay line the model did not extract blocks instead of SKIPping on No base posted', () => {
  const page = wasabiPage({ location: 'United States of America' });
  const missing = J.factCrossChecks(page, { base_min: null, base_max: null, pay_posted: false });
  assert.ok(missing.blockers.some((b) => b.id === 'pay_not_extracted'));

  const ok = J.factCrossChecks(page, { base_min: 140000, base_max: 170000, pay_posted: true });
  assert.deepEqual(ok.blockers, []);
});

test('26b. an OTE-only posting does not trip the pay check', () => {
  const body = 'We are hiring a Solutions Engineer. '.repeat(40) + '\nOTE: $180,000 - $220,000.';
  const page = { site: 'Greenhouse', body: body, body_length: body.length, location: 'Remote - United States', full_text: body, ld: {} };
  const rep = J.factCrossChecks(page, { base_min: null, base_max: null, pay_posted: false });
  assert.deepEqual(rep.blockers, []);
});

test('27. no location anywhere is an unknown gate: a question by default, REVIEW if you say so', () => {
  const page = wasabiPage({ location: '', full_text: wasabiBody });
  const nowhere = J.factCrossChecks(page, { location_restriction: null, location_scope: 'unclear' });
  assert.deepEqual(nowhere.blockers.filter((b) => b.id === 'no_location_anywhere'), [],
    'the gate reports unknown itself now');
  const x = mk({ page_location: '', location_restriction: null, location_scope: 'unclear',
    work_arrangement: 'unclear', _text: 'Sells firewalls. Base salary $140,000 - $160,000.' });
  const res = J.score(x, cfg);
  assert.equal(gateOf(res, 'Location').status, 'unknown');
  assert.equal(res.verdict, 'APPLY');
  assert.equal(res.askRecruiter, true);
  assert.ok(res.questions.length >= 1);

  const review = J.score(x, J.setPath(cfg, 'gates.location.onUnknown', 'review'));
  assert.equal(review.verdict, 'REVIEW');
});
test('28. coverageAsText names every blocker and the raw selector counts', () => {
  const page = wasabiPage();
  const text = J.coverageAsText(J.coverageReport(page), page);
  assert.match(text, /NO SCORE/);
  assert.match(text, /BLOCKER/);
  assert.match(text, /body=\d+ chars/);
  assert.match(text, /site=Greenhouse/);
});

console.log('present / explanation attributes');

test('29. present and explanation survive normalize and verify', () => {
  const pageText = 'Solutions Engineer. Remote - United States. Benefits: medical.';
  const { x, evidence } = J.normalizeExtraction({
    title: { value: 'Solutions Engineer', present: true, evidence: 'Solutions Engineer', explanation: 'the posting headline' },
    base_min: { value: null, present: false, evidence: null, explanation: 'the posting lists no base pay' },
    location_scope: { value: 'us_wide', present: true, evidence: 'Remote - United States', explanation: 'names the whole US' },
  });
  const v = J.verifyEvidence(x, evidence, pageText);
  assert.equal(v.present.title, true);
  assert.equal(v.present.base_min, false);
  assert.equal(v.present.location_scope, true);
  assert.equal(v.explanation.base_min, 'the posting lists no base pay');
  assert.equal(v.explanation.title, 'the posting headline');
  assert.equal(v.x.__present, undefined, 'internal keys must not leak into the extraction');
});

test('29b. a model that omits present still gets a sensible one', () => {
  const pageText = 'Solutions Engineer. Remote - United States.';
  const { x, evidence } = J.normalizeExtraction({ title: 'Solutions Engineer' });
  const v = J.verifyEvidence(x, evidence, pageText);
  assert.equal(v.present.title, true, 'a value that survived is present');
  assert.equal(v.present.company, false, 'an absent field is not present');
  assert.equal(v.explanation.company, null);
});

test('29c. an unverified quote leaves the field not-present, whatever was claimed', () => {
  const { x, evidence } = J.normalizeExtraction({
    base_min: { value: 140000, present: true, evidence: 'base 140k', explanation: 'the salary line' },
  });
  const v = J.verifyEvidence(x, evidence, 'Solutions Engineer. Remote - United States.');
  assert.equal(v.x.base_min, null);
  assert.equal(v.present.base_min, false);
  assert.equal(v.status.base_min, 'unverified');
});

console.log('gate wording and the panel labels');

test('30. the Location gate quotes the phrase it matched, not the header blob', () => {
  const x = mk({
    title: 'Sr. Solutions Architect',
    page_title: 'Sr. Solutions Architect',
    page_location: 'United States of America',
    location_restriction: 'EST Zone',
    location_scope: 'us_region',
    work_arrangement: 'unclear',
    _text: 'Role Description: Sr. Solutions Architect - EST Zone.',
  });
  const loc = gateOf(J.score(x, cfg), 'Location');
  assert.equal(loc.status, 'pass');
  assert.match(loc.quote, /United States of America/);
  assert.doesNotMatch(loc.quote, /Solutions Architect/, 'the title must not be pasted in as a quote');
  assert.equal(loc.detail, 'Card names the United States');
});

test('31. the Employer gate does not claim Direct hire without an employer', () => {
  const emp = gateOf(J.score(mk({ company: null }), cfg), 'Employer');
  assert.equal(emp.status, 'pass');
  assert.match(emp.detail, /No staffing or contract wording found/);
  assert.equal(emp.quote, '', 'nothing to quote when the employer is unknown');

  const named = gateOf(J.score(mk({ company: 'Wasabi' }), cfg), 'Employer');
  assert.equal(named.detail, 'Direct hire (Wasabi)');
  assert.equal(named.quote, 'Wasabi');
});

console.log('employer from the URL');

test('32. the employer can be read off an ATS board path', () => {
  assert.equal(J.companyFromUrl('https://job-boards.greenhouse.io/wasabi/jobs/1'), 'Wasabi');
  assert.equal(J.companyFromUrl('https://boards.greenhouse.io/acme/jobs/123'), 'Acme');
  assert.equal(J.companyFromUrl('https://jobs.lever.co/acme-corp/abc'), 'Acme Corp');
  assert.equal(J.companyFromUrl('https://jobs.ashbyhq.com/acme'), 'Acme');
  assert.equal(J.companyFromUrl('https://careers.trellix.com/jobs/junior-solutions-engineer/'), 'Trellix');
  assert.equal(J.companyFromUrl('https://www.acme.com/careers/1'), 'Acme');
  assert.equal(J.companyFromUrl('https://jobs.acme.co.uk/roles/1'), 'Acme', 'a country TLD must not become the name');
  assert.equal(J.companyFromUrl('https://acme.com/'), 'Acme');
  assert.equal(
    J.companyFromUrl('https://arcticwolf.wd1.myworkdayjobs.com/en-US/External/job/Remote-United-States/Senior-Sales-Engineer--Enterprise--Cincinnati-or-Columbus-_R26_996'),
    'Arcticwolf', 'a Workday tenant is named in the subdomain, not the path');
  assert.equal(J.companyFromUrl('https://job-boards.greenhouse.io/en-US/External/job/x'), null,
    'a locale segment and a site segment are not company names');
  assert.equal(J.companyFromUrl('https://www.linkedin.com/jobs/view/123456'), null, 'the board is not the employer');
  assert.equal(J.companyFromUrl('https://job-boards.greenhouse.io/embed/job_app?id=1'), null);
  assert.equal(J.companyFromUrl('https://boards.greenhouse.io/embed/job_app?for=wasabi&token=123'), 'Wasabi',
    'an embedded board names the employer in the for= query param');
  assert.equal(J.companyFromUrl('not a url'), null);
});

test('32b. a URL slug that is a housekeeping word is not a company name', () => {
  assert.equal(J.companyFromSlug('jobs'), null);
  assert.equal(J.companyFromSlug('job-boards'), null);
  assert.equal(J.companyFromSlug('1234'), null);
  assert.equal(J.companyFromSlug('wasabi'), 'Wasabi');
});

test('33. the no-quote list only names fields that assert something', () => {
  const pageText = 'Solutions Engineer. Remote - United States.';
  const { x, evidence } = J.normalizeExtraction({
    title: { value: 'Solutions Engineer', present: true, evidence: 'Solutions Engineer', explanation: 'headline' },
    one_line_summary: { value: 'A pre-sales role for a storage vendor.' },
    work_arrangement: { value: 'unclear' },
    location_scope: { value: 'unclear' },
    role_type: { value: 'other' },
    pay_range_is_job_family_wide: { value: false },
    pay_posted: { value: true },
  });
  const v = J.verifyEvidence(x, evidence, pageText);
  assert.deepEqual(v.noQuote, ['pay_posted'],
    'a summary, a fallback enum and a false boolean have nothing to quote');
});

test('34. the evidence haystack is what the model was shown, URL included', () => {
  const page = {
    url: 'https://job-boards.greenhouse.io/wasabi/jobs/1',
    title: 'Sr. Solutions Architect', company: 'Wasabi', location: '',
    tab_title: 'x', body: 'text',
  };
  assert.ok(J.evidenceHaystack(page).includes('https://job-boards.greenhouse.io/wasabi/jobs/1'),
    'a quote copied from the URL must be verifiable');
  // and the URL really is sent, so the haystack and the prompt agree
  assert.match(J.buildPrompt(cfg, page).user, /PAGE URL: https:\/\/job-boards\.greenhouse\.io\/wasabi\/jobs\/1/);
});

test('35. the Pay gate quote is the label and the range, not half a paragraph', () => {
  // The fallback path: the model returned nothing usable about pay, so the range
  // is read out of the text.
  const body = 'Sell our platform to enterprise buyers. '.repeat(25) +
    '\nCompensation: Base Salary - $140,000 - 170,000.';
  const x = mk({ _text: body, base_min: null, base_max: null, base_source: null });
  const pay = gateOf(J.score(x, cfg), 'Pay');
  assert.equal(pay.status, 'pass');
  assert.match(pay.detail, /from the text/);
  assert.ok(pay.quote.length > 0 && pay.quote.length <= 140,
    'the quote must stay short, got ' + pay.quote.length + ' chars');
  assert.match(pay.quote, /Base Salary/);
  assert.match(pay.quote, /140,000/);
});

console.log('hand-selected runs and the Workday header');

// The real failure: the whole-page checks ran against text the user had picked
// by hand, where "the location banner was not captured" is meaningless. The
// selection refused to score, and the fix hint told them to select the text.
test('36. a hand-selected run is not refused for a banner it never had', () => {
  const body = 'Remote, but candidate must live in territory of Cincinnati, OH or Columbus, OH. ' +
    'Compensation: base salary range $130,000 - $160,000. '.repeat(20);
  const page = {
    url: 'https://arcticwolf.wd1.myworkdayjobs.com/en-US/External/job/x/Senior-Sales-Engineer_R26_996',
    site: 'selection', selector_used: 'user selection',
    body: body, body_length: body.length, location: '', ld: {},
  };
  const x = {
    location_restriction: 'must live in Cincinnati, OH or Columbus, OH territory',
    location_scope: 'named_place', base_min: 130000, base_max: 160000, pay_posted: true,
  };

  const scrape = J.coverageReport(page, x);
  assert.ok(scrape.blockers.some((b) => b.id === 'location_banner_missing'),
    'the scrape checks do fire on this text, which is exactly why they must not run on a selection');
  assert.equal(scrape.after_model, true);

  const selected = J.coverageReport(page, x, { skipTextChecks: true });
  assert.deepEqual(selected.blockers, [], 'text the user chose by hand is not a scrape to audit');
  assert.equal(selected.checks.location_scope, 'named_place', 'the facts are still reported');
  assert.equal(selected.checks.site, 'selection');

  // and the facts it did carry are enough to score
  const res = J.score(mk({
    page_location: '', location_restriction: x.location_restriction,
    location_scope: 'named_place', _text: body,
  }), cfg);
  assert.equal(gateOf(res, 'Location').status, 'pass', 'must-live Columbus still passes');
});

test('37. a scraped header value loses its own field label', () => {
  assert.equal(J.stripLocationLabel('locationsRemote, United States'), 'Remote, United States');
  assert.equal(J.stripLocationLabel('Remote - USA - Ohio'), 'Remote - USA - Ohio');
  assert.equal(J.stripLocationLabel('LocationRemote, USA'), 'Remote, USA');
  assert.equal(J.stripLocationLabel(''), '');
});

test('38. the Workday entry reads every location on the requisition', () => {
  const wd = J.SITE_SELECTORS.find((s) => s.name === 'Workday');
  assert.ok(wd, 'a Workday entry must exist');
  assert.ok((wd.locationAll || []).some((s) => /locations"\]\s*dd$/.test(s)),
    'the locations <dd> list must be collected or Ohio is dropped: ' + JSON.stringify(wd.locationAll));
  assert.ok((wd.description || []).some((s) => s.includes('jobPostingDescription')));
  assert.ok((wd.title || []).some((s) => s.includes('jobPostingHeader')));
  assert.ok((wd.company || []).some((s) => s.includes('companyName')));
});

test('39. the description read can fall back to aria-hidden content', () => {
  // Workday uses aria-hidden as a hydration trick, so the default junk-stripping
  // pass can delete the very container we are looking for and report 0 chars.
  assert.ok(J.JUNK_SELECTORS.includes('[aria-hidden="true"]'),
    'the first pass must keep stripping aria-hidden page chrome');
  assert.ok(!J.JUNK_SELECTORS_KEEP_ARIA.includes('aria-hidden'),
    'the second pass must keep it, so a hidden description is still readable');
  for (const sel of ['script', 'nav', 'footer', 'form']) {
    assert.ok(J.JUNK_SELECTORS.includes(sel) && J.JUNK_SELECTORS_KEEP_ARIA.includes(sel),
      sel + ' must be stripped by both passes - it is never a posting');
  }
});

console.log('pay: the extraction decides, the text is the fallback');

// The bug this replaces: `$150k-$175k` matched no regex (the parser wanted
// comma groups or 5-6 digits), so the gate said "No base posted" while the panel
// beside it displayed the base pay the model had just read.
test('40. a base derived from an OTE and a split is judged on the derived base', () => {
  const body = 'Compensation: The compensation range for this role is between $150k-$175k OTE ' +
    'with a 75/25 base to commission split.';
  const x = mk({ base_min: 112500, base_max: 131250, base_source: 'derived_from_ote', pay_posted: false, _text: body });
  const pay = gateOf(J.score(x, cfg), 'Pay');
  assert.equal(pay.status, 'pass', '75% of the top of the OTE clears the $125k floor');
  assert.match(pay.detail, /derived from the posted OTE/);
  assert.match(pay.detail, /131,250/);

  // the same posting if the split were all commission
  const low = gateOf(J.score(mk({ base_min: 90000, base_max: 112500, base_source: 'derived_from_ote' }), cfg), 'Pay');
  assert.equal(low.status, 'fail', 'a derived base under the floor still fails');
  assert.match(low.detail, /under/);
});

test('41. an OTE-only posting cannot be promoted into a base', () => {
  const text = 'Compensation: base salary range $180,000 - $220,000 OTE, on-target earnings.';
  // The model looked and found no base. That answer wins over the text, because
  // reading the text is exactly how OTE became "base pay" before. It is now a
  // question for the recruiter, not a skip.
  const model = gateOf(J.score(mk({ base_min: null, base_max: null, base_source: 'not_stated', pay_posted: false, _text: text }), cfg), 'Pay');
  assert.equal(model.status, 'unknown');
  assert.equal(model.kind, 'ote_only');
  assert.match(model.detail, /OTE or base plus commission/);

  const bare = gateOf(J.score(mk({ base_min: null, base_max: null, base_source: 'not_stated', pay_posted: false, _text: 'Compensation: on-target earnings only, discussed at offer.' }), cfg), 'Pay');
  assert.equal(bare.status, 'unknown');
  assert.match(bare.detail, /No base pay stated/);
});
test('42. when the model returns nothing about pay, the text range is still read', () => {
  const x = mk({
    base_min: null, base_max: null, base_source: null,
    _text: 'The base salary range is $140,000 to $150,000 per year.',
  });
  const pay = gateOf(J.score(x, cfg), 'Pay');
  assert.equal(pay.status, 'pass');
  assert.match(pay.detail, /read from the text/);
});

test('43. an OTE-derived base is labelled in the extraction, not silently swapped in', () => {
  const { x } = J.normalizeExtraction({
    base_min: { value: 112500, present: true, evidence: '75/25 base to commission split', explanation: '75% of the $150k-$175k OTE' },
    base_max: { value: 131250, present: true, evidence: '75/25 base to commission split' },
    base_source: { value: 'derived_from_ote' },
  });
  assert.equal(x.base_source, 'derived_from_ote');
  assert.equal(x.base_min, 112500);
  // base_source is metadata about the answer, so it must not appear as a field
  // that needed an evidence quote
  const v = J.verifyEvidence(x, { base_min: '75/25 base to commission split' }, 'Compensation with a 75/25 base to commission split');
  assert.ok(!v.noQuote.includes('base_source'));
  assert.ok(!v.unverified.includes('base_source'));
});

test('44. every Location branch quotes what it matched, not the header blob', () => {
  const base = {
    title: 'Sales Engineer II', page_title: 'Sales Engineer II', page_location: 'USA',
    location_restriction: 'Remote US', work_arrangement: 'remote', _text: 'Remote, United States.',
  };
  const withBase = (o) => Object.assign({}, base, o);

  const wide = gateOf(J.score(mk(withBase({ location_scope: 'us_wide' })), cfg), 'Location');
  assert.equal(wide.status, 'pass');
  assert.equal(wide.quote, 'USA', 'the matched token, not "Sales Engineer II Sales Engineer II USA"');
  assert.doesNotMatch(wide.quote, /Sales Engineer II/);

  const region = gateOf(J.score(mk(withBase({
    location_scope: 'us_region', page_location: '',
    _text: 'Role: SE - EST Zone. This is a remote position.',
  })), cfg), 'Location');
  assert.equal(region.status, 'pass');
  assert.match(region.quote, /EST\s+Zone/i);

  const named = gateOf(J.score(mk(withBase({ location_scope: 'named_place', page_location: 'Columbus, OH' })), cfg), 'Location');
  assert.equal(named.status, 'pass');
  assert.match(named.quote, /columbus/i);

  // A named non-OH place: the quote is the line that carries it, not the header
  // blob with the posting title pasted in twice.
  const ny = gateOf(J.score(mk(withBase({
    title: 'Sales Engineer, New York City (Strategic)',
    page_title: 'Sales Engineer, New York City (Strategic)',
    page_location: 'San Francisco, CA, USA', location_restriction: 'New York City',
    location_scope: 'named_place', _text: 'Location: New York City. Up to 30% travel.',
  })), cfg), 'Location');
  assert.equal(ny.status, 'fail');
  assert.match(ny.quote, /New York/);
  assert.doesNotMatch(ny.quote, /\(Strategic\) .*Sales Engineer/,
    'the header must not repeat the title: got ' + JSON.stringify(ny.quote));
});

console.log('a SKIP the gaps cannot touch still stands');

// The Cribl shape: the pay paragraph was not read, but the card names New York
// and that alone is the reason to skip. Refusing to score helps nobody.
test('45. blockers that do not touch the deciding gate leave the SKIP standing', () => {
  const body = 'Cribl. Sales Engineer, New York City (Strategic). Location: New York City. ' +
    'Telemetry platform work for security teams. '.repeat(20) +
    'Base Salary Range$140,000-$190,000 USD';
  const page = {
    url: 'https://builtin.com/job/x/1', site: 'Built In', selector_used: '[id^="job-post-body-"]',
    body: body, body_length: body.length, full_text: body,
    location: 'San Francisco, CA, USA', ld: { location: 'San Francisco, CA, USA' },
  };
  const x = mk({
    title: 'Sales Engineer, New York City (Strategic)',
    page_title: 'Sales Engineer, New York City (Strategic)',
    page_location: 'San Francisco, CA, USA',
    location_restriction: 'New York City', location_scope: 'named_place',
    base_min: null, base_max: null, base_source: 'not_stated', pay_posted: false, _text: body,
  });
  const result = J.score(x, cfg);
  assert.equal(result.verdict, 'SKIP');
  assert.equal(result.fail_gate, 'Location');

  const rep = J.coverageReport(page, x, {}, { unverified: [] });
  assert.deepEqual(rep.blockers.map((b) => b.id), ['pay_not_extracted']);
  assert.equal(J.coverageTolerable(rep, result), true, 'a missing pay line cannot change a Location finding');
  assert.equal(J.coverageHaltsEarly(rep), false, 'and it is still worth asking the model');
});

test('45b. an APPLY is never trusted while anything is unresolved', () => {
  assert.equal(J.coverageTolerable({ blockers: [{ id: 'pay_not_extracted' }] }, { verdict: 'APPLY', fail_gate: null }), false);
  // an empty capture is the one case that stops before the model is called
  assert.equal(J.coverageHaltsEarly(J.coverageReport({ body: '', body_length: 0, site: 'Built In', location: '' })), true);
  assert.equal(J.coverageHaltsEarly(J.coverageReport({
    body: 'Telemetry platform work. '.repeat(20), body_length: 500,
    site: 'Built In', location: 'Denver, CO',
  })), false);
});

test('45c. a blocker on the gate that decides still refuses', () => {
  const at = (id, failGate) => J.coverageTolerable({ blockers: [{ id: id }] }, { verdict: 'SKIP', fail_gate: failGate });
  assert.equal(at('pay_not_extracted', 'Pay'), false, 'the gap IS the pay verdict');
  assert.equal(at('location_banner_missing', 'Location'), false, 'the missing banner IS the location verdict');
  assert.equal(at('no_location_anywhere', 'Location'), false);
  assert.equal(at('body_too_short', 'Title'), false, 'a body that short undermines every gate');
  assert.equal(at('collapsed', 'Title'), false);
  assert.equal(at('some_future_check', 'Title'), false, 'an unclassified blocker is treated as global');
  assert.equal(at('pay_not_extracted', 'Title'), true, 'a title finding does not depend on pay');
});

test('46. an evidence quote survives the page text losing its whitespace and dashes', () => {
  // Built In concatenates without separators, so the fetched text reads
  // "...and equity.Base Salary Range$140,000-$190,000 USDBring Your Whole Se".
  const pageText = 'Cribl Logo Cribl Sales Engineer, New York City Job Posted 4 Days Ago. ' +
    'and equity.Base Salary Range$140,000\u2014$190,000 USDBring Your Whole Se';
  const { x, evidence } = J.normalizeExtraction({
    base_min: { value: 140000, present: true, evidence: 'Base Salary Range $140,000 - $190,000 USD' },
  });
  const v = J.verifyEvidence(x, evidence, pageText);
  assert.equal(v.x.base_min, 140000, 'tidied spacing and an ASCII hyphen must still find the quote');
  assert.deepEqual(v.unverified, []);
});

test('46b. a quote that is genuinely absent is still rejected', () => {
  const { x, evidence } = J.normalizeExtraction({
    base_min: { value: 300000, present: true, evidence: 'base salary range $300,000 to $400,000' },
  });
  const v = J.verifyEvidence(x, evidence, 'Base Salary Range$140,000-$190,000 USD');
  assert.equal(v.x.base_min, null);
  assert.deepEqual(v.unverified, ['base_min']);
});

test('47. the pay blocker says when the model read a base and the quote was dropped', () => {
  const body = 'Telemetry platform work. '.repeat(30) + 'Base Salary Range $140,000 - $190,000';
  const page = { site: 'Built In', body: body, body_length: body.length, location: 'Denver, CO' };
  const x = { base_min: null, base_max: null };
  const dropped = J.factCrossChecks(page, x, { unverified: ['base_min'] });
  assert.ok(dropped.blockers.some((b) => /was dropped as unverified/.test(b.message)),
    'a dropped quote is a different problem from a value never returned');
  const neverReturned = J.factCrossChecks(page, x, { unverified: [] });
  assert.ok(neverReturned.blockers.some((b) => /but no base pay was extracted/.test(b.message)));
});

console.log('100% remote from Columbus, travel, and the REVIEW verdict');

const SE = { title: 'Solutions Engineer', page_title: 'Solutions Engineer' };
const locOf = (o) => gateOf(J.score(mk(Object.assign({}, SE, o)), cfg), 'Location');
const travelOf = (o) => gateOf(J.score(mk(Object.assign({}, SE, o)), cfg), 'Travel');

test('50. a California company hiring remote across the US passes', () => {
  const g = locOf({
    page_location: 'Remote in Vista, CA', work_arrangement: 'remote', location_scope: 'unclear', location_restriction: null,
    _text: 'NewRocket is hiring a Solutions Engineer. This is a fully remote role open to candidates anywhere in the United States.',
  });
  assert.equal(g.status, 'pass', g.detail);
});

test('51. "Remote in Vista, CA" with nothing about who may apply is unknown, not a pass or a fail', () => {
  const g = locOf({
    page_location: 'Remote in Vista, CA', work_arrangement: 'remote', location_scope: 'unclear', location_restriction: null,
    _text: 'We are seeking a Solutions Consultant to drive enterprise sales motions.',
  });
  assert.equal(g.status, 'unknown', g.detail);
  assert.match(g.detail, /never says it hires across the United States/);
});

test('52. a bare "Remote" with no place is unknown, and "Remote" never invents a state', () => {
  const g = locOf({ page_location: 'Remote', work_arrangement: 'remote', location_scope: 'unclear', location_restriction: null, _text: 'Sells firewalls.' });
  assert.equal(g.status, 'unknown');
});

test('53. hybrid, onsite, or a must-live-elsewhere rule fails', () => {
  assert.equal(locOf({ work_arrangement: 'hybrid_work' }).status, 'fail');
  assert.equal(locOf({ work_arrangement: 'onsite' }).status, 'fail');
  assert.equal(locOf({ page_location: 'Remote', _text: 'Remote. You must live in the Austin, TX area.' }).status, 'fail');
  assert.equal(locOf({ page_location: 'Indianapolis, IN 46204', work_arrangement: 'unclear', location_scope: 'unclear', _text: 'Sells firewalls.' }).status, 'fail',
    'a two-letter state on an Indeed card is a place');
});

test('54. a named place with no remote statement anywhere fails', () => {
  const g = locOf({ page_location: '', work_arrangement: 'unclear', location_scope: 'unclear', location_restriction: 'EST Zone', _text: 'Sells firewalls. EST Zone.' });
  assert.equal(g.status, 'fail');
});

test('55. travel: none passes, home-region under the cap passes', () => {
  assert.equal(travelOf({ travel_percent: null, travel_scope: 'none' }).status, 'pass');
  assert.equal(travelOf({ travel_percent: 10, travel_scope: 'home_region', _text: 'Up to 10% travel within the Columbus area.' }).status, 'pass');
});

test('56. travel: over the cap fails; the cap is 10% outside the area and 50% inside', () => {
  const ok = travelOf({ travel_percent: 10, travel_scope: 'other_region', _text: 'Up to 10% travel to customers in the Bay Area.' });
  assert.equal(ok.status, 'pass', 'at the limit is allowed');
  const far = travelOf({ travel_percent: 15, travel_scope: 'other_region', _text: 'Up to 15% travel to customers in the Bay Area.' });
  assert.equal(far.status, 'fail');
  assert.match(far.detail, /outside/);
  assert.equal(travelOf({ travel_percent: 50, travel_scope: 'home_region' }).status, 'pass');
  assert.equal(travelOf({ travel_percent: 51, travel_scope: 'home_region' }).status, 'fail');

  // and the limits are settings
  const loose = J.setPath(cfg, 'gates.travel.maxPercentOutside', 20);
  const res = J.score(mk(Object.assign({}, SE, { travel_percent: 15, travel_scope: 'other_region' })), loose);
  assert.equal(gateOf(res, 'Travel').status, 'pass');
  const blocked = J.setPath(cfg, 'gates.travel.blockCustomerOutside', true);
  const cust = J.score(mk(Object.assign({}, SE, { travel_percent: 5, travel_scope: 'other_region', travel_purpose: 'customer' })), blocked);
  assert.equal(gateOf(cust, 'Travel').status, 'fail');
});
test('57. travel with no place given: fine under the outside cap, a question above it; the percent is read from the text', () => {
  assert.equal(travelOf({ travel_percent: 10, travel_scope: 'unspecified', _text: '10% travel' }).status, 'pass');
  assert.equal(travelOf({ travel_percent: 25, travel_scope: 'unspecified', _text: '25% travel' }).status, 'unknown');
  const missed = travelOf({ travel_percent: null, travel_scope: 'other_region', _text: 'Travel up to 25% to customer sites nationwide.' });
  assert.equal(missed.status, 'fail', 'the text percent still feeds the gate');
  assert.equal(travelOf({ travel_percent: null, travel_scope: 'unspecified', _text: 'Willingness to travel is required.' }).status, 'unknown');
  assert.equal(travelOf({ travel_percent: null, travel_scope: 'unspecified', _text: 'Sells firewalls.' }).status, 'pass',
    'a posting that never mentions travel has none to fail');
});
test('58. a fail always outranks an unknown; an unknown is a question unless you made it a REVIEW', () => {
  const unknownLoc = { page_location: 'Remote in Vista, CA', work_arrangement: 'remote', location_scope: 'unclear', location_restriction: null,
    _text: 'Sells firewalls. Base salary $140,000 - $160,000.' };
  const flagged = J.score(mk(Object.assign({}, SE, unknownLoc)), cfg);
  assert.equal(flagged.verdict, 'APPLY');
  assert.equal(flagged.askRecruiter, true);
  assert.equal(flagged.fail_gate, null);
  assert.deepEqual(flagged.unknown_gates, ['Location']);

  const review = J.score(mk(Object.assign({}, SE, unknownLoc)), J.setPath(cfg, 'gates.location.onUnknown', 'review'));
  assert.equal(review.verdict, 'REVIEW');
  assert.match(review.reason, /Location/);

  const skip = J.score(mk(Object.assign({}, SE, unknownLoc, { base_min: 80000, base_max: 100000, base_source: 'stated' })), cfg);
  assert.equal(skip.verdict, 'SKIP', 'a definite pay fail is not softened by an unknown location');
  assert.equal(skip.fail_gate, 'Pay');
});
test('59. no pay listed asks the recruiter; pay never captured is a REVIEW; a figure that WAS read still fails', () => {
  const none = mk(Object.assign({}, SE, { base_min: null, base_max: null, base_source: 'not_stated', pay_posted: false }));
  assert.equal(gateOf(J.score(none, cfg), 'Pay').status, 'unknown');
  assert.equal(J.score(none, cfg).verdict, 'APPLY');
  assert.equal(J.score(none, cfg).askRecruiter, true);
  const uncaptured = Object.assign({}, none, { _pay_uncaptured: true });
  const u = J.score(uncaptured, cfg);
  assert.equal(gateOf(u, 'Pay').kind, 'uncaptured');
  assert.equal(u.verdict, 'REVIEW', 'a scrape gap needs a look, not a recruiter message');
  const stated = Object.assign({}, uncaptured, { base_min: 90000, base_max: 100000, base_source: 'stated' });
  assert.equal(gateOf(J.score(stated, cfg), 'Pay').status, 'fail');
});
test('60. a missing title is unknown, not a skip', () => {
  const res = J.score(mk({ title: null, page_title: null }), cfg);
  assert.equal(gateOf(res, 'Title').status, 'unknown');
});

console.log('Indeed two-pane: identity, pane header, cheap gates');

test('61. Indeed keys the cache on the open job, not the search URL', () => {
  const a = J.canonicalKey('https://www.indeed.com/jobs?q=se&l=Remote&vjk=665ea0b27f9c11a1&start=10');
  const b = J.canonicalKey('https://www.indeed.com/viewjob?jk=665ea0b27f9c11a1&from=alert');
  assert.equal(a, 'indeed:job:665ea0b27f9c11a1');
  assert.equal(a, b);
  assert.equal(J.urlJobKey('https://www.indeed.com/jobs?q=se&vjk=abc123'), 'abc123');
  assert.equal(J.urlJobKey('https://www.indeed.com/jobs?q=se'), null);
});

test('62. the Indeed entry is strict: pane-scoped, no h1 / page fallback, no stale _initialData', () => {
  const indeed = J.SITE_SELECTORS.find((s) => s.name === 'Indeed');
  assert.equal(indeed.strict, true);
  assert.ok(indeed.paneRoot.includes('[data-testid="viewjob-main-content"]'));
  assert.ok(!indeed.title.includes('h1'), 'the search page h1 must never be a job title');
  assert.equal(indeed.json, undefined, '_initialData only describes the job opened at page load');
  assert.ok(indeed.blocks.some((b) => b.pay && /structured-job-summary/.test(b.selector)), 'the Job details box carries the pay');
});

// A tiny DOM, enough for the block-aware text walker.
function el(tag, kids) {
  const node = { nodeType: 1, tagName: tag.toUpperCase(), childNodes: [] };
  (kids || []).forEach((k) => {
    const c = typeof k === 'string' ? { nodeType: 3, nodeValue: k } : k;
    node.childNodes.push(c);
  });
  node.childNodes.forEach((c, i) => {
    c.nextSibling = node.childNodes[i + 1] || null;
  });
  node.firstChild = node.childNodes[0] || null;
  return node;
}

test('63. blockText puts a line break at each block boundary', () => {
  const tree = el('div', [
    el('div', ['Vista, CA']), el('div', ['\u2022']), el('div', ['Remote']),
    el('p', ['Pay ', el('b', ['$150k']), ' a year']),
  ]);
  const lines = J.cleanText(J.blockText(tree)).split('\n');
  assert.deepEqual(lines, ['Vista, CA', '\u2022', 'Remote', 'Pay $150k a year']);
});

test('64. cheapPay annualises hourly pay and ignores text with no figure', () => {
  assert.equal(J.cheapPay('$160,000 - $185,000 a year'), 185000);
  assert.equal(J.cheapPay('$30 an hour'), 62400);
  assert.equal(J.cheapPay('$12,000 a month'), 144000);
  assert.equal(J.cheapPay('Up to $120k a year'), 120000);
  assert.equal(J.cheapPay('Full-time'), null);
  assert.equal(J.cheapPay(''), null);
});

test('65. cheap gates fail a card on title, pay or place, and never on what the card does not show', () => {
  const at = (c) => J.cheapGates(c, cfg);
  assert.equal(at({ title: 'Sales Manager', location: 'Indianapolis, IN 46204', pay: '$80,000 - $200,000 a year' }).name, 'Title');
  assert.equal(at({ title: 'Solutions Engineer', location: 'Remote', pay: '$90,000 - $110,000 a year' }).name, 'Pay');
  assert.equal(at({ title: 'Solutions Engineer', location: 'Indianapolis, IN 46204', pay: '$160,000 - $185,000 a year' }).name, 'Location');
  assert.equal(at({ title: 'Solutions Engineer', location: 'Remote in Vista, CA', pay: '$160,000 - $185,000 a year' }), null,
    'remote with an employer city is not provably a fail');
  assert.equal(at({ title: 'Solutions Engineer', location: 'Remote', pay: null }), null,
    'no pay chip on a card is not "no pay listed" - the figure may be in the description');
  assert.equal(at({ title: null, location: null, pay: null }), null);
});

test('66. an hourly card chip is annualised before the floor check', () => {
  const f = J.cheapGates({ title: 'Solutions Engineer', location: 'Remote', pay: '$30 an hour' }, cfg);
  assert.equal(f.name, 'Pay');
  assert.match(f.detail, /\$62,400/);
});

test('67. payLines recognises the "a year" chip wording', () => {
  assert.ok(J.payLines('Pay\n$160,000 - $185,000 a year').length >= 1);
});

test('68. travel_scope parses, and an unverified quote falls back to unspecified', () => {
  const ok = J.normalizeExtraction({ travel_scope: { value: 'Home_Region', evidence: 'travel within the Columbus area' } });
  assert.equal(ok.x.travel_scope, 'home_region');
  assert.equal(J.normalizeExtraction({ travel_scope: { value: 'nonsense' } }).x.travel_scope, 'unspecified');
  const v = J.verifyEvidence({ travel_scope: 'none' }, { travel_scope: 'not on the page' }, 'Sales engineer. Remote.');
  assert.equal(v.x.travel_scope, 'unspecified');
});

test('69. a pane showing another job, or no pane at all, blocks instead of scoring', () => {
  const stale = J.extractionIssues({ strict: true, pane_found: true, pane_stale: true, job_key: 'abc', body: 'x'.repeat(900), body_length: 900, site: 'Indeed', location: 'Remote' });
  assert.ok(stale.blockers.some((b) => b.id === 'pane_stale'));
  const none = J.extractionIssues({ strict: true, pane_found: false, body: '', body_length: 0, site: 'Indeed' });
  assert.ok(none.blockers.some((b) => b.id === 'pane_missing'));
  assert.equal(J.coverageHaltsEarly({ blockers: [{ id: 'pane_stale' }] }), true);
});

test('70. history counts REVIEW separately from SKIP', () => {
  const h = J.computeHistory([{ verdict: 'APPLY' }, { verdict: 'REVIEW' }, { verdict: 'SKIP' }, { verdict: 'SKIP' }], Date.now());
  assert.equal(h.apply, 1);
  assert.equal(h.review, 1);
  assert.equal(h.skip, 2);
});

