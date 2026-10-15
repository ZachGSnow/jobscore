// Guards on the BUILT userscript (dist/JobScore.user.js). CI builds before it
// tests, so these always run there; locally they skip until `npm run build`.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'vitest';

const DIST = new URL('../dist/JobScore.user.js', import.meta.url);
const built = existsSync(DIST);

test.skipIf(!built)('bundle: no Trusted Types policy and no HTML-string sinks (LinkedIn refuses both)', () => {
  // LinkedIn serves "require-trusted-types-for 'script'; trusted-types default jSecure ..."
  // so creating any other policy throws at load and the whole script dies, and
  // assigning a string to innerHTML throws too. Svelte's fragments: 'tree'
  // option (vite.config.js) is what keeps both out of the bundle.
  const src = readFileSync(DIST, 'utf8');
  assert.doesNotMatch(src, /createPolicy\s*\(/, 'a Trusted Types policy would crash the script on LinkedIn');
  assert.doesNotMatch(src, /\.innerHTML\s*=|insertAdjacentHTML\s*\(|\.outerHTML\s*=/, 'an HTML-string sink would throw under Trusted Types');
});

test.skipIf(!built)('bundle: the userscript header keeps the identity that holds the saved settings', () => {
  const src = readFileSync(DIST, 'utf8');
  assert.match(src, /^\/\/ @name\s+JobScore - Pre-Sales Job Posting Scorer$/m);
  assert.match(src, /^\/\/ @namespace\s+jobscore\.local$/m);
});
