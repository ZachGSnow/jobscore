import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import monkey from 'vite-plugin-monkey';

// One bundled file, dist/JobScore.user.js, is what Violentmonkey installs.
export default defineConfig({
  plugins: [
    // fragments: 'tree' builds the panel with DOM calls instead of HTML strings.
    // LinkedIn enforces Trusted Types with an allow-list of policy names, and
    // Svelte's default HTML-string templates create a "svelte-trusted-html"
    // policy at load, which LinkedIn refuses - the whole script crashed there.
    // Test page: test/harness/serve.mjs with ?csp=linkedin.
    svelte({ compilerOptions: { fragments: 'tree' } }),
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'JobScore - Pre-Sales Job Posting Scorer',
        // name + namespace are the script's identity in Violentmonkey, and its saved
        // settings and job tracker belong to that identity. Never change either, or
        // an update installs as a new script with empty storage.
        namespace: 'jobscore.local',
        description: 'Reads the job posting you are looking at, has an LLM extract the facts, checks every quote against the page in code, then scores them against YOUR editable rules and shows APPLY / SKIP in a floating panel. It never navigates, clicks, or fetches other pages.',
        author: 'Zach Snow',
        homepageURL: 'https://github.com/ZachGSnow/jobscore',
        supportURL: 'https://github.com/ZachGSnow/jobscore/issues',
        // Every GitHub release attaches the built script, so installs auto-update.
        downloadURL: 'https://github.com/ZachGSnow/jobscore/releases/latest/download/JobScore.user.js',
        updateURL: 'https://github.com/ZachGSnow/jobscore/releases/latest/download/JobScore.user.js',
        // Listed boards get a panel and auto-score. The catch-all makes Alt+1
        // work on any careers page; unlisted pages stay idle until you ask (see
        // src/extract/policy.js), and frames on unlisted hosts do nothing.
        match: [
          'https://www.linkedin.com/jobs/*',
          'https://*.indeed.com/*',
          'https://builtin.com/*',
          'https://*.builtin.com/*',
          'https://*.greenhouse.io/*',
          'https://*.myworkdayjobs.com/*',
          'https://jobs.lever.co/*',
          'https://jobs.ashbyhq.com/*',
          '*://*/*',
        ],
        grant: ['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_registerMenuCommand'],
        connect: ['api.anthropic.com', 'api.openai.com', 'localhost', '127.0.0.1'],
        'run-at': 'document-idle',
      },
      build: {
        fileName: 'JobScore.user.js',
        autoGrant: false,
      },
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true, minify: false },
  test: { include: ['test/**/*.test.js'], environment: 'node' },
});
