<script>
  // A refused score. The blocker list is the report: each entry names one thing
  // the extraction got wrong, and the raw counts say what the selectors returned.
  import { session } from './state.js';
  import { money } from '../core/util.js';

  const rep = $derived($session.coverage || {});
  const page = $derived($session.page || {});
  const c = $derived(rep.checks || {});
  const isSelection = $derived(page.site === 'selection');
  const why = $derived(isSelection
    ? 'The text you selected does not contain enough to judge. The header (title, company, location) sits outside the description, so select it too - or use "Full page text".'
    : (rep.after_model
      ? 'The model answered, but the text it answered from does not support a verdict, so nothing is scored.'
      : 'The page text was not captured well enough to score. Nothing was sent to the model.'));

  const rows = $derived([
    ['Site', c.site], ['Selector', c.selector],
    ['Description', c.body_chars == null ? null : c.body_chars + ' chars'],
    ['Page text', c.page_chars == null ? null : c.page_chars + ' chars'],
    ['Page location', page.location], ['Location in ld+json', c.location_from_ld],
    ['Location limit', c.location_restriction], ['Location scope', c.location_scope],
    ['Place token on page', c.place_token_on_page === undefined ? null : (c.place_token_on_page ? 'yes' : 'no')],
    ['Pay lines', (c.pay_lines_on_page == null ? '?' : c.pay_lines_on_page) + ' on page / ' + (c.pay_lines_in_description == null ? '?' : c.pay_lines_in_description) + ' in the description'],
    ['Base pay', c.base_min === undefined && c.base_max === undefined ? null : money(c.base_min) + ' - ' + money(c.base_max)],
    ['Duplicated text', c.duplicate_text_runs],
    ['Collapsed', c.collapsed === undefined ? null : (c.collapsed ? 'yes' : 'no')],
  ]);
</script>

<div class="big skip">NO SCORE</div>
<div class="meta">{why}</div>
<h4>Why it stopped</h4>
<ul>{#each rep.blockers || [] as b (b.id)}<li><span class="status fail">&#10007;</span><span>{b.message}</span></li>{/each}</ul>
{#if (rep.notes || []).length}
  <h4>Also noticed</h4>
  <ul>{#each rep.notes as n (n)}<li><span class="status caution">!</span><span>{n}</span></li>{/each}</ul>
{/if}
<h4>What the selectors returned</h4>
{#each rows as [k, v] (k)}
  <div class="row"><span class="k">{k}</span><span>{v == null || v === '' ? 'none' : v}</span></div>
{/each}
<div class="meta" style="margin-top:8px">
  Fix it: select the posting text on the page and press <b>+ Selection</b> (adds it to what was scraped) or
  <b>Selection only</b>, or press <b>Full page text</b> to score everything the page shows.
</div>
