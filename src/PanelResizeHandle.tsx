import { useEffect, useRef } from 'react';

/** Shared resize behavior for right-side workspace panels. */
export function PanelResizeHandle({ width, onResize, label }: { width: number; onResize: (width: number) => void; label: string }) {
  const resize = useRef<{ x: number; width: number; current: number; panel: HTMLElement; frame: number } | null>(null);
  useEffect(() => () => { if (resize.current) cancelAnimationFrame(resize.current.frame); }, []);
  const finish = () => {
    const value = resize.current; if (!value) return;
    cancelAnimationFrame(value.frame); resize.current = null;
    onResize(value.current);
  };
  return <div className="sw-styles-resizer" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={200} aria-valuemax={1200} aria-valuenow={width} tabIndex={0} onKeyDown={event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); onResize(Math.max(200, Math.min(1200, width + (event.key === 'ArrowLeft' ? 16 : -16))));
  }} onPointerDown={event => {
    if (event.button !== 0) return;
    const panel = event.currentTarget.nextElementSibling as HTMLElement;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    resize.current = { x: event.clientX, width, current: width, panel, frame: 0 };
  }} onPointerMove={event => {
    const value = resize.current; if (!value) return;
    value.current = Math.max(200, Math.min(1200, window.innerWidth - 100, value.width + value.x - event.clientX));
    if (!value.frame) value.frame = requestAnimationFrame(() => { value.frame = 0; value.panel.style.width = `${value.current}px`; });
  }} onPointerUp={finish} onPointerCancel={finish} />;
}
