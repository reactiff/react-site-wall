#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

if (process.argv[2] !== 'init') {
  console.log('Usage: sitewall init [host-project-directory]\nCreates isolated integration files and route-analysis instructions. Existing files are never overwritten.');
  process.exit(process.argv[2] ? 1 : 0);
}
const root = resolve(process.argv[3] ?? '.');
const directory = join(root, 'sitewall');
await mkdir(directory, { recursive: true });
const files = {
  'page-routes.json': JSON.stringify({ version: 1, routes: [] }, null, 2) + '\n',
  'SiteWallEntry.tsx': `import { SiteWall, installSiteWallBridge, createStylesheetClient, type SharedStateAdapter, type RouteManifest } from 'react-site-wall';
import 'react-site-wall/styles.css';
import manifest from './page-routes.json';

// Call once, BEFORE mounting the host app. The host supplies its development flag.
export function connectSiteWall(enabled: boolean, sharedState?: SharedStateAdapter, navigate?: (path: string) => void) {
  return installSiteWallBridge({ enabled, sharedState, navigate });
}

// Mount at /sitewall, outside the host shell. Never enable in production.
export function SiteWallEntry({ enabled, token }: { enabled: boolean; token: string }) {
  return <SiteWall enabled={enabled} manifest={manifest as RouteManifest}
    styles={createStylesheetClient({ token })} />;
}
`,
  'server.example.mjs': `import { createStylesheetMiddleware } from 'react-site-wall/server';

// Attach to your Node development server BEFORE its SPA fallback.
// Generate a random token on server start and pass it only to the development wall.
export function sitewallMiddleware({ enabled, root, token, origin, files }) {
  return createStylesheetMiddleware({ enabled, root, token, origin, files });
}
`,
  'ROUTE-ANALYSIS.md': `# Codex route analysis

Analyze this host application after installing react-site-wall. Populate sitewall/page-routes.json with actual user-accessible concrete pages. Do not guess parameter values or inspect unrelated projects.

Inspect routing source, entry points, nested and optional parameters, redirects, authentication callbacks, query-dependent page identities, static content, and authorized application data/APIs. Resolve parameterized pages from actual data where possible; record unresolved cases and data dependencies here. Exclude /sitewall. Group pages and specify default inclusion with included: false for exceptional pages.

Schema: { "version": 1, "routes": [{ "id": "unique-id", "title": "Page name", "path": "/concrete/path?state=value", "pattern": "/pattern/:parameter", "params": { "parameter": "value" }, "group": "Section", "included": true, "metadata": {} }] }

Then integrate SiteWallEntry at /sitewall behind the host's explicit development flag, import package CSS, and call connectSiteWall before mounting normal application pages. For an in-memory cart/auth store, implement SharedStateAdapter.read/apply/subscribe using the actual host store. If the router ignores popstate, supply its navigation adapter. Attach the stylesheet middleware to the host development server with an explicit CSS source allowlist and random development token. Keep token and editing endpoints out of production.

Confirm /sitewall opens the workspace, each assigned page loads, navigation transfers focus/restores the source, auth/cart changes reach other panels, stylesheet writes reach source/HMR, and the production guard disables the wall and server.
`,
};
for (const [name, content] of Object.entries(files)) {
  try { await writeFile(join(directory, name), content, { flag: 'wx' }); console.log('Created sitewall/' + name); }
  catch (error) { if (error.code === 'EEXIST') console.log('Preserved sitewall/' + name); else throw error; }
}
console.log('Next: analyze routes using sitewall/ROUTE-ANALYSIS.md, then mount SiteWallEntry at /sitewall with a development-only flag.');
