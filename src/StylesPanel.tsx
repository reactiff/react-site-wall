import { useEffect, useRef, useState } from 'react';
import type { SiteWallAPI, Stylesheet, StylesheetAdapter } from './types.js';

export function StylesPanel({ adapter, subscribe }: { adapter: StylesheetAdapter; subscribe: SiteWallAPI['subscribe'] }) {
  const [ids, setIds] = useState<string[]>([]);
  const [file, setFile] = useState<Stylesheet | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('Choose a stylesheet');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const currentFile = useRef(file);
  const currentDraft = useRef(draft);
  currentFile.current = file;
  currentDraft.current = draft;
  useEffect(() => subscribe(event => {
    const selected = currentFile.current;
    if (event.type !== 'stylesheet' || !selected || (event.detail as { id: string }).id !== selected.id || busy.current) return;
    if (currentDraft.current !== selected.content) { setStatus('Changed externally. Reopen from disk to merge your draft.'); return; }
    const current = generation.current;
    adapter.read(selected.id).then(saved => {
      if (generation.current === current && currentDraft.current === selected.content) {
        setFile(saved); setDraft(saved.content); setStatus('Saved');
      }
    }).catch(error => { if (generation.current === current) setStatus(String(error)); });
  }), [adapter, subscribe]);
  useEffect(() => {
    let active = true;
    adapter.list().then(value => { if (active) setIds(value); }).catch(error => { if (active) setStatus(String(error)); });
    return () => { active = false; generation.current++; };
  }, [adapter]);
  async function open(id: string) {
    const current = ++generation.current;
    setFile(null); setStatus('Loading…');
    try {
      const next = await adapter.read(id);
      if (generation.current === current) { setFile(next); setDraft(next.content); setStatus('Saved'); }
    } catch (error) { if (generation.current === current) setStatus(String(error)); }
  }
  useEffect(() => {
    if (!file || draft === file.content) return;
    const current = generation.current;
    const timer = setTimeout(async () => {
      if (busy.current) { setRetry(value => value + 1); return; }
      busy.current = true;
      setStatus('Saving…');
      try {
        const saved = await adapter.save({ ...file, content: draft });
        if (generation.current === current) { setFile(saved); setStatus('Saved'); }
      } catch (error) { if (generation.current === current) setStatus(String(error)); }
      finally { busy.current = false; }
    }, 500);
    return () => clearTimeout(timer);
  }, [adapter, file, draft, retry]);
  return <>
    <h2>Application styles</h2>
    <select aria-label="Stylesheet" disabled={!!file && draft !== file.content} defaultValue="" onChange={event => void open(event.target.value)}>
      <option value="" disabled>Select stylesheet</option>
      {ids.map(id => <option key={id} value={id}>{id}</option>)}
    </select>
    {file ? <><button onClick={() => void open(file.id)}>Reopen from disk</button><textarea className="sw-editor" aria-label="Stylesheet content" spellCheck={false} value={draft} onChange={event => { setDraft(event.target.value); setStatus('Unsaved'); }} /></> : <p>Connect the development stylesheet server or supply a stylesheet adapter.</p>}
    <p role="status" className="sw-status">{status}</p>
  </>;
}
