import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { ReferenceAsset, ReferenceMetadata } from './types.js';
import { REFERENCE_COUNT_LIMIT, REFERENCE_FILE_LIMIT, REFERENCE_TOTAL_LIMIT } from './references.js';

export interface PreparedReference extends ReferenceMetadata { path: string }
export interface PromptExecutionAttachments { references: PreparedReference[]; tags: string[] }

/** Invocation-local files for an executor; browser assets remain the session authority. */
export class ReferenceWorkspace {
  private directory?: string;
  private files = new Map<string, { digest: string; reference: PreparedReference }>();
  private bytes = 0;
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  prepare(references: ReferenceAsset[] = []): Promise<PreparedReference[]> {
    if (this.closed) return Promise.reject(new Error('Reference workspace has ended'));
    const work = this.pending.then(() => this.prepareAssets(references));
    this.pending = work.then(() => {}, () => {}); return work;
  }
  private async prepareAssets(references: ReferenceAsset[]): Promise<PreparedReference[]> {
    if (!Array.isArray(references) || references.length > REFERENCE_COUNT_LIMIT) throw new Error('Invalid reference list');
    const ids = new Set<string>();
    const prepared: PreparedReference[] = [];
    for (const asset of references) {
      if (!asset || typeof asset.id !== 'string' || !/^[\w-]{1,128}$/.test(asset.id) || ids.has(asset.id) || typeof asset.name !== 'string' || asset.name.length > 255 || !['image', 'file', 'area'].includes(asset.kind) || typeof asset.mimeType !== 'string' || typeof asset.dataUrl !== 'string') throw new Error('Invalid reference metadata');
      ids.add(asset.id);
      const match = /^data:([\w.+/-]*)(?:;charset=[\w-]+)?;base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl);
      if (!match || match[2].length % 4 !== 0) throw new Error('Reference must contain base64 file data');
      if ((match[1] || 'application/octet-stream') !== asset.mimeType) throw new Error('Reference MIME type does not match its data');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.toString('base64') !== match[2] || bytes.length !== asset.size || bytes.length > REFERENCE_FILE_LIMIT) throw new Error('Invalid reference size or encoding');
      if (asset.kind !== 'file' && (match[1] !== 'image/png' || asset.mimeType !== 'image/png' || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))) throw new Error('Image and area references must be PNG');
      const previous = this.files.get(asset.id);
      if (previous) {
        if (previous.digest !== asset.dataUrl) throw new Error('Reference content changed for an existing id');
        prepared.push({ ...previous.reference }); continue;
      }
      if (this.files.size >= REFERENCE_COUNT_LIMIT || this.bytes + bytes.length > REFERENCE_TOTAL_LIMIT) throw new Error('Reference request exceeds 50 files or 32 MiB');
      this.directory ??= await mkdtemp(join(tmpdir(), 'sitewall-references-'));
      const extension = asset.kind !== 'file' ? '.png' : /^\.[A-Za-z0-9]{1,12}$/.test(extname(asset.name)) ? extname(asset.name) : '.bin';
      const path = join(this.directory, `${asset.id}${extension}`);
      await writeFile(path, bytes, { flag: 'wx' });
      const { dataUrl: _data, ...metadata } = asset;
      const reference: PreparedReference = { ...metadata, path };
      this.files.set(asset.id, { digest: asset.dataUrl, reference }); this.bytes += bytes.length; prepared.push(reference);
    }
    return prepared;
  }
  async dispose() {
    this.closed = true; await this.pending;
    if (!this.directory) return;
    const target = resolve(this.directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('sitewall-references-')) throw new Error('Temporary reference directory is outside its workspace');
    await rm(target, { recursive: true, force: true }); this.directory = undefined; this.files.clear(); this.bytes = 0;
  }
}
