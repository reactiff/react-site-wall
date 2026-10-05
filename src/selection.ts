import type { ContextSelection, SelectionRectangle } from './types.js';

/** Context is deliberately inspectable; credentials and form values are excluded. */
export function sanitizeContext(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[depth limit]';
  if (Array.isArray(value)) return value.slice(0, 500).map(item => sanitizeContext(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 500).map(([key, item]) => [key, /password|secret|token|credential|authorization|cookie|api.?key/i.test(key) ? '[redacted]' : sanitizeContext(item, depth + 1)]));
  return typeof value === 'string' ? value.slice(0, 20000) : value;
}
export function elementSelector(element: Element): string {
  if (element.id && element.ownerDocument.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
  const parts: string[] = [];
  let current: Element | null = element;
  while (current) {
    const parent: Element | null = current.parentElement;
    const siblings = parent ? [...parent.children].filter(item => item.tagName === current!.tagName) : [];
    parts.unshift(current.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : ''));
    current = parent;
  }
  return parts.join(' > ');
}
export function captureSelection(win: Window, panelId: string, applicationState: unknown, target: Element | SelectionRectangle): ContextSelection {
  const isElement = 'getBoundingClientRect' in target;
  const bounds = isElement ? target.getBoundingClientRect() : target;
  const rectangle = isElement ? { x: bounds.x + win.scrollX, y: bounds.y + win.scrollY, width: bounds.width, height: bounds.height } : { ...bounds };
  if (Object.values(rectangle).some(value => !Number.isFinite(value)) || rectangle.width <= 0 || rectangle.height <= 0 || rectangle.x < 0 || rectangle.y < 0) throw new Error('Selection must have a finite, positive size and page position');
  const brief = (element: Element) => ({ selector: elementSelector(element), tag: element.localName, text: ((element as HTMLElement).innerText ?? '').slice(0, 1000) });
  const surroundingElements = [...win.document.querySelectorAll('body *')].filter(element => {
    if (element.matches('script,style,template,input[type="password"],[hidden]')) return false;
    const box = element.getBoundingClientRect();
    return box.width && box.height && box.right + win.scrollX > rectangle.x && box.left + win.scrollX < rectangle.x + rectangle.width && box.bottom + win.scrollY > rectangle.y && box.top + win.scrollY < rectangle.y + rectangle.height;
  }).slice(-80).map(brief);
  let element: ContextSelection['element'];
  if (isElement) {
    const clone = target.cloneNode(true) as Element;
    clone.querySelectorAll('script,style,input,textarea,select,template').forEach(el => el.remove());
    [clone, ...clone.querySelectorAll('*')].forEach(el => [...el.attributes].forEach(attr => { if (/value|token|password|secret|on\w+/i.test(attr.name)) el.removeAttribute(attr.name); }));
    const ancestors: string[] = [];
    let parent = target.parentElement;
    while (parent && ancestors.length < 8) { ancestors.push(elementSelector(parent)); parent = parent.parentElement; }
    element = { ...brief(target), html: clone.outerHTML.slice(0, 16000), attributes: Object.fromEntries([...clone.attributes].map(attr => [attr.name, attr.value])), ancestors };
  }
  return { kind: isElement ? 'element' : 'region', panelId, route: win.location.pathname + win.location.search + win.location.hash, rectangle, viewport: { width: win.innerWidth, height: win.innerHeight }, scroll: { x: win.scrollX, y: win.scrollY }, capturedAt: Date.now(), element, surroundingElements, applicationState: sanitizeContext(applicationState) };
}
