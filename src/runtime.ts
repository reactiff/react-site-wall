import { readPersistent, writePersistent } from './persistence.js';
import { getPageBridge, type PageBridge } from './bridge.js';
import { capturePage, stitchPageSlices } from './capture.js';
import { waitForPageReady } from './page-ready.js';
import { WallController } from './controller.js';
import type { ContextSelection, PromptAdapter, PromptContext, SelectionRectangle, SiteWallAPI, StylesheetAdapter, WallEvent } from './types.js';
import { captureSelection, sanitizeContext } from './selection.js';
import { inspectStyleContextAsync, applyStylesheet, restoreStylesheets } from './style-context.js';

export class WallRuntime {
  readonly frames = new Map<string, HTMLIFrameElement>();
  canvas?: HTMLElement;
  private shared: unknown;
  private hasShared = false;
  private restoringSavedShared = false;
  private closed = false;
  private navigationQueue = Promise.resolve();
  private restoring = new Set<string>();
  private blocked = new Set<string>();
  private sharedQueue = Promise.resolve();
  private captureQueue: Promise<unknown> = Promise.resolve();
  private captureAbort = new AbortController();
  private overlays = new Map<string, string>();
  private contextHistory: WallEvent[] = [];
  private scrollPositions: Record<string, { x: number; y: number }> = {};
  readonly api: SiteWallAPI;
  constructor(readonly controller: WallController, styles: StylesheetAdapter, private customCapture?: (win: Window, signal: AbortSignal) => Promise<string[]>, private prompts?: PromptAdapter) {
    const saved = readPersistent<{ hasShared?: boolean; shared?: unknown; history?: WallEvent[]; scrolls?: Record<string, { x: number; y: number }> }>(controller.wallPath, 'session');
    if (saved) { this.hasShared = saved.hasShared === true; this.restoringSavedShared = this.hasShared; this.shared = saved.shared; this.contextHistory = Array.isArray(saved.history) ? saved.history.slice(-300) : []; this.scrollPositions = saved.scrolls ?? {}; }
    const action = async <T>(name: string, fn: () => T | Promise<T>): Promise<T> => {
      try { const result = await fn(); controller.emit('action', { name, success: true }); return result; }
      catch (error) { controller.emit('error', { action: name, message: String(error) }); throw error; }
    };
    this.api = {
      getState: () => structuredClone(controller.snapshot()),
      events: controller.events,
      subscribe: controller.observe,
      show: (id, visible) => controller.show(id, visible),
      focus: id => action('focus', async () => {
        this.restoring.delete(id);
        this.blocked.delete(id);
        controller.focus(id);
        await new Promise<void>(resolve => requestAnimationFrame(() => { const frame = this.frames.get(id); frame?.focus({ preventScroll: true }); frame?.contentWindow?.focus(); resolve(); }));
        const bridge = await this.ready(id);
        const redirect = controller.route(id).metadata?.redirectTo;
        if (typeof redirect === 'string') { await this.api.navigate(redirect); return; }
        if (bridge.location() !== controller.route(id).path) this.restore(id, bridge);
      }),
      navigate: path => action('navigate', () => {
        const work = this.navigationQueue.then(() => this.navigate(path));
        this.navigationQueue = work.catch(() => {});
        return work;
      }),
      configure: patch => controller.configure(patch),
      zoomAt: (zoom, origin) => {
        const wall = this.canvas?.querySelector<HTMLElement>('.sw-wall');
        controller.zoomAt(zoom, { x: origin.x - (wall?.offsetLeft ?? 0), y: origin.y - (wall?.offsetTop ?? 0) });
      },
      filterStyles: query => { if (typeof query !== 'string') throw new Error('Invalid styles filter'); controller.update({ styleFilter: query }); },
      inspectStyles: (id, selector) => action('inspectStyles', async () => {
        const currentSelection = controller.snapshot().selection;
        if (!selector && (!currentSelection || (id && currentSelection.panelId !== id))) return { stylesheets: [], cascade: [], unresolved: [], opaqueSources: [], rules: [] };
        const panelId = id ?? currentSelection?.panelId ?? this.focused();
        await this.ready(panelId);
        const win = this.frames.get(panelId)!.contentWindow!;
        const selection = controller.snapshot().selection;
        const selected = selection?.panelId === panelId ? selection : null;
        if (!selector && !selected) return { stylesheets: [], cascade: [], unresolved: [], opaqueSources: [], rules: [] };
        return inspectStyleContextAsync(win, selector ?? selected?.element?.selector, await styles.list(), !selector && selected?.kind === 'region' ? selected.rectangle : undefined);
      }),
      setSelectionMode: mode => {
        if (!['none', 'element', 'region'].includes(mode)) throw new Error('Invalid selection mode');
        controller.update({ selectionMode: mode, ...(mode !== 'none' ? { layout: 'viewport' as const } : {}) });
      },
      selectElement: (selector, id) => action('selectElement', async () => {
        const panelId = id ?? this.focused();
        await this.ready(panelId);
        const doc = this.frames.get(panelId)!.contentDocument!;
        const elements = doc.querySelectorAll(selector);
        if (elements.length !== 1) throw new Error('Selection selector must identify exactly one element');
        return this.select(panelId, elements[0]);
      }),
      selectRegion: (rectangle, id) => action('selectRegion', async () => {
        const panelId = id ?? this.focused();
        await this.ready(panelId);
        return this.select(panelId, rectangle);
      }),
      clearSelection: () => controller.update({ selection: null, selectionMode: controller.snapshot().selectionMode === 'element' ? 'element' : 'none' }),
      inspectSelection: () => structuredClone(controller.snapshot().selection),
      promptContext: () => action('promptContext', () => this.promptContext()),
      executePrompt: instruction => action('executePrompt', async () => {
        if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) throw new Error('Enter an instruction of at most 20000 characters');
        if (!this.prompts) throw new Error('No development Codex prompt adapter configured');
        const context = await this.promptContext();
        controller.emit('prompt-start', { panelId: context.selection?.panelId ?? context.wall.focused });
        const result = await this.prompts.execute(instruction, context);
        controller.emit('prompt-result', result);
        return result;
      }),
      inspect: id => action('inspect', async () => {
        await this.navigationQueue;
        const panelId = id ?? this.focused();
        const observation = (await this.ready(panelId)).inspect();
        const assignedRoute = controller.route(panelId).path;
        return { ...observation, panelId, assignedRoute, available: !this.blocked.has(panelId) && (observation.route === assignedRoute || observation.route.split('#')[0] === assignedRoute) };
      }),
      click: selector => action('click', async () => (await this.active()).click(selector)),
      type: (selector, value) => action('type', async () => (await this.active()).type(selector, value)),
      scroll: (x, y) => action('scroll', async () => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid scroll coordinates');
        (await this.active()).scroll(x, y);
        controller.emit('scroll', { id: this.focused(), x, y });
      }),
      capture: id => action('capture', () => this.queueCapture(id ?? this.focused(), false)),
      captureFullPage: route => action('captureFullPage', async () => {
        const panel = route ? controller.snapshot().routes.find(page => page.id === route || page.path === route)?.id : this.focused();
        if (!panel) throw new Error(`Route is absent from page-routes.json: ${route}`);
        if (!this.frames.has(panel)) controller.show(panel, true);
        return this.queueCapture(panel, true);
      }),
      captureAllPages: () => action('captureAllPages', async () => {
        const panels = [...controller.snapshot().visible];
        const results: { id: string; route: string; image: string }[] = [];
        for (const id of panels) {
          // A user may uncheck a panel while an earlier page is capturing.
          if (!controller.snapshot().visible.includes(id)) continue;
          const image = await this.queueCapture(id, true);
          if (controller.snapshot().visible.includes(id)) results.push({ id, route: controller.route(id).path, image });
        }
        return results;
      }),
      saveAllPages: outputDir => action('saveAllPages', async () => {
        if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('outputDir must be a nonempty directory path');
        if (!this.prompts?.saveCaptures) throw new Error('No development capture persistence adapter configured');
        const captures = await this.api.captureAllPages();
        return this.prompts.saveCaptures(outputDir, captures);
      }),
      styles: {
        list: () => action('styles.list', () => styles.list()),
        read: id => action('styles.read', () => styles.read(id)),
        save: file => action('styles.save', async () => {
          const saved = await styles.save(file);
          this.overlays.set(saved.id, saved.content);
          this.frames.forEach(frame => this.applyStyles(frame));
          controller.emit('stylesheet', { id: saved.id, revision: saved.revision });
          return saved;
        }),
      },
    };
  }
  private persistSession(): void {
    writePersistent(this.controller.wallPath, 'session', () => ({ hasShared: this.hasShared, shared: this.shared, history: this.contextHistory, scrolls: this.scrollPositions }));
  }
  private queueCapture(panel: string, full: true): Promise<string>;
  private queueCapture(panel: string, full: false): Promise<string[]>;
  private queueCapture(panel: string, full: boolean): Promise<string | string[]> {
    const work = this.captureQueue.then(async () => {
      await this.navigationQueue;
      await this.ready(panel);
      if (this.blocked.has(panel)) throw new Error(`Cannot capture redirected panel ${panel}`);
      const win = this.frames.get(panel)!.contentWindow!;
      const images = await (this.customCapture ?? capturePage)(win, this.captureAbort.signal);
      const result = full ? await stitchPageSlices(win, images, this.captureAbort.signal) : images;
      this.controller.emit('capture', { id: panel, slices: images.length, full });
      return result;
    });
    this.captureQueue = work.catch(() => {});
    return work;
  }
  private select(panelId: string, target: Element | SelectionRectangle): ContextSelection {
    const win = this.frames.get(panelId)!.contentWindow!;
    if (this.blocked.has(panelId) || getPageBridge(win).location().split('#')[0] !== this.controller.route(panelId).path.split('#')[0]) throw new Error('Cannot select an unavailable assigned page');
    const selection = captureSelection(win, panelId, getPageBridge(win).shared?.read() ?? this.shared, target);
    const state = this.controller.snapshot();
    this.controller.update({ selection, selectionMode: selection.kind === 'element' && state.selectionMode === 'element' ? 'element' : 'none', layout: 'viewport', visible: state.visible.includes(panelId) ? state.visible : [...state.visible, panelId] });
    this.controller.emit('selection', selection);
    return structuredClone(selection);
  }
  private async promptContext(): Promise<PromptContext> {
    await this.navigationQueue;
    await this.sharedQueue;
    const selection = this.api.inspectSelection();
    const id = selection?.panelId ?? this.focused();
    const page = await this.api.inspect(id);
    if (!page.available) throw new Error('Selected page is unavailable');
    if (selection && selection.route !== page.route) throw new Error('Selected route changed; select the context again');
    const applicationState = (await this.ready(id)).shared?.read() ?? this.shared;
    return sanitizeContext({ version: 1, wallUrl: window.location.href, capturedAt: Date.now(), wall: this.api.getState(), selection, page, applicationState, history: this.contextHistory, styles: await this.api.inspectStyles(id, selection?.element?.selector) }) as PromptContext;
  }
  private focused(): string {
    const id = this.controller.snapshot().focused;
    if (!id) throw new Error('No panel is focused');
    return id;
  }
  private async active(): Promise<PageBridge> {
    await this.navigationQueue;
    const id = this.focused();
    const bridge = await this.ready(id);
    const assigned = this.controller.route(id).path;
    if (this.blocked.has(id) || (bridge.location() !== assigned && bridge.location().split('#')[0] !== assigned)) throw new Error(`Panel ${id} has redirected and cannot be interacted with as ${assigned}`);
    return bridge;
  }
  async ready(id: string, settle = true): Promise<PageBridge> {
    this.controller.route(id);
    const deadline = Date.now() + 30000;
    let error: unknown;
    while (!this.closed && Date.now() < deadline) {
      try {
        const win = this.frames.get(id)?.contentWindow;
        if (win && win.document.readyState === 'complete' && win.location.href !== 'about:blank') {
          const bridge = getPageBridge(win);
          if (settle) await waitForPageReady(win, this.captureAbort.signal);
          return bridge;
        }
      } catch (failure) { error = failure; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Panel ${id} is unavailable: ${String(error ?? 'bridge timeout')}`);
  }
  private applyStyles(frame: HTMLIFrameElement) {
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      for (const [id, content] of this.overlays) {
        if (!applyStylesheet(doc, id, content)) this.controller.emit('style-unresolved', { id, reason: 'No unique loaded stylesheet matches this source; host HMR must apply the edit.' });
      }
    } catch (error) { this.controller.emit('error', { message: String(error) }); }
  }
  async loaded(id: string) {
    try {
      // Hydrate the existing shared store before waiting for data dependent on it.
      const bridge = await this.ready(id, false);
      if (this.closed) return;
      this.applyStyles(this.frames.get(id)!);
      if (bridge.shared) {
        if (this.hasShared) {
          if (this.restoringSavedShared) { this.shared = restoreSavedShared(bridge.shared.read(), this.shared); this.restoringSavedShared = false; }
          await bridge.shared.apply(structuredClone(this.shared));
        }
        else { this.shared = structuredClone(bridge.shared.read()); this.hasShared = true; }
      }
      this.persistSession();
      this.controller.emit('ready', { id, sharedState: !!bridge.shared });
      const scroll = this.scrollPositions[id];
      if (scroll && Number.isFinite(scroll.x) && Number.isFinite(scroll.y)) { void waitForPageReady(this.frames.get(id)!.contentWindow!, this.captureAbort.signal).then(() => { if (!this.closed && this.scrollPositions[id] === scroll) bridge.scroll(scroll.x, scroll.y); }).catch(error => this.controller.emit('error', { id, message: String(error) })); }
      const path = bridge.location();
      if (path !== this.controller.route(id).path) {
        if (this.controller.snapshot().focused === id) await this.api.navigate(path);
        else this.restore(id, bridge);
      }
    } catch (error) { this.controller.emit('error', { id, message: String(error) }); }
  }
  private async navigate(path: string): Promise<void> {
    const { source, destination } = this.controller.navigate(path);
    this.restoring.delete(destination);
    // Restore the source before waiting for a newly revealed destination to load.
    if (source && source !== destination) {
      const old = await this.ready(source);
      this.restore(source, old);
    }
    const target = await this.ready(destination);
    if (target.location() !== path) target.navigate(path);
    this.controller.emit('navigation-complete', { source, destination, path: target.location() });
  }
  private restore(id: string, bridge: PageBridge): void {
    const route = this.controller.route(id);
    const assigned = route.path;
    if (typeof route.metadata?.redirectTo === 'string') {
      if (bridge.location() !== assigned) bridge.navigate(assigned);
      this.blocked.add(id);
      this.controller.emit('panel-blocked', { id, path: assigned, destination: route.metadata.redirectTo, message: 'This route redirects to another page. Its assigned panel is retained; select it to follow the redirect.' });
      return;
    }
    if (bridge.location() === assigned) {
      this.blocked.delete(id);
      this.controller.emit('restoration', { id, path: assigned });
      return;
    }
    if (this.restoring.has(id)) {
      this.blocked.add(id);
      this.controller.emit('panel-blocked', { id, path: assigned, destination: bridge.location(), message: 'This page redirects in the current application state. Focus its assigned panel to retry.' });
      return;
    }
    this.restoring.add(id);
    bridge.navigate(assigned);
    if (bridge.location() !== assigned) {
      this.blocked.add(id);
      this.controller.emit('panel-blocked', { id, path: assigned, destination: bridge.location(), message: 'The host router could not restore this route. Supply a navigation adapter or update application state.' });
    } else {
      this.blocked.delete(id);
      this.controller.emit('restoration', { id, path: assigned });
    }
  }
  attach(): () => void {
    this.closed = false;
    this.captureAbort = new AbortController();
    const history = this.controller.observe(event => {
      if (!['navigation', 'focus', 'click', 'interaction', 'scroll', 'shared-state', 'inactive-navigation'].includes(event.type)) return;
      this.contextHistory.push(structuredClone(event));
      if (this.contextHistory.length > 300) this.contextHistory.shift();
      if (event.type === 'scroll') { const detail = event.detail as { id?: string; x?: number; y?: number; detail?: { x: number; y: number } }; if (detail.id) { const point = detail.detail ?? detail; if (Number.isFinite(point.x) && Number.isFinite(point.y)) this.scrollPositions[detail.id] = { x: point.x!, y: point.y! }; } }
      this.persistSession();
    });
    const page = (event: Event) => {
      const { source, type, detail } = (event as CustomEvent<{ source: Window; type: string; detail: unknown }>).detail;
      const entry = [...this.frames].find(([, frame]) => frame.contentWindow === source);
      if (!entry) return;
      const [id] = entry;
      if (type === 'navigation') {
        const path = (detail as { path: string }).path;
        if (this.controller.snapshot().focused === id) {
          void this.api.navigate(path).catch(async () => {
            try { this.restore(id, await this.ready(id)); } catch { /* Error is already observable. */ }
          });
        } else {
          const assigned = this.controller.route(id).path;
          if (path !== assigned) { this.restore(id, getPageBridge(source)); this.controller.emit('inactive-navigation', { id, path }); }
        }
      } else if (type === 'shared-state') {
        this.restoring.clear();
        this.shared = structuredClone(detail); this.hasShared = true;
        const snapshot = structuredClone(detail);
        this.sharedQueue = this.sharedQueue.then(async () => {
          for (const [other, frame] of this.frames) {
            if (other === id) continue;
            try { await getPageBridge(frame.contentWindow!).shared?.apply(structuredClone(snapshot)); }
            catch (error) { this.controller.emit('error', { id: other, message: String(error) }); }
          }
          this.controller.emit('shared-state', { source: id });
        });
      } else if (type !== 'ready') this.controller.emit(type, { id, detail });
    };
    window.addEventListener('sitewall:page', page);
    const previous = window.sitewall;
    window.sitewall = this.api;
    const detachPrompts = this.prompts?.attach?.(this.api);
    return () => {
      this.closed = true;
      history();
      detachPrompts?.();
      this.captureAbort.abort();
      window.removeEventListener('sitewall:page', page);
      if (window.sitewall === this.api) window.sitewall = previous;
      this.frames.forEach(frame => {
        try { if (frame.contentDocument) restoreStylesheets(frame.contentDocument); } catch { /* Cross-origin frame. */ }
      });
    };
  }
}

/** Persisted credentials are redacted; preserve the live host's credential fields. */
function restoreSavedShared(live: unknown, saved: unknown): unknown {
  if (Array.isArray(saved)) return saved.map((value, index) => restoreSavedShared(Array.isArray(live) ? live[index] : undefined, value));
  if (saved && typeof saved === 'object') {
    const current = live && typeof live === 'object' ? live as Record<string, unknown> : {};
    return Object.fromEntries([...new Set([...Object.keys(current), ...Object.keys(saved)])].filter(key => !/password|secret|token|credential|authorization|cookie|api.?key/i.test(key) || key in current).map(key => [key, /password|secret|token|credential|authorization|cookie|api.?key/i.test(key) ? current[key] : restoreSavedShared(current[key], (saved as Record<string, unknown>)[key])]));
  }
  return saved === undefined ? live : saved;
}
