// The settings form, as data. The panel renders this generically, so adding a
// setting is one line here plus a default in settings.js.
//
// field types: money | number | toggle | effect | select | list | text | longtext | url
//   effect  - what a gate does with an outcome: skip / review / flag / ignore
//   list    - one entry per line

export const EFFECT_LABELS = {
  skip: 'Skip',
  review: 'Review',
  flag: 'Flag + ask',
  ignore: 'Ignore',
};

export const EFFECT_HELP = 'Skip ends in SKIP. Review ends in REVIEW. Flag keeps the verdict and adds a question for the recruiter. Ignore hides it.';

export const TABS = [
  { id: 'pay', label: 'Pay & place' },
  { id: 'titles', label: 'Titles' },
  { id: 'gates', label: 'Other gates' },
  { id: 'tracker', label: 'Tracker' },
  { id: 'model', label: 'Model' },
  { id: 'data', label: 'Data' },
];

// Which tab holds a gate's settings (for the "edit" link on a gate row).
export const GATE_TAB = {
  title: 'titles', location: 'pay', travel: 'pay', pay: 'pay',
  experience: 'gates', product: 'gates', employer: 'gates', language: 'gates', clearance: 'gates',
};

export const SCHEMA = [
  {
    tab: 'pay', title: 'Pay', note: 'The floor is held against the part of the posted base range you pick below. OTE is shown, never gated.',
    fields: [
      { path: 'gates.pay.floor', label: 'Base pay floor', type: 'money', help: 'A stated base whose top is under this is a fail.' },
      {
        path: 'gates.pay.compareAt', label: 'Hold the floor against', type: 'select',
        options: [['top', 'Top of the range'], ['midpoint', 'Midpoint'], ['bottom', 'Bottom of the range']],
        help: 'Top never skips a role that might pay enough. Midpoint is the realistic read if you would land mid-band. Bottom is the guarantee. A range that starts under the floor is still flagged.',
      },
      { path: 'gates.pay.preferred', label: 'Preferred base', type: 'money', help: 'Shown as "meets preferred". Never changes the verdict.' },
      { path: 'gates.pay.onFail', label: 'Base under the floor', type: 'effect' },
      { path: 'gates.pay.onNotPosted', label: 'No base posted', type: 'effect', help: 'Flag + ask = APPLY, with "what is the base?" for the recruiter.' },
      { path: 'gates.pay.onStraddle', label: 'Range starts under the floor', type: 'effect' },
      { path: 'gates.pay.onUnknown', label: 'Pay section not captured', type: 'effect', help: 'A scrape gap, not a posting with no pay.' },
    ],
  },
  {
    tab: 'pay', title: 'Where you work from',
    fields: [
      { path: 'home.region', label: 'Home region', type: 'text', help: 'Used in wording, and in the question put to the model.' },
      { path: 'home.aliases', label: 'Territory words', type: 'list', help: 'A territory or "must live in" line that contains one of these includes you (state level is fine). Include your state name and code (e.g. ohio, oh): the home state is read from these.' },
      { path: 'home.metro', label: 'Commutable places', type: 'list', help: 'Hybrid / onsite offices and "local" travel only count inside these.' },
      { path: 'gates.location.allowHybridInMetro', label: 'Hybrid / onsite in your metro is OK', type: 'toggle' },
      { path: 'gates.location.onFail', label: 'Cannot work from here', type: 'effect' },
      { path: 'gates.location.onUnknown', label: 'Who may apply is not stated', type: 'effect', help: 'Flag + ask = APPLY, with "is this open to <your home state>?" for the recruiter.' },
    ],
  },
  {
    tab: 'pay', title: 'Travel',
    fields: [
      { path: 'gates.travel.maxPercentOutside', label: 'Max travel outside your metro', type: 'number', unit: '%', min: 0, max: 100 },
      { path: 'gates.travel.maxPercentMetro', label: 'Max travel inside your metro', type: 'number', unit: '%', min: 0, max: 100 },
      { path: 'gates.travel.blockCustomerOutside', label: 'No customer-site travel outside your metro', type: 'toggle', help: 'Fails any role that sends you to customers elsewhere, whatever the percentage.' },
      { path: 'gates.travel.onFail', label: 'Over a limit', type: 'effect' },
      { path: 'gates.travel.onUnknown', label: 'Amount or place not stated', type: 'effect' },
    ],
  },

  {
    tab: 'titles', title: 'Title',
    note: 'Matched as whole phrases, ignoring case and punctuation. "pre-sales" matches "Pre Sales Engineer".',
    fields: [
      { path: 'gates.title.passKeywords', label: 'Pre-sales titles', type: 'list' },
      { path: 'gates.title.ambiguousKeywords', label: 'Only pre-sales if the model agrees', type: 'list', help: '"Systems Engineer" is a sysadmin job at some companies. These pass only when the model reads the role as pre-sales.' },
      { path: 'gates.title.adjacentKeywords', label: 'Adjacent titles', type: 'list', help: 'Not pre-sales, but worth seeing. The verdict is ADJACENT.' },
      { path: 'gates.title.blockKeywords', label: 'Blocked words', type: 'list', help: 'Any of these in the title fails it (Principal, Lead, Manager, Account Executive ...).' },
      { path: 'gates.title.useModelRole', label: 'Let the model decide unusual titles', type: 'toggle', help: 'When no keyword matches, a role the model reads as pre-sales passes with a flag.' },
      { path: 'gates.title.blockQuota', label: 'Fail roles that carry a sales quota', type: 'toggle' },
      { path: 'gates.title.onFail', label: 'Title not accepted', type: 'effect' },
      { path: 'gates.title.onUnknown', label: 'No title, or an ambiguous one', type: 'effect' },
    ],
  },

  {
    tab: 'gates', title: 'Experience',
    fields: [
      { path: 'gates.experience.maxYears', label: 'Most pre-sales years a posting may require', type: 'number', unit: 'years', min: 0, max: 40 },
      { path: 'gates.experience.salesWords', label: 'Sales-method words', type: 'list', help: 'Seeing one of these raises a flag, not a fail.' },
      { path: 'gates.experience.onSalesWords', label: 'Sales-method words found', type: 'effect' },
      { path: 'gates.experience.onFail', label: 'Over the years limit', type: 'effect' },
    ],
  },
  {
    tab: 'gates', title: 'Product',
    fields: [
      { path: 'gates.product.blockKeywords', label: 'Blocked product words', type: 'list' },
      { path: 'gates.product.goodKeywords', label: 'Familiar category words', type: 'list' },
      { path: 'gates.product.knownProducts', label: 'Products you know', type: 'list' },
      { path: 'gates.product.knownCategories', label: 'Categories you know', type: 'list' },
      { path: 'gates.product.onFail', label: 'Blocked product', type: 'effect' },
      { path: 'gates.product.onUnknown', label: 'Unfamiliar product', type: 'effect', help: 'Flag + ask is the default: learning a product is part of the job.' },
    ],
  },
  {
    tab: 'gates', title: 'Employer, language, clearance',
    fields: [
      { path: 'gates.employer.contractWords', label: 'Contract wording', type: 'list' },
      { path: 'gates.employer.onFail', label: 'Contract or staffing firm', type: 'effect' },
      { path: 'gates.language.languages', label: 'Languages that fail the role', type: 'list' },
      { path: 'gates.language.onFail', label: 'Other language required', type: 'effect' },
      { path: 'gates.clearance.words', label: 'Clearance words', type: 'list' },
      { path: 'gates.clearance.onFail', label: 'Clearance required', type: 'effect' },
    ],
  },

  {
    tab: 'tracker', title: 'Follow-ups',
    note: 'Marking a job Applied (or Asked recruiter) sets a follow-up date this many days out. The date is yours to change on the job.',
    fields: [
      { path: 'tracker.followUpDays', label: 'Follow up after', type: 'number', unit: 'days', min: 1, max: 60 },
    ],
  },
  {
    tab: 'tracker', title: 'Backups',
    note: 'Your jobs live in this browser. Export a backup file now and then; the Jobs tab reminds you when it is time.',
    fields: [
      { path: 'tracker.backupReminderDays', label: 'Remind me after', type: 'number', unit: 'days with changes', min: 1, max: 90 },
      { path: 'tracker.backupReminderChanges', label: 'Or after', type: 'number', unit: 'changes', min: 1, max: 500 },
    ],
  },
  {
    tab: 'tracker', title: 'Outreach messages',
    note: 'The generator uses only facts: your intro below, a product you listed as familiar, and the strengths the fit notes confirmed. It never invents experience.',
    fields: [
      { path: 'outreach.name', label: 'Your first name (sign-off)', type: 'text' },
      { path: 'outreach.intro', label: 'One-line intro about you', type: 'text', help: 'One sentence, no full stop needed. Keep it true and specific.' },
      { path: 'outreach.noteLimit', label: 'Connection note length limit', type: 'number', unit: 'characters', min: 60, max: 600, help: 'LinkedIn caps the note on a connection request. I believe free accounts get about 200; check yours.' },
    ],
  },
  {
    tab: 'tracker', title: 'Search results',
    fields: [
      { path: 'tracker.cardBadges', label: 'Outline result cards for jobs I already track (Indeed, LinkedIn)', type: 'toggle', help: 'Green: applied or further. Blue: to apply, asked, or follow up. Yellow: needs a look.' },
      { path: 'general.cardLabels', label: 'Label each marked card with the reason', type: 'toggle', help: 'A small coloured label on the card, e.g. "SKIP: pay $88K < $125K" or "Applied 10-12", so you do not have to hover.' },
    ],
  },
  {
    tab: 'model', title: 'Model',
    note: 'Takes effect on the next Rescore. Changing the model re-reads a posting; every other setting re-scores instantly.',
    fields: [
      { path: 'model.provider', label: 'Provider', type: 'select', options: [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['ollama', 'Ollama (local)']] },
      { path: 'model.anthropic', label: 'Anthropic model', type: 'text' },
      { path: 'model.openai', label: 'OpenAI model', type: 'text' },
      { path: 'model.ollama', label: 'Ollama model', type: 'text' },
      { path: 'model.ollamaUrl', label: 'Ollama URL', type: 'url' },
    ],
  },
  {
    tab: 'model', title: 'Behaviour',
    fields: [
      { path: 'general.autoScore', label: 'Score automatically on load and navigation', type: 'toggle' },
      { path: 'general.allSites', label: 'Also auto-score sites that look like a posting', type: 'toggle', help: 'Off: only listed sites auto-score. Alt+1 works everywhere either way.' },
      { path: 'general.cardPrefilter', label: 'Dim result cards that already fail (Indeed, LinkedIn)', type: 'toggle', help: 'Judged from the card alone (title, pay shown, place), with no API call.' },
      { path: 'general.fitNotes', label: 'Fit notes (your profile vs the requirements)', type: 'toggle', help: 'A second, small call after a non-SKIP verdict. Informational only.' },
    ],
  },
  {
    tab: 'model', title: 'Your profile',
    note: 'Sent only to the fit-notes call, never to the extraction. Editing it never re-reads a posting.',
    fields: [
      { path: 'profile', label: 'Profile', type: 'longtext', rows: 9 },
    ],
  },
];
