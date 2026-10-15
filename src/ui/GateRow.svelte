<script>
  // One gate: its status, why, the page wording behind it, and the setting that
  // decides what it does to the verdict - editable right here.
  import EffectSelect from './EffectSelect.svelte';
  import { GATE_TAB } from '../core/schema.js';
  import { patchUi } from './state.js';

  let { gate, items = [] } = $props();

  const mark = $derived(gate.status === 'pass' ? '\u2713' : (gate.status === 'unknown' ? '?' : '\u2717'));
  const softs = $derived(items.filter((i) => i.status === 'soft' && i.id === gate.id));
  const modePath = $derived(`gates.${gate.id}.${gate.modeKey || (gate.status === 'fail' ? 'onFail' : 'onUnknown')}`);

  function edit() { patchUi({ view: 'settings', tab: GATE_TAB[gate.id] || 'pay', collapsed: false }); }
</script>

<li>
  <span class="status {gate.status}">{mark}</span>
  <span class="gate">
    <div class="gate-head">
      <span class="txt"><b>{gate.name}</b> - {gate.detail}</span>
      {#if gate.status !== 'pass'}
        <EffectSelect path={modePath} mini />
      {:else}
        <button class="linkbtn" onclick={edit}>edit</button>
      {/if}
    </div>
    {#if gate.quote}<div class="quote">"{gate.quote}"</div>{/if}
    {#each gate.notes as n (n)}<div class="note">{n}</div>{/each}
    {#each softs as s (s.text)}
      <div class="gate-head" style="margin-left:20px">
        <span class="txt soft">! {s.text}</span>
        {#if s.modeKey}<EffectSelect path={`gates.${gate.id}.${s.modeKey}`} mini />{/if}
      </div>
    {/each}
  </span>
</li>
