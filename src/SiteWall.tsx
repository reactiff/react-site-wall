import { CodexPanel } from './CodexPanel.js';
import { PanelResizeHandle } from './PanelResizeHandle.js';
import { useCanvasControls } from './canvas-controls.js';
import { readPersistent, removePersistent, usePersistentState, writePersistent } from './persistence.js';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WallController } from './controller.js';
import { WallRuntime } from './runtime.js';
import { StylesPanel } from './StylesPanel.js';
import { devices, type PromptAdapter, type RouteManifest, type SiteWallAPI, type StylesheetAdapter } from './types.js';
import { ContextOverlay } from './ContextOverlay.js';

const noStyles: StylesheetAdapter = {
  async list() { return []; },
  async read() { throw new Error('No stylesheet adapter configured'); },
  async save() { throw new Error('No stylesheet adapter configured'); },
};
export interface SiteWallProps {
  enabled: boolean;
  manifest: RouteManifest;
  wallPath?: string;
  styles?: StylesheetAdapter;
  prompts?: PromptAdapter;
  onReady?: (api: SiteWallAPI) => void;
  capture?: (win: Window, signal: AbortSignal) => Promise<string[]>;
}
export function SiteWall(props: SiteWallProps) {
  return props.enabled ? <Workspace {...props} /> : null;
}
function Workspace({ manifest, wallPath = '/sitewall', styles = noStyles, prompts, capture, onReady }: SiteWallProps) {
  // Configuration is fixed for one session; remount explicitly to replace a manifest.
  const [controller] = useState(() => new WallController(manifest, wallPath));
  const [runtime] = useState(() => new WallRuntime(controller, styles, capture, prompts));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [visited, setVisited] = useState(() => new Set([...state.visible, ...(readPersistent<string[]>(wallPath, 'visited') ?? []).filter(id => state.routes.some(route => route.id === id))]));
  useEffect(() => { writePersistent(wallPath, 'visited', () => [...visited]); }, [wallPath, visited]);
  const [filter, setFilter] = usePersistentState(wallPath, 'route-filter', '');
  const [address, setAddress] = useState(state.currentRoute);
  const [dimensions, setDimensions] = useState({ width: String(state.viewport.width), height: String(state.viewport.height) });
  useEffect(() => { setDimensions({ width: String(state.viewport.width), height: String(state.viewport.height) }); }, [state.viewport.width, state.viewport.height]);
  const [error, setError] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [codexWidth, setCodexWidth] = usePersistentState(wallPath, 'codex-width', 360);
  useEffect(() => { for (const key of ['prompt-instruction', 'prompt-output', 'prompt-open']) removePersistent(wallPath, key); }, [wallPath]);
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string[]>>({});
  const [capturing, setCapturing] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [, redrawSelection] = useState(0);
  const captureVersion = useRef(0);
  const firstCentering = useRef(true);
  const canvas = useRef<HTMLElement | null>(null);
  const panels = useRef(new Map<string, HTMLElement>());
  useCanvasControls(controller, runtime, canvas);
  useEffect(() => {
    const detach = runtime.attach();
    const unobserve = controller.observe(event => {
      if (event.type === 'ready') redrawSelection(value => value + 1);
      if (event.type === 'scroll' && controller.snapshot().selection) redrawSelection(value => value + 1);
      if ((event.type === 'error' && (event.detail as { action?: string })?.action !== 'executePrompt') || event.type === 'unmapped-navigation' || event.type === 'external-navigation') setError(JSON.stringify(event.detail));
      if (event.type === 'stylesheet' || event.type === 'shared-state' || event.type === 'navigation-complete') {
        setImages({});
        setRefreshRevision(value => value + 1);
      }
      if (event.type === 'panel-blocked') {
        const { id, message } = event.detail as { id: string; message: string };
        setBlocked(previous => ({ ...previous, [id]: message }));
      }
      if (event.type === 'restoration') {
        const { id } = event.detail as { id: string };
        setBlocked(previous => { const next = { ...previous }; delete next[id]; return next; });
      }
    });
    return () => { unobserve(); detach(); };
  }, [runtime, controller]);
  useEffect(() => { onReady?.(runtime.api); }, [runtime, onReady]);
  useEffect(() => {
    const documents = new Set<Document>();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const current = controller.snapshot();
      if (!current.selection && current.selectionMode === 'none') return;
      event.preventDefault();
      runtime.api.clearSelection();
    };
    const listen = (doc: Document) => {
      if (documents.has(doc)) return;
      documents.add(doc);
      doc.addEventListener('keydown', escape, true);
    };
    listen(document);
    const listenToFrames = () => {
      for (const frame of runtime.frames.values()) {
        try { if (frame.contentDocument) listen(frame.contentDocument); } catch { /* Cross-origin pages are unavailable for selection. */ }
      }
    };
    listenToFrames();
    const unsubscribe = controller.observe(event => { if (event.type === 'ready') listenToFrames(); });
    return () => { unsubscribe(); for (const doc of documents) doc.removeEventListener('keydown', escape, true); };
  }, [runtime, controller]);
  useEffect(() => {
    if (firstCentering.current) { firstCentering.current = false; return; }
    if (!state.autoCenter) return;
    const task = requestAnimationFrame(() => {
      const panel = state.focused ? panels.current.get(state.focused) : undefined;
      if (!panel || !canvas.current) return;
      const bounds = canvas.current.getBoundingClientRect();
      const page = panel.getBoundingClientRect();
      const dx = page.width > bounds.width || page.left < bounds.left ? bounds.left + 24 - page.left : page.right > bounds.right ? bounds.right - 24 - page.right : 0;
      const dy = page.top < bounds.top || page.top > bounds.bottom - 80 ? bounds.top + 24 - page.top : 0;
      if (dx || dy) { const pan = controller.snapshot().pan; controller.configure({ pan: { x: pan.x + dx, y: pan.y + dy } }); }
    });
    return () => cancelAnimationFrame(task);
  }, [state.focused, state.autoCenter, controller]);
  useEffect(() => { setAddress(state.currentRoute); }, [state.currentRoute]);
  useEffect(() => {
    setVisited(previous => state.visible.every(id => previous.has(id)) ? previous : new Set([...previous, ...state.visible]));
  }, [state.visible]);
  const perform = (action: Promise<unknown>) => { action.catch(failure => setError(String(failure))); };
  function interact(id: string) {
    controller.configure({ layout: 'viewport' });
    perform(runtime.api.focus(id));
  }
  async function refreshOverview() {
    const version = ++captureVersion.current;
    setCapturing(true); setError('');
    try {
      for (const id of controller.snapshot().visible) {
        if (captureVersion.current !== version || controller.snapshot().layout !== 'overview') return;
        const slices = await runtime.api.capture(id);
        if (captureVersion.current !== version || controller.snapshot().layout !== 'overview') return;
        setImages(previous => ({ ...previous, [id]: slices }));
      }
    } catch (failure) { if (captureVersion.current === version) setError(String(failure)); }
    finally { if (captureVersion.current === version) setCapturing(false); }
  }
  useEffect(() => {
    if (state.layout !== 'overview') { setCapturing(false); return; }
    const timer = setTimeout(() => { setImages({}); void refreshOverview(); }, 100);
    return () => { clearTimeout(timer); captureVersion.current++; };
  }, [state.layout, state.viewport.width, state.viewport.height, state.visible, refreshRevision]);
  return <div className={`sw-root ${state.selectionMode !== 'none' ? 'sw-selecting' : ''}`}>
    <header className="sw-toolbar">
      <button aria-label="Toggle controls" aria-expanded={state.leftOpen} onClick={() => controller.configure({ leftOpen: !state.leftOpen })}>☷</button>
      <strong>SiteWall</strong>
      <form onSubmit={event => { event.preventDefault(); perform(runtime.api.navigate(address)); }}>
        <input aria-label="Current route" value={address} onChange={event => setAddress(event.target.value)} placeholder="Navigate to a manifest route" />
        <button type="submit">Go</button>
      </form>
      <span>{state.visible.length} pages</span>
      <button aria-expanded={promptOpen} onClick={() => setPromptOpen(value => !value)}>Prompt Codex</button>
      <button aria-label="Toggle styles" aria-expanded={state.rightOpen} onClick={() => controller.configure({ rightOpen: !state.rightOpen })}>Styles ◧</button>
    </header>
    {error ? <div role="alert" className="sw-error">{error}<button onClick={() => setError('')}>Dismiss</button></div> : null}
    <div className="sw-workspace">
      {state.leftOpen ? <aside className="sw-controls" aria-label="Workspace controls">
        <h2>Representation</h2>
        <label>Layout<select value={state.layout} onChange={e => controller.configure({ layout: e.target.value as 'viewport' | 'overview' })}><option value="viewport">Live viewports</option><option value="overview">Full-page overview</option></select></label>
        <label>Device<select value={devices.findIndex(d => d.width === state.viewport.width && d.height === state.viewport.height)} onChange={e => { if (+e.target.value >= 0) controller.configure({ viewport: devices[+e.target.value] }); setImages({}); }}><option value={-1}>Custom</option>{devices.map((d, i) => <option key={d.name} value={i}>{d.name} · {d.width} × {d.height}</option>)}</select></label>
        <div className="sw-dimensions">{(['width', 'height'] as const).map(dimension => <label key={dimension}>{dimension}<input type="number" min={200} max={4096} value={dimensions[dimension]} onChange={e => setDimensions(previous => ({ ...previous, [dimension]: e.target.value }))} onBlur={e => {
          const value = Number(e.target.value);
          if (Number.isInteger(value) && value >= 200 && value <= 4096 && e.target.value.trim()) { controller.configure({ viewport: { ...controller.snapshot().viewport, [dimension]: value } }); setImages({}); }
          else setDimensions(previous => ({ ...previous, [dimension]: String(controller.snapshot().viewport[dimension]) }));
        }} /></label>)}</div>
        <label>Zoom · {Math.round(state.zoom * 100)}%<input aria-label="Zoom" type="range" min=".1" max="2" step=".001" value={state.zoom} onChange={e => controller.configure({ zoom: +e.target.value })} /></label>
        <label>Columns<input type="number" min={1} max={20} value={state.columns} onChange={e => { if (+e.target.value >= 1 && +e.target.value <= 20) controller.configure({ columns: +e.target.value }); }} /></label>
        <button onClick={() => controller.configure({ pan: { x: 32, y: 32 }, zoom: .65 })}>Reset canvas</button>
        <label className="sw-checkbox"><input type="checkbox" checked={state.autoCenter} onChange={event => runtime.api.configure({ autoCenter: event.target.checked })} />Auto Centering</label>
        <h2>Context selection</h2>
        <button aria-pressed={state.selectionMode === 'element'} onClick={() => runtime.api.setSelectionMode(state.selectionMode === 'element' ? 'none' : 'element')}>Select element</button>
        <button aria-pressed={state.selectionMode === 'region'} onClick={() => runtime.api.setSelectionMode(state.selectionMode === 'region' ? 'none' : 'region')}>Select region</button>
        {state.selection && <><p className="sw-hint">{state.selection.kind} on {state.selection.route} · {Math.round(state.selection.rectangle.width)} × {Math.round(state.selection.rectangle.height)} at {Math.round(state.selection.rectangle.x)}, {Math.round(state.selection.rectangle.y)}</p><button onClick={() => runtime.api.clearSelection()}>Clear selection</button></>}
        {state.layout === 'overview' ? <><button disabled={capturing} onClick={() => void refreshOverview()}>{capturing ? 'Capturing…' : 'Refresh full pages'}</button><p className="sw-hint">Viewport slices retain scroll behavior. Select a page to interact in its live viewport. Refresh after page changes.</p></> : null}
        <h2>Routes</h2>
        <input aria-label="Filter routes" placeholder="Search title, group, route" value={filter} onChange={e => setFilter(e.target.value)} />
        <div className="sw-route-list">{state.routes.filter(route => `${route.title} ${route.path} ${route.group ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map(route => <div className="sw-route" key={route.id}>
          <input type="checkbox" aria-label={`Show ${route.title}`} checked={state.visible.includes(route.id)} onChange={e => controller.show(route.id, e.target.checked)} />
          <button aria-pressed={state.focused === route.id} onClick={() => perform(runtime.api.focus(route.id))}><span>{route.title}</span><small>{route.group ? `${route.group} · ` : ''}{route.path}</small></button>
        </div>)}</div>
      </aside> : null}
      <main ref={element => { canvas.current = element; runtime.canvas = element ?? undefined; }} className="sw-canvas" aria-label="Page canvas">
        <div className="sw-pan-surface" aria-hidden="true" />
        <div className="sw-wall" style={{ transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`, gridTemplateColumns: `repeat(${state.columns}, ${state.viewport.width + 4}px)` }}>
          {state.routes.filter(route => visited.has(route.id) || state.visible.includes(route.id)).map(route => {
            const focused = state.focused === route.id;
            const slices = Object.hasOwn(images, route.id) ? images[route.id] : undefined;
            const blockMessage = Object.hasOwn(blocked, route.id) ? blocked[route.id] : undefined;
            const overview = state.layout === 'overview' && slices;
            return <section key={route.id} ref={panel => { if (panel) panels.current.set(route.id, panel); else panels.current.delete(route.id); }} className={`sw-page ${focused ? 'sw-focused' : ''}`} style={{ display: state.visible.includes(route.id) ? undefined : 'none', width: state.viewport.width + 4 }} aria-label={`${route.title} panel`}>
              <header><button onClick={() => interact(route.id)}>{focused ? '● ' : ''}{route.title}</button><small>{route.path}</small></header>
              <div className="sw-page-body" style={{ width: state.viewport.width, height: overview ? undefined : state.viewport.height }}>
                {/* The shield guards inactive pages; toggling iframe inert on focus leaves Chromium wheel hit-testing stale. */}
                <iframe title={route.title} src={route.path} sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-downloads" ref={frame => { if (frame) runtime.frames.set(route.id, frame); else runtime.frames.delete(route.id); }} onLoad={() => void runtime.loaded(route.id)} tabIndex={focused ? 0 : -1} inert={!!overview || !!blockMessage} style={{ width: state.viewport.width, height: state.viewport.height, display: 'block', position: overview ? 'absolute' : undefined, opacity: overview ? 0 : 1, pointerEvents: overview ? 'none' : undefined, visibility: blockMessage ? 'hidden' : undefined }} />
                {blockMessage ? <div className="sw-blocked" role="status"><strong>{route.title}</strong><p>{blockMessage}</p><button onClick={() => interact(route.id)}>Retry assigned route</button></div> : null}
                {overview ? <div className="sw-slices">{slices.map((src, index) => <img key={index} src={src} alt={`${route.title}, viewport slice ${index + 1}`} />)}</div> : null}
                {(!focused || overview) && !blockMessage ? <button className="sw-focus-shield" aria-label={`Focus ${route.title}`} onClick={() => interact(route.id)}><span>Focus {route.title}</span></button> : null}
                {!overview && !blockMessage && (state.selectionMode !== 'none' || state.selection?.panelId === route.id) ? <ContextOverlay id={route.id} api={runtime.api} state={state} frame={runtime.frames.get(route.id)} onError={setError} /> : null}
              </div>
            </section>;
          })}
        </div>
        {!state.visible.length ? <p className="sw-empty">Select routes to compose the wall.</p> : null}
      </main>
      {state.rightOpen && <PanelResizeHandle label="Resize styles panel" width={state.stylesWidth} onResize={width => controller.configure({ stylesWidth: width })} />}<aside className="sw-styles" style={{ width: state.stylesWidth, display: state.rightOpen ? undefined : 'none' }} aria-label="Stylesheet workspace"><StylesPanel api={runtime.api} /></aside>
      {promptOpen && <PanelResizeHandle label="Resize Codex panel" width={codexWidth} onResize={setCodexWidth} />}
      <CodexPanel api={runtime.api} width={codexWidth} open={promptOpen} />
    </div>
    <footer className="sw-footer">Focus: {state.currentRoute || 'none'} · {state.viewport.width} × {state.viewport.height} CSS px · Drag canvas to pan · Ctrl + wheel to zoom</footer>
  </div>;
}

