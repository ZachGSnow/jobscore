<script>
  // Draft a first message to someone at the company. The text is built from facts
  // (see core/outreach.js) and is yours to edit before you copy it.
  import { copyText, jobReachedOut, settings } from './state.js';
  import { RECIPIENTS, buildOutreach } from '../core/outreach.js';

  let { job } = $props();
  let open = $state(false);
  let type = $state('manager');
  let mode = $state('note');
  let name = $state('');
  let edited = $state(null);   // your edits; cleared when the inputs change

  const built = $derived(buildOutreach({ type, mode, name }, { job, settings: $settings }));
  const text = $derived(edited === null ? built.text : edited);
  const over = $derived(mode === 'note' && text.length > built.limit);

  function regenerate() { edited = null; }
  function copy(andMark) {
    copyText(text);
    if (andMark && !job.reachedOutAt) jobReachedOut(job.id);
  }
</script>

<div class="draft">
  <button onclick={() => (open = !open)}>{open ? 'Hide message' : 'Draft a message'}</button>
  {#if open}
    <div class="draft-box">
      <div class="chips">
        <select bind:value={type} onchange={regenerate} title="Who you are writing to">
          {#each RECIPIENTS as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
        </select>
        <select bind:value={mode} onchange={regenerate} title="A short connection note, or a fuller message">
          <option value="note">Connection note (up to {$settings.outreach.noteLimit})</option>
          <option value="message">Message</option>
        </select>
        <input type="text" class="search" placeholder="Their first name" bind:value={name} oninput={regenerate} />
      </div>
      <textarea rows={mode === 'note' ? 4 : 9} value={text} oninput={(e) => (edited = e.currentTarget.value)}></textarea>
      <div class="chips">
        {#if mode === 'note'}<span class="draft-count" class:over>{text.length} / {built.limit}</span>{/if}
        <button class="primary" onclick={() => copy(false)}>Copy</button>
        <button onclick={() => copy(true)} disabled={!!job.reachedOutAt} title="Copy it and record that you reached out today">Copy + mark reached out</button>
        {#if edited !== null}<button class="linkbtn" onclick={regenerate}>reset my edits</button>{/if}
      </div>
      <div class="meta tight">Built only from your intro, products you listed as familiar, and strengths the fit notes confirmed. Read it before you send it.</div>
    </div>
  {/if}
</div>
