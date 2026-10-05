import type { PageObservation, SharedStateAdapter } from './types.js';

export interface PageBridge {
  location(): string;
  navigate(path: string): void;
  inspect(): PageObservation;
  click(selector: string): void;
  type(selector: string, value: string): void;
  scroll(x: number, y: number): void;
  shared?: SharedStateAdapter;
  dispose(): void;
}
const key = '__reactSiteWallBridge';
type BridgeWindow = Window & { __reactSiteWallBridge?: PageBridge };
export function getPageBridge(win: Window): PageBridge {
  const bridge = (win as BridgeWindow)[key];
  if (!bridge) throw new Error('Host page has no SiteWall bridge. Install it before rendering the application.');
  return bridge;
}
export function installSiteWallBridge(options: { enabled: boolean; sharedState?: SharedStateAdapter; navigate?: (path: string) => void }): () => void {
  if (!options.enabled || typeof window === 'undefined' || window.parent === window) return () => {};
  const win = window as BridgeWindow;
  if (win[key]) return () => {};
  let applying = false;
  let disposed = false;
  const report = (type: string, detail: unknown) => {
    try {
      if (win.parent.location.origin !== win.location.origin) return;
      win.parent.dispatchEvent(new CustomEvent('sitewall:page', { detail: { source: win, type, detail } }));
    } catch { /* Cross-origin pages cannot expose application internals. */ }
  };
  const location = () => win.location.pathname + win.location.search + win.location.hash;
  const navigation = () => { if (!applying) report('navigation', { path: location() }); };
  const push = win.history.pushState;
  const replace = win.history.replaceState;
  win.history.pushState = function (...args) { push.apply(this, args); navigation(); };
  win.history.replaceState = function (...args) { replace.apply(this, args); navigation(); };
  win.addEventListener('popstate', navigation);
  win.addEventListener('hashchange', navigation);
  const error = (event: ErrorEvent) => report('error', { message: event.message });
  const rejection = (event: PromiseRejectionEvent) => report('error', { message: String(event.reason) });
  win.addEventListener('error', error);
  win.addEventListener('unhandledrejection', rejection);
  const element = (selector: string): HTMLElement => {
    const matches = win.document.querySelectorAll<HTMLElement>(selector);
    if (matches.length !== 1) throw new Error(`Selector must identify one control; found ${matches.length}: ${selector}`);
    const target = matches[0];
    const style = win.getComputedStyle(target);
    if (!target.getClientRects().length || style.visibility !== 'visible' || target.closest('[inert]') || ('disabled' in target && target.disabled)) throw new Error('Control is hidden or disabled');
    return target;
  };
  const unsubscribe = options.sharedState?.subscribe(() => {
    if (!applying) report('shared-state', options.sharedState!.read());
  });
  const clickLink = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, win.location.href);
    // Keep the development wall intact even for target=_top and external links.
    event.preventDefault();
    if (url.origin !== win.location.origin) report('external-navigation', { url: url.href });
    else report('navigation', { path: url.pathname + url.search + url.hash });
  };
  // Observe after React/root handlers, preserving application link side effects.
  win.document.addEventListener('click', clickLink);
  const shared = options.sharedState ? {
    read: () => options.sharedState!.read(),
    subscribe: options.sharedState.subscribe,
    async apply(state: unknown) {
      applying = true;
      try { await options.sharedState!.apply(state); } finally { applying = false; }
    },
  } : undefined;
  const bridge: PageBridge = {
    shared,
    location,
    navigate(path) {
      applying = true;
      try {
        if (options.navigate) options.navigate(path);
        else { replace.call(win.history, null, '', path); win.dispatchEvent(new PopStateEvent('popstate')); }
      } finally { applying = false; }
    },
    inspect() {
      return {
        route: location(), title: win.document.title, text: win.document.body.innerText,
        controls: [...win.document.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[role="button"]')].map(el => ({ tag: el.tagName.toLowerCase(), text: el.innerText || el.getAttribute('aria-label') || '', name: el.getAttribute('name') || el.id, type: el.getAttribute('type') || '' })),
        viewport: { width: win.innerWidth, height: win.innerHeight },
        scroll: { x: win.scrollX, y: win.scrollY, height: win.document.documentElement.scrollHeight },
      };
    },
    click(selector) { element(selector).click(); },
    type(selector, value) {
      const target = element(selector);
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) throw new Error('Control does not accept text');
      const prototype = target instanceof HTMLInputElement ? HTMLInputElement.prototype : target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(target, value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
    },
    scroll(x, y) { win.scrollTo({ left: x, top: y, behavior: 'instant' }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe?.();
      win.history.pushState = push; win.history.replaceState = replace;
      win.removeEventListener('popstate', navigation); win.removeEventListener('hashchange', navigation);
      win.removeEventListener('error', error); win.removeEventListener('unhandledrejection', rejection);
      win.document.removeEventListener('click', clickLink);
      delete win[key];
    },
  };
  win[key] = bridge;
  report('ready', { path: location(), shared: !!shared });
  return bridge.dispose;
}
