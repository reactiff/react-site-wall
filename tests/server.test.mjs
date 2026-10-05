import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStylesheetMiddleware } from '../dist/server.js';

test('stylesheet server enforces origin/token/allowlist and conflicting revisions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-test-'));
  await writeFile(join(root, 'main.css'), 'body{color:red}');
  const token = 'development-test-token-at-least-24';
  let middleware;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  middleware = createStylesheetMiddleware({ enabled: true, root, files: ['main.css'], token, origin });
  const request = (suffix = '', init = {}) => fetch(origin + '/__sitewall/styles' + suffix, { ...init, headers: { 'X-SiteWall-Token': token, 'Content-Type': 'application/json', ...init.headers } });
  try {
    assert.equal((await fetch(origin + '/__sitewall/styles')).status, 403);
    assert.equal((await request('', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('?id=../outside.css')).status, 400);
    const file = await (await request('?id=main.css')).json();
    assert.equal(file.content, 'body{color:red}');
    const edits = await Promise.all([1,2].map(i => request('?id=main.css', { method: 'PUT', body: JSON.stringify({ ...file, content: `body{opacity:.${i}}` }) })));
    assert.deepEqual(edits.map(r => r.status).sort(), [200,409]);
    assert.match(await readFile(join(root, 'main.css'), 'utf8'), /opacity/);
    middleware = createStylesheetMiddleware({ enabled: false, root, files: [], token: '', origin });
    assert.equal((await request()).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
test('allowlisted symlink cannot escape root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'sitewall-outside-'));
  await writeFile(join(outside, 'secret.css'), 'private');
  try { await symlink(join(outside, 'secret.css'), join(root, 'link.css')); }
  catch (error) { await rm(root, { recursive: true }); await rm(outside, { recursive: true }); t.skip(`Symlinks unavailable: ${error.code}`); return; }
  let middleware;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  middleware = createStylesheetMiddleware({ enabled: true, root, files: ['link.css'], token: 'development-test-token-at-least-24', origin });
  try {
    const response = await fetch(origin + '/__sitewall/styles?id=link.css', { headers: { 'X-SiteWall-Token': 'development-test-token-at-least-24' } });
    assert.equal(response.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); await rm(outside, { recursive: true }); }
});
