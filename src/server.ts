import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface StylesheetServerOptions {
  enabled: boolean;
  root: string;
  /** Explicit source-file allowlist; ids are relative to root. */
  files: string[];
  token: string;
  /** Exact development origin, e.g. http://localhost:3000. */
  origin: string;
  endpoint?: string;
}
export function createStylesheetMiddleware(options: StylesheetServerOptions) {
  if (options.enabled && options.token.length < 24) throw new Error('Use a random development token of at least 24 characters');
  const files = new Set(options.files);
  const endpoint = options.endpoint ?? '/__sitewall/styles';
  let queue: Promise<unknown> = Promise.resolve();
  const revision = (content: string) => createHash('sha256').update(content).digest('hex');
  async function pathFor(id: string) {
    if (!files.has(id) || !/\.css$/i.test(id)) throw new Error('Stylesheet is not allowlisted');
    const root = await realpath(options.root);
    const path = await realpath(resolve(root, id));
    const rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Stylesheet escapes project root');
    return path;
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const respond = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (!options.enabled) return respond(404, { error: 'Disabled' });
    const token = req.headers['x-sitewall-token'];
    if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(options.token) || !timingSafeEqual(Buffer.from(token), Buffer.from(options.token))) return respond(403, { error: 'Forbidden' });
    const origin = new URL(options.origin);
    if (req.headers.host !== origin.host || (req.headers.origin && req.headers.origin !== origin.origin) || req.headers['sec-fetch-site'] === 'cross-site') return respond(403, { error: 'Origin rejected' });
    const id = new URL(req.url!, options.origin).searchParams.get('id');
    try {
      if (req.method === 'GET' && !id) return respond(200, [...files]);
      if (!id) return respond(400, { error: 'Missing stylesheet id' });
      const path = await pathFor(id);
      const content = await readFile(path, 'utf8');
      if (req.method === 'GET') return respond(200, { id, content, revision: revision(content) });
      if (req.method !== 'PUT') return respond(405, { error: 'Method not allowed' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > 1024 * 1024) return respond(413, { error: 'Stylesheet exceeds 1 MiB' });
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(body) as { content?: unknown; revision?: unknown };
      if (typeof data.content !== 'string' || typeof data.revision !== 'string') return respond(400, { error: 'Expected content and revision' });
      if (data.revision !== revision(content)) return respond(409, { error: 'Stylesheet changed on disk. Reopen before saving.' });
      await writeFile(path, data.content, 'utf8');
      respond(200, { id, content: data.content, revision: revision(data.content) });
    } catch (error) { respond(400, { error: error instanceof Error ? error.message : 'Stylesheet operation failed' }); }
  }
  return (req: IncomingMessage, res: ServerResponse, next: () => void = () => { res.writeHead(404); res.end(); }): void => {
    if (req.url?.split('?')[0] !== endpoint) return next();
    // Serialize writes and revision reads to make optimistic concurrency reliable.
    queue = queue.then(() => handle(req, res)).catch(() => { if (!res.writableEnded) { res.writeHead(500); res.end(); } });
  };
}
