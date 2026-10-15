<script>
  // What the model read, each with the quote it gave and its own one-line note.
  // A value dropped because its quote was not on the page says so, instead of
  // looking like the posting is silent.
  import { session, ui } from './state.js';
  import { payText } from '../core/history.js';
  import { money } from '../core/util.js';
  import { homeLabel } from '../core/location.js';
  import { getSettings } from '../core/settings.js';

  const x = $derived($session.x || {});
  const page = $derived($session.page || {});
  const v = $derived($session.verification);

  function companyLabel() {
    const name = x.company;
    if (!name) return name;
    if (page.company_source === 'url' && name === page.company) return name + '  (from the URL)';
    return name;
  }

  const rows = $derived([
    ['Company', companyLabel(), 'company'],
    ['Title', x.title, 'title'],
    ['Work', x.work_arrangement, 'work_arrangement'],
    ['Office', x.office_location, 'office_location'],
    ['Open to ' + homeLabel(getSettings()), x.eligibility_home || x.eligibility_ky, 'eligibility_home'],
    ['Wording', x.eligibility_text, 'eligibility_text'],
    ['Location limit', x.location_restriction, 'location_restriction'],
    ['Location scope', x.location_scope, 'location_scope'],
    ['Page location', page.location, null],
    ['Base pay', payText(x) + (x.base_source === 'derived_from_ote' ? '  (derived from the posted OTE)' : ''), 'base_min'],
    ['OTE', x.ote_min != null || x.ote_max != null ? (x.ote_min != null ? money(x.ote_min) : '?') + ' - ' + (x.ote_max != null ? money(x.ote_max) : '?') : null, 'ote_max'],
    ['Role type', x.role_type, 'role_type'],
    ['Quota', x.quota_carrying ? 'yes' : 'no', 'quota_carrying'],
    ['Years', x.years_required == null ? null : x.years_required + ' (' + x.years_required_kind + ')', 'years_required'],
    ['Buyer', x.buyer_persona, 'buyer_persona'],
    ['Product', x.product_name, 'product_name'],
    ['Category', x.product_category, 'product_category'],
    ['Tools', (x.named_tools || []).join(', '), 'named_tools'],
    ['Travel', x.travel_percent == null ? null : x.travel_percent + '%', 'travel_percent'],
    ['Travel where', x.travel_scope, 'travel_scope'],
    ['Travel for', x.travel_purpose, 'travel_purpose'],
    ['Posted', x.posted_days_ago == null ? null : x.posted_days_ago + ' days ago', 'posted_days_ago'],
    ['Employer', x.employer_type, 'employer_type'],
  ]);

  function cell(label, value, key) {
    const status = key && v && v.status ? v.status[key] : null;
    const ev = key ? $session.evidence[key] : null;
    const why = key && $session.explanation ? $session.explanation[key] : null;
    const tip = [ev ? 'quote: "' + ev + '"' : null, why ? 'model: ' + why : null].filter(Boolean).join('   |   ');
    const empty = value == null || value === '';
    const notStated = empty && status !== 'unverified' && key && $session.present && $session.present[key] === false;
    const shown = empty ? (status === 'unverified' ? 'quoted but not found' : (notStated ? '(not stated)' : 'n/a')) : String(value);
    return { status, tip, shown, ev };
  }
</script>

{#each rows as [label, value, key] (label)}
  {@const c = cell(label, value, key)}
  <div class="row" title={c.tip || undefined}>
    <span class="k">{label}</span>
    <span class:unverified={c.status === 'unverified'}>{c.shown}</span>
    {#if c.status === 'unverified'}<span class="warn" title="The quote was not found in the page text - treated as null for scoring">!</span>{/if}
  </div>
  {#if $ui.showQuotes && c.ev}<div class="quote">{c.ev}</div>{/if}
{/each}

{#if v && v.unverified.length}
  <h4>Unverified (quote not in page text - scored as null)</h4>
  <ul>{#each v.unverified as k (k)}<li><span class="status caution">!</span><span>{k}</span></li>{/each}</ul>
{/if}
{#if v && v.noQuote.length}
  <div class="meta" style="margin-top:6px">No quote supplied for: {v.noQuote.join(', ')}</div>
{/if}
