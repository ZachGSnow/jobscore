<script>
  // One tracked job. The company and title are a link that reopens the posting.
  import OutreachDraft from './OutreachDraft.svelte';
  import { copyText, jobDelete, jobPatch, jobReachedOut, jobSetStatus } from './state.js';
  import { STATUSES, agoText, dayString, isDue, needsOutreach, peopleSearchUrls, trackerLine } from '../core/jobs.js';
  import { payText } from '../core/history.js';

  let { job } = $props();
  let open = $state(false);
  const now = Date.now();
  const due = $derived(isDue(job, now));
  const pay = $derived(payText(job));
  const people = $derived(peopleSearchUrls(job.company, job.title));
  const outreach = $derived(needsOutreach(job));
  const verdictClass = $derived('c-' + String(job.verdict || 'skip').toLowerCase());

  function remove() {
    if (window.confirm('Remove "' + (job.company || '?') + ' - ' + (job.title || '?') + '" from your jobs? This cannot be undone.')) jobDelete(job.id);
  }
</script>

<div class="job" class:due>
  <div class="job-main">
    <span class="chip {verdictClass}" title={job.reason}>{job.verdict || '?'}</span>
    <span class="job-title">
      {#if job.url}<a href={job.url} target="_blank" rel="noopener noreferrer" title="Open the posting in a new tab"><b>{job.company || '?'}</b> - {job.title || '?'}</a>
      {:else}<b>{job.company || '?'}</b> - {job.title || '?'}{/if}
    </span>
  </div>
  <div class="job-meta">
    {pay}{job.location ? ' - ' + job.location : ''} - {job.site || '?'} - seen {agoText(job.lastSeen, now)}
    {#if job.fail_gate}<span class="c-skip"> - skipped by {job.fail_gate}</span>{/if}
    {#if job.flags && job.flags.length}<span class="c-apply"> - asks: {job.flags.join(', ')}</span>{/if}
  </div>
  <div class="job-controls">
    <select value={job.status} onchange={(e) => jobSetStatus(job.id, e.currentTarget.value)} title="Status">
      {#each STATUSES as s (s.id)}<option value={s.id} selected={job.status === s.id}>{s.label}</option>{/each}
    </select>
    <input type="date" value={job.followUpAt || ''} class:overdue={due} title="Follow-up date"
      onchange={(e) => jobPatch(job.id, { followUpAt: e.currentTarget.value })} />
    {#if job.appliedAt}<span class="jb-note">applied {job.appliedAt.slice(0, 10)}</span>{/if}
    {#if due}<span class="jb-note due">follow-up due</span>{/if}
    {#if outreach}<span class="jb-note">no outreach yet</span>{/if}
    <span class="spacer"></span>
    <button class="linkbtn" onclick={() => (open = !open)}>{open ? 'less' : (job.notes ? 'notes +' : 'more')}</button>
  </div>
  {#if open}
    <div class="job-more">
      <textarea rows="3" value={job.notes} placeholder="Notes ..." onchange={(e) => jobPatch(job.id, { notes: e.currentTarget.value })}></textarea>
      {#if job.questions && job.questions.length}
        <div class="meta tight"><b>To ask:</b> {job.questions.join(' / ')}</div>
      {/if}
      <div class="meta tight">{job.reason}</div>
      {#if job.history && job.history.length}
        <div class="meta tight"><b>History:</b>
          {#each job.history as h, i (h.at + i)}{i ? ' > ' : ''}{STATUSES.find((s) => s.id === h.status)?.label || h.status} {h.at.slice(5, 10)}{/each}
        </div>
      {/if}
      <OutreachDraft {job} />
      <div class="job-controls">
        <label class="jb-note">applied on <input type="date" value={job.appliedAt ? job.appliedAt.slice(0, 10) : ''} max={dayString(now)}
          onchange={(e) => jobPatch(job.id, { appliedAt: e.currentTarget.value })} /></label>
        {#if people}
          <a class="linkbtn" href={people.managers} target="_blank" rel="noopener noreferrer">find managers</a>
          <a class="linkbtn" href={people.team} target="_blank" rel="noopener noreferrer">find team</a>
        {/if}
        {#if job.reachedOutAt}
          <span class="jb-note">reached out {job.reachedOutAt.slice(0, 10)}</span>
          <button class="linkbtn" onclick={() => jobReachedOut(job.id, false)}>undo</button>
        {:else}
          <button onclick={() => jobReachedOut(job.id)}>Mark reached out</button>
        {/if}
        <button onclick={() => copyText(trackerLine(job))}>Copy tracker line</button>
        <button class="danger" onclick={remove}>Remove</button>
      </div>
    </div>
  {/if}
</div>
