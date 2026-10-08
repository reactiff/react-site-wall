import type { ContextSelection, ReferenceAsset, ReferenceMetadata, ReferencesAPI, ReferencesSnapshot, SelectionRectangle } from './types.js';

export const REFERENCE_FILE_LIMIT = 20 * 1024 * 1024;
export const REFERENCE_TOTAL_LIMIT = 32 * 1024 * 1024;
export const REFERENCE_COUNT_LIMIT = 50;

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read reference')); reader.readAsDataURL(blob);
  });
}
/** Normalize raster images to PNG so browser thumbnails and CLI attachments agree. */
async function raster(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 32 * 1024 * 1024) throw new Error('Reference image is too large to render');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image rendering is unavailable');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not read image')), 'image/png'));
  } finally { bitmap.close(); }
}

/** Assets and selections have independent lifetimes; both stay outside persistent wall state. */
export class ReferenceStore implements ReferencesAPI {
  private assets: ReferenceAsset[] = [];
  private selected = new Set<string>();
  private listeners = new Set<() => void>();
  private areaNumber = 0;
  private generation = 0;
  private selectionGeneration = 0;
  private pending = new Set<Promise<ReferenceAsset>>();
  constructor(private capture: (rectangle: SelectionRectangle, id?: string) => Promise<{ context: ContextSelection; image: string }>) {}
  snapshot = (): ReferencesSnapshot => structuredClone({ assets: this.assets, selected: [...this.selected], ...(this.pending.size ? { pending: this.pending.size } : {}) });
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.listeners.forEach(listener => listener()); }
  private add(asset: ReferenceAsset, select = true): ReferenceAsset {
    if (asset.size > REFERENCE_FILE_LIMIT) throw new Error('Each reference must be at most 20 MiB');
    if (this.assets.length >= REFERENCE_COUNT_LIMIT || this.assets.reduce((sum, item) => sum + item.size, 0) + asset.size > REFERENCE_TOTAL_LIMIT) throw new Error('References hold up to 50 assets and 32 MiB; remove an asset to add more');
    this.assets.push(asset); if (select) this.selected.add(asset.id); this.notify(); return structuredClone(asset);
  }
  private track(work: Promise<ReferenceAsset>): Promise<ReferenceAsset> {
    const done = work.finally(() => { this.pending.delete(done); this.notify(); });
    this.pending.add(done); this.notify(); return done;
  }
  whenReady = async () => { while (this.pending.size) await Promise.all([...this.pending]); };
  addFile = (file: File): Promise<ReferenceAsset> => this.track(this.importFile(file));
  private async importFile(file: File): Promise<ReferenceAsset> {
    if (file.size > REFERENCE_FILE_LIMIT) throw new Error('Each reference must be at most 20 MiB');
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    const image = (file.type.startsWith('image/') && file.type !== 'image/svg+xml') || (!file.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name));
    const blob = image ? await raster(file) : file;
    const bytes = await dataUrl(blob);
    if (generation !== this.generation) throw new DOMException('References were cleared', 'AbortError');
    return this.add({ id: crypto.randomUUID(), name: file.name || 'Pasted image.png', kind: image ? 'image' : 'file', mimeType: blob.type || 'application/octet-stream', size: blob.size, createdAt: Date.now(), dataUrl: bytes }, selectionGeneration === this.selectionGeneration);
  }
  captureArea = (rectangle: SelectionRectangle, id?: string): Promise<ReferenceAsset> => this.track(this.captureReference(rectangle, id));
  private async captureReference(rectangle: SelectionRectangle, id?: string): Promise<ReferenceAsset> {
    const generation = this.generation;
    const selectionGeneration = this.selectionGeneration;
    const { context, image } = await this.capture(rectangle, id);
    if (generation !== this.generation) throw new DOMException('References were cleared', 'AbortError');
    const number = ++this.areaNumber;
    const encoded = image.slice(image.indexOf(',') + 1);
    const size = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    return this.add({ id: crypto.randomUUID(), name: `Area ${number}`, alias: `Area${number}`, kind: 'area', mimeType: 'image/png', size, createdAt: Date.now(), dataUrl: image, context: structuredClone(context) }, selectionGeneration === this.selectionGeneration);
  }
  list = (): ReferenceMetadata[] => this.assets.map(({ dataUrl: _bytes, ...metadata }) => structuredClone(metadata));
  read = (id: string): ReferenceAsset => { const asset = this.assets.find(item => item.id === id); if (!asset) throw new Error('Reference not found'); return structuredClone(asset); };
  select = (id: string, selected: boolean) => { this.read(id); if (selected) this.selected.add(id); else this.selected.delete(id); this.notify(); };
  forPrompt = (instruction = ''): ReferenceAsset[] => {
    const mentions = new Set([...instruction.matchAll(/@([A-Za-z][A-Za-z0-9]*)\b/g)].map(match => match[1].toLowerCase()));
    return structuredClone(this.assets.filter(asset => this.selected.has(asset.id) || (asset.alias && mentions.has(asset.alias.toLowerCase()))));
  };
  clearSelection = (ids?: string[]) => { if (ids) ids.forEach(id => this.selected.delete(id)); else { this.selectionGeneration++; this.selected.clear(); } this.notify(); };
  remove = (id: string) => { this.assets = this.assets.filter(asset => asset.id !== id); this.selected.delete(id); this.notify(); };
  clear = () => { this.generation++; this.assets = []; this.selected.clear(); this.notify(); };
}
