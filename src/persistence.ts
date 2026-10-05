import { useEffect, useState } from 'react';
import { sanitizeContext } from './selection.js';
const pending = new Map<string, () => unknown>();
let timer: ReturnType<typeof setTimeout> | undefined;
const storageKey = (scope: string, key: string) => `react-site-wall:v1:${scope}:${key}`;
export function readPersistent<T>(scope: string, key: string): T | undefined {
  try { if (typeof localStorage !== 'undefined') { const value = localStorage.getItem(storageKey(scope, key)); if (value) return JSON.parse(value) as T; } } catch { /* Disabled, expired or full storage. */ }
  return undefined;
}
function flush() {
  clearTimeout(timer); timer = undefined;
  for (const [key, value] of pending) { try { localStorage.setItem(key, JSON.stringify(sanitizeContext(value()))); } catch { /* Keep the live session usable when storage is unavailable. */ } }
  pending.clear();
}
export function writePersistent(scope: string, key: string, value: () => unknown): void {
  if (typeof window === 'undefined') return;
  pending.set(storageKey(scope, key), value);
  clearTimeout(timer);
  timer = setTimeout(() => { if ('requestIdleCallback' in window) window.requestIdleCallback(flush, { timeout: 2000 }); else flush(); }, 250);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
export function usePersistentState<T>(scope: string, key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readPersistent<T>(scope, key) ?? fallback);
  useEffect(() => { writePersistent(scope, key, () => value); }, [scope, key, value]);
  return [value, setValue] as const;
}
