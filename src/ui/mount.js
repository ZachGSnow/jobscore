// Build the panel on demand, so the catch-all @match does not put a floating box
// on every page you visit.
import { mount } from 'svelte';
import App from './App.svelte';
import css from './panel.css?inline';
import { createHost, host, watchHost } from './host.js';

export function ensurePanel() {
  if (host.el) return;
  createHost(css);
  mount(App, { target: host.root });
  watchHost();
}

export function panelIsUp() { return !!host.el; }
