// The job tracker. Pure functions over a plain object of job records
// ({ [id]: record }), so every rule here is unit-tested without a browser or a
// GM store. Persistence lives in store.js; the panel lives in ui/.
//
// A record is the durable memory of one posting: what it was, what JobScore
// said, and what YOU did about it. It holds compact facts only, never the
// posting text.
import { clip, norm, str } from './util.js';

/* ----------------------------------------------------------------- statuses */

export const STATUSES = [
  { id: 'new', label: 'New' },
  { id: 'to_apply', label: 'To apply' },
  { id: 'asked', label: 'Asked recruiter' },
  { id: 'applied', label: 'Applied' },
  { id: 'follow_up', label: 'Follow up' },
  { id: 'interview', label: 'Interview' },
  { id: 'offer', label: 'Offer' },
  { id: 'passed', label: 'Passed' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'closed', label: 'Closed' },
];
export const STATUS_IDS = STATUSES.map((s) => s.id);
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));

export const CLOSED_STATUSES = ['passed', 'rejected', 'closed'];
export const OPEN_STATUSES = STATUS_IDS.filter((s) => !CLOSED_STATUSES.includes(s));
// Statuses that can come due: you are waiting on someone, or owe a nudge.
export const WATCH_STATUSES = ['asked', 'applied', 'follow_up'];
// What you should be looking at today.
export const QUEUE_STATUSES = ['to_apply', 'follow_up'];

// What a fresh verdict means for a posting nobody has touched yet.
export function initialStatus(verdict) {
  if (verdict === 'APPLY' || verdict === 'ADJACENT') return 'to_apply';
  if (verdict === 'SKIP') return 'passed';
  return 'new';
}

/* -------------------------------------------------------------------- dates */

const pad = (n) => String(n).padStart(2, '0');

// Local calendar date as YYYY-MM-DD. Follow-up dates are dates, not instants.
export function dayString(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function addDays(ms, days) {
  const d = new Date(ms);
  d.setDate(d.getDate() + Math.round(days));
  return dayString(d.getTime());
}

export function validDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s + 'T12:00:00'));
}

export function daysAgo(iso, now) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor(((now || Date.now()) - then) / 86400000));
}

export function agoText(iso, now) {
  const n = daysAgo(iso, now);
  if (n === null) return '';
  if (n === 0) return 'today';
  return n === 1 ? 'yesterday' : n + ' days ago';
}

/* ------------------------------------------------------------- identity */

const COMPANY_NOISE = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|technologies|technology|group|holdings)\b/g;

export function normCompany(s) {
  return norm(s).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(COMPANY_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

export function normTitle(s) {
  return norm(s)
    .replace(/\(.*?\)/g, ' ')                      // "(Remote)", "(US)"
    .replace(/\b(senior|snr)\b/g, 'sr')
    .replace(/\b(remote|hybrid|onsite|on-site|us|usa|united states)\b/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// The same job often arrives from LinkedIn, Indeed and Built In under different
// URLs. Company + title is what they share.
export function dupKeyFor(company, title) {
  const c = normCompany(company);
  const t = normTitle(title);
  return c && t ? c + '|' + t : null;
}

// A link that reopens the posting itself. The address bar on a two-pane search
// page (Indeed's vjk, LinkedIn's currentJobId) only reopens the search.
export function permalinkFor(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)indeed\.com$/i.test(u.hostname)) {
      const jk = u.searchParams.get('vjk') || u.searchParams.get('jk');
      if (jk) return u.origin + '/viewjob?jk=' + jk;
    }
    if (/(^|\.)linkedin\.com$/i.test(u.hostname)) {
      const id = u.searchParams.get('currentJobId') || (u.pathname.match(/\/jobs\/view\/(\d{6,})/) || [])[1];
      if (id) return u.origin + '/jobs/view/' + id + '/';
    }
    u.hash = '';
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^(utm_|trk|trackingId|refId|gh_src|fbclid|gclid|mc_|_hs|campaignId|recommendedFlavor|position|pageNum|start|from|source|src)/i.test(k)) u.searchParams.delete(k);
    }
    return u.toString();
  } catch (e) {
    return String(url || '');
  }
}

export function siteOf(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (/linkedin\.com$/.test(h)) return 'LinkedIn';
    if (/indeed\.com$/.test(h)) return 'Indeed';
    if (/builtin\.com$/.test(h)) return 'Built In';
    if (/greenhouse\.io$/.test(h)) return 'Greenhouse';
    if (/myworkdayjobs\.com$/.test(h)) return 'Workday';
    if (/lever\.co$/.test(h)) return 'Lever';
    if (/ashbyhq\.com$/.test(h)) return 'Ashby';
    return h;
  } catch (e) {
    return '';
  }
}

/* ----------------------------------------------------------------- records */

export function blankJob(id) {
  return {
    id: id, dupKey: null, url: '', site: '', company: '', title: '', location: '',
    firstSeen: null, lastSeen: null, seenCount: 0,
    verdict: null, fail_gate: null, fail_detail: null, reason: '', flags: [], questions: [],
    base_min: null, base_max: null, ote_min: null, ote_max: null,
    status: 'new', statusBy: 'auto', statusAt: null, history: [],
    appliedAt: null, followUpAt: null, reachedOutAt: null, notes: '', updatedAt: null,
    product: '', strengths: [],
  };
}

const iso = (ms) => new Date(ms).toISOString();

function pushHistory(job, status, now, by, note) {
  const entry = { status: status, at: iso(now), by: by };
  if (note) entry.note = note;
  return (job.history || []).concat([entry]).slice(-50);
}

// Record a fresh score. `entry` is what the pipeline produced (see
// logEntryFor). Your own edits are never overwritten: only a status that was
// set automatically follows the verdict.
export function upsertJob(jobs, entry, now) {
  const id = String(entry.id || '');
  if (!id) return { jobs: jobs, job: null, isNew: false, previous: null };
  const previous = jobs[id] || null;
  const base = previous ? Object.assign(blankJob(id), previous) : blankJob(id);
  const company = str(entry.company) || base.company || '';
  const title = str(entry.title) || base.title || '';

  const next = Object.assign({}, base, {
    dupKey: dupKeyFor(company, title) || base.dupKey,
    url: permalinkFor(entry.url) || base.url,
    site: siteOf(entry.url) || base.site,
    company: company, title: title,
    location: str(entry.location) || base.location || '',
    product: str(entry.product) || base.product || '',
    verdict: entry.verdict || base.verdict,
    fail_gate: entry.fail_gate || null,
    fail_detail: entry.fail_detail ? clip(entry.fail_detail, 240) : null,
    reason: clip(entry.reason, 300),
    flags: Array.isArray(entry.flags) ? entry.flags.slice(0, 12) : [],
    questions: Array.isArray(entry.questions) ? entry.questions.slice(0, 8) : [],
    base_min: entry.base_min == null ? null : entry.base_min,
    base_max: entry.base_max == null ? null : entry.base_max,
    ote_min: entry.ote_min == null ? null : entry.ote_min,
    ote_max: entry.ote_max == null ? null : entry.ote_max,
    firstSeen: base.firstSeen || iso(now),
    lastSeen: iso(now),
    // Pressing Rescore five times is still one visit.
    seenCount: previous ? (now - Date.parse(base.lastSeen) > 3600000 ? base.seenCount + 1 : base.seenCount) : 1,
    updatedAt: iso(now),
  });

  const want = initialStatus(next.verdict);
  if (!previous) {
    next.status = want;
    next.statusBy = 'auto';
    next.statusAt = iso(now);
    next.history = pushHistory(next, want, now, 'auto');
  } else if (base.statusBy === 'auto' && base.status !== want) {
    next.status = want;
    next.statusAt = iso(now);
    next.history = pushHistory(next, want, now, 'auto', 'verdict is now ' + next.verdict);
  }
  return { jobs: Object.assign({}, jobs, { [id]: next }), job: next, isNew: !previous, previous: previous };
}

// Your decision. Applying records when, and sets the follow-up date.
export function setStatus(jobs, id, status, now, tracker) {
  const job = jobs[id];
  if (!job || !STATUS_IDS.includes(status) || job.status === status) return jobs;
  const days = tracker && Number.isFinite(tracker.followUpDays) ? tracker.followUpDays : 7;
  const next = Object.assign({}, job, {
    status: status, statusBy: 'user', statusAt: iso(now), updatedAt: iso(now),
    history: pushHistory(job, status, now, 'user'),
  });
  if (status === 'applied') {
    next.appliedAt = iso(now);
    next.followUpAt = addDays(now, days);
  } else if (status === 'asked') {
    next.followUpAt = addDays(now, days);
  } else if (status === 'follow_up') {
    if (!next.followUpAt || next.followUpAt > dayString(now)) next.followUpAt = dayString(now);
  } else if (CLOSED_STATUSES.includes(status) || status === 'interview' || status === 'offer') {
    next.followUpAt = null;
  }
  return Object.assign({}, jobs, { [id]: next });
}

// Notes, follow-up date, or a corrected company / title.
export function patchJob(jobs, id, patch, now) {
  const job = jobs[id];
  if (!job) return jobs;
  const next = Object.assign({}, job, { updatedAt: iso(now) });
  if ('notes' in patch) next.notes = String(patch.notes || '').slice(0, 4000);
  if ('followUpAt' in patch) next.followUpAt = validDay(patch.followUpAt) ? patch.followUpAt : null;
  if ('appliedAt' in patch) {
    const d = validDay(patch.appliedAt) ? new Date(patch.appliedAt + 'T12:00:00').toISOString() : null;
    next.appliedAt = d;
  }
  if ('reachedOutAt' in patch) {
    next.reachedOutAt = validDay(patch.reachedOutAt) ? new Date(patch.reachedOutAt + 'T12:00:00').toISOString() : null;
  }
  if ('company' in patch) next.company = String(patch.company || '').trim();
  if ('title' in patch) next.title = String(patch.title || '').trim();
  next.dupKey = dupKeyFor(next.company, next.title) || next.dupKey;
  return Object.assign({}, jobs, { [id]: next });
}

export function removeJob(jobs, id) {
  if (!(id in jobs)) return jobs;
  const out = Object.assign({}, jobs);
  delete out[id];
  return out;
}

/* ------------------------------------------------------------ seen before */

// Has this posting, or the same job on another site, been looked at already?
export function findSeen(jobs, id, dupKey) {
  const same = jobs[id] || null;
  const duplicates = dupKey
    ? Object.values(jobs).filter((j) => j.id !== id && j.dupKey === dupKey)
        .sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
    : [];
  return { same: same, duplicates: duplicates };
}

// company + title -> the job that is furthest along (for badges on result cards)
const RANK = { offer: 9, interview: 8, applied: 7, follow_up: 6, asked: 5, to_apply: 4, new: 3, passed: 2, rejected: 2, closed: 1 };
export function buildIndex(jobs) {
  const map = new Map();
  for (const j of Object.values(jobs)) {
    if (!j.dupKey) continue;
    const cur = map.get(j.dupKey);
    if (!cur || (RANK[j.status] || 0) > (RANK[cur.status] || 0)) map.set(j.dupKey, j);
  }
  return map;
}

/* ------------------------------------------------------------- outreach */

// Applied, and nobody has been messaged yet: the weekly batch.
export const OUTREACH_STATUSES = ['applied', 'follow_up'];
export function needsOutreach(job) {
  return !!(job && OUTREACH_STATUSES.includes(job.status) && !job.reachedOutAt);
}

// LinkedIn people searches for a job. They are plain links that open in a new
// tab; nothing is fetched or read from the results.
//   managers: who would hire for this seat
//   team:     people with the same title, who can refer you
export function peopleSearchUrls(company, title) {
  const c = String(company || '').replace(/\b(inc|llc|ltd|corp|corporation|technologies|technology)\b\.?/gi, ' ').replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!c) return null;
  const t = String(title || '').replace(/\(.*?\)/g, ' ').replace(/[,\-\u2013\u2014|].*$/, ' ').replace(/\b(sr|senior|snr|jr|junior|associate|staff|principal|lead)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  const area = /architect/i.test(title || '') ? 'solutions architecture' : (/system/i.test(title || '') ? 'systems engineering' : 'sales engineering');
  const url = (q) => 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q) + '&origin=GLOBAL_SEARCH_HEADER';
  return {
    managers: url(c + ' ' + area + ' manager'),
    team: url(c + (t ? ' ' + t : ' ' + area)),
    label: c,
  };
}

/* ------------------------------------------------------------- views */

export function isDue(job, now) {
  return !!(job && WATCH_STATUSES.includes(job.status) && job.followUpAt && job.followUpAt <= dayString(now || Date.now()));
}

export function dueJobs(jobs, now) {
  return Object.values(jobs).filter((j) => isDue(j, now));
}

// filters: { view: 'queue'|'open'|'closed'|'all', status, verdict, gate, q, site }
export function filterJobs(jobs, f, now) {
  f = f || {};
  const q = norm(f.q || '');
  let list = Object.values(jobs).filter((j) => {
    if (f.status && j.status !== f.status) return false;
    if (f.verdict && j.verdict !== f.verdict) return false;
    if (f.gate && j.fail_gate !== f.gate) return false;
    if (f.site && j.site !== f.site) return false;
    if (!f.status) {
      if (f.view === 'queue' && !(QUEUE_STATUSES.includes(j.status) || isDue(j, now))) return false;
      if (f.view === 'outreach' && !needsOutreach(j)) return false;
      if (f.view === 'open' && !OPEN_STATUSES.includes(j.status)) return false;
      if (f.view === 'closed' && !CLOSED_STATUSES.includes(j.status)) return false;
    }
    if (q && !norm([j.company, j.title, j.notes, j.location].join(' ')).includes(q)) return false;
    return true;
  });
  const by = f.sort || 'recent';
  const key = {
    recent: (a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)),
    followup: (a, b) => String(a.followUpAt || '9999').localeCompare(String(b.followUpAt || '9999')) || String(b.lastSeen).localeCompare(String(a.lastSeen)),
    company: (a, b) => norm(a.company).localeCompare(norm(b.company)) || norm(a.title).localeCompare(norm(b.title)),
    pay: (a, b) => (b.base_max || 0) - (a.base_max || 0),
  }[by] || null;
  if (key) list = list.sort(key);
  return list;
}

export function countByStatus(jobs) {
  const out = {};
  for (const j of Object.values(jobs)) out[j.status] = (out[j.status] || 0) + 1;
  return out;
}

/* -------------------------------------------------------------- export */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const CSV_COLUMNS = [
  ['Company', (j) => j.company],
  ['Job Title', (j) => j.title],
  ['URL', (j) => j.url],
  ['Status', (j) => STATUS_LABEL[j.status] || j.status],
  ['JobScore Verdict', (j) => j.verdict],
  ['Date Applied', (j) => (j.appliedAt ? j.appliedAt.slice(0, 10) : '')],
  ['Reached Out', (j) => (j.reachedOutAt ? j.reachedOutAt.slice(0, 10) : '')],
  ['Follow-up Date', (j) => j.followUpAt],
  ['Base Min', (j) => j.base_min],
  ['Base Max', (j) => j.base_max],
  ['OTE Max', (j) => j.ote_max],
  ['Location', (j) => j.location],
  ['Source', (j) => j.site],
  ['First Seen', (j) => (j.firstSeen ? j.firstSeen.slice(0, 10) : '')],
  ['Last Seen', (j) => (j.lastSeen ? j.lastSeen.slice(0, 10) : '')],
  ['Notes', (j) => j.notes],
  ['Flags', (j) => (j.flags || []).join('; ')],
  ['Questions to Ask', (j) => (j.questions || []).join(' | ')],
];

export function jobsToCsv(jobs) {
  const list = Object.values(jobs).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
  const rows = [CSV_COLUMNS.map((c) => csvCell(c[0])).join(',')];
  for (const j of list) rows.push(CSV_COLUMNS.map((c) => csvCell(c[1](j))).join(','));
  return rows.join('\r\n') + '\r\n';
}

// A one-line note for a tracker that takes pasted text.
export function trackerLine(j) {
  const pay = j.base_min != null || j.base_max != null
    ? '$' + Math.round((j.base_min != null ? j.base_min : j.base_max) / 1000) + 'k' +
      (j.base_max != null && j.base_max !== j.base_min && j.base_min != null ? '-$' + Math.round(j.base_max / 1000) + 'k' : '')
    : 'pay not posted';
  return [j.company || '?', j.title || '?', STATUS_LABEL[j.status] || j.status, pay, j.url].join(' | ');
}

/* ------------------------------------------------------------- backup */

export const BACKUP_VERSION = 1;

export function buildBackup(settings, jobs, now) {
  return JSON.stringify({
    jobscore: 'backup', version: BACKUP_VERSION, exportedAt: iso(now),
    settings: settings || null,
    jobs: Object.values(jobs),
  }, null, 2);
}

// Coerce one imported record into the current shape, or null if it is junk.
export function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !raw.id) return null;
  const j = Object.assign(blankJob(raw.id), raw);
  if (!STATUS_IDS.includes(j.status)) j.status = 'new';
  j.statusBy = j.statusBy === 'user' ? 'user' : 'auto';
  j.flags = Array.isArray(j.flags) ? j.flags.map(String) : [];
  j.questions = Array.isArray(j.questions) ? j.questions.map(String) : [];
  j.history = Array.isArray(j.history) ? j.history.filter((h) => h && STATUS_IDS.includes(h.status)).slice(-50) : [];
  j.notes = String(j.notes || '');
  j.strengths = Array.isArray(j.strengths) ? j.strengths.map(String).slice(0, 3) : [];
  j.product = String(j.product || '');
  j.followUpAt = validDay(j.followUpAt) ? j.followUpAt : null;
  j.updatedAt = j.updatedAt || j.lastSeen || null;
  return j;
}

// Returns { settings, jobs } or throws a message the UI can show.
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('That is not valid JSON.'); }
  if (!data || data.jobscore !== 'backup' || !Array.isArray(data.jobs)) throw new Error('That is not a JobScore backup file.');
  const jobs = {};
  for (const raw of data.jobs) {
    const rec = cleanRecord(raw);
    if (rec) jobs[rec.id] = rec;
  }
  return { settings: data.settings && typeof data.settings === 'object' ? data.settings : null, jobs: jobs };
}

// Merge by id; the more recently changed record wins, so importing an old
// backup never undoes newer work.
export function mergeJobs(current, incoming) {
  const out = Object.assign({}, current);
  let added = 0, updated = 0;
  for (const j of Object.values(incoming)) {
    const have = out[j.id];
    if (!have) { out[j.id] = j; added++; continue; }
    if (String(j.updatedAt || '') > String(have.updatedAt || '')) { out[j.id] = j; updated++; }
  }
  return { jobs: out, added: added, updated: updated };
}

// Backup state: { lastBackupAt, changesSince }
export function backupDue(meta, jobCount, now, tracker) {
  const m = meta || {};
  const t = tracker || {};
  const changes = m.changesSince || 0;
  if (!jobCount || !changes) return null;
  if (!m.lastBackupAt) return jobCount >= 5 ? { reason: 'never', changes: changes } : null;
  const days = daysAgo(m.lastBackupAt, now);
  if (changes >= (t.backupReminderChanges || 25)) return { reason: 'changes', changes: changes, days: days };
  if (days !== null && days >= (t.backupReminderDays || 7)) return { reason: 'age', changes: changes, days: days };
  return null;
}
