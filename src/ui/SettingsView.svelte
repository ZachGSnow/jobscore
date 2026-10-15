<script>
  import Field from './Field.svelte';
  import ModelKey from './ModelKey.svelte';
  import DataTab from './DataTab.svelte';
  import { ui, patchUi } from './state.js';
  import { EFFECT_HELP, SCHEMA, TABS } from '../core/schema.js';

  const sections = $derived(SCHEMA.filter((s) => s.tab === $ui.tab));
  const showEffectHelp = $derived(['pay', 'titles', 'gates'].includes($ui.tab));
</script>

<div class="stab">
  {#each TABS as t (t.id)}
    <button class:on={$ui.tab === t.id} onclick={() => patchUi({ tab: t.id })}>{t.label}</button>
  {/each}
</div>

{#if $ui.tab === 'data'}
  <DataTab />
{:else}
  {#if showEffectHelp}<div class="meta tight">{EFFECT_HELP}</div>{/if}
  {#each sections as sec (sec.title)}
    <div class="sect">
      <h4>{sec.title}</h4>
      {#if sec.note}<div class="meta tight">{sec.note}</div>{/if}
      {#each sec.fields as f (f.path)}<Field field={f} />{/each}
      {#if sec.title === 'Model'}<ModelKey />{/if}
    </div>
  {/each}
{/if}
