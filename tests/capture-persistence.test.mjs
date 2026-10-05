import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { captureFilename, savePageCaptures } from '../dist/capture-persistence.js';
import { WallRuntime } from '../dist/runtime.js';
import { WallController } from '../dist/controller.js';
import { createPromptMiddleware } from '../dist/server.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=';
const captures = [{ id: 'home', route: '/', image }, { id: 'nested', route: '/watch/model-1', image }, { id: 'watches', route: '/watches', image }];

test('capture filenames cover root, nested routes and portable sanitization', () => {
  assert.equal(captureFilename('/'), 'home.png');
  assert.equal(captureFilename('/watches'), 'watches.png');
  assert.equal(captureFilename('/watch/model-1'), 'watch-model-1.png');
  assert.equal(captureFilename('/CON'), '_CON.png');
  assert.equal(captureFilename('/a%3Ab%3Fc'), 'a-b-c.png');
  assert.equal(captureFilename('/trailing. '), 'trailing.png');
  assert.notEqual(captureFilename('/watches?sort=price'), captureFilename('/watches?sort=name'));
  assert.ok(Buffer.byteLength(captureFilename('/' + 'x'.repeat(400))) < 255);
});

test('persistence creates nested directories, decodes PNG, overwrites and preserves order', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-capture-'));
  try {
    const results = await savePageCaptures('nested/output', captures, root);
    assert.deepEqual(results.map(item => item.route), captures.map(item => item.route));
    assert.ok(results.every(item => isAbsolute(item.path)));
    assert.deepEqual(await readFile(results[0].path), Buffer.from(image.split(',')[1], 'base64'));
    await writeFile(results[0].path, 'old content');
    assert.deepEqual(await savePageCaptures('nested/output', captures, root), results);
    assert.deepEqual(await readFile(results[0].path), Buffer.from(image.split(',')[1], 'base64'));
    const collisions = await savePageCaptures('collisions', [{ id: 'a', route: '/watch/model-1', image }, { id: 'b', route: '/watch-model-1', image }], root);
    assert.notEqual(collisions[0].path.toLowerCase(), collisions[1].path.toLowerCase());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('persistence rejects write and decoding failures with route and target path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-capture-fail-'));
  try {
    await writeFile(join(root, 'blocked'), 'file');
    await assert.rejects(savePageCaptures('blocked', captures, root), error => error.message.includes('route / to') && error.message.includes(join(root, 'blocked', 'home.png')));
    await assert.rejects(savePageCaptures(root, [{ ...captures[1], image: 'data:image/png;base64,YmFk' }]), error => error.message.includes('/watch/model-1') && error.message.includes(join(root, 'watch-model-1.png')) && error.message.includes('PNG signature'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('saveAllPages reuses captureAllPages and delegates persistence without recapturing', async () => {
  const controller = new WallController({ version: 1, routes: [{ id: 'home', title: 'Home', path: '/' }] });
  const expected = [{ id: 'home', route: '/', path: '/absolute/home.png' }];
  const runtime = new WallRuntime(controller, { list: async () => [] }, undefined, {
    execute: async () => { throw new Error('Not used'); },
    saveCaptures: async (directory, items) => { assert.equal(directory, 'captures'); assert.equal(items, captures); return expected; },
  });
  let count = 0;
  runtime.api.captureAllPages = async () => { count++; return captures; };
  assert.equal(await runtime.api.saveAllPages('captures'), expected);
  assert.equal(count, 1);
});

test('capture persistence endpoint is authenticated, development-only and writes files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-capture-http-'));
  const token = 'development-test-token-at-least-24';
  let middleware;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  middleware = createPromptMiddleware({ enabled: true, root, token, origin });
  const request = (headers = {}) => fetch(origin + '/__sitewall/captures', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ outputDir: 'output', captures }) });
  try {
    assert.equal((await request()).status, 403);
    assert.equal((await request({ 'X-SiteWall-Token': token, Origin: 'https://evil.example' })).status, 403);
    const response = await request({ 'X-SiteWall-Token': token });
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.equal(result.length, 3);
    assert.deepEqual(await readFile(result[0].path), Buffer.from(image.split(',')[1], 'base64'));
    middleware = createPromptMiddleware({ enabled: false, root, token: '', origin });
    assert.equal((await request({ 'X-SiteWall-Token': token })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
