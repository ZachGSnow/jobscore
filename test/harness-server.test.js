// The manual-test server serves the repo folder, so it must stay on this
// machine and inside the repo.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { test } from 'vitest';
import { HOST, ROOT, handle, resolveRequest } from './harness/serve.mjs';

const root = path.resolve('/srv/jobscore');

test('harness: request paths map inside the repo only', () => {
  assert.equal(resolveRequest(root, '/dist/JobScore.user.js'), path.join(root, 'dist', 'JobScore.user.js'));
  assert.equal(resolveRequest(root, '/jobs/senior-solutions-engineer'), path.join(root, 'test', 'harness', 'index.html'));
  assert.equal(resolveRequest(root, '/test/harness/'), path.join(root, 'test', 'harness', 'index.html'));
  assert.equal(resolveRequest(root, '/..%2Fjobscore-other%2Fsecret.txt'), null, 'a sibling folder with the same prefix');
  assert.equal(resolveRequest(root, '/..%2F..%2Fetc%2Fpasswd'), null);
  assert.equal(resolveRequest(root, '/%2e%2e/%2e%2e/x'), path.join(root, 'x'), 'the URL parser folds dot segments back inside');
  assert.equal(resolveRequest(root, '/%E0'), null, 'a malformed escape is refused, not thrown');
  assert.equal(resolveRequest(root, '/a%00b'), null);
});

test('harness: binds to loopback and answers bad requests without crashing', async () => {
  assert.equal(HOST, '127.0.0.1');
  const server = http.createServer((req, res) => handle(req, res, ROOT));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const get = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  try {
    assert.equal(await get('/%E0'), 404);
    assert.equal(await get('/..%2F..%2Fpackage.json'), 404);
    assert.equal(await get('/package.json'), 200, 'the server is still up');
    assert.equal(await get('/jobs/x'), 200);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
