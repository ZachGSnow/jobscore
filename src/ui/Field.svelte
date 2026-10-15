<script>
  // One setting, rendered from its schema entry. Text-like fields commit on
  // change (blur), so typing never re-scores half a number; toggles and
  // dropdowns commit at once.
  import { settings, updateSetting, resetSetting } from './state.js';
  import { getPath, isModified } from '../core/settings.js';
  import { EFFECT_LABELS } from '../core/schema.js';

  let { field } = $props();
  const value = $derived(getPath($settings, field.path));
  const modified = $derived(isModified($settings, field.path));
  const listText = $derived(Array.isArray(value) ? value.join('\n') : '');

  function commitList(e) {
    updateSetting(field.path, e.currentTarget.value.split('\n').map((s) => s.trim()).filter(Boolean));
  }
  function commitText(e) { updateSetting(field.path, e.currentTarget.value.trim()); }
  function commitNumber(e) {
    const n = Number(e.currentTarget.value);
    if (Number.isFinite(n) && e.currentTarget.value !== '') {
      const lo = field.min == null ? -Infinity : field.min;
      const hi = field.max == null ? Infinity : field.max;
      updateSetting(field.path, Math.min(hi, Math.max(lo, n)));
    } else {
      e.currentTarget.value = String(value);
    }
  }
</script>

<div class="field">
  <label class="lbl">
    {#if field.type === 'toggle'}
      <input type="checkbox" checked={value === true} onchange={(e) => updateSetting(field.path, e.currentTarget.checked)} />
    {/if}
    <span>{field.label}</span>
    {#if modified}
      <span class="mod" title="Different from the default">modified</span>
      <button class="linkbtn" onclick={() => resetSetting(field.path)}>reset</button>
    {/if}
  </label>

  {#if field.type === 'money' || field.type === 'number'}
    <div class="ctl">
      {#if field.type === 'money'}<span class="unit">$</span>{/if}
      <input type="number" value={value} step={field.type === 'money' ? 1000 : 1} min={field.min} max={field.max} onchange={commitNumber} />
      {#if field.unit}<span class="unit">{field.unit}</span>{/if}
    </div>
  {:else if field.type === 'effect'}
    <div class="ctl">
      <select {value} onchange={(e) => updateSetting(field.path, e.currentTarget.value)}>
        {#each Object.entries(EFFECT_LABELS) as [id, label] (id)}
          <option value={id} selected={value === id}>{label}</option>
        {/each}
      </select>
    </div>
  {:else if field.type === 'select'}
    <div class="ctl">
      <select {value} onchange={(e) => updateSetting(field.path, e.currentTarget.value)}>
        {#each field.options as [id, label] (id)}
          <option value={id} selected={value === id}>{label}</option>
        {/each}
      </select>
    </div>
  {:else if field.type === 'list'}
    <div class="ctl"><textarea rows={Math.min(8, Math.max(2, (value || []).length + 1))} value={listText} onchange={commitList} spellcheck="false"></textarea></div>
  {:else if field.type === 'longtext'}
    <div class="ctl"><textarea rows={field.rows || 6} {value} onchange={commitText}></textarea></div>
  {:else if field.type === 'text' || field.type === 'url'}
    <div class="ctl"><input type={field.type === 'url' ? 'url' : 'text'} {value} onchange={commitText} spellcheck="false" /></div>
  {/if}

  {#if field.help}<div class="help">{field.help}</div>{/if}
</div>
