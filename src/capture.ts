import { waitForPageReady } from './page-ready.js';
import type { SelectionRectangle } from './types.js';

/** Capture a region in page CSS coordinates without scrolling or resizing the page. */
export async function captureRegion(win: Window, rectangle: SelectionRectangle, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const module = await import('html2canvas');
  const html2canvas = module.default as unknown as (element: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  const canvas = await html2canvas(win.document.body, {
    x: rectangle.x, y: rectangle.y, width: Math.ceil(rectangle.width), height: Math.ceil(rectangle.height),
    windowWidth: win.innerWidth, windowHeight: win.innerHeight, scrollX: win.scrollX, scrollY: win.scrollY,
    scale: 1, useCORS: true, logging: false,
  });
  signal?.throwIfAborted();
  return canvas.toDataURL('image/png');
}

/** Capture exact viewport-height scroll steps without changing the CSS viewport. */
export async function capturePage(win: Window, signal?: AbortSignal): Promise<string[]> {
  const result = await captureViewportSlices(win, signal);
  return result.slices;
}

/** Pick the largest visible scrollport, including applications with a fixed shell. */
export function pageScrollContainer(win: Window): HTMLElement {
  const doc = win.document;
  const root = (doc.scrollingElement ?? doc.documentElement) as HTMLElement;
  const candidates = [root, ...doc.querySelectorAll<HTMLElement>('body *')].filter(element => {
    if (element === root) return element.scrollHeight > win.innerHeight;
    const style = win.getComputedStyle(element);
    return /^(auto|scroll|overlay)$/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1;
  });
  const area = (element: HTMLElement) => {
    if (element === root) return win.innerWidth * win.innerHeight;
    const box = element.getBoundingClientRect();
    return Math.max(0, Math.min(box.right, win.innerWidth) - Math.max(box.left, 0)) * Math.max(0, Math.min(box.bottom, win.innerHeight) - Math.max(box.top, 0));
  };
  return candidates.filter(element => area(element) > 0).sort((a, b) => area(b) - area(a) || b.scrollHeight - a.scrollHeight)[0] ?? root;
}

async function rendered(win: Window): Promise<void> {
  await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
}

async function captureViewportSlices(win: Window, signal?: AbortSignal): Promise<{ slices: string[]; width: number; height: number }> {
  await waitForPageReady(win, signal);
  const module = await import('html2canvas');
  const html2canvas = module.default as unknown as (element: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  const doc = win.document;
  const scroller = pageScrollContainer(win);
  const root = scroller === doc.scrollingElement || scroller === doc.documentElement;
  const start = { x: scroller.scrollLeft, y: scroller.scrollTop, windowX: win.scrollX, windowY: win.scrollY };
  const style = scroller.style;
  const overrides = ['scroll-behavior', 'scroll-snap-type', 'overflow-anchor'].map(property => ({ property, value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) }));
  style.setProperty('scroll-behavior', 'auto', 'important');
  style.setProperty('scroll-snap-type', 'none', 'important');
  style.setProperty('overflow-anchor', 'none', 'important');
  // Capture the content viewport, excluding the reserved scrollbar gutter.
  // Keep the actual iframe/clone viewport unchanged so responsive layout is stable.
  const width = root ? doc.documentElement.clientWidth : scroller.clientWidth;
  const viewportHeight = root ? win.innerHeight : scroller.clientHeight;
  const viewport = { width: win.innerWidth, height: win.innerHeight };
  const slices: string[] = [];
  const progress = (detail: Record<string, unknown>) => {
    if (win.parent !== win) win.parent.dispatchEvent(new CustomEvent('sitewall:page', { detail: { source: win, type: 'capture-progress', detail } }));
  };
  // Locate the same scrollport in html2canvas's clone without changing host attributes.
  const path: number[] = [];
  let node: Element = scroller;
  while (node !== doc.documentElement && node.parentElement) { path.unshift([...node.parentElement.children].indexOf(node)); node = node.parentElement; }
  let offset = 0, capturedHeight = 0;
  const move = (x: number, y: number) => root ? win.scrollTo({ left: x, top: y, behavior: 'instant' }) : scroller.scrollTo({ left: x, top: y, behavior: 'instant' });
  try {
    if (!width || !viewportHeight) throw new Error('Page scroll container has no visible capture area');
    while (offset < scroller.scrollHeight && slices.length < 40) {
      signal?.throwIfAborted();
      move(0, offset);
      await rendered(win);
      await waitForPageReady(win, signal, 200);
      await rendered(win);
      signal?.throwIfAborted();
      const actual = root ? win.scrollY : scroller.scrollTop;
      const fullHeight = scroller.scrollHeight;
      const expected = Math.min(offset, Math.max(0, fullHeight - viewportHeight));
      if (Math.abs(actual - expected) > 1) throw new Error(`Capture scroll failed: requested ${offset}, expected ${expected}, actual ${actual}`);
      progress({ scroller: root ? 'document' : `${scroller.localName}${scroller.id ? '#' + scroller.id : ''}`, offset, actual, fullHeight, viewportHeight, width });
      if (win.innerWidth !== viewport.width || win.innerHeight !== viewport.height) throw new Error('Iframe viewport changed during capture');
      const box = scroller.getBoundingClientRect();
      const x = root ? 0 : box.left + scroller.clientLeft + win.scrollX;
      const y = root ? actual : box.top + scroller.clientTop + win.scrollY;
      if (!root && (box.left + scroller.clientLeft < 0 || box.top + scroller.clientTop < 0 || box.left + scroller.clientLeft + width > win.innerWidth + 1 || box.top + scroller.clientTop + viewportHeight > win.innerHeight + 1)) throw new Error('Page scroll container is clipped outside the iframe viewport');
      const visible = await html2canvas(doc.body, {
        windowWidth: viewport.width, windowHeight: viewport.height, width, height: viewportHeight,
        x, y, scrollX: win.scrollX, scrollY: win.scrollY, useCORS: true, logging: false, scale: 1,
        onclone: (clone: Document) => {
          // Viewport-attached chrome must not cover new content at every seam.
          // Change only the disposable render clone, preserving the running app.
          const cloneWindow = clone.defaultView!;
          // html2canvas stretches replaced images and ignores object-fit/position.
          // Its background renderer supports the equivalent cover/contain crop.
          for (const image of [...clone.images]) {
            const imageStyle = cloneWindow.getComputedStyle(image);
            if (!['cover', 'contain'].includes(imageStyle.objectFit)) continue;
            const source = image.currentSrc || image.src;
            if (!source) continue;
            const fit = imageStyle.objectFit, position = imageStyle.objectPosition;
            const imageWidth = imageStyle.width, imageHeight = imageStyle.height;
            image.style.setProperty('width', imageWidth, 'important');
            image.style.setProperty('height', imageHeight, 'important');
            image.style.setProperty('background-image', `url(${JSON.stringify(source)})`, 'important');
            image.style.setProperty('background-size', fit, 'important');
            image.style.setProperty('background-position', position, 'important');
            image.style.setProperty('background-repeat', 'no-repeat', 'important');
            image.style.setProperty('background-origin', 'content-box', 'important');
            image.style.setProperty('background-clip', 'content-box', 'important');
            image.removeAttribute('srcset');
            if (image.parentElement?.localName === 'picture') image.parentElement.querySelectorAll('source').forEach(source => source.remove());
            image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
          }
          for (const element of clone.querySelectorAll<HTMLElement>('body *')) {
            const position = cloneWindow.getComputedStyle(element).position;
            if (position === 'fixed' && offset > 0) element.style.setProperty('visibility', 'hidden', 'important');
            if (position === 'sticky') {
              element.style.setProperty('position', 'relative', 'important');
              for (const edge of ['top', 'right', 'bottom', 'left']) element.style.setProperty(edge, 'auto', 'important');
            }
          }
          let target = clone.documentElement;
          for (const index of path) target = target.children[index] as HTMLElement;
          target.scrollLeft = 0; target.scrollTop = actual;
          const clonedOffset = root ? clone.defaultView!.scrollY : target.scrollTop;
          if (Math.abs(clonedOffset - actual) > 1) throw new Error(`Cloned capture scroll failed: expected ${actual}, actual ${clonedOffset}`);
        },
      });
      const overlap = Math.max(0, offset - actual);
      const remaining = Math.min(viewportHeight - overlap, fullHeight - offset);
      if (remaining <= 0) throw new Error('Capture made no progress through the page');
      const cropped = doc.createElement('canvas'); cropped.width = width; cropped.height = remaining;
      const context = cropped.getContext('2d');
      if (!context) throw new Error('Canvas context unavailable');
      context.drawImage(visible, 0, overlap, width, remaining, 0, 0, width, remaining);
      slices.push(cropped.toDataURL('image/png'));
      capturedHeight = offset + remaining;
      offset += viewportHeight;
    }
    if (capturedHeight < scroller.scrollHeight) throw new Error('Page exceeds the 40-viewport capture limit or changed height during capture');
    return { slices, width, height: capturedHeight };
  } finally {
    move(start.x, start.y);
    if (!root) win.scrollTo({ left: start.windowX, top: start.windowY, behavior: 'instant' });
    await rendered(win);
    for (const override of overrides) {
      if (override.value) style.setProperty(override.property, override.value, override.priority);
      else style.removeProperty(override.property);
    }
    if (Math.abs(scroller.scrollTop - start.y) > 1 || Math.abs(scroller.scrollLeft - start.x) > 1) throw new Error('Could not restore the original capture scroll position');
  }
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
