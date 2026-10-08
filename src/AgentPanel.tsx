import { useEffect, useRef, useState } from 'react';
import { EditorState, Prec } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { darkHighlightStyle } from './editor-theme.js';
import type { SiteWallAPI, PromptResult } from './types.js';
import { AgentInteractionDialog } from './AgentInteractionDialog.js';
import { importReferenceFiles, useReferences } from './ReferencesPanel.js';

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
      EditorView.contentAttributes.of({ 'aria-label': command ? 'Agent command output' : 'Agent report output' }),
      editorTheme, ...(command ? [powershell, syntaxHighlighting(darkHighlightStyle)] : []),
    ] }) });
    return () => view.destroy();
  }, [text, command]);
  return <div className={`sw-agent-output-editor ${command ? 'sw-command-output' : 'sw-report-output'}`} ref={host} />;
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

function PromptEditor({ send, addFiles }: { send: (text: string) => Promise<void>; addFiles: (files: File[]) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const submit = useRef(send); submit.current = send;
  const attachments = useRef(addFiles); attachments.current = addFiles;
  useEffect(() => {
    let alive = true;
    const view = new EditorView({ parent: host.current!, state: EditorState.create({ extensions: [
      history(), editorTheme, EditorView.lineWrapping,
      EditorView.domEventHandlers({
        paste: event => { const files = [...event.clipboardData?.files ?? []]; if (!files.length) return false; event.preventDefault(); event.stopPropagation(); attachments.current(files); return true; },
        dragover: event => { if (!event.dataTransfer?.types.includes('Files')) return false; event.preventDefault(); return true; },
        drop: event => { const files = [...event.dataTransfer?.files ?? []]; if (!files.length) return false; event.preventDefault(); event.stopPropagation(); attachments.current(files); return true; },
      }),
      placeholder('Ask Agent about this page or selection...'),
      EditorView.contentAttributes.of({ 'aria-label': 'Instruction for Agent', 'aria-multiline': 'true' }),
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
    const panel = host.current!.closest('.sw-agent')!;
    const measure = () => {
      const toolbar = panel.querySelector<HTMLElement>('.sw-agent-toolbar')!;
      const context = panel.querySelector<HTMLElement>('.sw-agent-context')!;
      const chips = panel.querySelector<HTMLElement>('.sw-agent-chips');
      const height = Math.max(0, panel.clientHeight - toolbar.offsetHeight - context.offsetHeight - (chips?.offsetHeight ?? 0));
      host.current?.style.setProperty('--sw-prompt-max-height', `${height}px`);
      view.scrollDOM.style.maxHeight = `${height}px`;
      view.requestMeasure();
    };
    const observer = new ResizeObserver(measure); observer.observe(panel);
    const chips = panel.querySelector<HTMLElement>('.sw-agent-chips'); if (chips) observer.observe(chips);
    measure();
    return () => { alive = false; observer.disconnect(); view.destroy(); };
  }, []);
  return <div className="sw-agent-prompt" ref={host} />;
}

type Entry = { id: number; role: 'You' | 'Agent' | 'Status'; text: string; time: number; references?: { id: string; name: string }[] };
type Activity = 'idle' | 'working' | 'completed' | 'problem';
export function AgentPanel({ api, width, open }: { api: SiteWallAPI; width: number; open: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<Activity>('idle');
  const [version, setVersion] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [mode, setMode] = useState<'creative' | 'express' | null>(null);
  const modeRef = useRef(mode);
  const [agent, setAgent] = useState(() => api.agent.snapshot());
  const [shownCard, setShownCard] = useState<string>();
  const references = useReferences(api);
  const output = useRef<HTMLDivElement>(null);
  const follow = useRef(true), running = useRef(false), acceptResults = useRef(false), counter = useRef(0);
  const completion = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const epoch = useRef(0);
  const continuationSequence = useRef(0);
  const continueInput = useRef(true);
  const internalPrompt = useRef(false);
  const append = (role: Entry['role'], text: string, references?: Entry['references']) => setEntries(previous => [...previous, { id: ++counter.current, role, text, references, time: Date.now() }]);
  useEffect(() => api.subscribe(event => {
    if (event.type.startsWith('agent-')) {
      setAgent(api.agent.snapshot());
      return;
    }
    if (event.type === 'prompt-begin') {
      clearTimeout(completion.current); acceptResults.current = true; running.current = true; setBusy(true); setActivity('working');
      if (!internalPrompt.current) { const detail = event.detail as { instruction: string; references?: Entry['references'] }; append('You', detail.instruction, detail.references); }
    } else if (acceptResults.current && event.type === 'prompt-result') {
      const result = event.detail as PromptResult;
      append('Agent', result.output || '(No output)'); running.current = false; setBusy(false);
      setActivity(result.status === 'completed' ? 'completed' : 'problem');
      if (result.status === 'completed') completion.current = setTimeout(() => setActivity('idle'), 1500);
    } else if (acceptResults.current && event.type === 'prompt-failure') {
      const failure = event.detail as { stopped: boolean; message: string };
      if (failure.stopped) continueInput.current = false;
      append('Status', failure.message); running.current = false; setBusy(false); setActivity(failure.stopped ? 'idle' : 'problem');
    }
  }), [api]);
  useEffect(() => () => { clearTimeout(completion.current); epoch.current++; continueInput.current = false; }, []);
  useEffect(() => {
    const element = output.current!;
    const reveal = () => { if (follow.current && open) element.scrollTop = element.scrollHeight; };
    const observer = new ResizeObserver(reveal);
    for (const block of element.children) observer.observe(block);
    reveal(); return () => observer.disconnect();
  }, [entries, agent, open]);
  const stop = async () => {
    continueInput.current = false;
    try { await api.stopPrompt(); }
    catch (error) { append('Status', String(error)); setActivity('problem'); throw error; }
  };
  const fresh = async () => {
    epoch.current++;
    clearTimeout(completion.current); acceptResults.current = false; follow.current = true;
    setEntries([]); setVersion(value => value + 1); setActivity('idle'); setResetting(true);
    try { if (running.current) await stop(); }
    catch { /* Cancellation error is shown; retain its warning instead of claiming success. */ }
    finally { api.agent.reset(); api.references.clearSelection(); modeRef.current = null; setMode(null); running.current = false; setBusy(false); setResetting(false); }
  };
  const send = async (text: string, internal = false, useReferences = true) => {
    if (internal && modeRef.current) text = `.${modeRef.current} ${text}`;
    if (resetting) throw new Error('Session is resetting');
    if (text.length > 16000) { setActivity('problem'); append('Status', 'Instruction must be at most 16000 characters'); throw new Error('Instruction must be at most 16000 characters'); }
    const request = { references: internal || !useReferences ? [] : api.references.forPrompt(text), tags: (useReferences || internal) && modeRef.current ? [modeRef.current] : [] };
    if (running.current) {
      api.agent.enqueue(text, request);
      api.references.clearSelection(request.references.map(asset => asset.id));
      return;
    }
    continueInput.current = true;
    internalPrompt.current = internal;
    if (internal) continuationSequence.current = api.agent.snapshot().inputs.filter(item => item.state === 'queued').at(-1)?.sequence ?? continuationSequence.current;
    const own = epoch.current;
    running.current = true; setBusy(true); setActivity('working');
    try { await api.executePrompt(text, request); }
    catch (error) {
      if (own === epoch.current && running.current) { append('Status', String(error)); setActivity('problem'); }
      throw error;
    } finally {
      if (own === epoch.current) {
        running.current = false; setBusy(false);
        internalPrompt.current = false;
        // A CLI operation ending is also a safe boundary. Preserve unread input
        // rather than requiring the owner to resend it after the process exits.
        const queued = api.agent.snapshot().inputs.filter(item => item.state === 'queued');
        const latest = queued.at(-1)?.sequence ?? 0;
        if (continueInput.current && latest > continuationSequence.current) {
          continuationSequence.current = latest;
          void send('Queued owner input is ready. Retrieve agent.takeOwnerInput(), incorporate it in order, and acknowledge each input.', true).catch(() => {});
        }
      }
    }
  };
  const state = api.getState();
  const waiting = agent.interactions.find(item => item.state === 'waiting');
  const waitingId = waiting?.card.id;
  useEffect(() => { setShownCard(waitingId); }, [waitingId]);
  const status = waiting ? 'Waiting for you' : busy ? agent.status === 'Idle' ? 'Working' : agent.status : references.pending ? 'Loading references' : activity === 'completed' ? 'Completed' : activity === 'problem' ? 'Problem' : 'Idle';
  const toggle = async (next: 'creative' | 'express') => {
    const previous = modeRef.current;
    modeRef.current = previous === next ? null : next;
    setMode(modeRef.current);
    try {
      if (previous) await send(`.${previous} off`, false, false);
    } catch (error) { append('Status', String(error)); }
  };
  const context = state.selection ? `${state.selection.kind}: ${state.selection.route}` : `Page: ${state.currentRoute || 'none'}`;
  return <><aside className="sw-agent" style={{ width, display: open ? 'flex' : 'none' }} aria-label="Agent panel">
    <div className="sw-agent-toolbar" role="toolbar" aria-label="Agent controls">
      <strong>Agent</strong><button disabled={resetting} onClick={() => void fresh()}>New Session</button>
      <button disabled={!busy || resetting} onClick={() => void stop().catch(() => {})}>Stop</button>
      <span className={`sw-agent-activity sw-${waiting ? 'waiting' : activity}`} title={status} />
      <span className="sw-agent-status" role="status">{status}</span>
    </div>
    <div className="sw-agent-context" title={context}>{context}</div>
    <div className="sw-agent-history" ref={output} aria-label="Agent output history" onScroll={event => {
      const element = event.currentTarget; follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    }}>{[...entries.map(entry => ({ time: entry.time, node: <div className="sw-agent-entry" data-role={entry.role} key={entry.id}>
      <div className="sw-agent-entry-label">{entry.role}</div>
      {outputParts(entry.text).map((part, index) => <OutputEditor key={index} {...part} />)}
      {entry.references?.length ? <div className="sw-agent-reference-history">{entry.references.map(asset => <span key={asset.id}>{asset.name}</span>)}</div> : null}
    </div> })),
      ...agent.inputs.filter(item => item.instruction).map(item => ({ time: item.time, node: <div className="sw-agent-entry sw-agent-owner-input" key={item.id}>
        <div className="sw-agent-entry-label">You · {item.state === 'queued' ? 'Queued' : item.state === 'delivered' ? 'Delivered at boundary' : 'Incorporated'}</div>
        <OutputEditor text={item.instruction!} command={false} />
        {item.references?.length ? <div className="sw-agent-reference-history">{item.references.map(asset => <span key={asset.id}>{asset.name}</span>)}</div> : null}
        {item.acknowledgement && <p>{item.acknowledgement}</p>}
      </div> })),
      ...agent.interactions.map(item => ({ time: item.time, node: <div className="sw-agent-interaction-history" key={item.card.id}>
        <strong>{item.card.title}</strong><p>{item.card.summary}</p>
        <span>{item.state === 'waiting' ? 'Waiting for you' : item.state === 'submitted' ? 'Sent · awaiting agent result' : item.state === 'completed' ? 'Completed' : 'Failed'}</span>
        {item.state === 'waiting' && item.card.id === waiting?.card.id && <button onClick={() => setShownCard(item.card.id)}>Respond</button>}
        {item.response && <p>Your response: {item.response.action}{item.response.selected?.length ? ` · ${item.response.selected.join(', ')}` : ''}{item.response.text ? ` · ${item.response.text}` : ''}</p>}
        {item.result && <p>{item.result}</p>}
      </div> }))].sort((a, b) => a.time - b.time).map(item => item.node)}
    </div>
    <PromptEditor key={version} send={async text => { const own = epoch.current; await api.references.whenReady(); if (own !== epoch.current) throw new DOMException('Session changed', 'AbortError'); await send(modeRef.current ? `.${modeRef.current} ${text}` : text); }} addFiles={files => { void importReferenceFiles(api, files, message => { if (message) append('Status', message); }); }} />
    <div className="sw-agent-chips" aria-label="Agent modes">
      {(['creative', 'express'] as const).map(value => <button key={value} aria-pressed={mode === value} disabled={resetting} onClick={() => void toggle(value)}>{value === 'creative' ? 'Creative' : 'Express'}</button>)}
      <span className="sw-agent-route-chip" title={context}>{state.selection?.route || state.currentRoute || 'No page'}</span>
      {references.assets.filter(asset => references.selected.includes(asset.id)).map(asset => <span className="sw-agent-reference-chip" key={asset.id} title={asset.alias ? `@${asset.alias}` : asset.name}>{asset.name}<button aria-label={`Unselect ${asset.name}`} onClick={() => api.references.select(asset.id, false)}>×</button></span>)}
    </div>
    </aside>
    {waiting && <AgentInteractionDialog key={waiting.card.id} interaction={waiting} visible={shownCard === waiting.card.id} dismiss={() => setShownCard(undefined)} respond={response => { api.agent.respond(response); if (!running.current) void send('Owner interaction response is ready. Retrieve agent.takeOwnerInput() and handle the structured intent, then acknowledge and report its result.', true).catch(() => {}); }} />}
  </>;
}
