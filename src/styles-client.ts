import type { Stylesheet, StylesheetAdapter } from './types.js';
export function createStylesheetClient(options: { endpoint?: string; token: string }): StylesheetAdapter {
  const endpoint = options.endpoint ?? '/__sitewall/styles';
  async function request<T>(suffix: string, init?: RequestInit): Promise<T> {
    const response = await fetch(endpoint + suffix, { ...init, headers: { 'Content-Type': 'application/json', 'X-SiteWall-Token': options.token }, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Stylesheet request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  return {
    list: () => request<string[]>(''),
    read: id => request<Stylesheet>('?id=' + encodeURIComponent(id)),
    save: file => request<Stylesheet>('?id=' + encodeURIComponent(file.id), { method: 'PUT', body: JSON.stringify(file) }),
  };
}
