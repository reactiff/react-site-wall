import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createStylesheetMiddleware } from '../dist/server.js';
const root = new URL('../', import.meta.url);
await mkdir(new URL('.demo/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('examples/app.tsx', root))], bundle: true, format: 'esm', outdir: fileURLToPath(new URL('.demo/', root)), sourcemap: true });
const token = randomBytes(24).toString('hex');
const port = Number(process.env.SITEWALL_DEMO_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const middleware = createStylesheetMiddleware({ enabled: true, root: fileURLToPath(root), files: ['examples/app.css'], token, origin });
const server = createServer((req, res) => middleware(req, res, async () => {
  try {
    if (req.url === '/demo.js' || req.url === '/demo.css' || req.url === '/app.css') {
      const name = req.url === '/app.css' ? 'examples/app.css' : '.demo/app.' + (req.url.endsWith('.js') ? 'js' : 'css');
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' });
      res.end(await readFile(new URL(name, root))); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>SiteWall example</title><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/demo.css"></head><body><div id="root"></div><script>window.demoToken=${JSON.stringify(token)}</script><script type="module" src="/demo.js"></script></body></html>`);
  } catch { res.writeHead(500); res.end('Example server error'); }
}));
server.listen(port, '127.0.0.1', () => console.log(`SiteWall example: ${origin}/sitewall`));
