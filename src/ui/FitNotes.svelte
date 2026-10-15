<script>
  // Your profile against what the posting asks for. Informational only: nothing
  // here ever changes a verdict.
  import { settings, session, loadFit } from './state.js';

  const fit = $derived($session.fit);
  const MARK = { yes: '\u2713', partial: '~', no: '\u2717', unknown: '?' };
  const order = { no: 0, partial: 1, unknown: 2, yes: 3 };
  const items = $derived(fit.data ? fit.data.items.slice().sort((a, b) => (order[a.meets] - order[b.meets]) || (a.i - b.i)) : []);
</script>

{#if $settings.general.fitNotes && $session.result && $session.result.verdict !== 'SKIP'}
  <h4>Fit with your profile</h4>
  {#if fit.status === 'loading'}
    <div class="meta">Comparing the requirements with your profile...</div>
  {:else if fit.status === 'error'}
    <div class="err">Fit notes failed: {fit.error}</div>
    <button onclick={loadFit}>Retry</button>
  {:else if fit.data}
    {#if fit.data.summary}<div class="meta tight">{fit.data.summary}</div>{/if}
    {#each items as it (it.i)}
      <div class="fit-item">
        <span class="mark m-{it.meets}">{MARK[it.meets]}</span>
        <span>
          {it.text} <span class="tag">{it.kind}</span>
          {#if it.note}<div class="why">{it.note}</div>{/if}
        </span>
      </div>
    {/each}
    <div class="meta tight">The model's read of your profile - information only, not part of the verdict.</div>
  {:else if !($session.x && $session.x.requirements && $session.x.requirements.length)}
    <div class="meta">The posting listed no requirements to compare.</div>
  {/if}
{/if}
