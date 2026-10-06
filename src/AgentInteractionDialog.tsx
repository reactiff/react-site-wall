import { useEffect, useRef, useState } from 'react';
import type { AgentArtifact, AgentInteraction, AgentResponse } from './types.js';
import { safeArtifactUrl } from './agent-session.js';

function Artifacts({ items = [] }: { items?: AgentArtifact[] }) {
  return <div className="sw-agent-artifacts">{items.filter(item => safeArtifactUrl(item.url)).map((item, index) => <a key={index} href={item.url} target="_blank" rel="noopener noreferrer">
    {item.kind === 'image' && <img src={item.url} alt={item.title} />}{item.title}
  </a>)}</div>;
}
export function AgentInteractionDialog({ interaction, respond, visible, dismiss }: { interaction: AgentInteraction; respond: (response: AgentResponse) => void; visible: boolean; dismiss: () => void }) {
  const { card, state } = interaction;
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [followup, setFollowup] = useState<AgentResponse['action']>();
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const send = (action: AgentResponse['action']) => {
    try { respond({ cardId: card.id, action, selected, text }); setError(''); }
    catch (failure) { setError(String(failure)); }
  };
  const sender = useRef(send); sender.current = send;
  useEffect(() => {
    const element = dialog.current!;
    if (visible) element.showModal(); else element.close();
    return () => { element.close(); };
  }, [visible]);
  useEffect(() => {
    if (state !== 'waiting' || !card.deadline || !card.allowPass) return;
    const timer = setInterval(() => { setNow(Date.now()); if (Date.now() >= card.deadline!) sender.current('pass'); }, 250);
    return () => clearInterval(timer);
  }, [state, card.deadline, card.allowPass]);
  const action = (value: AgentResponse['action']) => {
    if (value === 'revise' || (value === 'reject' && card.type === 'implementation-approval')) { setFollowup(value); setText(''); }
    else send(value);
  };
  const buttons: { action: AgentResponse['action']; label: string }[] = card.type === 'proposal'
    ? [{ action: 'approve', label: 'Approve' }, { action: 'reject', label: 'Reject' }, { action: 'revise', label: 'Revise' }]
    : card.type === 'implementation-approval' ? [{ action: 'implement', label: 'Implement' }, { action: 'revise', label: 'Revise' }, { action: 'reject', label: 'Reject' }]
    : card.type === 'review' ? [{ action: 'accept', label: 'Accept' }, { action: 'revise', label: 'Revise' }, ...(card.canRevert ? [{ action: 'revert' as const, label: 'Revert' }] : [])]
    : card.type === 'variants' ? [{ action: 'select', label: 'OK' }]
    : [{ action: 'answer', label: 'Send answer' }, ...(card.type === 'owner-turn' && card.allowPass ? [{ action: 'pass' as const, label: 'Pass' }] : [])];
  return <dialog ref={dialog} className="sw-agent-dialog" aria-labelledby={`sw-card-${card.id}`} onCancel={event => { event.preventDefault(); dismiss(); }}>
    <button className="sw-agent-dialog-close" aria-label="Close interaction" onClick={dismiss}>Close</button>
    <div className="sw-agent-card-kind">{card.type.replaceAll('-', ' ')}</div>
    <h2 id={`sw-card-${card.id}`}>{card.title}</h2><p>{card.summary}</p>
    {card.implications?.length ? <><h3>Implications</h3><ul>{card.implications.map((item, i) => <li key={i}>{item}</li>)}</ul></> : null}
    {card.changes?.length ? <><h3>Changes</h3><ul>{card.changes.map((item, i) => <li key={i}>{item}</li>)}</ul></> : null}
    <Artifacts items={card.artifacts} />
    {state === 'submitted' ? <p role="status">Sent to the agent. Waiting for the result…</p> : <>
      <div className={card.type === 'variants' ? 'sw-agent-variants' : 'sw-agent-choices'}>{card.choices?.map(choice => <label className="sw-agent-choice" key={choice.id}>
        <span><input type={card.selection === 'many' ? 'checkbox' : 'radio'} name={`choice-${card.id}`} checked={selected.includes(choice.id)} onChange={event => setSelected(previous => card.selection === 'many' ? event.target.checked ? [...previous, choice.id] : previous.filter(id => id !== choice.id) : [choice.id])} /> <strong>{choice.title}</strong></span>
        {choice.description && <p>{choice.description}</p>}
        {choice.differentiators && <ul>{choice.differentiators.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        <Artifacts items={choice.artifacts} />
      </label>)}</div>
      {(followup || ((card.type === 'clarification' || card.type === 'owner-turn') && card.allowText !== false)) && <label className="sw-agent-answer">
        {followup === 'reject' ? 'What should happen next?' : followup === 'revise' ? 'What would you like revised?' : 'Your answer'}
        <textarea autoFocus={!!followup} value={text} onChange={event => setText(event.target.value)} />
      </label>}
      {card.deadline && card.allowPass && <p role="timer">Pass in {Math.max(0, Math.ceil((card.deadline - now) / 1000))} seconds</p>}
      <div className="sw-agent-card-actions">{followup ? <><button onClick={() => setFollowup(undefined)}>Back</button><button disabled={!text.trim()} onClick={() => send(followup)}>Send</button></> : buttons.map(button => <button key={button.action} onClick={() => action(button.action)}>{button.label}</button>)}</div>
    </>}
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
