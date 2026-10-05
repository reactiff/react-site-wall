import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createStylesheetMiddleware, createPromptMiddleware } from '../dist/server.js';
const root = new URL('../', import.meta.url);
await mkdir(new URL('.demo/', root), { recursive: true });
const development = process.argv.includes('--dev');
const reloadClients = new Set();
let revision = String(Date.now());
const bundleOptions = { entryPoints: [fileURLToPath(new URL('examples/app.tsx', root))], bundle: true, format: 'esm', outdir: fileURLToPath(new URL('.demo/', root)), sourcemap: true };
let bundleContext;
if (development) {
  bundleContext = await context({ ...bundleOptions, plugins: [{ name: 'demo-reload', setup(builder) {
    builder.onEnd(result => {
      if (result.errors.length) return;
      revision = String(Date.now());
      for (const client of reloadClients) client.write(`data: ${revision}\n\n`);
    });
  } }] });
  await bundleContext.rebuild();
  await bundleContext.watch();
} else await build(bundleOptions);
const token = randomBytes(24).toString('hex');
const port = Number(process.env.SITEWALL_DEMO_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const middleware = createStylesheetMiddleware({ enabled: true, root: fileURLToPath(root), manifest: 'examples/page-styles.json', token, origin });
// Demo prompts are deliberately simulated: browser tests never invoke a paid agent or edit source.
await mkdir(new URL('.demo/sitewall/', root), { recursive: true });
await writeFile(new URL('.demo/sitewall/AGENTS.md', root), await readFile(new URL('SITEWALL-AGENTS.md', root)));
const prompts = createPromptMiddleware({ enabled: true, root: fileURLToPath(new URL('.demo/', root)), token, origin,
  execute: async prompt => ({ status: 'completed', exitCode: 0, output: `Simulated Codex execution: received instruction and SiteWall context (${prompt.length} characters). No source changes made.` }),
});
const server = createServer((req, res) => {
  if (development && req.url === '/__demo/reload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`data: ${revision}\n\n`);
    reloadClients.add(res);
    req.on('close', () => reloadClients.delete(res));
    return;
  }
  middleware(req, res, () => prompts(req, res, async () => {
  try {
    if (req.url === '/demo.js' || req.url === '/demo.css' || req.url === '/app.css') {
      const name = req.url === '/app.css' ? 'examples/app.css' : '.demo/app.' + (req.url.endsWith('.js') ? 'js' : 'css');
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' });
      res.end(await readFile(new URL(name, root))); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>SiteWall example</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script>window.demoToken=${JSON.stringify(token)}</script><script type="module" src="/demo.js"></script>${development ? `<script>if(window.top===window){const revision=${JSON.stringify(revision)};const updates=new EventSource('/__demo/reload');updates.onmessage=event=>{if(event.data!==revision)location.reload();};}</script>` : ''}</body></html>`);
  } catch { res.writeHead(500); res.end('Example server error'); }
}));
});
server.listen(port, '127.0.0.1', () => console.log(`SiteWall example: ${origin}/sitewall`));
