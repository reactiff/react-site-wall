import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { PageCapture, SavedPageCapture } from './types.js';

export function captureFilename(route: string): string {
  const [pathname] = route.split(/[?#]/);
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = pathname; }
  let stem = decoded.replace(/^\/+|\/+$/g, '').replace(/[/\\]+/g, '-').replace(/[<>:"|?*\x00-\x1f\x7f]/g, '-').replace(/[. ]+$/g, '') || 'home';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  if (stem === '.' || stem === '..') stem = 'home';
  // Bound filename bytes, including suffix/extension; query/hash routes remain distinct.
  let short = '';
  for (const character of stem) { if (Buffer.byteLength(short + character) > 160) break; short += character; }
  const suffix = pathname !== route || short !== stem ? '-' + createHash('sha256').update(route).digest('hex').slice(0, 12) : '';
  return short + suffix + '.png';
}

export async function savePageCaptures(outputDir: string, captures: PageCapture[], root = process.cwd()): Promise<SavedPageCapture[]> {
  if (typeof outputDir !== 'string' || !outputDir.trim()) throw new Error('outputDir must be a nonempty directory path');
  const directory = resolve(root, outputDir);
  const used = new Set<string>();
  const results: SavedPageCapture[] = [];
  for (const capture of captures) {
    let filename = captureFilename(capture.route);
    // Distinct routes can normalize to the same case-insensitive filename.
    if (used.has(filename.toLowerCase())) filename = filename.slice(0, -4) + '-' + createHash('sha256').update(capture.route + '\0' + capture.id).digest('hex').slice(0, 12) + '.png';
    if (used.has(filename.toLowerCase())) throw new Error(`Duplicate capture for route ${capture.route}: ${join(directory, filename)}`);
    used.add(filename.toLowerCase());
    const path = join(directory, filename);
    try {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(capture.image);
      if (!match || match[1].length % 4 !== 0) throw new Error('Expected a base64 PNG data URL');
      const png = Buffer.from(match[1], 'base64');
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG signature');
      await mkdir(directory, { recursive: true });
      await writeFile(path, png);
      results.push({ id: capture.id, route: capture.route, path });
    } catch (error) { throw new Error(`Could not save route ${capture.route} to ${path}: ${String(error)}`, { cause: error }); }
  }
  if (!captures.length) await mkdir(directory, { recursive: true });
  return results;
}
