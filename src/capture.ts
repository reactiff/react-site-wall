/** Capture viewport slices after actual scrolling; never enlarge the CSS viewport. */
export async function capturePage(win: Window, signal?: AbortSignal): Promise<string[]> {
  const module = await import('html2canvas');
  const html2canvas = module.default as unknown as (element: HTMLElement, options: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  const start = { x: win.scrollX, y: win.scrollY };
  const slices: string[] = [];
  const height = win.innerHeight;
  const document = win.document;
  let offset = 0;
  try {
    // Bounded to avoid infinite-scroll pages consuming unlimited memory.
    while (offset < document.documentElement.scrollHeight && slices.length < 40) {
      signal?.throwIfAborted();
      win.scrollTo({ top: offset, left: 0, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 150));
      signal?.throwIfAborted();
      const actual = win.scrollY;
      const canvas = await html2canvas(document.body, {
        windowWidth: win.innerWidth, windowHeight: height,
        width: win.innerWidth, height: Math.min(height, document.documentElement.scrollHeight - offset),
        x: 0, y: offset, scrollX: 0, scrollY: actual,
        useCORS: true, logging: false, scale: 1,
      });
      slices.push(canvas.toDataURL('image/png'));
      offset += height;
    }
    if (offset < document.documentElement.scrollHeight) throw new Error('Page exceeds the 40-viewport capture limit; use viewport mode or a custom capture adapter');
    return slices;
  } finally { win.scrollTo({ left: start.x, top: start.y, behavior: 'instant' }); }
}
