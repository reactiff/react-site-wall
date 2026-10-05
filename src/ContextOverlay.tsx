import { useEffect, useRef, useState } from 'react';
import { elementSelector } from './selection.js';
import type { SiteWallAPI, WallState, SelectionRectangle } from './types.js';

export function ContextOverlay({ id, api, state, frame, onError }: { id: string; api: SiteWallAPI; state: WallState; frame?: HTMLIFrameElement; onError: (message: string) => void }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<SelectionRectangle | null>(null);
  useEffect(() => { start.current = null; setDraft(null); }, [state.selectionMode]);
  let win = frame?.contentWindow ?? null;
  try { void win?.document; } catch { win = null; }
  const selected = state.selection?.panelId === id ? state.selection : null;
  const rectangle = draft ?? (selected ? { ...selected.rectangle, x: selected.rectangle.x - (win?.scrollX ?? selected.scroll.x), y: selected.rectangle.y - (win?.scrollY ?? selected.scroll.y) } : null);
  const picking = state.selectionMode !== 'none';
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(state.viewport.width, (event.clientX - bounds.left) / state.zoom)), y: Math.max(0, Math.min(state.viewport.height, (event.clientY - bounds.top) / state.zoom)) };
  };
  return <div className={`sw-context-overlay ${picking ? 'sw-picking' : ''}`} aria-label={`Select context in ${id}`} onPointerDown={event => {
    if (!picking || event.button !== 0) return;
    if (!win) { onError('This page is unavailable for context selection'); return; }
    event.preventDefault(); event.stopPropagation();
    const position = point(event);
    if (state.selectionMode === 'element') {
      const element = win.document.elementFromPoint(position.x, position.y);
      if (element) void api.selectElement(elementSelector(element), id).catch(error => onError(String(error)));
    } else {
      start.current = position; setDraft({ ...position, width: 0, height: 0 }); event.currentTarget.setPointerCapture(event.pointerId);
    }
  }} onPointerMove={event => {
    if (!start.current) return;
    const position = point(event);
    setDraft({ x: Math.min(position.x, start.current.x), y: Math.min(position.y, start.current.y), width: Math.abs(position.x - start.current.x), height: Math.abs(position.y - start.current.y) });
  }} onPointerUp={event => {
    if (!start.current || !win) return;
    const position = point(event), origin = start.current;
    const rect = { x: Math.min(position.x, origin.x) + win.scrollX, y: Math.min(position.y, origin.y) + win.scrollY, width: Math.abs(position.x - origin.x), height: Math.abs(position.y - origin.y) };
    start.current = null; setDraft(null);
    if (rect.width >= 1 && rect.height >= 1) void api.selectRegion(rect, id).catch(error => onError(String(error)));
  }} onPointerCancel={() => { start.current = null; setDraft(null); }}>
    {rectangle && <div className="sw-selection-box" style={{ left: rectangle.x, top: rectangle.y, width: rectangle.width, height: rectangle.height }}><span>{selected?.kind ?? 'Region'} · {Math.round(rectangle.width)} × {Math.round(rectangle.height)}</span></div>}
  </div>;
}
