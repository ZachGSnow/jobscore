// Tiny static server for manual testing: the harness page plus the built script.
// It serves the repo folder, so it listens on this machine only (127.0.0.1)
// and never serves a file outside the repo.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const HOST = '127.0.0.1';
export const PORT = 5179;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// The file a request URL maps to, or null when it does not decode or would
// leave `root` (../, an encoded %2F.., or a sibling folder such as
// jobscore-other that merely starts with the same name).
export function resolveRequest(root, reqUrl) {
  let p;
  try {
    p = decodeURIComponent(new URL(reqUrl, 'http://x').pathname);
  } catch (e) {
    return null;                                    // malformed escape such as %E0
  }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  // /jobs/... and /careers/... are served by the harness page, so URLs look like job pages.
  if (/^\/(jobs|careers)\//.test(p) && !path.extname(p)) p = '/test/harness/index.html';
  const file = path.resolve(root, '.' + p);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return file;
}

export function handle(req, res, root) {
  const file = resolveRequest(root || ROOT, req.url);
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  const headers = { 'content-type': types[path.extname(file)] || 'text/plain', 'cache-control': 'no-store' };
  // ?csp=tt serves the page the way Google / YouTube do: scripts may not insert raw HTML.
  // ?csp=linkedin adds LinkedIn's policy-name allowlist (seen 2026-10-15): creating any
  // Trusted Types policy outside it throws, which used to crash the script at load.
  const csp = new URL(req.url, 'http://x').searchParams.get('csp');
  if (csp === 'tt') headers['content-security-policy'] = "require-trusted-types-for 'script'";
  if (csp === 'linkedin') headers['content-security-policy'] = "require-trusted-types-for 'script'; trusted-types default jSecure 'allow-duplicates' dompurify highcharts goog#html ProseMirrorClipboard";
  res.writeHead(200, headers);
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// Listen only when run directly (npm run harness), not when a test imports it.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  http.createServer((req, res) => handle(req, res))
    .listen(PORT, HOST, () => console.log('harness on http://localhost:' + PORT + '/jobs/senior-solutions-engineer'));
}
