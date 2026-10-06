import { useEffect, useRef, useState } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { darkHighlightStyle } from './editor-theme.js';
import type { SiteWallAPI, PromptResult } from './types.js';

// Lightweight PowerShell tokens for command/tool output, without another dependency.
const powershell = StreamLanguage.define({
  startState: () => ({ quote: '', comment: false }),
  token(stream, state) {
    if (state.comment) { if (stream.skipTo('#>')) { stream.match('#>'); state.comment = false; } else stream.skipToEnd(); return 'comment'; }
    if (state.quote) {
      while (!stream.eol()) { const char = stream.next(); if (char === '`') stream.next(); else if (char === state.quote) { state.quote = ''; break; } }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('<#')) { state.comment = true; return 'comment'; }
    if (stream.match('#')) { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/['"]/)) { state.quote = stream.current(); return 'string'; }
    if (stream.match(/\$(?:\{[^}]+\}|[\w:?]+)/)) return 'variableName';
    if (stream.match(/\b(?:if|else|elseif|foreach|for|while|function|return|param|try|catch|finally|throw|switch|in|begin|process|end)\b/i)) return 'keyword';
    if (stream.match(/\b[A-Za-z]+-[A-Za-z][\w-]*/)) return 'typeName';
    if (stream.match(/-\w+/)) return 'keyword';
    if (stream.match(/\b\d+(?:\.\d+)?\b/)) return 'number';
    if (stream.match(/[|&=+*/<>!{}()[\];,]/)) return 'operator';
    stream.next(); return null;
  },
});
const editorTheme = EditorView.theme({
  '&': { background: '#1e1e1e', color: '#d4d4d4', fontSize: '12px' },
  '.cm-content': { padding: '3px 5px' }, '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: '#73e2c4' },
  '.cm-scroller': { overflowX: 'hidden', fontFamily: 'Consolas, monospace' },
  '.cm-focused': { outline: 'none' },
});

function OutputEditor({ text, command }: { text: string; command: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ doc: text, extensions: [
      EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': command ? 'Codex command output' : 'Codex report output' }),
      editorTheme, ...(command ? [powershell, syntaxHighlighting(darkHighlightStyle)] : []),
    ] }) });
    return () => view.destroy();
  }, [text, command]);
  return <div className={`sw-codex-output-editor ${command ? 'sw-command-output' : 'sw-report-output'}`} ref={host} />;
}

function outputParts(text: string): { text: string; command: boolean }[] {
  const parts: { text: string; command: boolean }[] = [];
  const fences = /```([^\n]*)\n([\s\S]*?)```/g;
  let end = 0;
  for (const match of text.matchAll(fences)) {
    if (match.index! > end) parts.push({ text: text.slice(end, match.index).trim(), command: false });
    parts.push({ text: match[2].trimEnd(), command: /^(powershell|pwsh|ps1|ps|shell|console|sh|bash|cmd)\b/i.test(match[1].trim()) });
    end = match.index! + match[0].length;
  }
  if (end < text.length) { const rest = text.slice(end).trim(); parts.push({ text: rest, command: /^(?:PS\s+[A-Z]:|\$\s|(?:Get|Set|Write|New|Remove|Invoke|Test|Select)-\w+)/m.test(rest) }); }
  return parts.filter(part => part.text);
}

function PromptEditor({ send }: { send: (text: string) => Promise<void> }) {
  const host = useRef<HTMLDivElement>(null);
  const submit = useRef(send); submit.current = send;
  useEffect(() => {
    let alive = true;
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ extensions: [
      history(), editorTheme, EditorView.lineWrapping,
      placeholder('Ask Codex about this page or selection...'),
      EditorView.contentAttributes.of({ 'aria-label': 'Instruction for Codex', 'aria-multiline': 'true' }),
      Prec.highest(keymap.of([
        { key: 'Ctrl-Enter', run: editor => { editor.dispatch(editor.state.replaceSelection('\n')); return true; } },
        { key: 'Enter', run: editor => {
          const text = editor.state.doc.toString();
          if (!text.trim()) return true;
          const promise = submit.current(text);
          editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '' }, selection: { anchor: 0 } });
          void promise.catch(error => { if (alive && error?.name !== 'AbortError' && !editor.state.doc.length) editor.dispatch({ changes: { from: 0, insert: text } }); });
          return true;
        } },
      ])), keymap.of([...defaultKeymap, ...historyKeymap]),
    ] }) });
    const panel = host.current!.closest('.sw-codex')!;
    const measure = () => {
      const toolbar = panel.querySelector<HTMLElement>('.sw-codex-toolbar')!;
      const context = panel.querySelector<HTMLElement>('.sw-codex-context')!;
      const height = Math.max(0, panel.clientHeight - toolbar.offsetHeight - context.offsetHeight);
      host.current?.style.setProperty('--sw-prompt-max-height', `${height}px`);
      view.scrollDOM.style.maxHeight = `${height}px`;
      view.requestMeasure();
    };
    const observer = new ResizeObserver(measure); observer.observe(panel); measure();
    return () => { alive = false; observer.disconnect(); view.destroy(); };
  }, []);
  return <div className="sw-codex-prompt" ref={host} />;
}

type Entry = { id: number; role: 'You' | 'Codex' | 'Status'; text: string };
type Activity = 'idle' | 'working' | 'completed' | 'problem';
export function CodexPanel({ api, width, open }: { api: SiteWallAPI; width: number; open: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Activity>('idle');
  const [version, setVersion] = useState(0);
  const [resetting, setResetting] = useState(false);
  const output = useRef<HTMLDivElement>(null);
  const follow = useRef(true), running = useRef(false), acceptResults = useRef(false), counter = useRef(0);
  const completion = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const epoch = useRef(0);
  const append = (role: Entry['role'], text: string) => setEntries(previous => [...previous, { id: ++counter.current, role, text }]);
  useEffect(() => api.subscribe(event => {
    if (event.type === 'prompt-begin') {
      clearTimeout(completion.current); acceptResults.current = true; running.current = true; setBusy(true); setActivity('working');
      append('You', (event.detail as { instruction: string }).instruction);
    } else if (acceptResults.current && event.type === 'prompt-result') {
      const result = event.detail as PromptResult;
      append('Codex', result.output || '(No output)'); running.current = false; setBusy(false);
      setActivity(result.status === 'completed' ? 'completed' : 'problem');
      if (result.status === 'completed') completion.current = setTimeout(() => setActivity('idle'), 1500);
    } else if (acceptResults.current && event.type === 'prompt-failure') {
      const failure = event.detail as { stopped: boolean; message: string };
      append('Status', failure.message); running.current = false; setBusy(false); setActivity(failure.stopped ? 'idle' : 'problem');
    }
  }), [api]);
  useEffect(() => () => clearTimeout(completion.current), []);
  useEffect(() => {
    const element = output.current!;
    const reveal = () => { if (follow.current && open) element.scrollTop = element.scrollHeight; };
    const observer = new ResizeObserver(reveal);
    for (const block of element.children) observer.observe(block);
    reveal(); return () => observer.disconnect();
  }, [entries, open]);
  const stop = async () => {
    try { await api.stopPrompt(); }
    catch (error) { append('Status', String(error)); setActivity('problem'); throw error; }
  };
  const fresh = async () => {
    epoch.current++;
    clearTimeout(completion.current); acceptResults.current = false; follow.current = true;
    setEntries([]); setVersion(value => value + 1); setActivity('idle'); setResetting(true);
    try { if (running.current) await stop(); }
    catch { /* Cancellation error is shown; retain its warning instead of claiming success. */ }
    finally { running.current = false; setBusy(false); setResetting(false); }
  };
  const send = async (text: string) => {
    if (running.current || resetting) throw new Error('Codex is already running');
    if (text.length > 16000) { setActivity('problem'); append('Status', 'Instruction must be at most 16000 characters'); throw new Error('Instruction must be at most 16000 characters'); }
    const own = epoch.current;
    running.current = true; setBusy(true); setActivity('working');
    try { await api.executePrompt(text); }
    catch (error) {
      if (own === epoch.current && running.current) { append('Status', String(error)); setActivity('problem'); }
      throw error;
    } finally { if (own === epoch.current) { running.current = false; setBusy(false); } }
  };
  const state = api.getState();
  const context = state.selection ? `${state.selection.kind}: ${state.selection.route}` : `Page: ${state.currentRoute || 'none'}`;
  return <aside className="sw-codex" style={{ width, display: open ? 'flex' : 'none' }} aria-label="Codex panel">
    <div className="sw-codex-toolbar" role="toolbar" aria-label="Codex controls">
      <strong>Codex</strong><button disabled={resetting} onClick={() => void fresh()}>New Session</button>
      <button disabled={!busy || resetting} onClick={() => void stop().catch(() => {})}>Stop</button>
      <span className={`sw-codex-activity sw-${activity}`} role="status" aria-label={`Codex ${activity}`} title={activity} />
    </div>
    <div className="sw-codex-context" title={context}>{context}</div>
    <div className="sw-codex-history" ref={output} aria-label="Codex output history" onScroll={event => {
      const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    }}>{entries.map(entry => <div className="sw-codex-entry" data-role={entry.role} key={entry.id}>
      <div className="sw-codex-entry-label">{entry.role}</div>
      {outputParts(entry.text).map((part, index) => <OutputEditor key={index} {...part} />)}
    </div>)}</div>
    <PromptEditor key={version} send={send} />
  </aside>;
}
