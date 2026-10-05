// Opt-in integration verification. Invokes the authenticated installed Codex CLI.
// node tests/codex-smoke.mjs --run
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createPromptMiddleware } from '../dist/server.js';

if (!process.argv.includes('--run')) { console.log('Skipped: pass --run to invoke the installed Codex CLI.'); process.exit(0); }
const root = await mkdtemp(join(tmpdir(), 'sitewall-codex-smoke-'));
const token = randomBytes(24).toString('hex');
const sessionId = randomUUID();
const headers = { 'X-SiteWall-Token': token, 'Content-Type': 'application/json' };
const abort = new AbortController();
let middleware, relayInspections = 0, relayMethods = [];
const server = createServer((req, res) => middleware(req, res));
try {
  execFileSync('git', ['init', '--quiet', root], { stdio: 'ignore' });
  await mkdir(join(root, 'sitewall'));
  await writeFile(join(root, 'sitewall/AGENTS.md'), await readFile(new URL('../SITEWALL-AGENTS.md', import.meta.url), 'utf8'));
  await writeFile(join(root, 'AGENTS.md'), 'For SiteWall work read sitewall/AGENTS.md. Work only on sample.txt.\n');
  await writeFile(join(root, 'sample.txt'), 'old\n');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  middleware = createPromptMiddleware({ enabled: true, root, token, origin, timeoutMs: 90000 });
  const polling = (async () => {
    while (!abort.signal.aborted) {
      try {
        const response = await fetch(`${origin}/__sitewall/session?poll=1&sessionId=${sessionId}`, { headers, signal: abort.signal });
        const command = await response.json();
        if (!command.id) continue;
        relayMethods.push(command.method);
        let result, error;
        if (command.method === 'getState') result = { focusedId: 'sample', routes: [{ id: 'sample', path: '/sample' }] };
        else if (command.method === 'inspect' || command.method === 'promptContext') {
          relayInspections++;
          result = { route: '/sample', title: 'Smoke sample', text: await readFile(join(root, 'sample.txt'), 'utf8'), viewport: { width: 1024, height: 768 }, simulatedVerificationFixture: true };
        } else error = 'Smoke fixture only supports getState/inspect/promptContext';
        await fetch(`${origin}/__sitewall/session`, { method: 'PUT', headers, signal: abort.signal, body: JSON.stringify({ sessionId, id: command.id, result, error }) });
      } catch { if (!abort.signal.aborted) break; }
    }
  })();
  await new Promise(resolve => setTimeout(resolve, 100));
  const response = await fetch(`${origin}/__sitewall/prompts`, { method: 'POST', headers, body: JSON.stringify({ sessionId,
    instruction: 'Change sample.txt from old to new (retain newline). This is a bounded integration smoke test. Do not edit any other file. After changing it, use the authenticated SiteWall relay inspect method to confirm the original session now reports new. Use a Node script through exec_command, reading SITEWALL_ORIGIN, SITEWALL_RELAY_CREDENTIAL, SITEWALL_SESSION_ID directly from environment; never print credentials. If sandbox network prevents connecting report unresolved. Finish promptly.',
    context: { version: 1, wallUrl: origin + '/sitewall', selection: { kind: 'element', route: '/sample', element: { selector: '#sample', text: 'old' } }, simulatedVerificationFixture: true },
  }) });
  const result = await response.json();
  const content = await readFile(join(root, 'sample.txt'), 'utf8');
  // Deliberately never emit CLI output: it may contain user configuration or sensitive context.
  const output = result.output ?? '';
  const errorCategories = Object.entries({ reusedRefreshToken: /refresh_token_reused|refresh token.*already.*used/i, tokenRefreshFailed: /(?:refresh.*token|token.*refresh).*(?:fail|expired|invalid)|(?:fail|unable).*refresh.*token/i, unauthorized: /unauthorized|401/i, notLoggedIn: /not logged|login required/i, sandboxDenied: /sandbox.*(?:failed|denied|blocked)|permission denied|operation not permitted|network.*(?:blocked|denied)/i }).filter(([, pattern]) => pattern.test(output)).map(([name]) => name);
  console.log(JSON.stringify({ httpStatus: response.status, cliStatus: result.status ?? 'unavailable', exitCode: result.exitCode ?? null, fileChanged: content === 'new\n', sameSessionInspected: relayInspections > 0, relayMethods, errorCategories }));
  abort.abort(); await polling;
  if (response.status !== 200 || result.status !== 'completed' || content !== 'new\n' || !relayInspections) process.exitCode = 1;
} finally {
  abort.abort();
  await new Promise(resolve => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
