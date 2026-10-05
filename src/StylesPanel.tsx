import { useEffect, useRef, useState } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { css, cssLanguage, cssCompletionSource } from '@codemirror/lang-css';
import { autocompletion, completionKeymap, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
import { format } from 'prettier/standalone';
import * as postcss from 'prettier/plugins/postcss';
import type { SiteWallAPI } from './types.js';

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
export function sourceRules(content: string): { from: number; to: number; text: string; selector: string }[] {
  const rules: { from: number; to: number; text: string; selector: string }[] = [];
  cssLanguage.parser.parse(content).iterate({ enter(node) {
    if (node.name === 'RuleSet') rules.push({ from: node.from, to: node.to, text: content.slice(node.from, node.to), selector: content.slice(node.from, node.node.getChild('Block')?.from ?? node.to).trim() });
  } });
  return rules;
}

function RuleEditor({ id, index, selector, api }: { id: string; index: number; selector: string; api: SiteWallAPI }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true, editor: EditorView | null = null, timer: ReturnType<typeof setTimeout> | undefined;
    let baseline = '', draft = '', saving = false;
    const load = async () => {
      const file = await api.styles.read(id);
      const rule = sourceRules(file.content)[index];
      if (!active || !rule || (editor && draft !== baseline)) return;
      const normalize = (value: string) => value.replace(/\s+/g, ' ').replace(/\s*([,>+~])\s*/g, '$1').trim();
      if (normalize(rule.selector) !== normalize(selector)) throw new Error('Cannot safely map this runtime rule to its source.');
      baseline = draft = rule.text;
      if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: rule.text } });
      else if (host.current) editor = new EditorView({ parent: host.current, state: EditorState.create({ doc: rule.text, extensions: [
        history(), css(), bracketMatching(), syntaxHighlighting(defaultHighlightStyle), autocompletion({ override: [cssCompletions] }),
        Prec.highest(keymap.of([{ key: 'ArrowUp', run: v => step(v, 1) }, { key: 'ArrowDown', run: v => step(v, -1) }, { key: 'Shift-ArrowUp', run: v => step(v, 10) }, { key: 'Shift-ArrowDown', run: v => step(v, -10) }, { key: 'Alt-ArrowUp', run: v => step(v, .1) }, { key: 'Alt-ArrowDown', run: v => step(v, -.1) }])),
        keymap.of([{ key: 'Mod-Shift-f', run: view => {
          const original = view.state.doc.toString();
          void format(original, { parser: 'css', plugins: [postcss], tabWidth: 2 }).then(formatted => { if (active && view.state.doc.toString() === original) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: formatted.trimEnd() } }); }).catch(error => active && setStatus(String(error)));
          return true;
        } }, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.contentAttributes.of({ 'aria-label': 'CSS rule content', 'data-stylesheet': id }),
        EditorView.updateListener.of(update => { if (update.docChanged) { draft = update.state.doc.toString(); if (draft !== baseline) { setStatus('Unsaved'); clearTimeout(timer); timer = setTimeout(() => void save(), 500); } } }),
        EditorView.theme({ '&': { fontSize: '12px', background: '#101827', color: '#dce4f1' }, '.cm-content': { padding: '0' }, '.cm-line': { padding: '0' }, '.cm-cursor': { borderLeftColor: '#73e2c4' }, '.cm-scroller': { overflow: 'auto' }, '.cm-tooltip': { background: '#151f30' } }),
      ] }) });
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
        const rule = sourceRules(file.content)[index];
        if (!rule || rule.text !== baseline) throw new Error('This rule changed externally. Your draft has been preserved; resolve the conflict before saving.');
        await api.styles.save({ ...file, content: file.content.slice(0, rule.from) + submitted + file.content.slice(rule.to) });
        baseline = submitted;
        if (active) setStatus(draft === baseline ? '' : 'Unsaved');
      } catch (error) { if (active) setStatus(String(error)); }
      finally { saving = false; if (draft !== submitted) timer = setTimeout(() => void save(), 500); }
    };
    void load().catch(error => active && setStatus(String(error)));
    const unsubscribe = api.subscribe(event => { if (event.type === 'stylesheet' && (event.detail as { id: string }).id === id && !saving) void load().catch(error => active && setStatus(String(error))); });
    return () => { active = false; unsubscribe(); clearTimeout(timer); if (draft !== baseline) void save(); editor?.destroy(); };
  }, [id, index, selector, api]);
  return <section className="sw-style-rule" data-stylesheet={id} data-rule-index={index}><div className="sw-rule-filename">{id}</div><div className="sw-code-editor" ref={host} />{status && <div role="status" className="sw-rule-status">{status}</div>}</section>;
}
export function StylesPanel({ api }: { api: SiteWallAPI }) {
  const [ids, setIds] = useState<string[]>([]);
  const [filter, setFilter] = useState(api.getState().styleFilter);
  const [selectionMode, setSelectionMode] = useState(api.getState().selectionMode);
  const [error, setError] = useState('');
  const [context, setContext] = useState<Awaited<ReturnType<SiteWallAPI['inspectStyles']>> | null>(null);
  useEffect(() => {
    let active = true, inspection = 0;
    let viewport = JSON.stringify(api.getState().viewport);
    let selection = api.getState().selection;
    void api.styles.list().then(files => active && setIds(files)).catch(e => active && setError(String(e)));
    const inspect = () => {
      const request = ++inspection;
      if (api.getState().focused) void api.inspectStyles().then(value => { if (active && request === inspection) { setContext(value); setError(''); } }).catch(e => active && request === inspection && setError(String(e)));
    };
    inspect();
    const unsubscribe = api.subscribe(event => {
      if (event.type === 'workspace') {
        setFilter(api.getState().styleFilter);
        setSelectionMode(api.getState().selectionMode);
        const nextSelection = api.getState().selection;
        if (JSON.stringify(nextSelection) !== JSON.stringify(selection)) { selection = nextSelection; inspect(); }
        const next = JSON.stringify(api.getState().viewport);
        if (next !== viewport) { viewport = next; requestAnimationFrame(inspect); }
      }
      if (['selection', 'focus', 'stylesheet', 'navigation-complete', 'ready'].includes(event.type)) inspect();
      if (['shared-state', 'interaction', 'click'].includes(event.type)) requestAnimationFrame(inspect);
    });
    return () => { active = false; unsubscribe(); };
  }, [api]);
  const rules = (context?.rules ?? []).filter(rule => ids.includes(rule.stylesheet));
  const query = filter.toLowerCase();
  return <><div className="sw-selection-toolbar" role="toolbar" aria-label="Styles selection modes">
    <button type="button" aria-pressed={selectionMode === 'element'} onClick={() => api.setSelectionMode(selectionMode === 'element' ? 'none' : 'element')}>Element Selection</button>
    <button type="button" aria-pressed={selectionMode === 'region'} onClick={() => api.setSelectionMode(selectionMode === 'region' ? 'none' : 'region')}>Snip Selection</button>
  </div><input aria-label="Filter styles" placeholder="Filter" value={filter} onChange={e => { setFilter(e.target.value); api.filterStyles(e.target.value); }} />
    {rules.map(rule => <div key={`${rule.stylesheet}:${rule.sourceIndex}`} hidden={!`${rule.selector} ${rule.cssText} ${rule.stylesheet}`.toLowerCase().includes(query)}><RuleEditor id={rule.stylesheet} index={rule.sourceIndex} selector={rule.selector} api={api} /></div>)}
    {context?.opaqueSources.filter(source => source.active).map(source => <div className="sw-rule-status" key={source.id}>Opaque source: {source.id}. Computed values are available through style inspection.</div>)}
    {!rules.length && <div className="sw-rule-status">No applicable rules in page-styles.json.</div>}{error && <div role="status">{error}</div>}
  </>;
}
