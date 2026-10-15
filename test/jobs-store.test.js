// Persistence of jobs against an in-memory stand-in for Violentmonkey storage.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'vitest';

const mem = new Map();
globalThis.GM_getValue = (k, d) => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : d);
globalThis.GM_setValue = (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); };
const J = await import('../src/all.js');

beforeEach(() => mem.clear());

test('first run carries the old rolling log over into jobs, once', () => {
  mem.set('log', [
    { url: 'https://boards.greenhouse.io/wasabi/jobs/1?gh_src=x', timestamp: '2026-10-01T10:00:00Z', company: 'Wasabi', title: 'Sr. Solutions Architect', verdict: 'APPLY', flags: [] },
    { url: 'https://www.linkedin.com/jobs/search/?currentJobId=4012345678', timestamp: '2026-10-02T10:00:00Z', company: 'Acme', title: 'Sales Manager', verdict: 'SKIP', fail_gate: 'Title' },
    { company: 'No URL', verdict: 'APPLY' },
    null,
  ]);
  const jobs = J.loadJobs();
  assert.equal(Object.keys(jobs).length, 2, 'entries with no URL cannot be reopened, so they are not carried over');
  const wasabi = Object.values(jobs).find((j) => j.company === 'Wasabi');
  assert.equal(wasabi.status, 'to_apply');
  assert.equal(wasabi.firstSeen, '2026-10-01T10:00:00.000Z');
  assert.equal(Object.values(jobs).find((j) => j.company === 'Acme').url, 'https://www.linkedin.com/jobs/view/4012345678/');
  assert.equal(Object.values(jobs).find((j) => j.company === 'Acme').status, 'passed');

  // once saved, the stored jobs win and the log is left alone
  J.saveJobs(jobs);
  mem.set('log', []);
  assert.equal(Object.keys(J.loadJobs()).length, 2);
  assert.equal(mem.get('log').length, 0);
});

test('jobs round-trip through storage and junk records are discarded on load', () => {
  const r = J.upsertJob({}, { id: 'k1', url: 'https://x.com/jobs/1', company: 'X', title: 'SE', verdict: 'APPLY' }, Date.now());
  J.saveJobs(Object.assign({}, r.jobs));
  assert.equal(J.loadJobs().k1.company, 'X');
  mem.set(J.JOBS_KEY, { version: 1, items: { good: { id: 'good', status: 'bogus' }, bad: 'string', worse: { nope: 1 } } });
  const loaded = J.loadJobs();
  assert.deepEqual(Object.keys(loaded), ['good']);
  assert.equal(loaded.good.status, 'new');
});

test('backup meta defaults to "never backed up, nothing changed"', () => {
  assert.deepEqual(J.loadMeta(), { lastBackupAt: null, changesSince: 0 });
  J.saveMeta({ lastBackupAt: '2026-10-01T00:00:00.000Z', changesSince: 4 });
  assert.deepEqual(J.loadMeta(), { lastBackupAt: '2026-10-01T00:00:00.000Z', changesSince: 4 });
  mem.set(J.META_KEY, 'garbage');
  assert.deepEqual(J.loadMeta(), { lastBackupAt: null, changesSince: 0 });
});
