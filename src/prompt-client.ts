import type { PromptAdapter, PromptResult } from './types.js';
export function createPromptClient(options: { token: string; endpoint?: string; sessionEndpoint?: string }): PromptAdapter {
  const headers = { 'Content-Type': 'application/json', 'X-SiteWall-Token': options.token };
  let sessionId = '';
  if (typeof window !== 'undefined') {
    const key = `sitewall-session:${options.sessionEndpoint ?? '/__sitewall/session'}`;
    try { sessionId = sessionStorage.getItem(key) ?? crypto.randomUUID(); sessionStorage.setItem(key, sessionId); }
    catch { sessionId = crypto.randomUUID(); }
  }
  return { async cancel() {
    const response = await fetch(options.endpoint ?? '/__sitewall/prompts', { method: 'DELETE', credentials: 'same-origin', headers, body: JSON.stringify({ sessionId }) });
    if (!response.ok) throw new Error(`Could not stop Codex (${response.status}): ${await response.text()}`);
  }, async saveCaptures(outputDir, captures) {
    const response = await fetch('/__sitewall/captures', {
      method: 'POST', credentials: 'same-origin', headers,
      body: JSON.stringify({ outputDir, captures }),
    });
    if (!response.ok) throw new Error(`Capture persistence failed (${response.status}): ${await response.text()}`);
    return (await response.json()).result;
  }, attach(api) {
    const abort = new AbortController();
    const endpoint = options.sessionEndpoint ?? '/__sitewall/session';
    const invoke = async (method: string, args: unknown[]) => {
      const parts = method.split('.');
      const target = parts.length === 2 && parts[0] === 'styles' ? api.styles : api;
      const name = parts.length === 2 ? parts[1] : parts[0];
      const allowed = ['getState', 'events', 'show', 'focus', 'navigate', 'configure', 'zoomAt', 'filterStyles', 'inspectStyles', 'setSelectionMode', 'selectElement', 'selectRegion', 'clearSelection', 'inspectSelection', 'promptContext', 'stopPrompt', 'inspect', 'click', 'type', 'scroll', 'capture', 'captureFullPage', 'captureAllPages', 'saveAllPages', 'styles.list', 'styles.read', 'styles.save'];
      if (!allowed.includes(method)) throw new Error('Unsupported session command');
      const fn = (target as unknown as Record<string, (...args: unknown[]) => unknown>)[name];
      return fn(...args);
    };
    void (async () => {
      while (!abort.signal.aborted) {
        try {
          const response = await fetch(`${endpoint}?poll=1&sessionId=${encodeURIComponent(sessionId)}`, { headers, credentials: 'same-origin', signal: abort.signal });
          if (!response.ok) throw new Error(`Agent session connection failed (${response.status})`);
          if (response.status === 204) continue;
          const command = await response.json() as { id: string; method: string; args: unknown[]; idle?: boolean };
          if (command.idle) continue;
          let result: unknown, error: string | undefined;
          try { result = await invoke(command.method, command.args); } catch (failure) { error = String(failure); }
          await fetch(endpoint, { method: 'PUT', headers, credentials: 'same-origin', signal: abort.signal, body: JSON.stringify({ id: command.id, sessionId, result, error }) });
        } catch (error) {
          if (abort.signal.aborted) break;
          // Keep working while a development server is temporarily restarting.
          await new Promise<void>(resolve => {
            const cancelled = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => { abort.signal.removeEventListener('abort', cancelled); resolve(); }, 2000);
            abort.signal.addEventListener('abort', cancelled, { once: true });
          });
        }
      }
    })();
    return () => abort.abort();
  }, async execute(instruction, context, request) {
    const response = await fetch(options.endpoint ?? '/__sitewall/prompts', { method: 'POST', credentials: 'same-origin', headers, signal: request?.signal, body: JSON.stringify({ instruction, context, sessionId }) });
    if (!response.ok) throw new Error(`Prompt request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<PromptResult>;
  } };
}
