import { waitForPageReady } from './page-ready.js';

/** Capture exact viewport-height scroll steps without changing the CSS viewport. */
export async function capturePage(win: Window, signal?: AbortSignal): Promise<string[]> {
  const result = await captureViewportSlices(win, signal);
  return result.slices;
}

async function captureViewportSlices(win: Window, signal?: AbortSignal): Promise<{ slices: string[]; width: number; height: number }> {
  await waitForPageReady(win, signal);
  const module = await import('html2canvas');
  const html2canvas = module.default as unknown as (element: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  const start = { x: win.scrollX, y: win.scrollY };
  const slices: string[] = [];
  const viewportHeight = win.innerHeight, width = win.innerWidth;
  const doc = win.document;
  let offset = 0, capturedHeight = 0;
  try {
    while (offset < doc.documentElement.scrollHeight && slices.length < 40) {
      signal?.throwIfAborted();
      win.scrollTo({ top: offset, left: 0, behavior: 'instant' });
      await waitForPageReady(win, signal, 200);
      signal?.throwIfAborted();
      const actual = win.scrollY;
      const fullHeight = doc.documentElement.scrollHeight;
      const visible = await html2canvas(doc.body, {
        windowWidth: width, windowHeight: viewportHeight, width, height: viewportHeight,
        x: 0, y: actual, scrollX: 0, scrollY: actual, useCORS: true, logging: false, scale: 1,
      });
      // At the bottom scrollY is clamped: crop overlap from the final viewport.
      const overlap = Math.max(0, offset - actual);
      const remaining = Math.min(viewportHeight - overlap, fullHeight - offset);
      if (remaining <= 0) break;
      const cropped = doc.createElement('canvas'); cropped.width = width; cropped.height = remaining;
      const context = cropped.getContext('2d');
      if (!context) throw new Error('Canvas context unavailable');
      context.drawImage(visible, 0, overlap, width, remaining, 0, 0, width, remaining);
      slices.push(cropped.toDataURL('image/png'));
      capturedHeight = offset + remaining;
      offset += viewportHeight;
    }
    if (capturedHeight < doc.documentElement.scrollHeight) throw new Error('Page exceeds the 40-viewport capture limit or changed height during capture');
    return { slices, width, height: capturedHeight };
  } finally { win.scrollTo({ left: start.x, top: start.y, behavior: 'instant' }); }
}

/** Stitch cropped viewport slices into one PNG, with no duplicated bottom overlap. */
export async function stitchPageSlices(win: Window, slices: string[], signal?: AbortSignal): Promise<string> {
  if (!slices.length) throw new Error('Capture returned no viewport slices');
  const images: HTMLImageElement[] = [];
  let height = 0, width = 0;
  for (const source of slices) {
    signal?.throwIfAborted();
    const image = win.document.createElement('img'); image.src = source;
    await image.decode(); images.push(image);
    width = Math.max(width, image.naturalWidth); height += image.naturalHeight;
  }
  // Bound allocation explicitly; never return a silently truncated browser canvas.
  if (height > 32767 || width * height > 64000000) throw new Error('Stitched image exceeds the browser canvas size limit; use capture() slices');
  const canvas = win.document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas context unavailable');
  let y = 0;
  for (const image of images) { signal?.throwIfAborted(); context.drawImage(image, 0, y); y += image.naturalHeight; }
  const result = canvas.toDataURL('image/png');
  if (result === 'data:,') throw new Error('Browser could not encode the stitched image');
  return result;
}
