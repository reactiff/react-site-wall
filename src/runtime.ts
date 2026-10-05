import { getPageBridge, type PageBridge } from './bridge.js';
import { capturePage } from './capture.js';
import { WallController } from './controller.js';
import type { PageObservation, SiteWallAPI, StylesheetAdapter } from './types.js';

export class WallRuntime {
  readonly frames = new Map<string, HTMLIFrameElement>();
  private shared: unknown;
  private hasShared = false;
  private closed = false;
  private navigationQueue = Promise.resolve();
  private restoring = new Set<string>();
  private blocked = new Set<string>();
  private sharedQueue = Promise.resolve();
  private captureQueue: Promise<unknown> = Promise.resolve();
  private captureAbort = new AbortController();
  private overlays = new Map<string, string>();
  readonly api: SiteWallAPI;
  constructor(readonly controller: WallController, styles: StylesheetAdapter, private customCapture?: (win: Window, signal: AbortSignal) => Promise<string[]>) {
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
      capture: id => action('capture', () => {
        const panel = id ?? this.focused();
        const work = this.captureQueue.then(async () => {
          await this.ready(panel);
          if (this.blocked.has(panel)) throw new Error(`Cannot capture redirected panel ${panel}`);
          const win = this.frames.get(panel)!.contentWindow!;
          const images = await (this.customCapture ?? capturePage)(win, this.captureAbort.signal);
          controller.emit('capture', { id: panel, slices: images.length });
          return images;
        });
        this.captureQueue = work.catch(() => {});
        return work;
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
  async ready(id: string): Promise<PageBridge> {
    this.controller.route(id);
    const deadline = Date.now() + 10000;
    let error: unknown;
    while (!this.closed && Date.now() < deadline) {
      try {
        const win = this.frames.get(id)?.contentWindow;
        if (win && win.document.readyState !== 'loading' && win.location.pathname !== 'blank') return getPageBridge(win);
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
        let style = [...doc.querySelectorAll<HTMLStyleElement>('style[data-sitewall-file]')].find(el => el.dataset.sitewallFile === id);
        if (!style) { style = doc.createElement('style'); style.dataset.sitewallFile = id; doc.head.append(style); }
        style.textContent = content;
      }
    } catch (error) { this.controller.emit('error', { message: String(error) }); }
  }
  async loaded(id: string) {
    try {
      const bridge = await this.ready(id);
      if (this.closed) return;
      this.applyStyles(this.frames.get(id)!);
      if (bridge.shared) {
        if (this.hasShared) await bridge.shared.apply(structuredClone(this.shared));
        else { this.shared = structuredClone(bridge.shared.read()); this.hasShared = true; }
      }
      this.controller.emit('ready', { id, sharedState: !!bridge.shared });
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
    return () => {
      this.closed = true;
      this.captureAbort.abort();
      window.removeEventListener('sitewall:page', page);
      if (window.sitewall === this.api) window.sitewall = previous;
      this.frames.forEach(frame => {
        try { frame.contentDocument?.querySelectorAll('style[data-sitewall-file]').forEach(el => el.remove()); } catch { /* Cross-origin frame. */ }
      });
    };
  }
}
