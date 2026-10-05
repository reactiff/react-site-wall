import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { WallController } from './controller.js';
import { WallRuntime } from './runtime.js';
import { StylesPanel } from './StylesPanel.js';
import { devices, type RouteManifest, type SiteWallAPI, type StylesheetAdapter } from './types.js';

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
  onReady?: (api: SiteWallAPI) => void;
  capture?: (win: Window, signal: AbortSignal) => Promise<string[]>;
}
export function SiteWall(props: SiteWallProps) {
  return props.enabled ? <Workspace {...props} /> : null;
}
function Workspace({ manifest, wallPath = '/sitewall', styles = noStyles, capture, onReady }: SiteWallProps) {
  // Configuration is fixed for one session; remount explicitly to replace a manifest.
  const [controller] = useState(() => new WallController(manifest, wallPath));
  const [runtime] = useState(() => new WallRuntime(controller, styles, capture));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [visited, setVisited] = useState(() => new Set(state.visible));
  const [filter, setFilter] = useState('');
  const [address, setAddress] = useState(state.currentRoute);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, string[]>>({});
  const [capturing, setCapturing] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const captureVersion = useRef(0);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const canvas = useRef<HTMLElement | null>(null);
  const panels = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const detach = runtime.attach();
    const unobserve = controller.observe(event => {
      if (event.type === 'error' || event.type === 'unmapped-navigation' || event.type === 'external-navigation') setError(JSON.stringify(event.detail));
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
    const surface = canvas.current!;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      controller.configure({ zoom: Math.max(.1, Math.min(2, controller.snapshot().zoom - event.deltaY * .001)) });
    };
    surface.addEventListener('wheel', wheel, { passive: false });
    return () => surface.removeEventListener('wheel', wheel);
  }, [controller]);
  useEffect(() => {
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
  }, [state.focused, controller]);
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
  return <div className="sw-root">
    <header className="sw-toolbar">
      <button aria-label="Toggle controls" aria-expanded={state.leftOpen} onClick={() => controller.configure({ leftOpen: !state.leftOpen })}>☷</button>
      <strong>SiteWall</strong>
      <form onSubmit={event => { event.preventDefault(); perform(runtime.api.navigate(address)); }}>
        <input aria-label="Current route" value={address} onChange={event => setAddress(event.target.value)} placeholder="Navigate to a manifest route" />
        <button type="submit">Go</button>
      </form>
      <span>{state.visible.length} pages</span>
      <button aria-label="Toggle styles" aria-expanded={state.rightOpen} onClick={() => controller.configure({ rightOpen: !state.rightOpen })}>Styles ◧</button>
    </header>
    {error ? <div role="alert" className="sw-error">{error}<button onClick={() => setError('')}>Dismiss</button></div> : null}
    <div className="sw-workspace">
      {state.leftOpen ? <aside className="sw-controls" aria-label="Workspace controls">
        <h2>Representation</h2>
        <label>Layout<select value={state.layout} onChange={e => controller.configure({ layout: e.target.value as 'viewport' | 'overview' })}><option value="viewport">Live viewports</option><option value="overview">Full-page overview</option></select></label>
        <label>Device<select value={devices.findIndex(d => d.width === state.viewport.width && d.height === state.viewport.height)} onChange={e => { if (+e.target.value >= 0) controller.configure({ viewport: devices[+e.target.value] }); setImages({}); }}><option value={-1}>Custom</option>{devices.map((d, i) => <option key={d.name} value={i}>{d.name} · {d.width} × {d.height}</option>)}</select></label>
        <div className="sw-dimensions">{(['width', 'height'] as const).map(dimension => <label key={dimension}>{dimension}<input type="number" min={200} max={4096} value={state.viewport[dimension]} onChange={e => { const value = +e.target.value; if (value >= 200 && value <= 4096) { controller.configure({ viewport: { ...state.viewport, [dimension]: value } }); setImages({}); } }} /></label>)}</div>
        <label>Zoom · {Math.round(state.zoom * 100)}%<input aria-label="Zoom" type="range" min=".1" max="2" step=".05" value={state.zoom} onChange={e => controller.configure({ zoom: +e.target.value })} /></label>
        <label>Columns<input type="number" min={1} max={20} value={state.columns} onChange={e => { if (+e.target.value >= 1 && +e.target.value <= 20) controller.configure({ columns: +e.target.value }); }} /></label>
        <button onClick={() => controller.configure({ pan: { x: 32, y: 32 }, zoom: .65 })}>Reset canvas</button>
        {state.layout === 'overview' ? <><button disabled={capturing} onClick={() => void refreshOverview()}>{capturing ? 'Capturing…' : 'Refresh full pages'}</button><p className="sw-hint">Viewport slices retain scroll behavior. Select a page to interact in its live viewport. Refresh after page changes.</p></> : null}
        <h2>Routes</h2>
        <input aria-label="Filter routes" placeholder="Search title, group, route" value={filter} onChange={e => setFilter(e.target.value)} />
        <div className="sw-route-list">{state.routes.filter(route => `${route.title} ${route.path} ${route.group ?? ''}`.toLowerCase().includes(filter.toLowerCase())).map(route => <div className="sw-route" key={route.id}>
          <input type="checkbox" aria-label={`Show ${route.title}`} checked={state.visible.includes(route.id)} onChange={e => controller.show(route.id, e.target.checked)} />
          <button aria-pressed={state.focused === route.id} onClick={() => perform(runtime.api.focus(route.id))}><span>{route.title}</span><small>{route.group ? `${route.group} · ` : ''}{route.path}</small></button>
        </div>)}</div>
      </aside> : null}
      <main ref={canvas} className="sw-canvas" aria-label="Page canvas" onPointerDown={e => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, panX: state.pan.x, panY: state.pan.y };
      }} onPointerMove={e => {
        if (drag.current) controller.configure({ pan: { x: drag.current.panX + e.clientX - drag.current.x, y: drag.current.panY + e.clientY - drag.current.y } });
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div className="sw-wall" style={{ transform: `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`, gridTemplateColumns: `repeat(${state.columns}, ${state.viewport.width}px)` }}>
          {state.routes.filter(route => visited.has(route.id) || state.visible.includes(route.id)).map(route => {
            const focused = state.focused === route.id;
            const slices = Object.hasOwn(images, route.id) ? images[route.id] : undefined;
            const blockMessage = Object.hasOwn(blocked, route.id) ? blocked[route.id] : undefined;
            const overview = state.layout === 'overview' && slices;
            return <section key={route.id} ref={panel => { if (panel) panels.current.set(route.id, panel); else panels.current.delete(route.id); }} className={`sw-page ${focused ? 'sw-focused' : ''}`} style={{ display: state.visible.includes(route.id) ? undefined : 'none', width: state.viewport.width }} aria-label={`${route.title} panel`}>
              <header><button onClick={() => interact(route.id)}>{focused ? '● ' : ''}{route.title}</button><small>{route.path}</small></header>
              <div className="sw-page-body" style={{ width: state.viewport.width, height: overview ? undefined : state.viewport.height }}>
                <iframe title={route.title} src={route.path} sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-downloads" ref={frame => { if (frame) runtime.frames.set(route.id, frame); else runtime.frames.delete(route.id); }} onLoad={() => void runtime.loaded(route.id)} tabIndex={focused ? 0 : -1} inert={!focused || !!overview || !!blockMessage} style={{ width: state.viewport.width, height: state.viewport.height, display: 'block', position: overview ? 'absolute' : undefined, opacity: overview ? 0 : 1, pointerEvents: overview ? 'none' : undefined, visibility: blockMessage ? 'hidden' : undefined }} />
                {blockMessage ? <div className="sw-blocked" role="status"><strong>{route.title}</strong><p>{blockMessage}</p><button onClick={() => interact(route.id)}>Retry assigned route</button></div> : null}
                {overview ? <div className="sw-slices">{slices.map((src, index) => <img key={index} src={src} alt={`${route.title}, viewport slice ${index + 1}`} />)}</div> : null}
                {(!focused || overview) && !blockMessage ? <button className="sw-focus-shield" aria-label={`Focus ${route.title}`} onClick={() => interact(route.id)}><span>Focus {route.title}</span></button> : null}
              </div>
            </section>;
          })}
        </div>
        {!state.visible.length ? <p className="sw-empty">Select routes to compose the wall.</p> : null}
      </main>
      <aside className="sw-styles" style={{ display: state.rightOpen ? undefined : 'none' }} aria-label="Stylesheet workspace"><StylesPanel adapter={runtime.api.styles} subscribe={runtime.api.subscribe} /></aside>
    </div>
    <footer className="sw-footer">Focus: {state.currentRoute || 'none'} · {state.viewport.width} × {state.viewport.height} CSS px · Drag canvas to pan · Ctrl + wheel to zoom</footer>
  </div>;
}
