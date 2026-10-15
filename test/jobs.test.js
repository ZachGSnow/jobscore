// The job tracker: statuses, seen-before matching, follow-ups, filters, CSV and
// backups. All pure, so no browser and no GM store.
import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as J from '../src/all.js';

const T0 = Date.parse('2026-10-13T15:00:00');
const DAY = 86400000;
const tracker = { followUpDays: 7, backupReminderDays: 7, backupReminderChanges: 25 };

function entry(over) {
  return Object.assign({
    id: 'https://boards.greenhouse.io/wasabi/jobs/1', url: 'https://boards.greenhouse.io/wasabi/jobs/1?gh_src=abc',
    company: 'Wasabi Technologies', title: 'Sr. Solutions Architect', location: 'United States of America',
    verdict: 'APPLY', fail_gate: null, fail_detail: null, reason: 'Every gate passed.', flags: [], questions: [],
    base_min: 140000, base_max: 170000,
  }, over || {});
}
const first = (over, now) => J.upsertJob({}, entry(over), now || T0);

/* -------------------------------------------------------------- upsert */

test('a first score creates a record whose status follows the verdict', () => {
  const r = first();
  assert.equal(r.isNew, true);
  assert.equal(r.job.status, 'to_apply');
  assert.equal(r.job.statusBy, 'auto');
  assert.equal(r.job.seenCount, 1);
  assert.equal(r.job.url, 'https://boards.greenhouse.io/wasabi/jobs/1', 'tracking parameters are stripped from the link');
  assert.equal(r.job.site, 'Greenhouse');
  assert.equal(r.job.history.length, 1);
  assert.equal(J.initialStatus('APPLY'), 'to_apply');
  assert.equal(J.initialStatus('ADJACENT'), 'to_apply');
  assert.equal(J.initialStatus('REVIEW'), 'new');
  assert.equal(J.initialStatus('SKIP'), 'passed');
  assert.equal(first({ verdict: 'SKIP', fail_gate: 'Pay' }).job.status, 'passed');
});

test('scoring the same posting again updates it and keeps your work', () => {
  let jobs = first().jobs;
  jobs = J.setStatus(jobs, entry().id, 'applied', T0 + DAY, tracker);
  jobs = J.patchJob(jobs, entry().id, { notes: 'Spoke to Dana' }, T0 + DAY);
  const again = J.upsertJob(jobs, entry({ verdict: 'APPLY', reason: 'changed' }), T0 + 3 * DAY);
  assert.equal(again.isNew, false);
  assert.equal(again.job.status, 'applied', 'a status you set is never overwritten');
  assert.equal(again.job.notes, 'Spoke to Dana');
  assert.equal(again.job.reason, 'changed');
  assert.equal(again.job.seenCount, 2, 'a visit days later counts');
  assert.equal(again.previous.status, 'applied');
});

test('pressing Rescore within the hour is still one visit', () => {
  let jobs = first().jobs;
  jobs = J.upsertJob(jobs, entry(), T0 + 60000).jobs;
  jobs = J.upsertJob(jobs, entry(), T0 + 120000).jobs;
  assert.equal(jobs[entry().id].seenCount, 1);
});

test('an automatic status follows a changed verdict; a manual one does not', () => {
  let jobs = first({ verdict: 'SKIP', fail_gate: 'Pay' }).jobs;
  assert.equal(jobs[entry().id].status, 'passed');
  // you loosen a setting and the same posting now passes
  jobs = J.upsertJob(jobs, entry({ verdict: 'APPLY' }), T0 + DAY).jobs;
  assert.equal(jobs[entry().id].status, 'to_apply');
  assert.match(jobs[entry().id].history[1].note, /verdict is now APPLY/);

  jobs = J.setStatus(jobs, entry().id, 'passed', T0 + 2 * DAY, tracker);
  jobs = J.upsertJob(jobs, entry({ verdict: 'APPLY' }), T0 + 3 * DAY).jobs;
  assert.equal(jobs[entry().id].status, 'passed', 'you said pass; the verdict does not reopen it');
});

/* -------------------------------------------------------- statuses + dates */

test('marking applied records when, and sets the follow-up date a week out', () => {
  let jobs = first().jobs;
  jobs = J.setStatus(jobs, entry().id, 'applied', T0, tracker);
  const j = jobs[entry().id];
  assert.equal(j.status, 'applied');
  assert.equal(j.statusBy, 'user');
  assert.equal(j.appliedAt, new Date(T0).toISOString());
  assert.equal(j.followUpAt, J.addDays(T0, 7));
  assert.equal(j.followUpAt, '2026-10-20');
  assert.deepEqual(j.history.map((h) => h.status), ['to_apply', 'applied']);

  const custom = J.setStatus(first().jobs, entry().id, 'applied', T0, { followUpDays: 3 });
  assert.equal(custom[entry().id].followUpAt, '2026-10-16');
});

test('each status does the right thing to the follow-up date', () => {
  const at = (status) => J.setStatus(first().jobs, entry().id, status, T0, tracker)[entry().id];
  assert.equal(at('asked').followUpAt, '2026-10-20');
  assert.equal(at('follow_up').followUpAt, '2026-10-13', 'follow up means due now');
  for (const s of ['passed', 'rejected', 'closed', 'interview', 'offer']) assert.equal(at(s).followUpAt, null, s);
  // unknown statuses and no-ops change nothing
  const jobs = first().jobs;
  assert.equal(J.setStatus(jobs, entry().id, 'nonsense', T0, tracker), jobs);
  assert.equal(J.setStatus(jobs, entry().id, 'to_apply', T0, tracker), jobs);
  assert.equal(J.setStatus(jobs, 'missing', 'applied', T0, tracker), jobs);
});

test('a follow-up is due on its date, only for jobs you are waiting on', () => {
  let jobs = J.setStatus(first().jobs, entry().id, 'applied', T0, tracker);
  assert.equal(J.isDue(jobs[entry().id], T0 + 6 * DAY), false);
  assert.equal(J.isDue(jobs[entry().id], T0 + 7 * DAY), true);
  assert.equal(J.dueJobs(jobs, T0 + 9 * DAY).length, 1);
  jobs = J.patchJob(jobs, entry().id, { followUpAt: '2026-11-30' }, T0);
  assert.equal(J.isDue(jobs[entry().id], T0 + 9 * DAY), false, 'you can move the date');
  jobs = J.patchJob(jobs, entry().id, { followUpAt: 'tomorrow' }, T0);
  assert.equal(jobs[entry().id].followUpAt, null, 'a junk date clears it');
  const toApply = first().jobs[entry().id];
  assert.equal(J.isDue(Object.assign({}, toApply, { followUpAt: '2020-01-01' }), T0), false, 'to-apply jobs do not come due');
});

test('the applied date can be corrected', () => {
  let jobs = J.setStatus(first().jobs, entry().id, 'applied', T0, tracker);
  jobs = J.patchJob(jobs, entry().id, { appliedAt: '2026-10-09' }, T0);
  assert.equal(jobs[entry().id].appliedAt.slice(0, 10), '2026-10-09');
});

/* ------------------------------------------------------- seen before */

test('the same job on another site is matched by company and title', () => {
  const li = J.upsertJob({}, entry({ id: 'linkedin:job:42', url: 'https://www.linkedin.com/jobs/search/?currentJobId=42', company: 'Wasabi', title: 'Senior Solutions Architect (Remote)' }), T0);
  const ind = entry({ id: 'indeed:job:abc123def4567890', url: 'https://www.indeed.com/jobs?q=se&vjk=abc123def4567890', company: 'Wasabi Technologies, Inc.', title: 'Sr Solutions Architect' });
  const dup = J.dupKeyFor(ind.company, ind.title);
  assert.equal(dup, J.dupKeyFor('Wasabi', 'Senior Solutions Architect'));
  const seen = J.findSeen(li.jobs, ind.id, dup);
  assert.equal(seen.same, null);
  assert.equal(seen.duplicates.length, 1);
  assert.equal(seen.duplicates[0].site, 'LinkedIn');
  assert.equal(J.findSeen(li.jobs, 'linkedin:job:42', dup).duplicates.length, 0, 'a job is not its own duplicate');
  assert.equal(J.dupKeyFor('Acme', ''), null);
  assert.notEqual(J.dupKeyFor('Wasabi', 'Sales Engineer'), J.dupKeyFor('Wasabi', 'Solutions Architect'));
});

test('links reopen the posting, not the search page', () => {
  assert.equal(J.permalinkFor('https://www.indeed.com/jobs?q=se&l=Remote&vjk=665ea0b27f9c11a1&start=10'), 'https://www.indeed.com/viewjob?jk=665ea0b27f9c11a1');
  assert.equal(J.permalinkFor('https://www.linkedin.com/jobs/search/?keywords=se&currentJobId=4012345678&position=1'), 'https://www.linkedin.com/jobs/view/4012345678/');
  assert.equal(J.permalinkFor('https://www.linkedin.com/jobs/view/4012345678/?refId=x&trackingId=y'), 'https://www.linkedin.com/jobs/view/4012345678/');
  assert.equal(J.permalinkFor('https://builtin.com/job/se/123?utm_source=alert&keep=1#apply'), 'https://builtin.com/job/se/123?keep=1');
  assert.equal(J.siteOf('https://job-boards.greenhouse.io/x/jobs/1'), 'Greenhouse');
  assert.equal(J.siteOf('https://careers.trellix.com/jobs/1'), 'careers.trellix.com');
});

test('result cards are indexed by the furthest-along job for each company and title', () => {
  let jobs = first({ id: 'a' }).jobs;
  jobs = J.upsertJob(jobs, entry({ id: 'b', url: 'https://www.linkedin.com/jobs/view/123456/' }), T0).jobs;
  jobs = J.setStatus(jobs, 'b', 'applied', T0, tracker);
  const idx = J.buildIndex(jobs);
  assert.equal(idx.size, 1);
  assert.equal(idx.get(J.dupKeyFor('Wasabi Technologies', 'Sr. Solutions Architect')).status, 'applied');
});

/* -------------------------------------------------------------- views */

function sample() {
  let jobs = {};
  const add = (id, over, status, now) => {
    jobs = J.upsertJob(jobs, entry(Object.assign({ id: id, url: 'https://x.com/' + id }, over)), now || T0).jobs;
    if (status) jobs = J.setStatus(jobs, id, status, now || T0, tracker);
  };
  add('a', { company: 'Acme', title: 'Solutions Engineer' });                                       // to_apply
  add('b', { company: 'Borg', title: 'Sales Engineer', verdict: 'SKIP', fail_gate: 'Pay' });        // passed
  add('c', { company: 'Cyber', title: 'Pre-Sales Engineer' }, 'applied', T0 - 10 * DAY);            // applied, due
  add('d', { company: 'Dyno', title: 'Systems Engineer', verdict: 'REVIEW' });                      // new
  add('e', { company: 'Echo', title: 'Solutions Engineer', verdict: 'SKIP', fail_gate: 'Location' }); // passed
  return jobs;
}

test('views: the queue is what you should look at today', () => {
  const jobs = sample();
  const ids = (f) => J.filterJobs(jobs, f, T0).map((j) => j.id).sort();
  assert.deepEqual(ids({ view: 'queue' }), ['a', 'c'], 'to-apply, plus anything whose follow-up is due');
  assert.deepEqual(ids({ view: 'open' }), ['a', 'c', 'd']);
  assert.deepEqual(ids({ view: 'closed' }), ['b', 'e']);
  assert.deepEqual(ids({ view: 'all' }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids({ status: 'applied' }), ['c']);
  assert.deepEqual(ids({ verdict: 'SKIP' }), ['b', 'e']);
  assert.deepEqual(ids({ gate: 'Location' }), ['e'], 'click a "what skips you" bar to see those');
  assert.deepEqual(ids({ q: 'cyber' }), ['c']);
  assert.deepEqual(ids({ q: 'engineer', verdict: 'APPLY' }), ['a', 'c']);
  assert.equal(J.dueJobs(jobs, T0).length, 1);
  assert.deepEqual(J.countByStatus(jobs), { to_apply: 2 - 1, passed: 2, applied: 1, new: 1 });
});

test('views: sorting by follow-up date puts what is due first and undated last', () => {
  const jobs = sample();
  const order = J.filterJobs(jobs, { view: 'all', sort: 'followup' }, T0).map((j) => j.id);
  assert.equal(order[0], 'c');
  assert.equal(J.filterJobs(jobs, { view: 'all', sort: 'company' }, T0)[0].id, 'a');
  assert.equal(J.filterJobs(jobs, { view: 'all', sort: 'pay' }, T0).length, 5);
});

/* ------------------------------------------------------- export + backup */

test('CSV quotes commas, quotes and newlines, and has one row per job', () => {
  let jobs = first({ company: 'Acme, Inc.', title: 'Sales "Engineer"' }).jobs;
  jobs = J.patchJob(jobs, entry().id, { notes: 'line one\nline two' }, T0);
  const csv = J.jobsToCsv(jobs);
  const lines = csv.split('\r\n');
  assert.match(lines[0], /^Company,Job Title,URL,Status,JobScore Verdict,Date Applied/);
  assert.match(csv, /"Acme, Inc\.","Sales ""Engineer"""/);
  assert.match(csv, /"line one\nline two"/);
  assert.match(csv, /To apply,APPLY/);
  assert.match(J.trackerLine(jobs[entry().id]), /Acme, Inc\. \| Sales "Engineer" \| To apply \| \$140k-\$170k \| https:/);
  assert.match(J.trackerLine(J.upsertJob({}, entry({ base_min: null, base_max: null }), T0).job), /pay not posted/);
});

test('a backup round-trips, and junk records are dropped, not trusted', () => {
  const jobs = sample();
  const text = J.buildBackup(J.DEFAULT_SETTINGS, jobs, T0);
  const back = J.parseBackup(text);
  assert.equal(Object.keys(back.jobs).length, 5);
  assert.equal(back.settings.gates.pay.floor, J.DEFAULT_SETTINGS.gates.pay.floor);
  assert.deepEqual(back.jobs.c, jobs.c);

  const messy = JSON.stringify({ jobscore: 'backup', jobs: [{ id: 'x', status: 'bogus', flags: 'no', followUpAt: 'soon' }, { nope: 1 }, null, { id: 'y', company: 'Y' }] });
  const parsed = J.parseBackup(messy);
  assert.deepEqual(Object.keys(parsed.jobs).sort(), ['x', 'y']);
  assert.equal(parsed.jobs.x.status, 'new');
  assert.deepEqual(parsed.jobs.x.flags, []);
  assert.equal(parsed.jobs.x.followUpAt, null);

  assert.throws(() => J.parseBackup('nope'), /valid JSON/);
  assert.throws(() => J.parseBackup('{"a":1}'), /not a JobScore backup/);
});

test('importing merges by id and the newer change wins', () => {
  const now = sample();
  const older = J.setStatus(now, 'a', 'applied', T0 - 5 * DAY, tracker);          // a backup taken earlier
  older.a = Object.assign({}, older.a, { updatedAt: new Date(T0 - 5 * DAY).toISOString() });
  const incoming = Object.assign({}, older, { zz: J.blankJob('zz') });
  incoming.zz.updatedAt = new Date(T0 - 9 * DAY).toISOString();
  const merged = J.mergeJobs(now, incoming);
  assert.equal(merged.added, 1);
  assert.equal(merged.jobs.a.status, 'to_apply', 'the current, newer record is not undone by an old backup');
  assert.ok(merged.jobs.zz);
  const newer = Object.assign({}, now.a, { notes: 'from another browser', updatedAt: new Date(T0 + DAY).toISOString() });
  assert.equal(J.mergeJobs(now, { a: newer }).jobs.a.notes, 'from another browser');
  assert.equal(J.mergeJobs(now, { a: newer }).updated, 1);
});

test('the backup reminder fires on age or on change count, and never on an empty tracker', () => {
  const n = T0;
  assert.equal(J.backupDue({ lastBackupAt: null, changesSince: 3 }, 3, n, tracker), null, 'too few jobs to nag about');
  assert.equal(J.backupDue({ lastBackupAt: null, changesSince: 6 }, 6, n, tracker).reason, 'never');
  assert.equal(J.backupDue({ lastBackupAt: new Date(n - 2 * DAY).toISOString(), changesSince: 4 }, 30, n, tracker), null);
  assert.equal(J.backupDue({ lastBackupAt: new Date(n - 9 * DAY).toISOString(), changesSince: 4 }, 30, n, tracker).reason, 'age');
  assert.equal(J.backupDue({ lastBackupAt: new Date(n - 1 * DAY).toISOString(), changesSince: 25 }, 30, n, tracker).reason, 'changes');
  assert.equal(J.backupDue({ lastBackupAt: new Date(n - 30 * DAY).toISOString(), changesSince: 0 }, 30, n, tracker), null, 'nothing changed, nothing to save');
  assert.equal(J.backupDue({ lastBackupAt: null, changesSince: 0 }, 0, n, tracker), null);
});

test('removing a job and relative dates', () => {
  const jobs = sample();
  assert.equal(Object.keys(J.removeJob(jobs, 'a')).length, 4);
  assert.equal(J.removeJob(jobs, 'nope'), jobs);
  assert.equal(J.agoText(new Date(T0).toISOString(), T0 + 30000), 'today');
  assert.equal(J.agoText(new Date(T0).toISOString(), T0 + DAY), 'yesterday');
  assert.equal(J.agoText(new Date(T0).toISOString(), T0 + 5 * DAY), '5 days ago');
  assert.equal(J.agoText('garbage', T0), '');
});

test('settings: the tracker defaults are in the form', () => {
  const fields = J.SCHEMA.filter((s) => s.tab === 'tracker').flatMap((s) => s.fields).map((f) => f.path);
  assert.deepEqual(fields, ['tracker.followUpDays', 'tracker.backupReminderDays', 'tracker.backupReminderChanges', 'outreach.name', 'outreach.intro', 'outreach.noteLimit', 'tracker.cardBadges', 'general.cardLabels']);
  assert.equal(J.DEFAULT_SETTINGS.tracker.followUpDays, 7);
});

/* ---------------------------------------------------------------- outreach */

test('outreach: applied jobs nobody has been messaged about are the weekly batch', () => {
  let jobs = {};
  const add = (id, status, reached) => {
    jobs = J.upsertJob(jobs, entry({ id: id, url: 'https://x.com/' + id, company: 'Co ' + id }), T0).jobs;
    if (status) jobs = J.setStatus(jobs, id, status, T0, tracker);
    if (reached) jobs = J.patchJob(jobs, id, { reachedOutAt: '2026-10-12' }, T0);
  };
  add('a', 'applied');                 // needs outreach
  add('b', 'applied', true);           // already messaged
  add('c', null);                      // only to apply
  add('d', 'follow_up');               // nudging, never messaged
  add('e', 'passed');
  const ids = J.filterJobs(jobs, { view: 'outreach' }, T0).map((j) => j.id).sort();
  assert.deepEqual(ids, ['a', 'd']);
  assert.equal(J.needsOutreach(jobs.b), false);
  assert.equal(J.needsOutreach(jobs.c), false);
  assert.equal(jobs.b.reachedOutAt.slice(0, 10), '2026-10-12');
  jobs = J.patchJob(jobs, 'b', { reachedOutAt: null }, T0);
  assert.equal(jobs.b.reachedOutAt, null);
  assert.equal(J.needsOutreach(jobs.b), true);
  assert.equal(J.patchJob(jobs, 'a', { reachedOutAt: 'junk' }, T0).a.reachedOutAt, null);
});

test('outreach: LinkedIn people searches are plain links built from the company and title', () => {
  const u = J.peopleSearchUrls('Wasabi Technologies, Inc.', 'Sr. Solutions Architect - EST Zone');
  assert.equal(u.label, 'Wasabi');
  const kw = (url) => decodeURIComponent(new URL(url).searchParams.get('keywords'));
  assert.equal(new URL(u.managers).hostname, 'www.linkedin.com');
  assert.equal(new URL(u.managers).pathname, '/search/results/people/');
  assert.equal(kw(u.managers), 'Wasabi solutions architecture manager');
  assert.equal(kw(u.team), 'Wasabi Solutions Architect', 'level words and the "- EST Zone" tail are dropped');
  assert.equal(kw(J.peopleSearchUrls('Acme', 'Senior Sales Engineer (Remote)').managers), 'Acme sales engineering manager');
  assert.equal(kw(J.peopleSearchUrls('Acme', 'Systems Engineer').managers), 'Acme systems engineering manager');
  assert.equal(kw(J.peopleSearchUrls('Acme', '').team), 'Acme sales engineering');
  assert.equal(J.peopleSearchUrls('', 'Sales Engineer'), null, 'no company, nothing to search');
  assert.match(J.jobsToCsv({ a: Object.assign(J.blankJob('a'), { reachedOutAt: '2026-10-12T12:00:00.000Z' }) }), /Reached Out/);
});
