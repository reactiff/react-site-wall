const key = Symbol.for('sitewall:network');
export interface PageNetwork { pending: number; changed: number }
type NetworkWindow = Window & { [key]?: PageNetwork; XMLHttpRequest: typeof XMLHttpRequest };
export function pageNetwork(win: Window): PageNetwork | undefined { return (win as NetworkWindow)[key]; }

/** Development bridge instrumentation; original request promises and responses survive. */
export function observePageNetwork(win: Window): () => void {
  const target = win as NetworkWindow;
  if (target[key]) return () => {};
  const state: PageNetwork = { pending: 0, changed: Date.now() };
  target[key] = state;
  const begin = () => {
    state.pending++; state.changed = Date.now();
    let ended = false;
    return () => { if (!ended) { ended = true; state.pending--; state.changed = Date.now(); } };
  };
  const originalFetch = win.fetch;
  const fetch: typeof win.fetch = function (this: Window, ...args) {
    const end = begin();
    let request: ReturnType<typeof win.fetch>;
    try { request = originalFetch.apply(this, args); } catch (error) { end(); throw error; }
    void request.then(async response => {
      // Fetch resolves at response headers. Drain a clone to observe body completion
      // without replacing or consuming the response returned to the host.
      try {
        const reader = response.clone().body?.getReader();
        if (reader) { while (!(await reader.read()).done) { /* Discard observation chunks. */ } }
      } catch { /* Failed or already consumed body is settled. */ }
      finally { end(); }
    }, end);
    return request;
  };
  win.fetch = fetch;
  const prototype = target.XMLHttpRequest.prototype;
  const originalSend = prototype.send;
  const send: typeof prototype.send = function (this: XMLHttpRequest, ...args) {
    const end = begin();
    this.addEventListener('loadend', end, { once: true });
    try { return originalSend.apply(this, args); }
    catch (error) { this.removeEventListener('loadend', end); end(); throw error; }
  };
  prototype.send = send;
  return () => {
    if (win.fetch === fetch) win.fetch = originalFetch;
    if (prototype.send === send) prototype.send = originalSend;
    delete target[key];
  };
}
