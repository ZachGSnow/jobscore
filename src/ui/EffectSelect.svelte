<script>
  // A compact "what should this do" dropdown, bound to one settings path.
  import { settings, updateSetting } from './state.js';
  import { getPath } from '../core/settings.js';
  import { EFFECT_LABELS } from '../core/schema.js';

  let { path, mini = false } = $props();
  const value = $derived(getPath($settings, path));
</script>

<select class:mini {value} onchange={(e) => updateSetting(path, e.currentTarget.value)} title="What this does to the verdict">
  {#each Object.entries(EFFECT_LABELS) as [id, label] (id)}
    <option value={id} selected={value === id}>{label}</option>
  {/each}
</select>
