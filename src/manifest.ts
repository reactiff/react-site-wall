import type { RouteManifest } from './types.js';

export function normalizePath(path: string, origin = 'http://sitewall.local'): string {
  const url = new URL(path, origin);
  if (url.origin !== new URL(origin).origin || !path.startsWith('/') || path.startsWith('//')) {
    throw new Error('SiteWall routes must be same-origin absolute paths');
  }
  return url.pathname + url.search + url.hash;
}
export function validateManifest(input: unknown, wallPath = '/sitewall'): RouteManifest {
  if (!input || typeof input !== 'object') throw new Error('Invalid route manifest');
  const manifest = structuredClone(input) as RouteManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.routes)) throw new Error('Expected manifest version 1 and routes array');
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const route of manifest.routes) {
    if (!route || typeof route.id !== 'string' || !route.id || typeof route.title !== 'string' || !route.title || typeof route.path !== 'string') throw new Error('Each route needs an id, title, and concrete path');
    const path = normalizePath(route.path);
    if (path.split(/[?#]/)[0].replace(/\/$/, '') === wallPath.replace(/\/$/, '') || /(^|\/)[:*]/.test(path)) throw new Error(`Resolve concrete routes and exclude the wall: ${path}`);
    if (ids.has(route.id) || paths.has(path)) throw new Error(`Duplicate route: ${route.id}`);
    ids.add(route.id); paths.add(path);
    route.path = path;
  }
  return manifest;
}
