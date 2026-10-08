# react-site-wall

A React/TypeScript development workspace for viewing an application as a persistent wall of routes. Pages own assigned routes; interaction focus travels through the application. No router, build system, styling framework, or state library is required by the package.

## Try the example

```sh
npm install
npm run build
npm run demo
```

For automatic rebuilding and browser reload during development, run `npm run demo:dev` and open `http://127.0.0.1:4173/sitewall`. No initial `npm run build` is required. UI source changes rebuild and reload the demo; middleware/server changes restart it automatically. Reloading resets the in-memory demo session.


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

Setup creates `sitewall/SiteWallEntry.tsx`, `sitewall/page-routes.json`, `sitewall/page-styles.json`, `sitewall/AGENTS.md`, `sitewall/SITEWALL-API.md`, a server example, and `sitewall/ROUTE-ANALYSIS.md`. Existing files are preserved; a conditional reference to SiteWall instructions is added to the host's root `AGENTS.md`. CSS discovery excludes dependencies, build output, and hidden directories. Review the discovered styles manifest. Have Codex follow the route analysis instructions; the route manifest starts empty rather than filled with guessed routes.

Give agents the compact [SiteWall API reference](./SITEWALL-API.md) for methods, parameters, context results, and access to the shared human session. Setup copies it to the client project's `sitewall/SITEWALL-API.md`; rerun setup to add it to an existing installation without overwriting existing files.

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

`SiteWall` accepts `enabled`, `manifest`, optional `wallPath`, `styles`, `prompts`, `capture`, and `onReady(api)`. Configuration props are fixed for one mounted session; remount to replace a manifest or adapters. React 18+ is supported.

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

The dark workspace has collapsible control and stylesheet panels, searchable routes, an address control, device/custom dimensions, zoom, pan, and columns. Drag canvas background to pan; use the continuous zoom slider or smooth Ctrl/Command + wheel zoom. Pointer zoom anchors the content under the pointer, including inside the focused page. Auto Centering defaults on, keeping newly focused panels in view; turn it off to preserve the camera when moving focus. Canvas scrolling is available. Canvas zoom never changes effective CSS viewport dimensions.

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

Snapshots must support structured cloning. Include shared application state only; keep scroll/forms/local presentation independent. Install the adapter in every page before rendering. Changes propagate to mounted frames; newly loaded pages receive the latest snapshot. Applying a snapshot suppresses immediate notification echoes; the adapter should avoid deferred echoes. Explicitly invalidate server-query caches after mutations/auth changes. Cookies alone do not notify React caches. Snapshots remain in memory; selection and prompt context include redacted state snapshots. Reloading the wall starts a new workspace session.

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
  // Reads sitewall/page-styles.json by default. Optional files overrides its allowlist.
  token,
  origin: 'http://localhost:3000',
});
// Attach middleware before the SPA fallback; pass token to the development entry.
const styles = createStylesheetClient({ token });
```

Each applicable CSS rule has its own compact CodeMirror editor with CSS highlighting, property and value completion, and numeric editing. Filenames appear at the top right; editors have no line numbers or formatting/reload buttons. Ctrl/Command + Shift + F formats the current rule. Edits replace only the original rule block, preserving surrounding source. Arrow Up/Down adjusts a number by 1, Shift by 10, and Alt by 0.1. Filtering hides editors without discarding drafts or stopping autosave. Saves debounce by 500 ms, preserve drafts after errors/collapse, and participate in host HMR. Immediate updates replace uniquely identified loaded sources at their existing document position, preserving cascade order. Unmatched sources rely on host HMR and emit `style-unresolved`; CSS modules and preprocessors may require a custom adapter. The bundled server edits plain `.css` only.

The project-local manifest is `{ "version": 1, "styles": ["src/app.css", "src/theme.css"] }`. Server requests reread it, so it also serves as the editing allowlist. Explicit `files` remains supported. Existing installations fall back to `sitewall/styles.json` only when `page-styles.json` is absent; rerunning setup copies a legacy manifest into the new filename without overwriting either file. The panel shows rules matching the live page, or the selected element/region; unrelated selectors are hidden. Filtering matches selectors, declarations, and filenames. Selected-element rules follow native cascade precedence, with inherited rules after direct matches; page-wide rules use native precedence where they match the same element, then specificity and source order for independent or conflicting element contexts. Style context presents matched declarations per property, strongest first. Native browser evaluation in the original CSSOM rules handles `@scope` boundaries and proximity, size/style container queries, named containers, nesting, layers, important, active media/supports, and source order. Private non-inherited CSS property probes are restored synchronously without changing DOM attributes or visual declarations. Inheritance candidates are marked.

Every cascade row contains an authoritative `getComputedStyle()` value and a `source` discriminant: `known-declaration`, `opaque-cross-origin`, or `browser`. Inaccessible cross-origin sheets appear in `opaqueSources` as `opaque-source`, including their active status. They never make the computed value unresolved. Where active opaque sources could win, readable declarations remain candidates and the source is conservatively opaque: CSSOM cannot prove a hidden winner, even when its value equals a readable declaration. Inline important declarations are known because they outrank author stylesheet rules. Disabled or media-inactive opaque sheets do not affect attribution. The inspector does not disable stylesheets, fetch blocked source text, or fabricate hidden selectors.

Requests require the token and exact host/origin. Explicit file allowlists and realpath checks reject root escapes, including symlinks. Edits are limited to 1 MiB. Revision hashes and serialized writes reject conflicting disk edits with HTTP 409; reopen from disk to resolve conflicts. The server is disabled unless explicitly enabled.

## Shared human/agent API

The mounted development wall exposes `window.sitewall` and invokes `onReady(api)`. Browser automation can evaluate semantic controls:

```ts
const api = window.sitewall!;
api.getState();
api.show('model-one', true);
await api.focus('model-one');
api.configure({ viewport: { width: 430, height: 932 }, zoom: 0.6, columns: 2 });
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

Additional shared API methods:

```ts
api.configure({ autoCenter: false });
api.zoomAt(.731, { x: 250, y: 180 }); // origin in canvas content coordinates
api.filterStyles('theme');
await api.inspectStyles('model-one', 'main h1');
const fullPagePNG = await api.captureFullPage('/model-one'); // also accepts a panel id
api.setSelectionMode('element'); // 'region' or 'none'
await api.selectElement('main h1', 'model-one');
await api.selectRegion({ x: 20, y: 100, width: 300, height: 240 }, 'model-one');
api.inspectSelection();
const context = await api.promptContext();
await api.executePrompt('Reduce spacing in this section.');
api.clearSelection();
```

## Selection and Agent interaction

Select an element by clicking any live panel, or draw a rectangle in region mode. Selection consumes the pointer gesture without activating application controls or moving interaction focus. The outline remains visible. Regions use document CSS coordinates, including page scroll. Starting selection switches an overview to its live viewports. Agent selection calls capture the same state as human gestures.

Prompt context includes selection geometry, selector/markup/ancestors or intersecting elements, viewport and scroll, assigned and actual route, shared state, safe form values, router history state, bounded navigation/interaction history, wall camera/visible panels, and matched styles. Credential-like fields and sensitive form values are excluded/redacted. The host shared-state adapter supplies application internals; SiteWall cannot infer unexposed component state. A captured selection remains a timestamped snapshot; select again after materially changing the page. Route changes that invalidate the selection fail observably.

Attach `createPromptMiddleware({ enabled, root, token, origin })` from `react-site-wall/server` alongside the stylesheet middleware. Supply `prompts={createPromptClient({ token })}` to SiteWall. The setup server example composes both. Install and authenticate the Codex CLI in the development server's environment. Submission runs `codex exec` against the host root with `workspace-write` sandboxing and ephemeral context, respecting configured approvals. Evolving behavioral instructions live in `sitewall/AGENTS.md`, sourced from the package's [SITEWALL-AGENTS.md](./SITEWALL-AGENTS.md).

The Agent panel opens in a resizable right sidebar. Enter sends; Ctrl+Enter inserts a newline. New Session clears conversation and input, cancelling active work. Stop interrupts the current request through the authenticated development endpoint. The activity light pulses during work. The editor remains usable while working: submitted thoughts enter an ordered owner-input queue, retrieved and acknowledged by the agent at safe boundaries. Creative and Express chips are mutually exclusive; enabling one prefixes subsequent prompts, and disabling one sends its off command immediately (queued during active work). Switching modes first sends the previous mode off. Conversation, draft, queued owner input, cards, activity, and active reference selections are ephemeral; wall settings and shared application state retain their existing persistence. Custom prompt adapters should implement `cancel()` and honor the supplied AbortSignal; custom server executors receive an optional AbortSignal. Restart the host development server after updating its middleware.

The same middleware exposes an authenticated `/__sitewall/session` command relay. The prompt adapter connects the exact human tab; Codex receives origin and credentials through environment variables and can invoke the shared API there. Only explicitly supported API methods are allowed, with no arbitrary JavaScript evaluation. Browser GET polls, agent POST submits `{sessionId,method,args}`, and browser PUT returns results/errors. One tab is leased per middleware instance to prevent inspecting a different wall by accident. Closed/unreachable sessions time out and verification remains unresolved. The tab identifier and Agent interaction state restart on refresh. No separate agent wall is created.

Prompt results report process completion/failure and Codex's output; a zero exit code alone does not establish visual correctness. The example executor is explicitly simulated and makes no source changes. Generic clarification, proposal, variants, implementation approval, review, and owner-turn cards open an owner dialog with structured responses. Review Accept/Revert are intents handled by the agent, which performs Git and reports completion; SiteWall does not manipulate Git. See [Agent interaction API](./SITEWALL-API.md#agent-interaction-api).

Real host verification requires the actual CLI and the host router/store/HMR integration.

The latest 500 events have monotonic sequence numbers: workspace, focus, navigation/completion, restoration, blocked panels, shared-state notification, stylesheet revision, captures, actions, and errors. Await actions and inspect relevant page/event state; network/application work can require further polling. Humans and agents share one runtime. An external MCP/browser tool can evaluate this API; no separate automation session is created. Page observations can contain private host content and must follow the host's development access rules.

## Production isolation

`enabled` is mandatory for the component/bridge; the server also requires an explicit flag. Disabled SiteWall renders nothing and exposes no agent API. Disable production route registration, token delivery, and middleware, or exclude imports through a development entry/dynamic import. Keep manifests and development tokens out of production.

Frames are for trusted same-origin host code. The iframe sandbox restricts top navigation/popups; scripts plus same-origin access do not isolate malicious application code. Host CSP/frame restrictions must permit the development integration. This package cannot automatically grant compatibility with every framework/router/auth policy; verify each host's adapters.

## Validation

```sh
npm test
npm run test:browser
npm run test:css-browser # focused scope/container/opaque-source inspection
npm run typecheck
npm pack --dry-run
# Optional: invokes the installed, authenticated Codex CLI against a disposable host:
node tests/codex-smoke.mjs --run
```

Windows browser tests use installed Chrome. Elsewhere install Playwright Chromium (`npx playwright install chromium`). `SITEWALL_BROWSER_CHANNEL` selects another installed supported channel. Tests restore the example CSS and write ignored screenshots to `.artifacts/`.

Tests cover ownership/manifest invariants, setup preservation, origin/token/path checks, revision concurrency, focus protection, links, programmatic/document navigation, login/logout, shared cart, redirects, concurrent navigation, hide/show persistence, effective viewport, full-page capture/scroll restoration, and source stylesheet autosave across pages. This establishes the example integration; new hosts need their router/store/HMR integration verified.

## References

Viewport controls and side-by-side inspection were informed by [Polypane](https://polypane.app/), [Sizzy](https://sizzy.co/), [Responsively App](https://responsively.app/), and its [source](https://github.com/responsively-org/responsively-app). Stable route ownership, moving focus, shared sessions, and source stylesheet editing follow [REQUIREMENTS.md](./REQUIREMENTS.md).

### Selection performance and capture readiness

Live panels default to the iPhone 14 Pro Safari viewport, 393 x 659 CSS pixels. Custom width/height edits apply on blur. The styles panel stays accessible for its selection controls; style inspection and editors remain idle until a selection is made. Explicit agent selector inspection remains supported. Selection inspection is coalesced and yields between restored CSSOM probes, with bounded caches invalidated by DOM, CSSOM, viewport, scroll, focus and interaction changes. Region targets reuse ancestor rankings; source parsing, file reads and editor state are reused, and offscreen editors mount lazily.

`api.captureFullPage(route)` accepts a manifest route path or panel id and returns one PNG data URL. It scrolls the existing fixed viewport in viewport-height steps, crops the overlap in the final clamped viewport, stitches the slices, and restores scrolling. `capture()` continues to return cropped slices. Capture limits fail explicitly instead of returning incomplete images.

Agent interactions and captures wait for document load, pending iframe fetch/XHR requests (including fetch response bodies), visible images, fonts and a quiet render window. Network observation is installed by the development bridge and restored on disposal. Hosts may provide `window.sitewallReady` as a readiness promise or function, or mark unfinished rendering with `aria-busy="true"` / `data-sitewall-loading="true"`. Unfinished requests or readiness time out after 30 seconds and remain unresolved; continuously streaming requests must finish or be handled through explicit host integration.

### Workspace usability

Wheel zoom advances by one percentage point per standard wheel notch, smoothly anchored to the pointer. Ctrl/Command + wheel zooms over a live page; ordinary wheel scrolling stays with that page. Background wheel zoom also works. Shift-drag pans across the wall and live panels; grab/grabbing and zoom-in/zoom-out cursors indicate the gesture. Camera previews paint once per animation frame and commit the shared state at gesture completion. Selection picking is transparent and uses the standard arrow.

Workspace settings, route visibility/focus, camera, selection, filters, prompt UI/drafts, CSS drafts, histories, shared adapter state and per-panel scroll positions persist locally per wall path. Credentials are redacted; live host credentials are preserved during shared-state restoration. Opaque host component state remains under the host's own persistence. The styles panel has a draggable/keyboard-accessible left edge; its width also persists and is available as `configure({ stylesWidth })`. Editors format rule display without rewriting source merely on inspection, wrap long declarations, and grow to fit their content; the panel owns scrolling.


## References

Open **References** beside the Agent panel. Paste images into References or the prompt editor, drop image/ordinary files, or use **Add files**. The panel resizes and collapses like the other sidebars. New assets are selected; checkboxes and removable composer chips choose what accompanies the next prompt. Remove an asset or use **Clear References** to discard it explicitly.

**Capture areas** lets you draw several regions across rendered route panels. Each saved area includes a cropped PNG and its route, viewport, rectangle, and region context. Use ordinary requests such as ?Compare @Area1 and @Area2 with this image.? Turn capture mode off or press Escape to resume normal page interaction.

Sending clears the prompt and selected-reference chips while retaining assets and normal page/element context. Additional prompts while working carry their own reference snapshots through the owner-input queue. New Session retains References assets and clears selections; reload starts an empty working-session library. Panel width and other wall settings retain normal persistence.

The default transport attaches images to Codex and exposes other selected files from temporary execution storage outside the host repository. No screenshot directories or copied project assets are required. See [Session References API](./SITEWALL-API.md#session-references) for metadata, transport integration and limits.
