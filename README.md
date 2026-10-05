# react-site-wall

A React/TypeScript development workspace for viewing an application as a persistent wall of routes. Pages own assigned routes; interaction focus travels through the application. No router, build system, styling framework, or state library is required by the package.

## Try the example

```sh
npm install
npm run build
npm run demo
```

Open **http://127.0.0.1:4173/sitewall**. The example has a shared cart, login/logout, a purchase flow with document navigation, an automatic redirect, and a long page with sticky navigation and intersection effects. esbuild is used only by the example server.

## Host installation

The package is ready to pack; this implementation does not publish it.

```sh
# In this repository:
npm pack
# In the host application:
npm install /path/to/react-site-wall-0.1.0.tgz
npx sitewall init
```

Setup creates `sitewall/SiteWallEntry.tsx`, `sitewall/page-routes.json`, a server example, and `sitewall/ROUTE-ANALYSIS.md`. Existing files are preserved. Have Codex follow the analysis instructions to derive concrete routes from the host's source and authorized data. The generated manifest is empty rather than filled with guessed routes.

Mount the generated entry at `/sitewall` behind an explicit **development-only** flag. Call `connectSiteWall` before mounting ordinary application pages, including pages reached after a document reload. Enable TypeScript JSON imports (`resolveJsonModule`) or load the manifest with the host's own configuration mechanism. Import `react-site-wall/styles.css` separately.

```tsx
import { createRoot } from 'react-dom/client';
import { connectSiteWall, SiteWallEntry } from './sitewall/SiteWallEntry';
import { App } from './App';

// Supply the flag, token, store adapter, and router adapter from host configuration.
connectSiteWall(developmentEnabled, sharedStateAdapter, hostNavigate);
createRoot(document.getElementById('root')!).render(
  developmentEnabled && location.pathname === '/sitewall'
    ? <SiteWallEntry enabled={developmentEnabled} token={developmentStylesToken} />
    : <App />
);
```

Alternatively, register the entry with the existing router, outside authentication/layout wrappers that block the workspace. The host must serve real page routes on document requests. A router that responds to `popstate` can omit `hostNavigate`; otherwise supply its own `navigate(path)` function. Server-rendered frameworks may require a client entry and a framework-specific adapter. History API, popstate, hashchange, links, and iframe document loads are observed.

`SiteWall` accepts `enabled`, `manifest`, optional `wallPath`, `styles`, `capture`, and `onReady(api)`. Configuration props are fixed for one mounted session; remount to replace a manifest or adapters. React 18+ is supported.

## Route manifest

```json
{
  "version": 1,
  "routes": [
    { "id": "home", "title": "Home", "path": "/", "group": "Explore" },
    {
      "id": "model-one", "title": "Model One", "path": "/watches/model-1",
      "pattern": "/watches/:model", "params": { "model": "model-1" },
      "group": "Watches", "included": true, "metadata": { "source": "catalog" }
    },
    { "id": "filtered", "title": "Price order", "path": "/shop?sort=price", "included": false }
  ]
}
```

IDs and concrete paths must be unique. Paths must be absolute and same-origin, with no unresolved placeholders or recursive wall route. Queries distinguish page identities. An exact hash route wins; an anchor on an existing route uses that route's panel. Unmapped navigation fails observably and restores the source; add meaningful destinations during route analysis. Visibility changes only session state.

`pattern`, `params`, `group`, and `metadata` retain analysis context. Rendering uses the concrete `path`. Application-specific page states remain the host's responsibility. Resolve dynamic parameters using actual authorized data; never put credentials or sensitive records into the manifest.

For a known unconditional redirect, record `metadata: { "redirectTo": "/destination" }`. Its panel is retained as a redirect placeholder, and selecting it follows the destination. Conditional redirects are detected at runtime; their availability depends on the current host state.

## Workspace behavior

The dark workspace has collapsible control and stylesheet panels, searchable routes, an address control, device/custom dimensions, zoom, pan, and columns. Drag canvas background to pan; use the zoom slider or Ctrl/Command + wheel to zoom. Canvas scrolling is available. Canvas zoom never changes effective CSS viewport dimensions.

Only the focused page accepts content interaction/keyboard focus. Selecting an inactive panel consumes the selection click. After first use, hidden panels stay mounted to preserve page-local session. Layout/device changes reuse frames. Stylesheet drafts survive panel collapse.

Navigation reveals/focuses the destination panel and restores the source's assigned route. Concurrent agent navigation is serialized. A page that always redirects in the current application state cannot display its assigned content: its panel retains identity and shows a blocked placeholder, rather than displaying a different destination as that page or restoring forever. Focus/retry after updating application state. External links are reported without replacing the wall; cross-origin auth callbacks must return to a same-origin route for observation.

## Shared state integration

Same-origin frames share cookies/localStorage, but React contexts and in-memory stores are separate. **Supply a shared-state adapter for auth, cart, cache invalidation, and other shared state held in memory.** The host owns serialization/hydration:

```ts
const sharedStateAdapter = {
  read: () => store.getSharedSnapshot(),
  apply: snapshot => store.hydrateSharedSnapshot(snapshot),
  subscribe: notify => store.subscribeSharedChanges(notify),
};
connectSiteWall(developmentEnabled, sharedStateAdapter, hostNavigate);
```

Snapshots must support structured cloning. Include shared application state only; keep scroll/forms/local presentation independent. Install the adapter in every page before rendering. Changes propagate to mounted frames; newly loaded pages receive the latest snapshot. Applying a snapshot suppresses immediate notification echoes; the adapter should avoid deferred echoes. Explicitly invalidate server-query caches after mutations/auth changes. Cookies alone do not notify React caches. Snapshots remain in memory, outside the event log and browser storage. Reloading the wall starts a new workspace session.

## Full-page representation

Overview automatically captures pages as top-aligned viewport slices. Capture scrolls the existing page, waits for intersection/lazy behavior, renders each slice, and restores scroll. The iframe height remains the selected device height. Sticky/fixed content may recur in slices, reflecting real viewport behavior. Select a captured panel to return to live interaction. Navigation, shared-state, stylesheet, visibility, and viewport changes refresh snapshots automatically; **Refresh full pages** also captures other page-local changes.

The default renderer is html2canvas, loaded only for capture. Its DOM rasterization is not a browser screenshot engine: unsupported CSS, cross-origin images, video, and WebGL can differ or be absent. Scroll side effects are real; a 150 ms delay does not guarantee all delayed content settles. Infinite pages fail observably after 40 slices. Nested scroll containers/dynamic experiences may need a host adapter.

For pixel-faithful browser/Creative observation, supply `capture(win, signal): Promise<string[]>` backed by browser screenshot automation. Return ordered PNG data URLs using the real viewport, and restore scroll on exit. Humans and agents use the same adapter. Live viewports use normal browser rendering.

## Stylesheet editing

The Node export is middleware for Node HTTP, Connect/Express, or a framework-specific development server:

```ts
import { randomBytes } from 'node:crypto';
import { createStylesheetMiddleware } from 'react-site-wall/server';
import { createStylesheetClient } from 'react-site-wall';

const token = randomBytes(24).toString('hex');
const middleware = createStylesheetMiddleware({
  enabled: developmentEnabled,
  root: projectRoot,
  files: ['src/app.css', 'src/theme.css'],
  token,
  origin: 'http://localhost:3000',
});
// Attach middleware before the SPA fallback; pass token to the development entry.
const styles = createStylesheetClient({ token });
```

The editor lists allowlisted CSS files, reads them, and debounces saves by 500 ms. It prevents file switching while a draft is unsaved and keeps drafts after errors/collapse. Actual source writes participate in the host's HMR/file watcher. SiteWall also appends saved CSS to each frame for immediate feedback. The temporary overlay sits at the end of the cascade; exact source ordering, CSS modules, preprocessors, and imports may require a custom `StylesheetAdapter` and host HMR. The bundled server edits plain `.css` only.

Requests require the token and exact host/origin. Explicit file allowlists and realpath checks reject root escapes, including symlinks. Edits are limited to 1 MiB. Revision hashes and serialized writes reject conflicting disk edits with HTTP 409; reopen from disk to resolve conflicts. The server is disabled unless explicitly enabled.

## Shared human/agent API

The mounted development wall exposes `window.sitewall` and invokes `onReady(api)`. Browser automation can evaluate semantic controls:

```ts
const api = window.sitewall!;
api.getState();
api.show('model-one', true);
await api.focus('model-one');
api.configure({ viewport: { width: 390, height: 844 }, zoom: 0.6, columns: 2 });
await api.navigate('/shop?sort=price');
await api.type('input[name="email"]', 'example@example.com');
await api.click('button[type="submit"]');
await api.scroll(0, 700);
const page = await api.inspect();
const slices = await api.capture();
const changes = api.events(lastObservedSequence);
const unsubscribe = api.subscribe(event => console.log(event.type));
const file = await api.styles.read('src/app.css');
await api.styles.save({ ...file, content: file.content + '\n/* edit */\n' });
unsubscribe();
```

`configure` supports `layout`, `viewport`, `zoom`, `pan`, `columns`, `leftOpen`, and `rightOpen`. `inspect(id?)` returns panel/assigned/current routes, availability, rendered text, control summaries, viewport, and scroll. Selectors must identify exactly one visible enabled control. Text entry uses native setters and input/change events for React. Missing bridges, unavailable pages, ambiguous controls, and failed actions are observable errors.

The latest 500 events have monotonic sequence numbers: workspace, focus, navigation/completion, restoration, blocked panels, shared-state notification, stylesheet revision, captures, actions, and errors. Await actions and inspect relevant page/event state; network/application work can require further polling. Humans and agents share one runtime. An external MCP/browser tool can evaluate this API; no separate automation session is created. Page observations can contain private host content and must follow the host's development access rules.

## Production isolation

`enabled` is mandatory for the component/bridge; the server also requires an explicit flag. Disabled SiteWall renders nothing and exposes no agent API. Disable production route registration, token delivery, and middleware, or exclude imports through a development entry/dynamic import. Keep manifests and development tokens out of production.

Frames are for trusted same-origin host code. The iframe sandbox restricts top navigation/popups; scripts plus same-origin access do not isolate malicious application code. Host CSP/frame restrictions must permit the development integration. This package cannot automatically grant compatibility with every framework/router/auth policy; verify each host's adapters.

## Validation

```sh
npm test
npm run test:browser
npm run typecheck
npm pack --dry-run
```

Windows browser tests use installed Chrome. Elsewhere install Playwright Chromium (`npx playwright install chromium`). `SITEWALL_BROWSER_CHANNEL` selects another installed supported channel. Tests restore the example CSS and write ignored screenshots to `.artifacts/`.

Tests cover ownership/manifest invariants, setup preservation, origin/token/path checks, revision concurrency, focus protection, links, programmatic/document navigation, login/logout, shared cart, redirects, concurrent navigation, hide/show persistence, effective viewport, full-page capture/scroll restoration, and source stylesheet autosave across pages. This establishes the example integration; new hosts need their router/store/HMR integration verified.

## References

Viewport controls and side-by-side inspection were informed by [Polypane](https://polypane.app/), [Sizzy](https://sizzy.co/), [Responsively App](https://responsively.app/), and its [source](https://github.com/responsively-org/responsively-app). Stable route ownership, moving focus, shared sessions, and source stylesheet editing follow [REQUIREMENTS.md](./REQUIREMENTS.md).
