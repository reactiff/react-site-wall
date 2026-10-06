# SiteWall agent API reference

SiteWall is many routes sharing application state, with persistent route panels and one moving interaction focus. Agents and humans operate the same session. Treat supplied selection/context as authoritative. Preserve unrelated behavior; inspect the result and report incomplete verification. See `SITEWALL-AGENTS.md` for behavioral instructions.

## Access

In the existing wall browser tab: `const api = window.sitewall`. Await asynchronous calls. Do not open a new session to verify the original session.

For Codex launched through SiteWall, POST to `SITEWALL_ORIGIN + '/__sitewall/session'`:

```json
{ "sessionId": "<SITEWALL_SESSION_ID>", "method": "inspect", "args": [] }
```

Set `Content-Type: application/json` and `X-SiteWall-Token` from environment `SITEWALL_RELAY_CREDENTIAL` (fallback `SITEWALL_TOKEN`). Read credentials in code; never print or persist them. Response: `{ "result": ... }`; errors remain unresolved. All methods below support relay access except `subscribe` and `executePrompt`. Nested methods use `styles.list`, `styles.read`, `styles.save`. Environment credentials are supplied only to SiteWall-launched Codex processes.

## Methods

`id` means a panel's manifest route ID, obtained from `getState().routes`. Optional IDs usually default to the focused panel; exceptions are noted. Coordinates and dimensions are CSS pixels.

| Method and parameters | Result / behavior |
| --- | --- |
| `getState()` | `WallState`: routes, visible IDs, focused ID, currentRoute, layout, viewport, zoom, pan, columns, panel visibility/width, autoCenter, styleFilter, selectionMode, selection. |
| `events(since?: number)` | Retained `WallEvent[]` after sequence `since`; each has sequence, type, time, detail. Includes navigation, interactions, shared state and API activity. |
| `subscribe(listener: (event: WallEvent) => void)` | Unsubscribe function. Browser only. |
| `show(id: string, visible: boolean)` | Show/hide a persistent route panel. |
| `focus(id: string)` | Promise; activate/reveal panel, ready its page and restore assigned route. |
| `navigate(path: string)` | Promise; move focus to a route present in `page-routes.json`, carrying shared host state. |
| `configure(patch: object)` | Update any settings listed below. |
| `zoomAt(zoom: number, origin: {x: number, y: number})` | Zoom anchored at canvas-local origin. |
| `inspect(id?: string)` | Promise of page observation: panelId, assignedRoute, available, actual route, title, text, controls, historyState, viewport, scroll. |
| `click(selector: string)` | Promise; click exactly one visible/enabled control in focused page. |
| `type(selector: string, value: string)` | Promise; set exactly one input/textarea/select value; dispatch input/change. |
| `scroll(x: number, y: number)` | Promise; scroll focused page to absolute page coordinates. |
| `capture(id?: string)` | Promise of PNG data URL slices covering the page. |
| `captureFullPage(route?: string)` | Promise of one stitched PNG data URL. Accepts panel ID or manifest route path; defaults to focus. Preserves viewport and restores scroll; waits for readiness/network. Size/time limits fail explicitly. |
| `captureAllPages()` | Promise of `{id, route, image}[]`, one stitched PNG data URL per visible/checked panel. Snapshots visible IDs at start, skips panels unchecked during capture; hidden panels are never revealed. Sequentially waits for each page's readiness/network, captures in viewport-height steps and stitches; preserves viewport/scroll. Any capture failure rejects the call. |
| `saveAllPages(outputDir: string)` | Promise of `{id, route, path}[]` in capture order. Reuses `captureAllPages()` and writes PNG files through the authenticated development server. Relative outputDir resolves against server host root; returned paths are absolute. Creates directories recursively, overwrites deterministic filenames. Requires `createPromptClient` and prompt middleware (or an adapter providing saveCaptures). Write failures identify route/path and reject; earlier files may already exist. HTTP payload limit: 64 MiB, rejects before writing. |
| `filterStyles(query: string)` | Update shared styles-panel filter (selector, declaration, filename). |
| `inspectStyles(id?: string, selector?: string)` | Promise of `StyleContext`. Defaults to selection's panel/context; explicit selector permits inspection without selection. No selection/selector returns empty context. |
| `styles.list()` | Promise of editable stylesheet IDs from configured manifest (`page-styles.json`, legacy fallback). |
| `styles.read(id: string)` | Promise of `{id, content, revision}`. |
| `styles.save(file: {id: string, content: string, revision: string})` | Promise of updated file/revision; saves and live-updates panels. Use revision from read for conflict protection. Development-only, allowlisted files. |
| `setSelectionMode(mode: 'none' \| 'element' \| 'region')` | Set shared, mutually exclusive picking mode. Element mode stays active until toggled off/switched. |
| `selectElement(selector: string, id?: string)` | Promise of `ContextSelection`; selector must match exactly one element. |
| `selectRegion(rectangle: {x: number, y: number, width: number, height: number}, id?: string)` | Promise of `ContextSelection`; absolute page coordinates, nonnegative position, positive size. |
| `inspectSelection()` | `ContextSelection` or null. |
| `clearSelection()` | Clear visible/captured selection; retains active element picking mode. |
| `promptContext()` | Promise of complete `PromptContext` for current selection/focus. |
| `executePrompt(instruction: string)` | Browser only; Promise of `{status: 'completed' \| 'failed', output: string, exitCode: number \| null}`. Runs Codex against host project with captured context; requires development prompt adapter. Nonblank instruction, max 20,000 characters. |
| `stopPrompt()` | Promise; abort current context/request and interrupt the running Codex process through the authenticated development endpoint. Custom prompt adapters/executors must support cancellation via cancel/AbortSignal. |

## Configuration

`configure` accepts a partial object:

```ts
{
  layout: 'viewport' | 'overview',
  viewport: { width: number, height: number, name?: string }, // integers 200..4096
  zoom: number,                    // scale: 1 = 100%
  pan: { x: number, y: number },    // finite canvas translation
  columns: number,                 // integer 1..20
  leftOpen: boolean,
  rightOpen: boolean,
  autoCenter: boolean,
  stylesWidth: number              // 200..1200
}
```

Current checkout: configure/zoomAt accept 0.1..3; gesture preview and saved-zoom restoration still cap at 2. These limits are not yet consistent.

## Context results

- `ContextSelection`: kind, panelId, route, rectangle (page position and size), viewport, scroll, capturedAt, applicationState, surroundingElements. Element selections also include selector, tag, text, sanitized HTML/attributes and ancestors.
- `PromptContext`: version, wallUrl, capturedAt, wall state, selection, page observation, applicationState, history, styles. Histories/state are bounded and sensitive fields redacted; opaque host component state is available only when exposed by host integration.
- `StyleContext`: matched `rules` with stylesheet, sourceIndex/sourceOccurrence, selector, cssText, runtime rank and inherited flag; stylesheets with order/accessibility; cascade entries with property, authoritative computed value, ordered declarations and source attribution; opaqueSources, unresolved, optional region contexts.
- Style source kinds: `known-declaration` (declaration supplied), `opaque-cross-origin` (computed value known, source declarations unreadable), `browser`. Runtime DOM/CSSOM inspection accounts for scope/container applicability and precedence. Opaque source does not mean unresolved computed value.

## Example (browser)

```js
const api = window.sitewall;
const id = api.getState().routes.find(r => r.path === '/about').id;
await api.focus(id);
await api.selectElement('main', id);
const context = await api.promptContext();
const styles = await api.inspectStyles();
// After editing host source:
const page = await api.inspect(id);
const png = await api.captureFullPage(id);
// Save all checked pages into the host project's captures directory:
const files = await api.saveAllPages('captures');
```

Capture filenames: `/` -> `home.png`, `/watches` -> `watches.png`, `/watch/model-1` -> `watch-model-1.png`. Invalid filesystem characters and Windows reserved names are sanitized. Query/hash variants, long names and normalized collisions receive stable hash suffixes. `captureAllPages()` itself never writes files.

Codex sidebar conversation/input/activity state is ephemeral. New Session clears its history and input, cancelling active work; it does not reset shared wall state or the human/agent relay. Enter sends; Ctrl+Enter inserts a newline.
