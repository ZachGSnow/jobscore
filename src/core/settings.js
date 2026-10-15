// Everything you may want to change lives here as data. score() reads it, the
// panel edits it, and it is saved as one JSON blob. Scoring settings never need
// a new API call: the cache holds the extracted facts, not the verdict.
import { getv, setv } from './gm.js';
import { DEFAULT_PROVIDER, PROVIDERS } from './config.js';

export const SETTINGS_KEY = 'settings.v1';

// What a gate does with each outcome. 'skip' ends in SKIP, 'review' in REVIEW,
// 'flag' keeps the verdict and adds a question for the recruiter, 'ignore'
// hides it.
export const EFFECTS = ['skip', 'review', 'flag', 'ignore'];

// A fictional sample profile so the script works out of the box. Replace it in
// Settings > Profile with your own; it is only sent to the fit-notes call.
export const DEFAULT_PROFILE =
  'Sample profile (Jordan, fictional - replace with your own). 12 years in IT infrastructure, ' +
  'currently a senior systems engineer at a regional managed-services provider. Strong in Windows Server, ' +
  'Active Directory, Microsoft 365, Intune, VMware, Cisco and Meraki networking, Palo Alto firewalls, ' +
  'Veeam backup and PowerShell automation. Presales-adjacent work: scopes projects, writes quotes and ' +
  'joins sales calls as the technical expert. No quota-carrying sales role, no AWS/GCP depth.';

export const DEFAULT_SETTINGS = {
  version: 1,

  general: {
    autoScore: true,       // score on page load and SPA navigation
    allSites: true,        // also auto-score unlisted hosts that look like a posting
    cardPrefilter: true,   // dim result cards (Indeed, LinkedIn) that already fail a cheap gate
    cardLabels: true,      // a coloured reason label on every marked result card
    fitNotes: true,        // second, small model call: your profile vs the requirements
  },

  model: {
    provider: DEFAULT_PROVIDER,
    anthropic: PROVIDERS.anthropic.defaultModel,
    openai: PROVIDERS.openai.defaultModel,
    ollama: PROVIDERS.ollama.defaultModel,
    ollamaUrl: PROVIDERS.ollama.url,
  },

  // Sent only to the fit-notes call. Editing it never re-reads a posting.
  profile: DEFAULT_PROFILE,

  outreach: {
    name: '',                   // your first name, for the sign-off ("Thanks, Jordan")
    intro: "I'm a systems engineer from the managed-services world moving into pre-sales",
    noteLimit: 200,             // LinkedIn's connection-note limit; raise it if your account allows more
  },

  tracker: {
    followUpDays: 7,            // follow-up date set when you mark a job Applied or Asked
    backupReminderDays: 7,      // nag for a backup after this many days with changes
    backupReminderChanges: 25,  // or after this many changes
    cardBadges: true,           // outline Indeed result cards for jobs you have already tracked
  },

  // Sample home (Columbus, Ohio). Set your own in Settings > Pay > Where you work from.
  home: {
    region: 'Columbus, Ohio',
    // A posting "includes home" if its eligibility text contains any of these
    // as a whole word (state-level on purpose: "must live in Ohio"). The home
    // state is read from these, so include the state name and its code.
    aliases: ['columbus', 'columbus metro', 'central ohio', 'ohio', 'oh'],
    // Places you can physically commute to. Used for hybrid / onsite offices and
    // for the "travel inside my area" cap. Deliberately city-level.
    metro: [
      'columbus', 'columbus metro', 'central ohio', 'dublin', 'westerville', 'worthington',
      'hilliard', 'upper arlington', 'grove city', 'gahanna', 'reynoldsburg', 'new albany',
      'grandview heights', 'bexley', 'pickerington', 'lewis center', 'powell',
    ],
  },

  gates: {
    title: {
      onFail: 'skip',
      onUnknown: 'review',
      passKeywords: [
        'solutions engineer', 'solution engineer', 'sales engineer', 'sales engineering',
        'solutions consultant', 'solution consultant', 'solutions architect', 'solution architect',
        'sales architect', 'sales consultant', 'technical sales', 'pre-sales', 'presales', 'pre sales',
        'partner engineer', 'channel engineer', 'partner solutions', 'channel solutions',
        'systems engineer', 'customer engineer', 'technical solutions', 'solutions specialist',
      ],
      // Titles that are only pre-sales some of the time. They pass when the model
      // also reads the role as pre-sales, and are unknown otherwise.
      ambiguousKeywords: ['systems engineer', 'customer engineer', 'technical solutions', 'solutions specialist'],
      // Not pre-sales, but close enough that you want to see them. Verdict ADJACENT.
      adjacentKeywords: ['technical account manager', 'customer success engineer', 'technical success manager'],
      blockKeywords: [
        'principal', 'lead', 'staff', 'director', 'vice president', 'vp', 'head of', 'manager',
        'account executive', 'sdr', 'bdr', 'sales development', 'business development',
        'support engineer', 'software engineer', 'delivery engineer', 'implementation',
        'customer success', 'account manager', 'analyst', 'developer', 'intern',
        'hvac', 'electrical', 'mechanical', 'construction', 'manufacturing',
      ],
      useModelRole: true,   // when no keyword matches, let the model's role_type decide
      blockQuota: true,     // a role that carries a sales quota fails
    },
    location: {
      onFail: 'skip',
      onUnknown: 'flag',          // eligibility not stated: ask the recruiter
      allowHybridInMetro: true,   // hybrid / onsite is fine inside your metro
    },
    travel: {
      onFail: 'skip',
      onUnknown: 'flag',
      maxPercentOutside: 10,      // travel anywhere outside your metro
      maxPercentMetro: 50,        // travel inside your metro
      blockCustomerOutside: false, // fail any customer-site travel outside your metro
    },
    pay: {
      onFail: 'skip',             // a stated base under the floor
      onNotPosted: 'flag',        // no base stated: APPLY and ask the recruiter
      onStraddle: 'flag',         // the range starts under the floor but reaches it
      onUnknown: 'review',        // the pay section was never captured
      floor: 110000,              // held against the point of the range chosen by compareAt
      compareAt: 'top',           // top | midpoint | bottom: which figure of the range meets the floor
      preferred: 120000,          // shown as "meets preferred"; never gates
    },
    experience: {
      onFail: 'skip',
      onSalesWords: 'flag',
      onUnknown: 'ignore',
      maxYears: 5,                // years of pre-sales / SE a posting may require
      salesWords: ['meddpicc', 'meddic', 'challenger sale', 'spin selling', 'enterprise sales cycle', 'full sales cycle'],
    },
    product: {
      onFail: 'skip',
      onUnknown: 'flag',          // a product / category you do not recognise
      blockKeywords: [
        'reputation management', 'patient reviews', 'eam', 'cmms', 'cellular iot',
        'embedded hardware', 'observability platform', 'datadog', 'grafana',
        'application performance monitoring', 'apm',
      ],
      goodKeywords: [
        'firewall', 'network security', 'networking', 'sd-wan', 'sase', 'zero trust', 'wireless',
        'endpoint', 'edr', 'xdr', 'mdr', 'siem', 'email security', 'vulnerability', 'identity', 'mfa', 'sso',
        'backup', 'disaster recovery', 'storage', 'virtualization', 'rmm', 'msp', 'managed service',
        'security', 'microsoft 365', 'm365', 'ucaas', 'voip',
      ],
      knownProducts: [
        'Cisco', 'Meraki', 'Palo Alto Networks', 'Veeam', 'VMware', 'Hyper-V',
        'Microsoft 365', 'Intune', 'Entra ID', 'Active Directory', 'Exchange',
      ],
      knownCategories: [
        'MDR / managed detection and response',
        'firewall / network security',
        'backup / disaster recovery / immutable storage',
        'virtualization',
        'M365 / identity / endpoint management',
        'MSP tooling',
      ],
    },
    employer: {
      onFail: 'skip',
      contractWords: ['1099', 'c2c', 'corp-to-corp', 'contract-to-hire', 'long-term contract'],
    },
    language: {
      onFail: 'skip',
      languages: ['spanish', 'french', 'german', 'mandarin', 'japanese', 'portuguese'],
    },
    clearance: {
      onFail: 'skip',
      words: ['top secret', 'ts/sci', 'secret clearance', 'active clearance'],
    },
  },
};

// Aliases used by older code paths and by tests: the gate ids in display order.
export const GATE_IDS = ['title', 'location', 'travel', 'pay', 'experience', 'product', 'employer', 'language', 'clearance'];

/* ---------------------------------------------------------------- helpers */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function clone(v) { return JSON.parse(JSON.stringify(v)); }

export function getPath(obj, path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// Immutable set: returns a new object with `path` replaced.
export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  const out = Array.isArray(obj) ? obj.slice() : Object.assign({}, obj);
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    cur[keys[i]] = Array.isArray(next) ? next.slice() : Object.assign({}, next);
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return out;
}

// Take `saved` where it has the same shape as `defaults`, and the default where
// it does not. Unknown keys are dropped, so a stale export cannot add junk.
export function mergeSettings(saved, defaults) {
  const base = defaults === undefined ? DEFAULT_SETTINGS : defaults;
  if (Array.isArray(base)) {
    if (!Array.isArray(saved)) return base.slice();
    return saved.map((s) => String(s).trim()).filter(Boolean);
  }
  if (isPlainObject(base)) {
    const src = isPlainObject(saved) ? saved : {};
    const out = {};
    for (const k of Object.keys(base)) out[k] = mergeSettings(src[k], base[k]);
    return out;
  }
  if (typeof base === 'number') {
    const n = typeof saved === 'number' ? saved : (typeof saved === 'string' && saved.trim() !== '' ? Number(saved) : NaN);
    return Number.isFinite(n) ? n : base;
  }
  if (typeof base === 'boolean') return typeof saved === 'boolean' ? saved : base;
  return typeof saved === 'string' ? saved : base;
}

// Settings from before there was a settings blob lived under loose GM keys.
function seedFromLegacy() {
  const s = clone(DEFAULT_SETTINGS);
  const provider = getv('provider', null);
  if (provider && PROVIDERS[provider]) s.model.provider = provider;
  for (const p of Object.keys(PROVIDERS)) {
    const m = getv('model.' + p, null);
    if (typeof m === 'string' && m.trim()) s.model[p] = m.trim();
  }
  const bool = (key, to) => { const v = getv(key, null); if (typeof v === 'boolean') to(v); };
  bool('autoscore', (v) => { s.general.autoScore = v; });
  bool('allsites', (v) => { s.general.allSites = v; });
  bool('cardscan', (v) => { s.general.cardPrefilter = v; });
  return s;
}

export function loadSettings() {
  const raw = getv(SETTINGS_KEY, null);
  if (raw && typeof raw === 'object') return mergeSettings(raw);
  return mergeSettings(seedFromLegacy());
}

export function saveSettings(settings) {
  setv(SETTINGS_KEY, settings);
}

// The settings the rest of the code reads. A module-level value, not a store,
// so the pure modules (policy, cards, prompt) do not need to import Svelte.
let current = clone(DEFAULT_SETTINGS);
export function getSettings() { return current; }
export function setCurrentSettings(s) { current = s; }

export function modelFor(settings, provider) {
  const s = settings || current;
  const p = provider || s.model.provider;
  return (s.model[p] || '').trim() || (PROVIDERS[p] || {}).defaultModel || '';
}

// Settings that change what the MODEL is asked, so a cached extraction may no
// longer apply. Everything else only changes how facts are judged.
export function extractionFingerprint(settings) {
  const s = settings || current;
  return s.model.provider + '|' + modelFor(s);
}

// Paths whose value differs from the default (for the "modified" marker).
export function isModified(settings, path) {
  return JSON.stringify(getPath(settings, path)) !== JSON.stringify(getPath(DEFAULT_SETTINGS, path));
}

export function exportSettings(settings) {
  return JSON.stringify({ jobscore: 'settings', version: settings.version, settings }, null, 2);
}

// Returns the merged settings, or throws a message the UI can show. Accepts a
// settings export, a full backup (its settings part), or a bare settings
// object. Anything with no recognisable settings in it is refused rather than
// "imported" as all defaults: a backup pasted here used to reset everything
// silently.
export function importSettings(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('That is not valid JSON.'); }
  let payload = parsed;
  if (parsed && (parsed.jobscore === 'settings' || parsed.jobscore === 'backup')) payload = parsed.settings;
  if (!isPlainObject(payload)) throw new Error('No settings object found in that text.');
  const known = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'version' && k in payload);
  if (!known.length) throw new Error('No JobScore settings found in that text (expected a settings export or a backup file).');
  return mergeSettings(payload);
}
