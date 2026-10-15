// The outreach message generator: facts only, and it fits the connection-note limit.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as J from '../src/all.js';
import { testConfig } from './fixtures.js';

const cfg = testConfig();
const job = (over) => Object.assign(J.blankJob('k'), {
  company: 'Wasabi Technologies, Inc.', title: 'Sr. Solutions Architect - EST Zone', product: 'Wasabi hot cloud storage',
  strengths: ['Fortinet, Check Point, endpoint security and backup experience', 'Hands-on Wasabi immutable backup'],
  questions: ['What is the base salary range for this role?'],
}, over || {});
const mk = (opts, j, settings) => J.buildOutreach(opts, { job: j || job(), settings: settings || cfg });

test('titles and company names are cleaned for use in a sentence', () => {
  assert.equal(J.cleanTitle('Sr. Solutions Architect - EST Zone'), 'Sr. Solutions Architect');
  assert.equal(J.cleanTitle('Sales Engineer, New York City'), 'Sales Engineer');
  assert.equal(J.cleanTitle('Solutions Engineer (Remote) | Acme'), 'Solutions Engineer');
  assert.equal(J.cleanTitle(''), '');
  assert.equal(J.shortCompany('Wasabi Technologies, Inc.'), 'Wasabi');
  assert.equal(J.shortCompany('Acme Security LLC'), 'Acme Security');
});

test('a connection note fits the limit and keeps the role, the company and the ask', () => {
  const r = mk({ type: 'manager', mode: 'note', name: 'steve nalick' });
  assert.ok(r.length <= 200, r.text);
  assert.equal(r.limit, 200);
  assert.match(r.text, /^Hi Steve,/, 'first name only, capitalised');
  assert.match(r.text, /Sr\. Solutions Architect role at Wasabi/);
  assert.match(r.text, /I've used Wasabi hands-on/, 'a product you listed as familiar');
  assert.doesNotMatch(r.text, /EST Zone|Inc/);
});

test('a short limit drops the optional parts instead of cutting a sentence in half', () => {
  const tight = J.setPath(cfg, 'outreach.noteLimit', 110);
  const r = mk({ type: 'manager', mode: 'note', name: 'Steve' }, job(), tight);
  assert.ok(r.length <= 110, r.text + ' (' + r.length + ')');
  assert.doesNotMatch(r.text, /hands-on/, 'the hook goes first');
  assert.match(r.text, /Sr\. Solutions Architect role at Wasabi\./);
  const tiny = mk({ type: 'peer', mode: 'note', name: 'Steve' }, job({ title: 'A very long and unusual job title that goes on and on for quite a while' }), J.setPath(cfg, 'outreach.noteLimit', 60));
  assert.ok(tiny.length <= 60);
  assert.equal(J.buildOutreach({ mode: 'note' }, { job: job(), settings: J.setPath(cfg, 'outreach.noteLimit', 5) }).limit, 60, 'the limit has a floor');
});

test('a full message is built from your intro, a known product and confirmed strengths only', () => {
  const r = mk({ type: 'manager', mode: 'message', name: 'Dana' }, job(), J.setPath(J.setPath(cfg, 'outreach.name', 'Jordan'), 'outreach.intro', 'i run MSP infrastructure and want to move into pre-sales.'));
  assert.match(r.text, /^Hi Dana,\n\nI just applied for the Sr\. Solutions Architect role at Wasabi\. /);
  assert.match(r.text, /I run MSP infrastructure and want to move into pre-sales\./, 'sentence case, one full stop');
  assert.match(r.text, /I have hands-on experience with Wasabi\./);
  assert.match(r.text, /Relevant background: Fortinet, Check Point, endpoint security and backup experience; Hands-on Wasabi immutable backup\./);
  assert.match(r.text, /ten minutes/);
  assert.match(r.text, /\n\nThanks,\nJordan$/);
  assert.equal(r.limit, null);
});

test('it never claims anything it has no fact for', () => {
  const bare = mk({ type: 'manager', mode: 'message', name: '' }, job({ company: 'Acme Security', product: 'Acme platform', strengths: [], questions: [] }));
  assert.match(bare.text, /^Hi,\n/, 'no name, no guess');
  assert.doesNotMatch(bare.text, /hands-on|Relevant background/);
  assert.match(bare.text, /Thanks!$/, 'no sign-off name set');
  assert.ok(bare.text.includes('systems engineer from the managed-services world moving into pre-sales.'), 'your intro, and nothing else about you');
});

test('each recipient gets the right ask; a recruiter also gets the open question', () => {
  assert.match(mk({ type: 'peer', mode: 'message', name: 'A' }).text, /what the team is like/);
  assert.match(mk({ type: 'manager', mode: 'message', name: 'A' }).text, /what you're looking for in this seat/);
  const rec = mk({ type: 'recruiter', mode: 'message', name: 'A' });
  assert.match(rec.text, /application reached you\. One quick question: What is the base salary range for this role\?/);
  const noQ = mk({ type: 'recruiter', mode: 'message', name: 'A' }, job({ questions: [] }));
  assert.match(noQ.text, /Happy to answer anything you need/);
  assert.match(mk({ type: 'bogus', mode: 'message' }).text, /ten minutes/, 'an unknown recipient falls back to the manager ask');
});

test('a job with no company or title still produces something sensible', () => {
  const r = J.buildOutreach({ type: 'manager', mode: 'note' }, { job: J.blankJob('x'), settings: cfg });
  assert.match(r.text, /I applied for the open role at your company\./);
  assert.ok(r.length <= 200);
});

test('the job record keeps the product and the strengths the fit notes confirmed', () => {
  const rec = J.upsertJob({}, { id: 'k', url: 'https://x.com/jobs/1', company: 'Wasabi', title: 'SA', verdict: 'APPLY', product: 'Wasabi hot cloud storage' }, Date.now()).job;
  assert.equal(rec.product, 'Wasabi hot cloud storage');
  assert.deepEqual(rec.strengths, []);
  const back = J.parseBackup(J.buildBackup(null, { k: Object.assign({}, rec, { strengths: ['a', 'b', 'c', 'd'] }) }, Date.now()));
  assert.deepEqual(back.jobs.k.strengths, ['a', 'b', 'c'], 'capped at three on import');
  const again = J.upsertJob({ k: Object.assign({}, rec, { strengths: ['kept'] }) }, { id: 'k', url: 'https://x.com/jobs/1', company: 'Wasabi', title: 'SA', verdict: 'APPLY' }, Date.now()).job;
  assert.deepEqual(again.strengths, ['kept'], 're-scoring does not erase them');
  assert.equal(again.product, 'Wasabi hot cloud storage');
});

test('a connection note says who you are when there is room, and drops it when there is not', () => {
  const plain = mk({ type: 'manager', mode: 'note', name: 'Dana' }, job({ company: 'Acme Security', product: 'Acme platform' }));
  assert.match(plain.text, /systems engineer from the managed-services world moving into pre-sales\./);
  assert.ok(plain.length <= 200);
  // with a known product the intro and the hook compete for 200 characters; the more specific hook wins
  const wasabi = mk({ type: 'manager', mode: 'note', name: 'Dana' });
  assert.ok(wasabi.length <= 200);
  assert.match(wasabi.text, /I've used Wasabi hands-on/);
});
