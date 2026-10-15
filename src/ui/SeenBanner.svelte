<script>
  // "You have been here before": the same posting, or the same job on another
  // site, with what you did about it. Works out once per posting per page load.
  import { session } from './state.js';
  import { STATUS_LABEL, agoText } from '../core/jobs.js';

  const seen = $derived($session.seen);
  const current = $derived($session.result ? $session.result.verdict : null);
  const done = (s) => ['applied', 'interview', 'offer'].includes(s);
  const applied = $derived(!!(seen && ((seen.previous && done(seen.previous.status)) || seen.duplicates.some((d) => done(d.status)))));
  const when = (job) => (job.appliedAt ? ' on ' + job.appliedAt.slice(0, 10) : '');
</script>

{#if seen}
  <div class="seen" class:applied>
    {#if seen.previous}
      <div>
        <b>{applied && done(seen.previous.status) ? 'You already applied' : 'Seen before'}</b>:
        last looked at this posting {agoText(seen.previous.lastSeen)}{seen.previous.seenCount > 1 ? ' (' + seen.previous.seenCount + ' visits)' : ''}.
        Status: <b>{STATUS_LABEL[seen.previous.status] || seen.previous.status}</b>{done(seen.previous.status) ? when(seen.previous) : ''}.
        {#if seen.verdictChanged}The verdict was <b>{seen.was}</b>; it is <b>{current}</b> now.{/if}
      </div>
    {/if}
    {#each seen.duplicates as d (d.id)}
      <div>
        <b>Same job elsewhere</b>:
        {#if d.url}<a href={d.url} target="_blank" rel="noopener noreferrer">{d.site || 'another site'}</a>{:else}{d.site || 'another site'}{/if},
        {agoText(d.lastSeen)}: <b>{STATUS_LABEL[d.status] || d.status}</b>{done(d.status) ? when(d) : ''} ({d.verdict}).
      </div>
    {/each}
  </div>
{/if}
