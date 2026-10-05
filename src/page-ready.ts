import { pageNetwork } from './network.js';
/** Wait for load, visible resources, host readiness and a quiet render window. */
export async function waitForPageReady(win: Window, signal?: AbortSignal, quietMs = 400): Promise<void> {
  const deadline = Date.now() + 30000;
  const doc = win.document;
  let changed = Date.now();
  let resources = win.performance.getEntriesByType('resource').length;
  const observer = new MutationObserver(() => { changed = Date.now(); });
  observer.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true });
  try {
    const ready = win.sitewallReady;
    if (ready) {
      let complete = false, failed = false, failure: unknown;
      Promise.resolve().then(() => typeof ready === 'function' ? ready() : ready).then(() => { complete = true; }, error => { failure = error; failed = true; complete = true; });
      while (!complete && Date.now() < deadline) { signal?.throwIfAborted(); await new Promise(resolve => setTimeout(resolve, 50)); }
      if (!complete) throw new Error('Host readiness timed out after 30 seconds');
      if (failed) throw failure ?? new Error('Host readiness rejected');
    }
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (win.document !== doc) throw new Error('Page navigated while waiting for readiness');
      const current = win.performance.getEntriesByType('resource').length;
      if (resources !== current) { resources = current; changed = Date.now(); }
      const imagesReady = [...doc.images].every(image => {
        const rect = image.getBoundingClientRect();
        return image.complete || rect.bottom <= 0 || rect.top >= win.innerHeight || !rect.width || !rect.height;
      });
      const network = pageNetwork(win);
      if (doc.readyState === 'complete' && doc.fonts.status === 'loaded' && imagesReady && !doc.querySelector('[aria-busy="true"], [data-sitewall-loading="true"]') && (!network || (network.pending === 0 && Date.now() - network.changed >= quietMs)) && Date.now() - changed >= quietMs) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Page did not finish loading and settle within 30 seconds');
  } finally { observer.disconnect(); }
}
