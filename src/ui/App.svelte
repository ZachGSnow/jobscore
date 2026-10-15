<script>
  import ScoreView from './ScoreView.svelte';
  import HaltedView from './HaltedView.svelte';
  import SettingsView from './SettingsView.svelte';
  import JobsView from './JobsView.svelte';
  import {
    copyText, currentSelection, jobs, kickoffScore, patchUi, session, toast, ui,
  } from './state.js';
  import { tick } from 'svelte';
  import { applyPosition, setMaximized, startDrag } from './host.js';
  import { buildSummary } from '../core/history.js';
  import { dueJobs } from '../core/jobs.js';
  import { coverageAsText } from '../extract/coverage.js';

  const result = $derived($session.result);
  const status = $derived($session.status);
  const due = $derived(dueJobs($jobs, Date.now()).length);
  const max = $derived($ui.maximized && !$ui.collapsed);

  const pill = $derived(
    status === 'loading' ? '...'
      : status === 'error' ? 'ERR'
        : status === 'halted' ? 'NO SCORE'
          : result ? result.verdict + (result.askRecruiter ? ' \u00B7 ASK' : '')
            : 'JobScore');
  const dot = $derived(
    status === 'error' || status === 'halted' ? 'd-error'
      : status === 'loading' || status === 'idle' || !result ? 'd-loading'
        : result.verdict === 'APPLY' ? (result.askRecruiter ? 'd-ask' : 'd-apply')
          : 'd-' + result.verdict.toLowerCase());

  // The host box is positioned with inline styles, so growing the panel to a
  // large overlay is a host concern, not a CSS one.
  $effect(() => { setMaximized(max); });
  // Expanding, collapsing or switching view changes the panel's size; pull it back
  // inside the window if that pushed an edge off screen.
  $effect(() => {
    $ui.collapsed; $ui.view; $ui.tab; $ui.maximized;
    tick().then(() => requestAnimationFrame(applyPosition));
  });

  function toggle() { patchUi({ collapsed: !$ui.collapsed }); }
  function setView(view) { patchUi({ view: view, collapsed: false }); }

  function withSelection(mode) {
    const sel = currentSelection();
    if (!sel) { toast('Select at least a few lines of the posting first'); return; }
    kickoffScore({ mode, selection: sel });
  }
  function summary() {
    if (status === 'halted') return coverageAsText($session.coverage || {}, $session.page);
    return buildSummary(result, $session.x, $session.page);
  }
</script>

<div class="wrap" class:collapsed={$ui.collapsed} class:max>
  <div class="handle" role="presentation" onmousedown={startDrag} ondblclick={toggle}>
    <span class="dot {dot}"></span>
    <span class="pill-label">{pill}</span>
    {#if !$ui.collapsed}
      <span class="tabs">
        <button class:on={$ui.view === 'score'} onclick={() => setView('score')} title="The verdict for this page">Score</button>
        <button class:on={$ui.view === 'jobs'} onclick={() => setView('jobs')} title="Every posting you have scored, with status and follow-ups">Jobs{#if due}<span class="due-dot">{due}</span>{/if}</button>
        <button class:on={$ui.view === 'settings'} onclick={() => setView('settings')} title="Edit every rule and save it">Settings</button>
        <button onclick={() => patchUi({ maximized: !$ui.maximized })} title={max ? 'Back to the small panel' : 'Make the panel large'}>{max ? '\u2921' : '\u2922'}</button>
      </span>
    {:else}
      <span class="spacer"></span>
      {#if due}<span class="due-dot" title="{due} follow-up(s) due">{due} due</span>{/if}
    {/if}
    <button onclick={toggle} title="Expand / collapse (Alt+1 scores)">{$ui.collapsed ? '\u25BC' : '\u25B2'}</button>
  </div>

  {#if !$ui.collapsed}
    <div class="body">
      {#if $ui.view === 'settings'}
        <SettingsView />
      {:else if $ui.view === 'jobs'}
        <JobsView />
      {:else if status === 'loading'}
        <div>Scoring this posting...</div>
      {:else if status === 'halted'}
        <HaltedView />
      {:else if status === 'error'}
        <div class="err">{$session.error || 'Unknown error'}</div>
        <div class="meta" style="margin-top:8px">Check Settings &gt; Model: provider, model id and API key.</div>
        <button onclick={() => patchUi({ view: 'settings', tab: 'model' })}>Open model settings</button>
      {:else if result}
        <ScoreView />
      {:else}
        <div class="meta">Press Alt+1 or Rescore to score this posting.</div>
      {/if}
    </div>

    {#if $ui.view === 'score'}
      <div class="buttons">
        <button class="primary" onclick={() => kickoffScore({ force: true })}>Rescore</button>
        <button onclick={() => withSelection('addition')} title="Add the text you selected to what was scraped">+ Selection</button>
        <button onclick={() => withSelection('selection')} title="Score only the text you selected">Selection only</button>
        <button onclick={() => kickoffScore({ mode: 'fulltext' })} title="Score everything the page shows, not just the description">Full page text</button>
        <button onclick={() => copyText(summary())}>Copy summary</button>
        <button onclick={() => patchUi({ showQuotes: !$ui.showQuotes })}>{$ui.showQuotes ? 'Hide quotes' : 'Show quotes'}</button>
        <button onclick={() => patchUi({ showSent: !$ui.showSent })}>{$ui.showSent ? 'Hide sent text' : 'Sent text'}</button>
        <button onclick={() => patchUi({ showRaw: !$ui.showRaw })}>{$ui.showRaw ? 'Hide raw JSON' : 'Raw JSON'}</button>
        <button onclick={toggle}>Close</button>
      </div>
    {:else}
      <div class="buttons">
        {#if $ui.view === 'settings'}<button class="primary" onclick={() => setView('score')}>Back to score</button>{/if}
        <button onclick={toggle}>Close</button>
      </div>
    {/if}
  {/if}
  <div class="toast">{$ui.toast}</div>
</div>
