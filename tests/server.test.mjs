import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStylesheetMiddleware, createPromptMiddleware } from '../dist/server.js';

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

test('page styles manifest takes precedence, falls back to legacy, and confines source access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-manifest-'));
  await mkdir(join(root, 'sitewall'));
  await writeFile(join(root, 'main.css'), 'body{}');
  await writeFile(join(root, 'sitewall/styles.json'), JSON.stringify({ version: 1, styles: ['main.css', '../outside.css'] }));
  let middleware;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = 'development-test-token-at-least-24';
  middleware = createStylesheetMiddleware({ enabled: true, root, token, origin });
  const request = suffix => fetch(origin + '/__sitewall/styles' + suffix, { headers: { 'X-SiteWall-Token': token } });
  try {
    assert.deepEqual(await (await request('')).json(), ['main.css', '../outside.css']);
    assert.equal((await request('?id=main.css')).status, 200);
    assert.equal((await request('?id=../outside.css')).status, 400);
    await writeFile(join(root, 'sitewall/page-styles.json'), JSON.stringify({ version: 1, styles: [] }));
    assert.deepEqual(await (await request('')).json(), []);
    assert.equal((await request('?id=main.css')).status, 400);
    await writeFile(join(root, 'sitewall/page-styles.json'), 'invalid JSON');
    assert.equal((await request('')).status, 400, 'invalid canonical manifests must not silently use the legacy allowlist');
    middleware = createStylesheetMiddleware({ enabled: true, root, token, origin, manifest: 'sitewall/styles.json' });
    assert.deepEqual(await (await request('')).json(), ['main.css', '../outside.css']);
    middleware = createStylesheetMiddleware({ enabled: true, root, token, origin, manifest: 'missing.json' });
    assert.equal((await request('')).status, 400, 'explicit manifest paths never fall back');
    middleware = createStylesheetMiddleware({ enabled: true, root, token, origin, files: ['main.css'] });
    assert.deepEqual(await (await request('')).json(), ['main.css'], 'explicit file allowlists retain precedence');
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); }
});

test('prompt server guards execution and supplies host guidance and redacted shared context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-prompts-'));
  await mkdir(join(root, 'sitewall'));
  await writeFile(join(root, 'sitewall/AGENTS.md'), 'Treat selection as authoritative.');
  let middleware, received, finish;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const token = 'development-test-token-at-least-24';
  middleware = createPromptMiddleware({ enabled: true, root, token, origin, execute: async (prompt, cwd) => {
    received = { prompt, cwd };
    await new Promise(resolve => { finish = resolve; });
    return { status: 'completed', output: 'Verified selected panel', exitCode: 0 };
  } });
  const sessionId = 'prompt-test-session';
  const connect = async () => {
    const controller = new AbortController();
    const polling = fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers: { 'X-SiteWall-Token': token }, signal: controller.signal }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 25));
    controller.abort(); await polling;
  };
  const request = (body, headers = {}) => fetch(origin + '/__sitewall/prompts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SiteWall-Token': token, ...headers }, body: JSON.stringify({ ...body, sessionId }) });
  try {
    await connect();
    assert.equal((await request({}, { 'X-SiteWall-Token': '' })).status, 403);
    assert.equal((await request({}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request({ instruction: '' })).status, 400);
    const pending = request({ instruction: 'Reduce spacing here', context: { route: '/cart', selection: { width: 200 }, token: 'secret-value' } });
    while (!finish) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await request({ instruction: 'second', context: {} })).status, 409);
    assert.equal(received.cwd.toLowerCase(), root.toLowerCase());
    assert.match(received.prompt, /authoritative/);
    assert.match(received.prompt, /Reduce spacing here/);
    assert.ok(received.prompt.startsWith('Reduce spacing here\n\n'), 'owner instruction remains first so protocol prefixes activate');
    assert.match(received.prompt, /agent.takeOwnerInput/);
    assert.match(received.prompt, /\/cart/);
    assert.doesNotMatch(received.prompt, /secret-value/);
    finish();
    assert.equal((await (await pending).json()).status, 'completed');
    middleware = createPromptMiddleware({ enabled: true, root, token, origin, execute: async () => ({ status: 'failed', exitCode: 1, output: `Verification unresolved ${token}` }) });
    await connect();
    assert.deepEqual(await (await request({ instruction: 'Inspect result', context: {} })).json(), { status: 'failed', exitCode: 1, output: 'Verification unresolved [redacted]' });
    assert.equal((await request({ instruction: 'Too large', context: { text: 'x'.repeat(1024 * 1024) } })).status, 413);
    middleware = createPromptMiddleware({ enabled: false, root, token: '', origin });
    assert.equal((await request({})).status, 404);
  } finally { finish?.(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }); }
});

test('session relay authenticates, pins the browser session, and returns actual API results and errors', async () => {
  const token = 'development-test-token-at-least-24';
  let middleware;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  middleware = createPromptMiddleware({ enabled: true, root: process.cwd(), token, origin });
  const request = (method, data, headers = {}) => fetch(origin + '/__sitewall/session', { method, headers: { 'X-SiteWall-Token': token, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  const sessionId = 'relay-test-session';
  try {
    assert.equal((await request('POST', {}, { 'X-SiteWall-Token': '' })).status, 403);
    assert.equal((await request('POST', {}, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await request('POST', { method: 'inspect' })).status, 409);
    const polling = fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers: { 'X-SiteWall-Token': token } });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal((await fetch(`${origin}/__sitewall/session?poll=1&sessionId=another-session`, { headers: { 'X-SiteWall-Token': token } })).status, 409);
    assert.equal((await request('POST', { sessionId, method: 'eval', args: ['evil'] })).status, 400);
    const commandResult = request('POST', { sessionId, method: 'inspect', args: ['shop'] });
    const command = await (await polling).json();
    assert.equal(command.method, 'inspect');
    assert.deepEqual(command.args, ['shop']);
    assert.equal((await request('PUT', { sessionId: 'wrong-session', id: command.id, result: {} })).status, 409);
    assert.equal((await request('PUT', { sessionId, id: command.id, result: { route: '/shop', text: 'Live application' } })).status, 200);
    assert.deepEqual(await (await commandResult).json(), { result: { route: '/shop', text: 'Live application' } });
    const failure = request('POST', { sessionId, method: 'click', args: ['#missing'] });
    const next = await (await fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers: { 'X-SiteWall-Token': token } })).json();
    assert.equal((await request('PUT', { sessionId, id: next.id, error: 'Element missing' })).status, 200);
    const failed = await failure;
    assert.equal(failed.status, 422);
    assert.deepEqual(await failed.json(), { error: 'Element missing' });
    middleware = createPromptMiddleware({ enabled: false, root: process.cwd(), token: '', origin });
    assert.equal((await request('POST', {})).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
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
