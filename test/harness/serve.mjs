// Tiny static server for manual testing: the harness page plus the built script.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  // /jobs/... and /careers/... are served by the harness page, so URLs look like job pages.
  if (/^\/(jobs|careers)\//.test(p) && !path.extname(p)) p = '/test/harness/index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const headers = { 'content-type': types[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' };
  // ?csp=tt serves the page the way Google / YouTube do: scripts may not insert raw HTML.
  // ?csp=linkedin adds LinkedIn's policy-name allowlist (seen 2026-10-15): creating any
  // Trusted Types policy outside it throws, which used to crash the script at load.
  const csp = new URL(req.url, 'http://x').searchParams.get('csp');
  if (csp === 'tt') headers['content-security-policy'] = "require-trusted-types-for 'script'";
  if (csp === 'linkedin') headers['content-security-policy'] = "require-trusted-types-for 'script'; trusted-types default jSecure 'allow-duplicates' dompurify highcharts goog#html ProseMirrorClipboard";
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}).listen(5179, () => console.log('harness on http://localhost:5179/jobs/senior-solutions-engineer'));
