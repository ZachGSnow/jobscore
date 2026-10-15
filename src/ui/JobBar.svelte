<script>
  // What you are doing about THIS posting: status, follow-up date, notes. Saved
  // the moment you change it, on the same record JobScore wrote the verdict to.
  import OutreachDraft from './OutreachDraft.svelte';
  import { jobs, session, jobSetStatus, jobPatch, jobReachedOut } from './state.js';
  import { STATUSES, dayString, peopleSearchUrls } from '../core/jobs.js';

  const job = $derived($session.jobId ? $jobs[$session.jobId] : null);
  let showNotes = $state(false);
  const today = dayString(Date.now());
  const people = $derived(job ? peopleSearchUrls(job.company, job.title) : null);
  const overdue = $derived(!!(job && job.followUpAt && job.followUpAt <= today && ['asked', 'applied', 'follow_up'].includes(job.status)));
</script>

{#if job}
  <div class="jobbar">
    <div class="jb-row">
      <span class="jb-label">Status</span>
      <select value={job.status} onchange={(e) => jobSetStatus(job.id, e.currentTarget.value)}>
        {#each STATUSES as s (s.id)}<option value={s.id} selected={job.status === s.id}>{s.label}</option>{/each}
      </select>
      <button class="primary" disabled={job.status === 'applied'} onclick={() => jobSetStatus(job.id, 'applied')}>Mark applied</button>
      <button disabled={job.status === 'passed'} onclick={() => jobSetStatus(job.id, 'passed')}>Pass</button>
    </div>
    <div class="jb-row">
      {#if job.appliedAt}<span class="jb-note">Applied {job.appliedAt.slice(0, 10)}</span>{/if}
      <span class="jb-label">Follow up</span>
      <input type="date" class:overdue value={job.followUpAt || ''} onchange={(e) => jobPatch(job.id, { followUpAt: e.currentTarget.value })} />
      {#if overdue}<span class="jb-note due">due</span>{/if}
      <button class="linkbtn" onclick={() => (showNotes = !showNotes)}>{showNotes ? 'hide notes' : (job.notes ? 'notes (1)' : 'add notes')}</button>
    </div>
    <div class="jb-row">
      <span class="jb-label">Outreach</span>
      {#if people}
        <a class="linkbtn" href={people.managers} target="_blank" rel="noopener noreferrer" title="Search LinkedIn for managers at {people.label}">find managers</a>
        <a class="linkbtn" href={people.team} target="_blank" rel="noopener noreferrer" title="Search LinkedIn for people with this title at {people.label}">find team</a>
      {/if}
      {#if job.reachedOutAt}
        <span class="jb-note">reached out {job.reachedOutAt.slice(0, 10)}</span>
        <button class="linkbtn" onclick={() => jobReachedOut(job.id, false)}>undo</button>
      {:else}
        <button onclick={() => jobReachedOut(job.id)}>Mark reached out</button>
      {/if}
    </div>
    <OutreachDraft {job} />
    {#if showNotes}
      <textarea rows="3" value={job.notes} placeholder="Who you spoke to, what they said ..." onchange={(e) => jobPatch(job.id, { notes: e.currentTarget.value })}></textarea>
    {/if}
  </div>
{/if}
