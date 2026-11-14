// @vitest-environment jsdom
// state.js is imported on every page and in every frame (the catch-all @match),
// so it must not read the never-trimmed tracker until the panel needs it.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { get } from 'svelte/store';

const reads = [];
const store = {
  'jobs.v1': { version: 1, items: { 'https://jobs.lever.co/acme/1': { id: 'https://jobs.lever.co/acme/1', company: 'Acme', title: 'SE', status: 'applied', statusBy: 'user' } } },
};
globalThis.GM_getValue = (k, d) => { reads.push(k); return k in store ? store[k] : d; };
globalThis.GM_setValue = (k, v) => { store[k] = v; };

const S = await import('../src/ui/state.js');

test('state: importing it does not read the job tracker', () => {
  assert.equal(reads.includes('jobs.v1'), false, 'no tracker read at import');
  assert.deepEqual(get(S.jobs), {});
  S.scanCardsSafe();
  assert.equal(reads.includes('jobs.v1'), false, 'a card scan on an idle page reads nothing');
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(reads.includes('jobs.v1'), false, 'neither does coming back to an idle tab');
});

test('state: the tracker loads once, when the panel needs it, without writing it back', () => {
  const before = JSON.stringify(store['jobs.v1']);
  S.ensureTracker();
  assert.equal(get(S.jobs)['https://jobs.lever.co/acme/1'].status, 'applied');
  const n = reads.length;
  S.ensureTracker();
  assert.equal(reads.length, n, 'a second call reads nothing');
  assert.equal(JSON.stringify(store['jobs.v1']), before, 'loading is not a save');
});
