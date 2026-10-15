// The one place UI state lives. Components read these stores; main.js and the
// hotkey call the actions. Everything that touches the network or the page goes
// through pipeline.js, so this file is only orchestration.
import { get, writable } from 'svelte/store';
import {
  DEFAULT_SETTINGS, clone, getPath, importSettings, loadSettings, saveSettings, setCurrentSettings, setPath,
} from '../core/settings.js';
import {
  JOBS_KEY, canonicalKey, clearCache, loadJobs, loadMeta, saveJobs, saveMeta,
} from '../core/store.js';
import {
  buildBackup, buildIndex, dupKeyFor, findSeen, jobsToCsv, mergeJobs, parseBackup, patchJob, removeJob,
  dayString, setStatus, upsertJob,
} from '../core/jobs.js';
import { getv, setv } from '../core/gm.js';
import { log } from '../core/util.js';
import { scanCards } from '../extract/cards.js';
import { finalize, logEntryFor, runFitNotes, runPipeline } from '../pipeline.js';

/* ----------------------------------------------------------------- stores */

export const settings = writable(loadSettings());

const blankFit = { status: 'idle', data: null, error: null };
const blankSession = {
  status: 'idle',                  // idle | loading | ready | error | halted
  error: null,
  coverage: null,                  // coverage report when status === 'halted'
  result: null,                    // score() output
  x: null,
  evidence: {},
  verification: null,
  page: null,
  meta: null,
  rawText: '',                     // raw model reply (or cached extraction)
  warnings: [],
  unresolved: false,               // a verdict shown although some text was missing
  present: {},
  explanation: {},
  fit: blankFit,
  jobId: null,                     // the tracker record for this posting
  seen: null,                      // what was already known when this page was first scored
};
export const session = writable(blankSession);

export const ui = writable({
  collapsed: getv('collapsed', true),
  view: 'score',                   // always opens on the verdict, never on a stale Settings page
  tab: 'pay',
  showQuotes: getv('showquotes', false),
  showSent: false,
  showRaw: false,
  maximized: false,
  jf: { view: 'queue', verdict: '', status: '', gate: '', q: '', sort: 'recent' },   // the Jobs tab filters
  toast: '',
});

export function setFilter(patch) { ui.update((u) => Object.assign({}, u, { jf: Object.assign({}, u.jf, patch) })); }

let uiReady = false;
ui.subscribe((u) => {
  if (!uiReady) return;
  setv('collapsed', u.collapsed);
  setv('showquotes', u.showQuotes);
});
uiReady = true;

export function patchUi(patch) { ui.update((u) => Object.assign({}, u, patch)); }

let toastTimer = null;
export function toast(msg) {
  patchUi({ toast: msg });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => patchUi({ toast: '' }), 2500);
}

export function copyText(text) {
  const done = () => toast('Copied');
  const fallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    } catch (e) {
      log('copy failed, text follows', text);
      toast('Copy failed - logged to console');
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
  else fallback();
}

export function currentSelection() {
  const sel = String(window.getSelection ? window.getSelection().toString() : '').trim();
  return sel.length >= 40 ? sel : '';
}

/* --------------------------------------------------------------- settings */

setCurrentSettings(get(settings));
let settingsReady = false;

export function updateSetting(path, value) {
  settings.update((s) => setPath(s, path, value));
}
export function resetSetting(path) {
  updateSetting(path, clone(getPath(DEFAULT_SETTINGS, path)));
}
export function resetAllSettings() {
  settings.set(clone(DEFAULT_SETTINGS));
}
export function importSettingsText(text) {
  settings.set(importSettings(text));
}

settings.subscribe((s) => {
  setCurrentSettings(s);
  if (!settingsReady) return;
  saveSettings(s);
  queueMicrotask(onSettingsChanged);
});
settingsReady = true;

// A scoring setting needs no new extraction: the facts are already in hand, so
// the verdict is recomputed in place.
function onSettingsChanged() {
  scanCardsSafe();
  rescoreFromSettings();
}

/* ------------------------------------------------------------------- jobs
   Every real score is recorded here, and what you do about it (status, notes,
   follow-up) is saved on the same record. It is persisted on every change and
   is never trimmed. */

const initialJobs = loadJobs();
// First run of the tracker: write the migrated log out straight away, so the
// old log is never the only copy.
if (Object.keys(initialJobs).length && getv(JOBS_KEY, null) === null) saveJobs(initialJobs);

export const jobs = writable(initialJobs);
export const meta = writable(loadMeta());

let jobsReady = false;
jobs.subscribe((j) => {
  if (!jobsReady) return;
  saveJobs(j);
  queueMicrotask(scanCardsSafe);
});
meta.subscribe((m) => { if (jobsReady) saveMeta(m); });
jobsReady = true;

function bump(n) {
  meta.update((m) => Object.assign({}, m, { changesSince: m.changesSince + (n || 1) }));
}

let seenFor = null;
let seenData = null;

// Called after a fresh score. Works out what was already known about this
// posting (once per posting per page load, so Rescore does not report itself),
// then records it.
function trackScore(out) {
  const entry = logEntryFor(out);
  const before = get(jobs);
  if (seenFor !== entry.id) {
    const dup = dupKeyFor(entry.company, entry.title);
    const found = findSeen(before, entry.id, dup);
    seenFor = entry.id;
    seenData = (found.same || found.duplicates.length)
      ? {
        previous: found.same ? { verdict: found.same.verdict, status: found.same.status, lastSeen: found.same.lastSeen, appliedAt: found.same.appliedAt, seenCount: found.same.seenCount } : null,
        duplicates: found.duplicates.slice(0, 3).map((d) => ({ id: d.id, site: d.site, status: d.status, verdict: d.verdict, lastSeen: d.lastSeen, appliedAt: d.appliedAt, url: d.url })),
        verdictChanged: !!(found.same && found.same.verdict && found.same.verdict !== entry.verdict),
        was: found.same ? found.same.verdict : null,
      }
      : null;
  }
  const res = upsertJob(before, entry, Date.now());
  jobs.set(res.jobs);
  if (res.isNew) bump(1);
  session.update((s) => Object.assign({}, s, { jobId: entry.id, seen: seenData }));
}

export function jobSetStatus(id, status) {
  jobs.update((j) => setStatus(j, id, status, Date.now(), get(settings).tracker));
  bump(1);
}
export function jobPatch(id, patch) {
  jobs.update((j) => patchJob(j, id, patch, Date.now()));
  bump(1);
}
export function jobReachedOut(id, on) {
  jobs.update((j) => patchJob(j, id, { reachedOutAt: on === false ? null : dayString(Date.now()) }, Date.now()));
  bump(1);
}
export function jobDelete(id) {
  jobs.update((j) => removeJob(j, id));
  bump(1);
}
export function jobsClearAll() {
  jobs.set({});
  bump(1);
}

/* ----------------------------------------------------------- backups + CSV */

export function downloadText(filename, text, mime) {
  try {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (e) {
    log('download failed', e && e.message);
    return false;
  }
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function downloadBackup() {
  const text = buildBackup(get(settings), get(jobs), Date.now());
  if (!downloadText('jobscore-backup-' + stamp() + '.json', text, 'application/json')) {
    copyText(text);
    toast('Download blocked: the backup was copied instead');
  } else {
    toast('Backup saved to your Downloads folder');
  }
  meta.set({ lastBackupAt: new Date().toISOString(), changesSince: 0 });
}

export function downloadCsv() {
  const csv = jobsToCsv(get(jobs));
  if (!downloadText('jobscore-jobs-' + stamp() + '.csv', csv, 'text/csv')) {
    copyText(csv);
    toast('Download blocked: the CSV was copied instead');
  } else {
    toast('CSV saved to your Downloads folder');
  }
}

// mode: 'merge' keeps the newer record per job; 'replace' makes the backup the truth.
export function importBackupText(text, mode, withSettings) {
  const parsed = parseBackup(text);
  if (mode === 'replace') {
    jobs.set(parsed.jobs);
    bump(Object.keys(parsed.jobs).length);
  } else {
    const merged = mergeJobs(get(jobs), parsed.jobs);
    jobs.set(merged.jobs);
    bump(merged.added + merged.updated);
    toast(merged.added + ' added, ' + merged.updated + ' updated');
  }
  if (withSettings && parsed.settings) importSettingsText(JSON.stringify(parsed.settings));
  return Object.keys(parsed.jobs).length;
}

/* ------------------------------------------------------- results-page cards */

export function scanCardsSafe() {
  try {
    const s = get(settings);
    const idx = buildIndex(get(jobs));
    const lookup = s.tracker.cardBadges ? (company, title) => {
      const k = dupKeyFor(company, title);
      return k ? idx.get(k) || null : null;
    } : null;
    const r = scanCards(document, s, lookup);
    if (r.scanned) log('card prefilter: ' + r.dimmed + ' of ' + r.scanned + ' cards dimmed' + (r.badged ? ', ' + r.badged + ' tracked' : ''));
  } catch (e) { log('card prefilter skipped', e && e.message); }
}

/* ------------------------------------------------------------ run control */

let inFlight = false;
let lastSignature = null;
let lastRun = null;      // what finalize() needs to re-score without a model call
let lastKey = null;
let fitToken = 0;

export function pageSignature(page) {
  return canonicalKey(page.url) + '|' + page.body_length + '|' + (page.body || '').slice(0, 200);
}
export function isSameSignature(sig) { return sig === lastSignature; }
export function rememberSignature(sig) { lastSignature = sig; }
export function isBusy() { return inFlight; }

// `fresh` is a new run; a re-score after a settings change must not move you off the page you are on.
function applyOutput(out, fresh) {
  const v = out.verification;
  const base = {
    x: out.x, evidence: out.evidence || {}, verification: v, page: out.page, meta: out.meta,
    rawText: out.rawText || '', warnings: out.warnings || [], unresolved: !!out.unresolved,
    present: (v && v.present) || {}, explanation: (v && v.explanation) || {}, error: null,
  };
  if (out.halted) {
    session.update((s) => Object.assign({}, s, base, { result: null, coverage: out.report, status: 'halted', fit: blankFit }));
    // A refusal is only useful if it is read, so expand to show it.
    if (fresh) patchUi({ collapsed: false, view: 'score' });
    return;
  }
  session.update((s) => Object.assign({}, s, base, { result: out.result, coverage: null, status: 'ready' }));
}

export async function kickoffScore(opts) {
  opts = opts || {};
  if (inFlight) { log('already scoring, ignoring request'); return; }
  inFlight = true;
  session.update((s) => Object.assign({}, s, { status: 'loading', error: null }));
  try {
    const out = await runPipeline(opts, get(settings), document, window);
    lastRun = out.run || null;
    lastKey = out.key || null;
    lastSignature = pageSignature(out.page);
    applyOutput(out, true);
    if (out.halted) {
      log('halted', ((out.report && out.report.blockers) || []).map((b) => b.id).join(', '));
      return;
    }
    // A halt is not a verdict, so only real scores are tracked.
    trackScore(out);
    log('scored', out.result.verdict, out.x.company, out.x.title);
    loadFit();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    session.update((s) => Object.assign({}, s, { status: 'error', error: msg }));
    log('error', msg);
  } finally {
    inFlight = false;
  }
}

export function rescoreFromSettings() {
  if (!lastRun) return;
  const s = get(settings);
  const sess = get(session);
  if (sess.status !== 'ready' && sess.status !== 'halted') return;
  const out = finalize(lastRun, s);
  applyOutput(Object.assign(out, { key: lastKey }));
  if (!out.halted) {
    // The record follows the new verdict (an automatic status moves with it).
    const id = get(session).jobId;
    if (id) {
      jobs.update((j) => (j[id] ? upsertJob(j, Object.assign(logEntryFor(out), { id: id }), Date.now()).jobs : j));
    }
    loadFit();
  }
}

// Fit notes: your profile vs the requirement list. Cached, informational, and
// never allowed to break a score that already succeeded.
export async function loadFit() {
  const s = get(settings);
  const sess = get(session);
  const r = sess.result;
  if (!sess.x || !r || r.verdict === 'SKIP' || !s.general.fitNotes || !(sess.x.requirements || []).length) {
    session.update((cur) => Object.assign({}, cur, { fit: blankFit }));
    return;
  }
  const token = ++fitToken;
  session.update((cur) => Object.assign({}, cur, { fit: { status: 'loading', data: cur.fit && cur.fit.data, error: null } }));
  try {
    const data = await runFitNotes(sess.x, lastKey, s);
    if (token !== fitToken) return;
    session.update((cur) => Object.assign({}, cur, { fit: { status: data ? 'ready' : 'idle', data: data, error: null } }));
    // Keep the matches the model confirmed on the job, so a message can be drafted
    // later from the Jobs tab without re-running anything. Not a user edit, so it
    // does not count towards the backup reminder.
    const id = get(session).jobId;
    if (id && data && Array.isArray(data.items)) {
      const strengths = data.items.filter((i) => i.meets === 'yes' && i.note).slice(0, 3).map((i) => i.note);
      jobs.update((j) => (j[id] ? Object.assign({}, j, { [id]: Object.assign({}, j[id], { strengths: strengths }) }) : j));
    }
  } catch (e) {
    if (token !== fitToken) return;
    session.update((cur) => Object.assign({}, cur, { fit: { status: 'error', data: null, error: e && e.message ? e.message : String(e) } }));
  }
}

/* ------------------------------------------------------------------- data */

export function wipeCache() { clearCache(); toast('Cache cleared'); }

export function sessionReset() { session.set(blankSession); lastRun = null; lastKey = null; lastSignature = null; }
