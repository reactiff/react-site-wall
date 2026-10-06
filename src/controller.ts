import { readPersistent, writePersistent } from './persistence.js';
import { normalizePath, validateManifest } from './manifest.js';
import { devices, type RouteManifest, type WallEvent, type WallState } from './types.js';

const persistentEvent = (event: WallEvent) => !event.type.startsWith('prompt-') &&
  !['executePrompt', 'stopPrompt'].includes(String((event.detail as { action?: string; name?: string } | null)?.action ?? (event.detail as { name?: string } | null)?.name ?? ''));

/** Route ownership is independent of iframe location and rendering. */
export class WallController {
  private state: WallState;
  private log: WallEvent[] = [];
  private sequence = 0;
  private listeners = new Set<() => void>();
  private observers = new Set<(event: WallEvent) => void>();
  constructor(manifest: RouteManifest, readonly wallPath = '/sitewall') {
    const routes = validateManifest(manifest, wallPath).routes;
    const visible = routes.filter(r => r.included !== false).map(r => r.id);
    const focused = visible[0] ?? null;
    this.state = { autoCenter: true, styleFilter: '', selectionMode: 'none', selection: null, routes, visible, focused, currentRoute: routes.find(r => r.id === focused)?.path ?? '', layout: 'viewport', viewport: devices[0], zoom: .65, pan: { x: 32, y: 32 }, columns: 3, leftOpen: true, rightOpen: true, stylesWidth: 320 };
    const saved = readPersistent<Partial<WallState>>(wallPath, 'wall');
    if (saved) {
      const patch: Partial<WallState> = {};
      for (const key of ['autoCenter', 'leftOpen', 'rightOpen'] as const) if (typeof saved[key] === 'boolean') patch[key] = saved[key];
      if (saved.layout === 'viewport' || saved.layout === 'overview') patch.layout = saved.layout;
      if (saved.viewport && [saved.viewport.width, saved.viewport.height].every(value => Number.isInteger(value) && value >= 200 && value <= 4096)) patch.viewport = saved.viewport;
      if (Number.isFinite(saved.zoom) && saved.zoom! >= .1 && saved.zoom! <= 2) patch.zoom = saved.zoom;
      if (saved.pan && Number.isFinite(saved.pan.x) && Number.isFinite(saved.pan.y)) patch.pan = saved.pan;
      if (Number.isInteger(saved.columns) && saved.columns! >= 1 && saved.columns! <= 20) patch.columns = saved.columns;
      if (Number.isFinite(saved.stylesWidth) && saved.stylesWidth! >= 200 && saved.stylesWidth! <= 1200) patch.stylesWidth = saved.stylesWidth;
      if (typeof saved.styleFilter === 'string') patch.styleFilter = saved.styleFilter;
      if (['none', 'element', 'region'].includes(saved.selectionMode ?? '')) patch.selectionMode = saved.selectionMode;
      if (Array.isArray(saved.visible)) patch.visible = [...new Set(saved.visible.filter(id => routes.some(route => route.id === id)))];
      const ids = patch.visible ?? visible;
      patch.focused = ids.includes(saved.focused ?? '') ? saved.focused : ids[0] ?? null;
      const route = routes.find(route => route.id === patch.focused);
      patch.currentRoute = route && saved.currentRoute?.split('#')[0] === route.path ? saved.currentRoute : route?.path ?? '';
      if (saved.selection && typeof saved.selection.route === 'string' && routes.some(route => route.id === saved.selection!.panelId && route.path === saved.selection!.route.split('#')[0])) patch.selection = saved.selection;
      this.state = { ...this.state, ...patch };
    }
    const history = readPersistent<WallEvent[]>(wallPath, 'events');
    if (Array.isArray(history)) { this.log = history.filter(event => event && Number.isFinite(event.sequence) && typeof event.type === 'string' && persistentEvent(event)).slice(-500); this.sequence = this.log.at(-1)?.sequence ?? 0; }
  }
  snapshot = (): WallState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  observe = (listener: (event: WallEvent) => void): (() => void) => { this.observers.add(listener); return () => { this.observers.delete(listener); }; };
  events = (since = 0): WallEvent[] => structuredClone(this.log.filter(e => e.sequence > since));
  emit(type: string, detail: unknown): void {
    const event = { sequence: ++this.sequence, type, detail, time: Date.now() };
    this.log.push(event);
    if (this.log.length > 500) this.log.shift();
    this.observers.forEach(fn => fn(event));
    writePersistent(this.wallPath, 'events', () => this.log.filter(persistentEvent));
  }
  update(patch: Partial<WallState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn());
    this.emit('workspace', structuredClone(this.state));
    writePersistent(this.wallPath, 'wall', () => this.state);
  }
  route(id: string) {
    const route = this.state.routes.find(r => r.id === id);
    if (!route) throw new Error(`Unknown panel: ${id}`);
    return route;
  }
  show(id: string, visible: boolean): void {
    this.route(id);
    const ids = this.state.visible.filter(value => value !== id);
    if (visible) ids.push(id);
    const focused = !visible && this.state.focused === id ? ids[0] ?? null : this.state.focused ?? ids[0] ?? null;
    this.update({ visible: ids, focused, currentRoute: focused ? this.route(focused).path : '' });
  }
  focus(id: string): void {
    const route = this.route(id);
    this.update({ focused: id, currentRoute: route.path, visible: this.state.visible.includes(id) ? this.state.visible : [...this.state.visible, id] });
    this.emit('focus', { id, path: route.path });
  }
  navigate(path: string): { source: string | null; destination: string; path: string } {
    path = normalizePath(path);
    const route = this.state.routes.find(r => r.path === path) ?? this.state.routes.find(r => r.path === path.split('#')[0]);
    if (!route) { this.emit('unmapped-navigation', { path }); throw new Error(`Route is absent from page-routes.json: ${path}`); }
    const source = this.state.focused;
    this.focus(route.id);
    this.update({ currentRoute: path });
    this.emit('navigation', { source, destination: route.id, path });
    return { source, destination: route.id, path };
  }
  configure(patch: Partial<Pick<WallState, 'layout' | 'viewport' | 'zoom' | 'pan' | 'columns' | 'leftOpen' | 'rightOpen' | 'autoCenter' | 'stylesWidth'>>): void {
    if (patch.stylesWidth !== undefined && (!Number.isFinite(patch.stylesWidth) || patch.stylesWidth < 200 || patch.stylesWidth > 1200)) throw new Error('Styles panel width must be 200-1200 pixels');
    if (patch.autoCenter !== undefined && typeof patch.autoCenter !== 'boolean') throw new Error('Invalid auto-centering');
    if (patch.layout && !['overview', 'viewport'].includes(patch.layout)) throw new Error('Invalid layout');
    if (patch.zoom !== undefined && (!Number.isFinite(patch.zoom) || patch.zoom < .1 || patch.zoom > 3)) throw new Error('Zoom must be between 0.1 and 2');
    if (patch.columns !== undefined && (!Number.isInteger(patch.columns) || patch.columns < 1 || patch.columns > 20)) throw new Error('Columns must be 1–20');
    if (patch.viewport && [patch.viewport.width, patch.viewport.height].some(v => !Number.isInteger(v) || v < 200 || v > 4096)) throw new Error('Viewport dimensions must be 200–4096 CSS pixels');
    if (patch.pan && (!Number.isFinite(patch.pan.x) || !Number.isFinite(patch.pan.y))) throw new Error('Invalid pan');
    this.update(structuredClone(patch));
  }
  /** High-frequency gesture preview: shared state changes without rerendering the wall. */
  previewCamera(zoom: number, pan: { x: number; y: number }): void {
    if (!Number.isFinite(zoom) || zoom < .1 || zoom > 2 || !Number.isFinite(pan.x) || !Number.isFinite(pan.y)) return;
    this.state = { ...this.state, zoom, pan };
  }
  zoomAt(zoom: number, origin: { x: number; y: number }): void {
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) throw new Error('Invalid zoom origin');
    const { pan, zoom: previous } = this.state;
    this.configure({ zoom, pan: { x: origin.x - (origin.x - pan.x) * zoom / previous, y: origin.y - (origin.y - pan.y) * zoom / previous } });
  }
}
