import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('setup creates isolated host files and preserves existing route analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-setup-'));
  const run = promisify(execFile);
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/main.css'), 'body { color: red; }');
    await writeFile(join(root, 'AGENTS.md'), '# Existing host instructions\n');
    await run(process.execPath, ['bin/sitewall.mjs', 'init', root]);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sitewall/page-styles.json'), 'utf8')), { version: 1, styles: ['src/main.css'] });
    assert.match(await readFile(join(root, 'sitewall/AGENTS.md'), 'utf8'), /authoritative/);
    assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /Existing host instructions/);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sitewall/page-routes.json'), 'utf8')), { version: 1, routes: [] });
    await writeFile(join(root, 'sitewall/page-routes.json'), 'user analysis');
    await writeFile(join(root, 'sitewall/page-styles.json'), 'user styles');
    await run(process.execPath, ['bin/sitewall.mjs', 'init', root]);
    assert.equal(await readFile(join(root, 'sitewall/page-routes.json'), 'utf8'), 'user analysis');
    assert.equal(await readFile(join(root, 'sitewall/page-styles.json'), 'utf8'), 'user styles');
    assert.equal((await readFile(join(root, 'AGENTS.md'), 'utf8')).split('<!-- sitewall:instructions -->').length, 2);
    assert.match(await readFile(join(root, 'sitewall/SiteWallEntry.tsx'), 'utf8'), /enabled/);
  } finally { await rm(root, { recursive: true }); }
});

test('setup migrates the existing stylesheet allowlist beside the route manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-setup-legacy-'));
  const run = promisify(execFile);
  try {
    await mkdir(join(root, 'sitewall'));
    const legacy = JSON.stringify({ version: 1, styles: ['theme.css'] });
    await writeFile(join(root, 'sitewall/styles.json'), legacy);
    await writeFile(join(root, 'theme.css'), 'body{}');
    await writeFile(join(root, 'other.css'), 'body{}');
    await run(process.execPath, ['bin/sitewall.mjs', 'init', root]);
    assert.equal(await readFile(join(root, 'sitewall/page-styles.json'), 'utf8'), legacy);
    assert.equal(await readFile(join(root, 'sitewall/styles.json'), 'utf8'), legacy);
  } finally { await rm(root, { recursive: true }); }
});
