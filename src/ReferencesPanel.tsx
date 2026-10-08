import { useEffect, useRef, useState } from 'react';
import type { ReferenceAsset, SiteWallAPI } from './types.js';

export function useReferences(api: SiteWallAPI) {
  const [snapshot, setSnapshot] = useState(() => api.references.snapshot());
  useEffect(() => {
    const update = () => setSnapshot(api.references.snapshot());
    const unsubscribe = api.references.subscribe(update); update(); return unsubscribe;
  }, [api]);
  return snapshot;
}
export async function importReferenceFiles(api: SiteWallAPI, files: File[], report: (message: string) => void) {
  const failures: string[] = [];
  for (const file of files) {
    try { await api.references.addFile(file); }
    catch (error) { if ((error as Error)?.name !== 'AbortError') failures.push(`${file.name || 'Pasted image'}: ${(error as Error).message}`); }
  }
  report(failures.join('\n'));
}
function ReferenceItem({ asset, selected, api }: { asset: ReferenceAsset; selected: boolean; api: SiteWallAPI }) {
  return <div className={`sw-reference-item ${selected ? 'sw-reference-selected' : ''}`}>
    <label>
      <input type="checkbox" aria-label={`Use ${asset.name}`} checked={selected} onChange={event => api.references.select(asset.id, event.target.checked)} />
      {asset.kind === 'file' ? <span className="sw-reference-icon" aria-hidden="true">▤</span> : <img src={asset.dataUrl} alt={asset.name} />}
      <span className="sw-reference-details"><strong title={asset.name}>{asset.name}</strong><small>{asset.kind === 'area' ? `@${asset.alias} · ${asset.context?.route}` : asset.mimeType}</small></span>
    </label>
    <button aria-label={`Remove ${asset.name}`} onClick={() => api.references.remove(asset.id)}>×</button>
  </div>;
}
export function ReferencesPanel({ api, width, open, close, picking }: { api: SiteWallAPI; width: number; open: boolean; close: () => void; picking: boolean }) {
  const { assets, selected, pending } = useReferences(api);
  const picker = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const add = (files: File[]) => { void importReferenceFiles(api, files, setError); };
  return <aside className={`sw-references ${dragging ? 'sw-reference-dragging' : ''}`} style={{ width, display: open ? 'flex' : 'none' }} aria-label="References panel"
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); event.stopPropagation(); setDragging(false); add([...event.dataTransfer.files]); }}
    onPaste={event => { if (!event.clipboardData.files.length) return; event.preventDefault(); event.stopPropagation(); add([...event.clipboardData.files]); }}>
    <div className="sw-references-toolbar" role="toolbar" aria-label="Reference controls"><strong>References</strong>
      <button onClick={() => picker.current?.click()}>Add files</button><button disabled={!assets.length} onClick={() => api.references.clear()}>Clear References</button>
      <button aria-label="Collapse References" onClick={close}>×</button>
      <input ref={picker} type="file" multiple hidden aria-label="Add reference files" onChange={event => { add([...event.target.files ?? []]); event.target.value = ''; }} />
    </div>
    <div className="sw-references-assets">{assets.map(asset => <ReferenceItem key={asset.id} asset={asset} selected={selected.includes(asset.id)} api={api} />)}
      {!assets.length && <p className="sw-references-empty">Paste or drop images and files here, or capture areas from any page.</p>}
    </div>
    <div className="sw-references-footer"><button aria-label="Capture area references" aria-pressed={picking} onClick={() => api.setSelectionMode(api.getState().selectionMode === 'region' ? 'none' : 'region')}>{picking ? 'Done capturing' : 'Capture areas'}</button><span>{pending ? `Loading ${pending}…` : `${selected.length} selected`}</span></div>
    {error && <p className="sw-reference-error" role="alert">{error}</p>}
  </aside>;
}
