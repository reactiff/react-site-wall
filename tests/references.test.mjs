import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createPromptMiddleware } from '../dist/server.js';
import { ReferenceStore } from '../dist/references.js';
import { ReferenceWorkspace } from '../dist/reference-workspace.js';
import { AgentSession } from '../dist/agent-session.js';

const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const rectangle = { x: 3, y: 5, width: 40, height: 50 };
const context = route => ({ kind: 'region', panelId: route, route, rectangle, viewport: { width: 393, height: 659 }, scroll: { x: 0, y: 0 }, capturedAt: 1, surroundingElements: [], applicationState: { cart: 2 } });

test('multiple areas retain stable context and aliases; sending clears only selection', async () => {
  const refs = new ReferenceStore(async (_rectangle, route) => ({ context: context(route), image }));
  const first = await refs.captureArea(rectangle, '/shop'), second = await refs.captureArea(rectangle, '/watch');
  assert.notEqual(first.id, second.id);
  assert.deepEqual(refs.forPrompt().map(asset => asset.alias), ['Area1', 'Area2']);
  const captured = refs.forPrompt(); refs.clearSelection();
  assert.equal(refs.snapshot().assets.length, 2); assert.deepEqual(refs.snapshot().selected, []);
  assert.deepEqual(refs.forPrompt('Compare @Area2 with @area1').map(asset => asset.id), [first.id, second.id]);
  assert.equal(refs.forPrompt('@Area10').length, 0);
  assert.equal(captured[0].context.route, '/shop'); assert.equal(captured[1].context.route, '/watch');
  captured[0].context.rectangle.x = 99; assert.equal(refs.read(first.id).context.rectangle.x, 3);
  refs.remove(first.id); const third = await refs.captureArea(rectangle, '/');
  assert.equal(third.alias, 'Area3');
  refs.clear(); assert.deepEqual(refs.snapshot(), { assets: [], selected: [] });
});

test('queued attachments survive removal of original references and agent session reset retains assets', async () => {
  const refs = new ReferenceStore(async () => ({ context: context('/'), image }));
  const first = await refs.captureArea(rectangle);
  const agent = new AgentSession(() => {});
  agent.enqueue('Use @Area1', { references: refs.forPrompt(), tags: ['creative'] });
  refs.clearSelection(); refs.remove(first.id);
  const input = agent.takeOwnerInput()[0]; assert.equal(input.references[0].dataUrl, image); assert.deepEqual(input.tags, ['creative']);
  const second = await refs.captureArea(rectangle); agent.reset(); refs.clearSelection();
  assert.equal(refs.read(second.id).alias, 'Area2'); assert.deepEqual(refs.snapshot().selected, []);
});

test('clearing references while a capture is pending cannot resurrect an asset', async () => {
  let finish;
  const refs = new ReferenceStore(() => new Promise(resolve => { finish = resolve; }));
  const pending = refs.captureArea(rectangle); refs.clear(); finish({ context: context('/'), image });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(refs.snapshot().assets.length, 0);
});

test('resetting selection while a capture is pending retains its asset without selecting it', async () => {
  let finish;
  const refs = new ReferenceStore(() => new Promise(resolve => { finish = resolve; }));
  const pending = refs.captureArea(rectangle); refs.clearSelection(); finish({ context: context('/'), image });
  await pending; assert.equal(refs.snapshot().assets.length, 1); assert.deepEqual(refs.snapshot().selected, []);
});

test('executor files are temporary, stable under concurrent reads, and removed on disposal', async () => {
  const workspace = new ReferenceWorkspace();
  const source = { id: 'file-1', name: '../reference.txt', kind: 'file', mimeType: 'text/plain', size: 5, createdAt: 1, dataUrl: 'data:text/plain;base64,aGVsbG8=' };
  try {
    const [first, second] = await Promise.all([workspace.prepare([source]), workspace.prepare([source])]);
    assert.equal(first[0].path, second[0].path);
    assert.match(dirname(first[0].path), /sitewall-references-/);
    assert.equal(await readFile(first[0].path, 'utf8'), 'hello'); assert.ok(!('dataUrl' in first[0]));
    await assert.rejects(workspace.prepare([{ ...source, id: '../../outside' }]), /metadata/);
    await assert.rejects(workspace.prepare([{ ...source, id: 'bad', size: 100 }]), /size/);
    await assert.rejects(workspace.prepare([{ ...source, dataUrl: 'data:text/plain;base64,d29ybGQ=' }]), /changed/);
    await workspace.dispose(); await assert.rejects(access(first[0].path));
    await assert.rejects(workspace.prepare([source]), /ended/);
  } finally { await workspace.dispose(); }
});

test('authenticated transport stages initial and queued attachments outside the host and cleans them after execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-reference-host-'));
  await mkdir(join(root, 'sitewall')); await writeFile(join(root, 'sitewall/AGENTS.md'), 'Use supplied context.');
  const token = 'test-references-token-at-least-24';
  const sessionId = 'reference-test-session';
  let middleware, received, finish;
  const server = createServer((req, res) => middleware(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', 'X-SiteWall-Token': token };
  middleware = createPromptMiddleware({ enabled: true, root, token, origin, execute: async (prompt, cwd, signal, attachments) => {
    received = { prompt, cwd, attachments }; await new Promise(resolve => { finish = resolve; });
    return { status: 'completed', output: 'Done', exitCode: 0 };
  } });
  const file = { id: 'note', name: 'note.txt', kind: 'file', mimeType: 'text/plain', size: 5, createdAt: 1, dataUrl: 'data:text/plain;base64,aGVsbG8=' };
  const pngBytes = Buffer.from(image.split(',')[1], 'base64');
  const area = { id: 'area', name: 'Area 1', alias: 'Area1', kind: 'area', mimeType: 'image/png', size: pngBytes.length, dataUrl: image, createdAt: 2, context: context('/shop') };
  const post = (path, body, method = 'POST') => fetch(origin + path, { method, headers, body: JSON.stringify({ sessionId, ...body }) });
  const answerRelay = async (method, result) => {
    const response = post('/__sitewall/session', { method, args: [] });
    const command = await (await fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers })).json();
    assert.equal(command.method, method);
    await post('/__sitewall/session', { id: command.id, result }, 'PUT');
    return (await response).json();
  };
  try {
    const abort = new AbortController();
    const polling = fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers, signal: abort.signal }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 25)); abort.abort(); await polling;
    const request = post('/__sitewall/prompts', { instruction: '.creative Use my references', context: {}, references: [file, area], tags: ['creative'] });
    for (let i = 0; i < 100 && !received; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(received, 'executor started');
    assert.deepEqual(received.attachments.tags, ['creative']);
    const [note, firstArea] = received.attachments.references;
    assert.ok(!note.path.startsWith(root)); assert.equal(await readFile(note.path, 'utf8'), 'hello');
    assert.deepEqual(await readFile(firstArea.path), pngBytes);
    assert.ok(received.prompt.startsWith('.creative ')); assert.doesNotMatch(received.prompt, /aGVsbG8=|data:image\/png;base64/);
    assert.equal(firstArea.context.route, '/shop');
    const queued = { ...area, id: 'second-area', name: 'Area 2', alias: 'Area2', context: context('/watch') };
    const inbox = await answerRelay('agent.takeOwnerInput', [{ id: 'input', sequence: 1, time: 1, state: 'delivered', instruction: 'Also consider @Area2', references: [queued], tags: ['creative'] }]);
    const queuedArea = inbox.result[0].references[0]; assert.equal(queuedArea.alias, 'Area2'); assert.ok(!('dataUrl' in queuedArea));
    assert.deepEqual(await readFile(queuedArea.path), pngBytes);
    finish(); assert.equal((await request).status, 200);
    await assert.rejects(access(note.path)); await assert.rejects(access(queuedArea.path));
    assert.deepEqual(await readdir(root), ['sitewall']);
  } finally { finish?.(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
