<script>
  import GateRow from './GateRow.svelte';
  import FitNotes from './FitNotes.svelte';
  import Facts from './Facts.svelte';
  import SeenBanner from './SeenBanner.svelte';
  import JobBar from './JobBar.svelte';
  import { session, ui, copyText } from './state.js';
  import { buildRecruiterMessage } from '../core/history.js';

  const res = $derived($session.result);
  const x = $derived($session.x || {});
  const page = $derived($session.page || {});
  const cls = $derived(!res ? '' : res.verdict.toLowerCase());
  const cacheNote = $derived($session.meta && $session.meta.cached ? ' (cached)' : '');
  const modelNote = $derived($session.meta && $session.meta.model ? $session.meta.model : '');
  const srcNote = $derived(page.selector_used ? ' - via ' + page.selector_used + ' (' + page.body_length + ' chars)' : '');
</script>

{#if res}
  <div class="big {cls}">
    {res.verdict}{#if res.askRecruiter}<small>ask the recruiter</small>{/if}
  </div>
  <div class="meta">{res.reason}{cacheNote}{modelNote ? ' - ' + modelNote : ''}{srcNote}</div>

  <SeenBanner />
  <JobBar />

  {#if res.questions.length}
    <div class="ask">
      <b>Ask the recruiter</b>
      <ol>{#each res.questions as q (q)}<li>{q}</li>{/each}</ol>
      <button class="primary" onclick={() => copyText(buildRecruiterMessage(res, x))}>Copy as a message</button>
    </div>
  {/if}

  {#if $session.warnings.length}
    <h4>Check the extraction{$session.unresolved ? ' (this verdict did not depend on it)' : ''}</h4>
    <ul>{#each $session.warnings as w (w)}<li><span class="status caution">!</span><span>{w}</span></li>{/each}</ul>
  {/if}

  <h4>Gates</h4>
  <ul>
    {#each res.gates as g (g.id)}<GateRow gate={g} items={res.items} />{/each}
  </ul>

  <FitNotes />

  <details>
    <summary>What the model read</summary>
    <Facts />
  </details>

  {#if $ui.showSent && page.body}
    <h4>Text sent to the model</h4>
    <pre>{page.body.slice(0, 2000)}{page.body.length > 2000 ? '\n\n[... ' + (page.body.length - 2000) + ' more characters]' : ''}</pre>
  {/if}
  {#if $ui.showRaw && $session.rawText}
    <h4>Raw model JSON</h4>
    <pre>{$session.rawText}</pre>
  {/if}
{/if}
