import { getv, setv } from './gm.js';
import { blankJob, cleanRecord, upsertJob } from './jobs.js';
import { LIMITS, SCHEMA_VERSION } from './config.js';

export const TRACKING_PARAMS = /^(utm_|trk|trackingId|refId|gh_src|gh_jid|src|source|from|fbclid|gclid|mc_|_hs|campaignId|recommendedFlavor|position|pageNum|start)/i;

export function canonicalKey(url) {
  try {
    const u = new URL(url);
    // Indeed: the two-pane search page keeps one URL while the pane changes
    // job, so the open job's key (vjk) is the identity, not the search URL.
    if (/(^|\.)indeed\.com$/i.test(u.hostname)) {
      const jk = u.searchParams.get('vjk') || u.searchParams.get('jk');
      if (jk) return 'indeed:job:' + jk;
    }
    // LinkedIn: the right-hand pane is keyed by the job id, not the URL.
    if (/(^|\.)linkedin\.com$/i.test(u.hostname)) {
      const fromQuery = u.searchParams.get('currentJobId');
      const fromPath = (u.pathname.match(/\/(\d{6,})(?:\/|$)/) || [])[1];
      const id = fromQuery || fromPath;
      if (id) return 'linkedin:job:' + id;
    }
    u.hash = '';
    for (const k of Array.from(u.searchParams.keys())) {
      if (TRACKING_PARAMS.test(k)) u.searchParams.delete(k);
    }
    const qs = u.searchParams.toString();
    return u.origin + u.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '');
  } catch (e) {
    return String(url);
  }
}

export function readCache() {
  const raw = getv('cache', null);
  if (!raw || typeof raw !== 'object') return {};
  const now = Date.now();
  const ttl = LIMITS.CACHE_TTL_DAYS * 86400000;
  const out = {};
  for (const k of Object.keys(raw)) {
    const e = raw[k];
    if (!e || typeof e !== 'object') continue;
    if (e.version !== SCHEMA_VERSION) continue;
    if (!e.ts || now - e.ts > ttl) continue;
    out[k] = e;
  }
  return out;
}

export function writeCache(cache) {
  const keys = Object.keys(cache).sort((a, b) => (cache[b].ts || 0) - (cache[a].ts || 0));
  const trimmed = {};
  keys.slice(0, LIMITS.CACHE_MAX_ENTRIES).forEach((k) => { trimmed[k] = cache[k]; });
  setv('cache', trimmed);
}

export function cacheGet(key) {
  const cache = readCache();
  const hit = cache[key];
  return hit && hit.extraction ? hit : null;
}

export function cachePut(key, entry) {
  const cache = readCache();
  cache[key] = Object.assign({ ts: Date.now(), version: SCHEMA_VERSION }, entry);
  writeCache(cache);
}

// The local history is just this rolling log. It is stored with GM_setValue
// (per-browser, per-profile) and never leaves the machine.
export function appendLog(entry) {
  const raw = getv('log', []);
  const list = Array.isArray(raw) ? raw : [];
  // Looking at the same posting again replaces its entry instead of piling up.
  const last = list[list.length - 1];
  if (last && last.url && last.url === entry.url) list[list.length - 1] = entry;
  else list.push(entry);
  setv('log', list.slice(-LIMITS.LOG_MAX));
}

export function readLog() {
  const raw = getv('log', []);
  return Array.isArray(raw) ? raw.filter((e) => e && typeof e === 'object') : [];
}

export function clearLog() { setv('log', []); }

export function clearCache() { setv('cache', {}); }

// Fit notes are cached beside the extraction, under their own key, because they
// depend on your profile as well as on the posting.
export function fitGet(key) {
  const hit = readCache()[key];
  return hit && hit.fit ? hit.fit : null;
}

export function fitPut(key, fit) {
  const cache = readCache();
  cache[key] = { ts: Date.now(), version: SCHEMA_VERSION, fit: fit };
  writeCache(cache);
}

/* ------------------------------------------------------------------ jobs
   The durable record of every posting you have looked at and what you did
   about it. Kept apart from the 14-day extraction cache and never trimmed. */

export const JOBS_KEY = 'jobs.v1';
export const META_KEY = 'jobs.meta.v1';

export function loadJobs() {
  const raw = getv(JOBS_KEY, null);
  if (raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object') {
    const items = {};
    for (const rec of Object.values(raw.items)) {
      const clean = cleanRecord(rec);
      if (clean) items[clean.id] = clean;
    }
    return items;
  }
  // First run of the tracker: carry over what the old rolling log knew.
  let jobs = {};
  for (const e of readLog()) {
    if (!e.url) continue;
    const when = Date.parse(e.timestamp);
    const res = upsertJob(jobs, {
      id: canonicalKey(e.url), url: e.url, company: e.company, title: e.title, verdict: e.verdict,
      fail_gate: e.fail_gate, fail_detail: e.fail_detail, reason: e.reason, flags: e.flags,
      base_min: e.base_min, base_max: e.base_max,
    }, Number.isFinite(when) ? when : Date.now());
    jobs = res.jobs;
  }
  return jobs;
}

export function saveJobs(items) {
  setv(JOBS_KEY, { version: 1, items: items });
}

export function loadMeta() {
  const m = getv(META_KEY, null);
  return m && typeof m === 'object' ? { lastBackupAt: m.lastBackupAt || null, changesSince: Number(m.changesSince) || 0 } : { lastBackupAt: null, changesSince: 0 };
}

export function saveMeta(meta) { setv(META_KEY, meta); }

export { blankJob };
