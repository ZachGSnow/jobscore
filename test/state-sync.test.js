// @vitest-environment jsdom
// With Violentmonkey's GM_addValueChangeListener, each tab follows what other
// tabs save, so an edit starts from this tab's (current) copy and never
// re-reads the whole tracker, and a settings change in another window is not
// overwritten by this one.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { get } from 'svelte/store';

const store = {
  'jobs.v1': { version: 1, items: { a: { id: 'a', company: 'Acme', title: 'SE', status: 'new', statusBy: 'auto' } } },
};
const reads = [];
const writes = [];
const listeners = {};
globalThis.GM_getValue = (k, d) => { reads.push(k); return k in store ? JSON.parse(JSON.stringify(store[k])) : d; };
globalThis.GM_setValue = (k, v) => { writes.push(k); store[k] = JSON.parse(JSON.stringify(v)); };
globalThis.GM_addValueChangeListener = (k, fn) => { (listeners[k] = listeners[k] || []).push(fn); };
// What Violentmonkey does when another tab saves `k`.
const otherTabSaves = (k, v) => { store[k] = v; (listeners[k] || []).forEach((fn) => fn(k, null, v, true)); };

const S = await import('../src/ui/state.js');

test('sync: another tab\'s tracker save shows here without writing it back', () => {
  S.ensureTracker();
  assert.ok(listeners['jobs.v1'], 'the tracker is followed once loaded');
  const items = Object.assign({}, store['jobs.v1'].items, { b: { id: 'b', company: 'Beta', title: 'SA', status: 'applied', statusBy: 'user' } });
  writes.length = 0;
  otherTabSaves('jobs.v1', { version: 1, items });
  assert.equal(get(S.jobs).b.status, 'applied');
  assert.equal(writes.includes('jobs.v1'), false, 'showing a remote save is not a save');
});

test('sync: an edit starts from this tab\'s copy and does not re-read the tracker', () => {
  reads.length = 0;
  S.jobPatch('a', { notes: 'called the recruiter' });
  assert.equal(reads.includes('jobs.v1'), false, 'no full re-read before the edit');
  assert.equal(store['jobs.v1'].items.a.notes, 'called the recruiter');
  assert.equal(store['jobs.v1'].items.b.status, 'applied', 'the other tab\'s job survives the save');
});

test('sync: a setting changed in another window is kept when this one changes a different one', () => {
  const theirs = JSON.parse(JSON.stringify(get(S.settings)));
  theirs.gates.pay.floor = 150000;
  writes.length = 0;
  otherTabSaves('settings.v1', theirs);
  assert.equal(get(S.settings).gates.pay.floor, 150000);
  assert.equal(writes.includes('settings.v1'), false, 'showing a remote save is not a save');
  S.updateSetting('general.cardLabels', false);
  assert.equal(store['settings.v1'].gates.pay.floor, 150000, 'their change is not overwritten');
  assert.equal(store['settings.v1'].general.cardLabels, false);
});
