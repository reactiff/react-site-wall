import { useEffect, type RefObject } from 'react';
import type { WallController } from './controller.js';
import type { WallRuntime } from './runtime.js';

/** Camera previews are painted once per frame; React receives the final camera. */
export function useCanvasControls(controller: WallController, runtime: WallRuntime, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const surface = ref.current!;
    let shift = false, control = false, direction = '', zoomAnimation = 0, panAnimation = 0;
    let targetZoom = controller.snapshot().zoom, previousTime = 0;
    let anchor = { x: 0, y: 0 };
    let drag: { x: number; y: number; panX: number; panY: number } | null = null;
    let pointer = { x: 0, y: 0 };
    const documents = new Map<Document, { cursor?: HTMLStyleElement; value: string }>();
    const paint = () => {
      const wall = surface.querySelector<HTMLElement>('.sw-wall');
      const { pan, zoom } = controller.snapshot();
      if (wall) wall.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    };
    const cursors = () => {
      const cursor = drag ? 'grabbing' : shift ? 'grab' : control || (zoomAnimation && direction) ? direction || 'zoom-in' : '';
      surface.classList.toggle('sw-shift-pan', shift || !!drag);
      surface.style.setProperty('--sw-camera-cursor', cursor || '');
      surface.classList.toggle('sw-camera-cursor', !!cursor);
      for (const [doc, entry] of documents) {
        if (entry.value === cursor) continue;
        entry.value = cursor;
        if (!cursor) { entry.cursor?.remove(); entry.cursor = undefined; continue; }
        const style = entry.cursor ?? doc.createElement('style');
        style.dataset.sitewallInternal = 'cursor';
        style.textContent = `html,body,body * { cursor: ${cursor} !important; }`;
        if (!entry.cursor) (doc.head ?? doc.documentElement).append(style);
        entry.cursor = style;
      }
    };
    const commit = () => {
      const { zoom, pan } = controller.snapshot();
      controller.configure({ zoom, pan });
    };
    const animateZoom = (time: number) => {
      const state = controller.snapshot();
      const amount = 1 - Math.exp(-Math.min(64, previousTime ? time - previousTime : 16) / 45);
      previousTime = time;
      let next = state.zoom + (targetZoom - state.zoom) * amount;
      const done = Math.abs(targetZoom - next) < .00001;
      if (done) next = targetZoom;
      const wall = surface.querySelector<HTMLElement>('.sw-wall');
      const origin = { x: anchor.x - (wall?.offsetLeft ?? 0), y: anchor.y - (wall?.offsetTop ?? 0) };
      controller.previewCamera(next, { x: origin.x - (origin.x - state.pan.x) * next / state.zoom, y: origin.y - (origin.y - state.pan.y) * next / state.zoom });
      paint();
      if (done) { zoomAnimation = 0; previousTime = 0; commit(); cursors(); }
      else zoomAnimation = requestAnimationFrame(animateZoom);
    };
    const zoomWheel = (delta: number, mode: number, origin: { x: number; y: number }) => {
      if (!delta || drag) return;
      const rawNotches = mode === 1 ? delta / 3 : mode === 2 ? delta : delta / 100;
      const notches = Math.abs(rawNotches) >= .5 ? Math.sign(rawNotches) * Math.max(1, Math.round(Math.abs(rawNotches))) : rawNotches;
      anchor = origin; direction = delta < 0 ? 'zoom-in' : 'zoom-out';
      targetZoom = Math.max(.1, Math.min(2, (zoomAnimation ? targetZoom : controller.snapshot().zoom) - notches * .01));
      if (!zoomAnimation) zoomAnimation = requestAnimationFrame(animateZoom);
      cursors();
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && (event.target as Element).closest('.sw-page')) return;
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      zoomWheel(event.deltaY, event.deltaMode, { x: event.clientX - bounds.left - surface.clientLeft + surface.scrollLeft, y: event.clientY - bounds.top - surface.clientTop + surface.scrollTop });
    };
    const paintPan = () => {
      panAnimation = 0;
      if (!drag) return;
      controller.previewCamera(controller.snapshot().zoom, { x: drag.panX + pointer.x - drag.x, y: drag.panY + pointer.y - drag.y });
      paint();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || (!event.shiftKey && (event.target as Element).closest('.sw-page'))) return;
      event.preventDefault(); event.stopPropagation();
      if (zoomAnimation) { cancelAnimationFrame(zoomAnimation); zoomAnimation = 0; previousTime = 0; commit(); }
      if (!event.shiftKey) runtime.api.clearSelection();
      const { pan } = controller.snapshot();
      drag = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      pointer = { x: event.clientX, y: event.clientY };
      shift = event.shiftKey; surface.setPointerCapture(event.pointerId); cursors();
    };
    const move = (event: PointerEvent) => {
      if (!drag) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!panAnimation) panAnimation = requestAnimationFrame(paintPan);
    };
    const up = (event?: PointerEvent) => {
      if (!drag) return;
      if (event && event.type !== 'pointercancel') pointer = { x: event.clientX, y: event.clientY };
      cancelAnimationFrame(panAnimation); paintPan(); drag = null;
      commit(); cursors();
    };
    const key = (event: KeyboardEvent) => {
      shift = event.shiftKey; control = event.ctrlKey || event.metaKey;
      if (!control) direction = '';
      cursors();
    };
    const blur = () => { shift = false; control = false; direction = ''; up(); cursors(); };
    const listen = (doc: Document) => {
      if (documents.has(doc)) return;
      documents.set(doc, { value: '' });
      doc.addEventListener('keydown', key, true); doc.addEventListener('keyup', key, true);
    };
    const frames = () => {
      for (const frame of runtime.frames.values()) { try { if (frame.contentDocument) listen(frame.contentDocument); } catch { /* Same-origin panels only. */ } }
      cursors();
    };
    // Host cursor is scoped to the canvas; iframe cursors require their own document.
    document.addEventListener('keydown', key, true); document.addEventListener('keyup', key, true);
    frames();
    const unobserve = controller.observe(event => {
      if (event.type === 'ready') frames();
      if (event.type !== 'zoom') return;
      const { id, detail } = event.detail as { id: string; detail: { x: number; y: number; deltaY: number; deltaMode: number } };
      const frame = runtime.frames.get(id); if (!frame) return;
      const bounds = surface.getBoundingClientRect(), page = frame.getBoundingClientRect(), scale = controller.snapshot().zoom;
      zoomWheel(detail.deltaY, detail.deltaMode, { x: page.left + detail.x * scale - bounds.left - surface.clientLeft + surface.scrollLeft, y: page.top + detail.y * scale - bounds.top - surface.clientTop + surface.scrollTop });
    });
    surface.addEventListener('wheel', wheel, { passive: false });
    surface.addEventListener('pointerdown', down, true); surface.addEventListener('pointermove', move);
    surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', up);
    window.addEventListener('blur', blur);
    return () => {
      unobserve(); cancelAnimationFrame(zoomAnimation); cancelAnimationFrame(panAnimation);
      surface.removeEventListener('wheel', wheel); surface.removeEventListener('pointerdown', down, true); surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerup', up); surface.removeEventListener('pointercancel', up);
      document.removeEventListener('keydown', key, true); document.removeEventListener('keyup', key, true); window.removeEventListener('blur', blur);
      for (const [doc, entry] of documents) { doc.removeEventListener('keydown', key, true); doc.removeEventListener('keyup', key, true); entry.cursor?.remove(); }
    };
  }, [controller, runtime, ref]);
}
