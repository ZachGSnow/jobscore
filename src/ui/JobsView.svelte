<script>
  // Every posting you have scored and what you did about it. Click a verdict, a
  // status, or a bar in "what skips you" to filter; click a title to reopen the
  // posting. Backups and restore live at the bottom.
  import JobRow from './JobRow.svelte';
  import {
    downloadBackup, downloadCsv, importBackupText, jobs, jobsClearAll, meta, setFilter, settings, toast, ui,
  } from './state.js';
  import { computeHistory } from '../core/history.js';
  import {
    CLOSED_STATUSES, OPEN_STATUSES, STATUSES, STATUS_LABEL, agoText, backupDue, countByStatus, dueJobs, filterJobs,
  } from '../core/jobs.js';

  const now = Date.now();
  const f = $derived($ui.jf);
  const all = $derived(Object.values($jobs));
  const due = $derived(dueJobs($jobs, now).length);
  const byStatus = $derived(countByStatus($jobs));
  const count = (ids) => ids.reduce((n, id) => n + (byStatus[id] || 0), 0);
  const list = $derived(filterJobs($jobs, f, now));
  const reminder = $derived(backupDue($meta, all.length, now, $settings.tracker));
  const stats = $derived(computeHistory(all.map((j) => Object.assign({}, j, { timestamp: j.lastSeen })), now));
  const maxFail = $derived(stats.failGates.length ? stats.failGates[0].n : 0);
  const maxFlag = $derived(stats.flagGates.length ? stats.flagGates[0].n : 0);
  const pct = (n, max) => (max ? Math.max(4, Math.round((n / max) * 100)) : 0);
  const queueCount = $derived(filterJobs($jobs, { view: 'queue' }, now).length);
  const outreachCount = $derived(filterJobs($jobs, { view: 'outreach' }, now).length);

  const views = $derived([
    ['queue', 'Queue', queueCount],
    ['outreach', 'Needs outreach', outreachCount],
    ['open', 'Open', count(OPEN_STATUSES)],
    ['closed', 'Closed', count(CLOSED_STATUSES)],
    ['all', 'All', all.length],
  ]);
  const filtered = $derived(!!(f.verdict || f.status || f.gate || f.q));

  let showInsights = $state(false);
  let showImport = $state(false);
  let importText = $state('');
  let importMode = $state('merge');
  let importSettings = $state(false);

  function toggle(key, value) { setFilter({ [key]: f[key] === value ? '' : value }); }
  function clearFilters() { setFilter({ verdict: '', status: '', gate: '', q: '' }); }

  function readFile(e) {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { importText = String(r.result || ''); };
    r.readAsText(file);
  }
  function doImport() {
    try {
      if (importMode === 'replace' && !window.confirm('Replace ALL ' + all.length + ' jobs with the backup? Jobs not in the backup are lost.')) return;
      const n = importBackupText(importText, importMode, importSettings);
      toast('Imported ' + n + ' jobs');
      importText = ''; showImport = false;
    } catch (e) { toast(e.message); }
  }
  function clearAll() {
    const typed = window.prompt('This deletes all ' + all.length + ' tracked jobs. Back up first. Type DELETE to confirm.', '');
    if (typed === 'DELETE') { jobsClearAll(); toast('All jobs removed'); }
  }
  const backedUp = $derived($meta.lastBackupAt ? agoText($meta.lastBackupAt, now) : 'never');
</script>

{#if !all.length}
  <h4>Jobs</h4>
  <div class="meta">Nothing tracked yet. Every posting you score is saved here with its verdict, so you can come back to the ones worth applying to.</div>
{:else}
  {#if reminder}
    <div class="remind">
      <b>Back up your jobs.</b>
      {#if reminder.reason === 'never'}You have {all.length} jobs and no backup yet.
      {:else}{reminder.changes} {reminder.changes === 1 ? 'change' : 'changes'} since your last backup ({backedUp}).{/if}
      Your jobs live in this browser only.
      <button class="primary" onclick={downloadBackup}>Back up now</button>
    </div>
  {/if}

  <div class="chips">
    {#each views as [id, label, n] (id)}
      <button class="chip-btn" class:on={f.view === id && !f.status} onclick={() => setFilter({ view: id, status: '' })}>
        {label} {n}{#if id === 'queue' && due}<span class="due-dot" title="{due} follow-up(s) due">{due} due</span>{/if}
      </button>
    {/each}
  </div>

  <div class="chips">
    <span class="jb-label">Verdict</span>
    {#each ['APPLY', 'ADJACENT', 'REVIEW', 'SKIP'] as v (v)}
      <button class="chip-btn c-{v.toLowerCase()}" class:on={f.verdict === v} onclick={() => toggle('verdict', v)}>{v} {stats.verdicts[v] || 0}</button>
    {/each}
  </div>

  <div class="chips">
    <select value={f.status} onchange={(e) => setFilter({ status: e.currentTarget.value })} title="Show one status">
      <option value="" selected={!f.status}>Any status</option>
      {#each STATUSES as s (s.id)}<option value={s.id} selected={f.status === s.id}>{s.label} {byStatus[s.id] || 0}</option>{/each}
    </select>
    <select value={f.sort} onchange={(e) => setFilter({ sort: e.currentTarget.value })} title="Sort">
      <option value="recent" selected={f.sort === 'recent'}>Newest first</option>
      <option value="followup" selected={f.sort === 'followup'}>Follow-up date</option>
      <option value="company" selected={f.sort === 'company'}>Company A-Z</option>
      <option value="pay" selected={f.sort === 'pay'}>Highest pay</option>
    </select>
    <input type="text" class="search" placeholder="Search company, title, notes" value={f.q} onchange={(e) => setFilter({ q: e.currentTarget.value.trim() })} />
  </div>

  {#if filtered}
    <div class="meta tight">
      Showing {list.length} of {all.length} jobs{f.gate ? ', skipped by ' + f.gate : ''}
      <button class="linkbtn" onclick={clearFilters}>clear filters</button>
    </div>
  {/if}

  {#each list as j (j.id)}<JobRow job={j} />{:else}
    <div class="meta" style="margin:10px 0">
      {f.view === 'queue' && !filtered ? 'Nothing in your queue. Open postings you have not decided on will appear here.' : (f.view === 'outreach' && !filtered ? 'Nobody waiting on outreach: every job you applied to has been reached out to.' : 'No jobs match these filters.')}
    </div>
  {/each}

  <details bind:open={showInsights}>
    <summary>Insights</summary>
    <div class="meta tight">{stats.last7} scored in the last 7 days - {stats.asked} had a question for the recruiter.</div>
    <h5>What skips you</h5>
    {#each stats.failGates as g (g.key)}
      <button class="bar-btn" class:on={f.gate === g.key} onclick={() => { toggle('gate', g.key); setFilter({ view: 'all', verdict: 'SKIP' }); }}>
        <span class="lbl">{g.key}</span><span class="fill" style="width:{pct(g.n, maxFail)}px"></span><span class="n">{g.n}</span>
      </button>
    {:else}<div class="meta">No skips yet.</div>{/each}
    <h5>What raises a question</h5>
    {#each stats.flagGates as g (g.key)}
      <div class="bar"><span class="lbl">{g.key}</span><span class="fill" style="width:{pct(g.n, maxFlag)}px;background:#2ecc71"></span><span class="n">{g.n}</span></div>
    {:else}<div class="meta">No questions yet.</div>{/each}
  </details>

  <h4>Backup</h4>
  <div class="meta tight">{all.length} {all.length === 1 ? 'job' : 'jobs'}. Last backup: {backedUp}{$meta.changesSince ? ', ' + $meta.changesSince + ($meta.changesSince === 1 ? ' change' : ' changes') + ' since' : ''}.</div>
  <div class="buttons" style="border:0;background:none;padding:4px 0">
    <button class="primary" onclick={downloadBackup}>Back up (JSON)</button>
    <button onclick={downloadCsv}>Export CSV</button>
    <button onclick={() => (showImport = !showImport)}>{showImport ? 'Cancel restore' : 'Restore...'}</button>
    <button class="danger" onclick={clearAll}>Remove all</button>
  </div>
{/if}

{#if showImport || !all.length}
  <div class="importbox">
    <div class="meta tight">Restore from a JobScore backup file. <b>Merge</b> keeps whichever copy of a job changed most recently; <b>Replace</b> makes the file the truth.</div>
    <input type="file" accept=".json,application/json" onchange={readFile} />
    <textarea rows="4" bind:value={importText} placeholder="...or paste the backup JSON here"></textarea>
    <div class="chips">
      <select bind:value={importMode}><option value="merge">Merge</option><option value="replace">Replace</option></select>
      <label class="jb-note"><input type="checkbox" bind:checked={importSettings} /> also restore settings</label>
      <button class="primary" onclick={doImport} disabled={!importText.trim()}>Restore</button>
    </div>
  </div>
{/if}
