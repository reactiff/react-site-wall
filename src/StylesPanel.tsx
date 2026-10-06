import { darkHighlightStyle } from './editor-theme.js';
import { readPersistent, writePersistent } from './persistence.js';
import { startTransition, useEffect, useRef, useState } from 'react';
import { EditorState, Prec, StateEffect } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { css, cssLanguage, cssCompletionSource } from '@codemirror/lang-css';
import { autocompletion, completionKeymap, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { format } from 'prettier/standalone';
import * as postcss from 'prettier/plugins/postcss';
import type { SiteWallAPI, Stylesheet } from './types.js';

const cssCompletions: CompletionSource = async context => {
  const result = await cssCompletionSource(context);
  if (!result || typeof CSS === 'undefined') return result;
  const declaration = /([\w-]+)\s*:\s*[^;{}]*$/.exec(context.state.doc.sliceString(0, context.pos));
  if (!declaration || result.options.some(option => option.type === 'property')) return result;
  const property = declaration[1];
  return { ...result, options: result.options.filter(option => option.type === 'variable' || CSS.supports(property, option.label)) };
};

export function numericEdit(text: string, position: number, delta: number): { from: number; to: number; value: string } | null {
  const tree = cssLanguage.parser.parse(text);
  let node = tree.resolveInner(position, -1);
  while (node.name === 'Unit' && node.parent) node = node.parent;
  if (node.name !== 'NumberLiteral') { node = tree.resolveInner(position, 1); while (node.name === 'Unit' && node.parent) node = node.parent; }
  if (node.name !== 'NumberLiteral') return null;
  let parent = node.parent;
  while (parent && parent.name !== 'Declaration') parent = parent.parent;
  if (!parent) return null;
  const match = /^-?(?:\d*\.\d+|\d+\.?\d*)/.exec(text.slice(node.from, node.to));
  if (!match || position > node.from + match[0].length) return null;
  return { from: node.from, to: node.from + match[0].length, value: String(Math.round((Number(match[0]) + delta) * 10000) / 10000) };
}
function step(view: EditorView, delta: number) {
  if (!view.state.selection.main.empty) return false;
  const change = numericEdit(view.state.doc.toString(), view.state.selection.main.head, delta);
  if (!change) return false;
  view.dispatch({ changes: { from: change.from, to: change.to, insert: change.value }, selection: { anchor: change.from + change.value.length }, userEvent: 'input' });
  return true;
}
const selectorCache = new Map<string, string>();
function canonicalSelector(selector: string): string {
  const cached = selectorCache.get(selector); if (cached) return cached;
  let canonical = selector.trim();
  if (typeof CSSStyleSheet !== 'undefined') {
    try { const sheet = new CSSStyleSheet(); sheet.replaceSync(`${selector} {}`); const rule = sheet.cssRules[0] as CSSStyleRule | undefined; canonical = rule?.selectorText ?? canonical; } catch { /* Keep original selector for unsupported syntax. */ }
  }
  if (selectorCache.size >= 512) selectorCache.delete(selectorCache.keys().next().value!);
  selectorCache.set(selector, canonical); return canonical;
}
function matchSource(content: string, index: number, selector: string, occurrence?: number): SourceRule | undefined {
  const rules = sourceRules(content), canonical = canonicalSelector(selector);
  const candidates = rules.filter(rule => canonicalSelector(rule.selector) === canonical);
  if (occurrence !== undefined && candidates[occurrence]) return candidates[occurrence];
  if (rules[index] && canonicalSelector(rules[index].selector) === canonical) return rules[index];
  return candidates.length === 1 ? candidates[0] : undefined;
}
type SourceRule = { from: number; to: number; text: string; selector: string };
const parsedSources = new Map<string, SourceRule[]>();
const editorCaches = new WeakMap<SiteWallAPI, Map<string, EditorState>>();
const pendingReads = new WeakMap<SiteWallAPI, Map<string, Promise<Stylesheet>>>();
function readSource(api: SiteWallAPI, id: string): Promise<Stylesheet> {
  let reads = pendingReads.get(api);
  if (!reads) { reads = new Map(); pendingReads.set(api, reads); }
  const existing = reads.get(id);
  if (existing) return existing;
  const pending = api.styles.read(id).finally(() => { if (reads!.get(id) === pending) reads!.delete(id); });
  reads.set(id, pending);
  return pending;
}
export function sourceRules(content: string): SourceRule[] {
  const cached = parsedSources.get(content);
  if (cached) return cached;
  const rules: SourceRule[] = [];
  cssLanguage.parser.parse(content).iterate({ enter(node) {
    if (node.name === 'RuleSet') rules.push({ from: node.from, to: node.to, text: content.slice(node.from, node.to), selector: content.slice(node.from, node.node.getChild('Block')?.from ?? node.to).trim() });
  } });
  if (parsedSources.size >= 12) parsedSources.delete(parsedSources.keys().next().value!);
  parsedSources.set(content, rules);
  return rules;
}

function DeferredRuleEditor(props: { id: string; index: number; selector: string; occurrence?: number; api: SiteWallAPI }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { startTransition(() => setVisible(true)); observer.disconnect(); }
    }, { root: host.current.closest('.sw-styles'), rootMargin: '100px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={host}>{visible ? <RuleEditor {...props} /> : <div className="sw-style-rule sw-rule-placeholder"><div className="sw-rule-filename">{props.id}</div>{props.selector}</div>}</div>;
}

function RuleEditor({ id, index, selector, occurrence, api }: { id: string; index: number; selector: string; occurrence?: number; api: SiteWallAPI }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true, editor: EditorView | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let baseline = '', sourceBaseline = '', draft = '', saving = false;
    const cache = editorCaches.get(api) ?? new Map<string, EditorState>();
    editorCaches.set(api, cache);
    const cacheKey = `${id}:${occurrence ?? index}:${selector}`;
    const scope = window.location.pathname;
    const persistDraft = () => writePersistent(scope, `css-draft:${cacheKey}`, () => ({ source: sourceBaseline, content: draft, dirty: draft !== baseline }));
    const load = async () => {
      const file = await readSource(api, id);
      await new Promise(resolve => setTimeout(resolve, 0));
      const rule = matchSource(file.content, index, selector, occurrence);
      if (!active || (editor && draft !== baseline)) return;
      if (!rule) { setStatus('This rule is generated or has no matching editable source.'); return; }
      const formatted = await format(rule.text, { parser: 'css', plugins: [postcss], tabWidth: 2, printWidth: 60 }).then(value => value.trimEnd()).catch(() => rule.text);
      if (!active || (editor && draft !== baseline)) return;
      sourceBaseline = rule.text; baseline = draft = formatted;
      if (!editor) { const remembered = readPersistent<{ source: string; content: string; dirty?: boolean }>(scope, `css-draft:${cacheKey}`); if (remembered?.dirty && typeof remembered.content === 'string') { sourceBaseline = remembered.source; draft = remembered.content; } }
      if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: draft } });
      else if (host.current) editor = new EditorView({ parent: host.current, state: (cache.get(cacheKey)?.doc.toString() === draft ? cache.get(cacheKey)! : EditorState.create({ doc: draft })).update({ effects: StateEffect.reconfigure.of([
        history(), css(), EditorView.lineWrapping, bracketMatching(), syntaxHighlighting(darkHighlightStyle), autocompletion({ override: [cssCompletions] }),
        Prec.highest(keymap.of([{ key: 'ArrowUp', run: v => step(v, 1) }, { key: 'ArrowDown', run: v => step(v, -1) }, { key: 'Shift-ArrowUp', run: v => step(v, 10) }, { key: 'Shift-ArrowDown', run: v => step(v, -10) }, { key: 'Alt-ArrowUp', run: v => step(v, .1) }, { key: 'Alt-ArrowDown', run: v => step(v, -.1) }])),
        keymap.of([{ key: 'Mod-Shift-f', run: view => {
          const original = view.state.doc.toString();
          void format(original, { parser: 'css', plugins: [postcss], tabWidth: 2 }).then(formatted => { if (active && view.state.doc.toString() === original) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted.trimEnd() } }); }).catch(error => active && setStatus(String(error)));
          return true;
        } }, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ 'aria-label': 'CSS rule content', 'data-stylesheet': id }),
        EditorView.updateListener.of(update => { if (update.docChanged) { draft = update.state.doc.toString(); persistDraft(); if (draft !== baseline) { setStatus('Unsaved'); clearTimeout(timer); timer = setTimeout(() => void save(), 500); } } }),
        EditorView.theme({ '&': { fontSize: '12px', background: '#1e1e1e', color: '#d4d4d4' }, '.cm-content': { padding: '0' }, '.cm-line': { padding: '0' }, '.cm-cursor': { borderLeftColor: '#73e2c4' }, '.cm-scroller': { overflow: 'visible' }, '.cm-tooltip': { background: '#252526' } }),
      ]) }).state });
      if (draft !== baseline) { setStatus('Unsaved'); timer = setTimeout(() => void save(), 500); }
    };
    const save = async () => {
      if (saving) { timer = setTimeout(() => void save(), 100); return; }
      if (draft === baseline) return;
      let incomplete = false;
      cssLanguage.parser.parse(draft).iterate({ enter(node) { if (node.type.isError) incomplete = true; } });
      if (incomplete) { if (active) setStatus('Incomplete CSS ? draft retained'); return; }
      saving = true;
      const submitted = draft;
      try {
        const file = await api.styles.read(id);
        const rule = matchSource(file.content, index, selector, occurrence);
        if (!rule || rule.text !== sourceBaseline) throw new Error('This rule changed externally. Your draft has been preserved; resolve the conflict before saving.');
        await api.styles.save({ ...file, content: file.content.slice(0, rule.from) + submitted + file.content.slice(rule.to) });
        sourceBaseline = baseline = submitted;
        persistDraft();
        if (active) setStatus(draft === baseline ? '' : 'Unsaved');
      } catch (error) { if (active) setStatus(String(error)); }
      finally { saving = false; if (draft !== submitted) timer = setTimeout(() => void save(), 500); }
    };
    void load().catch(error => active && setStatus(String(error)));
    const unsubscribe = api.subscribe(event => { if (event.type === 'stylesheet' && (event.detail as { id: string }).id === id && !saving) void load().catch(error => active && setStatus(String(error))); });
    return () => { persistDraft(); active = false; unsubscribe(); clearTimeout(timer); if (draft !== baseline) void save(); if (editor) { if (cache!.size >= 64) cache!.delete(cache!.keys().next().value!); cache!.set(cacheKey, editor.state); editor.destroy(); } };
  }, [id, index, selector, occurrence, api]);
  return <section className="sw-style-rule" data-stylesheet={id} data-rule-index={index}><div className="sw-rule-filename">{id}</div><div className="sw-code-editor" ref={host} />{status && <div role="status" className="sw-rule-status">{status}</div>}</section>;
}
export function StylesPanel({ api }: { api: SiteWallAPI }) {
  const [ids, setIds] = useState<string[]>([]);
  const [filter, setFilter] = useState(api.getState().styleFilter);
  const [selectionMode, setSelectionMode] = useState(api.getState().selectionMode);
  const [error, setError] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<SiteWallAPI['inspectStyles']>> | null>(null);
  useEffect(() => {
    let active = true, inspection = 0, inFlight = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let selectionStamp = '', viewportStamp = '';
    const inspect = () => {
      clearTimeout(timer);
      const state = api.getState();
      if (!state.selection) { inspection++; setContext(null); setError(''); return; }
      if (inFlight) { inspection++; again = true; return; }
      const request = ++inspection;
      timer = setTimeout(async () => {
        if (!active || !api.getState().selection) return;
        inFlight = true;
        try {
          const value = await api.inspectStyles();
          const files = await api.styles.list();
          if (active && request === inspection && api.getState().selection) startTransition(() => { setContext(value); setIds(files); setError(''); });
        } catch (error) { if (active && request === inspection) setError(String(error)); }
        finally { inFlight = false; if (again && active) { again = false; inspect(); } }
      }, 80);
    };
    inspect();
    const unsubscribe = api.subscribe(event => {
      if (event.type === 'workspace') {
        const state = api.getState();
        setFilter(state.styleFilter); setSelectionMode(state.selectionMode);
        const nextSelection = JSON.stringify([state.selection?.panelId, state.selection?.capturedAt]);
        const nextViewport = JSON.stringify(state.viewport);
        if (nextSelection !== selectionStamp || nextViewport !== viewportStamp) {
          selectionStamp = nextSelection; viewportStamp = nextViewport; inspection++; inspect();
        }
      }
      if (['selection', 'stylesheet', 'navigation-complete', 'shared-state', 'interaction', 'click', 'ready'].includes(event.type)) inspect();
    });
    return () => { active = false; inspection++; clearTimeout(timer); unsubscribe(); };
  }, [api]);
  const rules = (context?.rules ?? []).filter(rule => ids.includes(rule.stylesheet));
  const query = filter.toLowerCase();
  return <><div className="sw-selection-toolbar" role="toolbar" aria-label="Styles selection modes">
    <button type="button" aria-pressed={selectionMode === 'element'} onClick={() => api.setSelectionMode(selectionMode === 'element' ? 'none' : 'element')}>Element Selection</button>
    <button type="button" aria-pressed={selectionMode === 'region'} onClick={() => api.setSelectionMode(selectionMode === 'region' ? 'none' : 'region')}>Snip Selection</button>
  </div><input aria-label="Filter styles" placeholder="Filter" value={filter} onChange={e => { setFilter(e.target.value); api.filterStyles(e.target.value); }} />
    {rules.map(rule => <div key={`${rule.stylesheet}:${rule.sourceIndex}`} hidden={!`${rule.selector} ${rule.cssText} ${rule.stylesheet}`.toLowerCase().includes(query)}><DeferredRuleEditor id={rule.stylesheet} index={rule.sourceIndex} selector={rule.selector} occurrence={rule.sourceOccurrence} api={api} /></div>)}
    {context?.opaqueSources.filter(source => source.active).map(source => <div className="sw-rule-status" key={source.id}>Opaque source: {source.id}. Computed values are available through style inspection.</div>)}
    {!rules.length && <div className="sw-rule-status">{api.getState().selection ? 'No applicable rules in page-styles.json.' : 'Select an element or snip to inspect its styles.'}</div>}{error && <div role="status">{error}</div>}
  </>;
}
