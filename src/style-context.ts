import { cssLanguage } from '@codemirror/lang-css';
import { inspectRuntimeCascade, inspectRuntimeCascadeAsync } from './runtime-cascade.js';
export interface StyleDeclaration { property: string; value: string; important: boolean; selector: string; specificity: [number, number, number]; stylesheet: string; order: number; layer: string | null; inherited: boolean; inline: boolean }
export type StyleSource = { kind: 'known-declaration'; declaration: StyleDeclaration } | { kind: 'opaque-cross-origin'; stylesheets: string[]; knownCandidate?: StyleDeclaration; attribution: 'not-readable' } | { kind: 'browser' };
export interface MatchedStyleRule { stylesheet: string; sourceIndex: number; sourceOccurrence?: number; selector: string; cssText: string; rank: number; inherited: boolean }
export interface StyleContext { rules?: MatchedStyleRule[]; selector?: string; stylesheets: { id: string; href: string | null; order: number; accessible: boolean }[]; cascade: { property: string; computed: string; declarations: StyleDeclaration[]; source: StyleSource }[]; opaqueSources: { id: string; href: string | null; active: boolean; kind: 'opaque-source' }[]; unresolved: string[]; region?: { selector: string; cascade: StyleContext['cascade'] }[] }
/** Computed values and native runtime rule precedence from the live DOM/CSSOM. */
export const inspectStyleContext = inspectRuntimeCascade;
export const inspectStyleContextAsync = inspectRuntimeCascadeAsync;

/** Preserve external stylesheet URL semantics when its text is applied inline. */
export function rebaseStylesheetURLs(content: string, baseURL: string): string {
  const changes: { from: number; to: number; value: string }[] = [];
  const decode = (value: string) => value.replace(/\\([\da-fA-F]{1,6})(?:\r\n|[\t\n\r\f ])?|\\([^\n\r\f])/g, (_match, hex: string | undefined, character: string) => hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : character);
  const rewrite = (from: number, to: number) => {
    let raw = content.slice(from, to).trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
    const value = decode(raw);
    if (!value || value.startsWith('#') || value.startsWith('/') || /^[a-z][\w+.-]*:/i.test(value)) return;
    try {
      const absolute = new URL(value, baseURL).href;
      changes.push({ from, to, value: `"${absolute.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` });
    } catch { /* Leave malformed URLs for the CSS parser/browser to report. */ }
  };
  cssLanguage.parser.parse(content).iterate({ enter(node) {
    if (node.name === 'CallLiteral' && node.node.getChild('CallTag')?.name) {
      const tag = node.node.getChild('CallTag')!;
      if (content.slice(tag.from, tag.to).toLowerCase() !== 'url') return;
      const value = node.node.getChild('StringLiteral') ?? node.node.getChild('ParenthesizedContent');
      if (value) rewrite(value.from, value.to);
    } else if (node.name === 'StringLiteral' && node.node.parent?.name === 'ImportStatement') rewrite(node.from, node.to);
  } });
  for (const change of changes.sort((a, b) => b.from - a.from)) content = content.slice(0, change.from) + change.value + content.slice(change.to);
  return content;
}
const replacements = new WeakMap<Document, Map<string, { original: Element; replacement: HTMLStyleElement; text: string | null; baseURL: string }>>();
/** Replace a uniquely identified source at its existing document position. */
export function applyStylesheet(doc: Document, id: string, content: string): boolean {
  let entries = replacements.get(doc);
  if (!entries) { entries = new Map(); replacements.set(doc, entries); }
  const existing = entries.get(id);
  if (existing) { existing.replacement.textContent = rebaseStylesheetURLs(content, existing.baseURL); return true; }
  const normalized = id.replaceAll('\\', '/').replace(/^\.\//, '');
  const sources = [...doc.querySelectorAll<Element>('style[data-vite-dev-id],style[data-sitewall-file],link[rel="stylesheet"]')];
  const path = (el: Element) => {
    const source = el.getAttribute('data-sitewall-file') ?? el.getAttribute('data-vite-dev-id') ?? el.getAttribute('href') ?? '';
    try { return decodeURIComponent(new URL(source, doc.baseURI).pathname).replaceAll('\\', '/'); } catch { return source.replaceAll('\\', '/'); }
  };
  let matches = sources.filter(el => path(el) === normalized || path(el).endsWith('/' + normalized));
  if (!matches.length) { const basename = normalized.split('/').pop()!; matches = sources.filter(el => path(el).split('/').pop() === basename); }
  if (matches.length !== 1) return false;
  const original = matches[0];
  const baseURL = original.tagName === 'LINK' ? new URL(original.getAttribute('href')!, doc.baseURI).href : original.hasAttribute('data-vite-dev-id') ? new URL('/' + normalized.replace(/^\//, ''), doc.baseURI).href : doc.baseURI;
  const rebasedContent = rebaseStylesheetURLs(content, baseURL);
  const replacement = doc.createElement('style'); replacement.dataset.sitewallFile = id; replacement.textContent = rebasedContent;
  if (original.getAttribute('media')) replacement.setAttribute('media', original.getAttribute('media')!);
  if (original.getAttribute('nonce')) replacement.setAttribute('nonce', original.getAttribute('nonce')!);
  const text = original.textContent;
  // Keep Vite's style node intact so its own HMR continues to target the same node.
  if (original.tagName === 'STYLE') {
    (original as HTMLStyleElement).textContent = rebasedContent;
    entries.set(id, { original, replacement: original as HTMLStyleElement, text, baseURL });
  } else { original.replaceWith(replacement); entries.set(id, { original, replacement, text, baseURL }); }
  return true;
}
export function restoreStylesheets(doc: Document): void {
  for (const entry of replacements.get(doc)?.values() ?? []) {
    if (entry.original === entry.replacement) entry.original.textContent = entry.text;
    else entry.replacement.replaceWith(entry.original);
  }
  replacements.delete(doc);
}


