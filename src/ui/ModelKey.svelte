<script>
  // API keys live in Violentmonkey storage, never in the settings blob, so an
  // exported settings file cannot leak one.
  import { settings, toast } from './state.js';
  import { getApiKey, setApiKey } from '../llm/transport.js';
  import { PROVIDERS } from '../core/config.js';

  const provider = $derived($settings.model.provider);
  const needsKey = $derived(!!(PROVIDERS[provider] && PROVIDERS[provider].needsKey));
  let draft = $state('');
  let tick = $state(0);
  const stored = $derived((tick, getApiKey(provider)));
  const masked = $derived(stored ? '\u2022\u2022\u2022\u2022' + stored.slice(-4) : '');

  function save() {
    if (!draft.trim()) return;
    setApiKey(provider, draft);
    draft = '';
    tick++;
    toast('Key saved for ' + provider);
  }
  function clear() { setApiKey(provider, ''); tick++; toast('Key cleared'); }
</script>

<div class="field">
  <div class="lbl">API key for {PROVIDERS[provider].label}</div>
  {#if needsKey}
    <div class="meta tight">{stored ? 'A key is saved (' + masked + ').' : 'No key saved yet - nothing can be scored until you add one.'}</div>
    <div class="ctl">
      <input type="password" bind:value={draft} placeholder="paste a key, then Save" autocomplete="off" />
      <button class="primary" onclick={save} disabled={!draft.trim()}>Save</button>
      {#if stored}<button class="danger" onclick={clear}>Clear</button>{/if}
    </div>
    <div class="help">Stored in Violentmonkey on this browser only. It is never part of an exported settings file.</div>
  {:else}
    <div class="help">{PROVIDERS[provider].label} runs on your machine and needs no key.</div>
  {/if}
</div>
