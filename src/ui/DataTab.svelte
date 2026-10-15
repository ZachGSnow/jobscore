<script>
  import { settings, jobs, toast, copyText, importSettingsText, resetAllSettings, wipeCache, downloadBackup, downloadCsv, patchUi } from './state.js';
  import { exportSettings } from '../core/settings.js';
    import { resetPosition } from './host.js';
  import { diagnosePanel, selectorDebugReport } from '../debug.js';

  let importText = $state('');
  let showImport = $state(false);

  function doImport() {
    try {
      importSettingsText(importText);
      importText = '';
      showImport = false;
      toast('Settings imported');
    } catch (e) {
      toast(e.message);
    }
  }
  function doReset() {
    if (window.confirm('Reset every setting to its default? Your API keys are not touched.')) {
      resetAllSettings();
      toast('Settings reset');
    }
  }
</script>

<h4>Settings</h4>
<div class="meta tight">Everything you change is saved at once, on this browser. API keys are never included in an export.</div>
<div class="buttons" style="border:0;background:none;padding:4px 0">
  <button onclick={() => copyText(exportSettings($settings))}>Copy settings (JSON)</button>
  <button onclick={() => (showImport = !showImport)}>{showImport ? 'Cancel import' : 'Import settings'}</button>
  <button class="danger" onclick={doReset}>Reset all to defaults</button>
</div>
{#if showImport}
  <textarea rows="6" bind:value={importText} placeholder="paste exported settings JSON here"></textarea>
  <div style="margin-top:4px"><button class="primary" onclick={doImport} disabled={!importText.trim()}>Apply</button></div>
{/if}

<h4>Your jobs</h4>
<div class="meta tight">{Object.keys($jobs).length} tracked jobs live in this browser. Restore and filtering are on the Jobs tab.</div>
<div class="buttons" style="border:0;background:none;padding:4px 0">
  <button class="primary" onclick={downloadBackup}>Back up jobs + settings</button>
  <button onclick={downloadCsv}>Export jobs as CSV</button>
  <button onclick={() => patchUi({ view: 'jobs' })}>Open Jobs</button>
</div>

<h4>Cache</h4>
<div class="buttons" style="border:0;background:none;padding:4px 0">
  <button onclick={wipeCache}>Clear extraction cache</button>
</div>
<div class="meta tight">The cache holds the model's extracted facts, not verdicts or your jobs, so clearing it only costs API calls on the next visit.</div>

<h4>Troubleshooting</h4>
<div class="buttons" style="border:0;background:none;padding:4px 0">
  <button onclick={() => { selectorDebugReport(); }}>Copy selector report</button>
  <button onclick={() => { diagnosePanel(); }}>Copy panel diagnosis</button>
  <button onclick={() => { resetPosition(); toast('Panel moved back to the top right'); }}>Reset panel position</button>
</div>
