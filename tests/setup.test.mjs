import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('setup creates isolated host files and preserves existing route analysis', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sitewall-setup-'));
  const run = promisify(execFile);
  try {
    await run(process.execPath, ['bin/sitewall.mjs', 'init', root]);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'sitewall/page-routes.json'), 'utf8')), { version: 1, routes: [] });
    await writeFile(join(root, 'sitewall/page-routes.json'), 'user analysis');
    await run(process.execPath, ['bin/sitewall.mjs', 'init', root]);
    assert.equal(await readFile(join(root, 'sitewall/page-routes.json'), 'utf8'), 'user analysis');
    assert.match(await readFile(join(root, 'sitewall/SiteWallEntry.tsx'), 'utf8'), /enabled/);
  } finally { await rm(root, { recursive: true }); }
});
