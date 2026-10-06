import type { AgentAPI, AgentCard, AgentOwnerInput, AgentResponse, AgentSnapshot, ContextSelection } from './types.js';

const types = new Set(['clarification', 'proposal', 'variants', 'implementation-approval', 'review', 'owner-turn']);
const actions: Record<AgentCard['type'], AgentResponse['action'][]> = {
  clarification: ['answer'], proposal: ['approve', 'reject', 'revise'], variants: ['select'],
  'implementation-approval': ['implement', 'revise', 'reject'], review: ['accept', 'revise', 'revert'], 'owner-turn': ['answer', 'pass'],
};
export function safeArtifactUrl(url: string): boolean {
  return typeof url === 'string' && (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url));
}

/** In-memory interaction layer. Execution, protocols and Git remain agent-owned. */
export class AgentSession implements AgentAPI {
  private data: AgentSnapshot = { inputs: [], interactions: [], status: 'Idle' };
  private sequence = 0;
  constructor(private emit: (type: string, detail: unknown) => void, private reference?: () => ContextSelection | null) {}
  snapshot = (): AgentSnapshot => structuredClone({ ...this.data, status: this.data.interactions.some(item => item.state === 'waiting') ? 'Waiting for you' : this.data.status });
  private notify(type: string, detail: unknown) { this.emit(`agent-${type}`, structuredClone(detail)); }
  private input(instruction?: string, response?: AgentResponse): AgentOwnerInput {
    if (this.data.inputs.filter(item => item.state !== 'acknowledged').length >= 100) throw new Error('Owner input queue is full');
    const item: AgentOwnerInput = { id: crypto.randomUUID(), sequence: ++this.sequence, time: Date.now(), instruction, response, state: 'queued' };
    const reference = instruction ? this.reference?.() : null;
    if (reference) item.reference = structuredClone(reference);
    this.data.inputs.push(item); this.notify('input', item); return structuredClone(item);
  }
  enqueue = (instruction: string) => {
    if (typeof instruction !== 'string' || !instruction.trim() || instruction.length > 16000) throw new Error('Instruction must contain 1–16000 characters');
    return this.input(instruction);
  };
  takeOwnerInput = () => {
    const items = this.data.inputs.filter(item => item.state !== 'acknowledged');
    items.forEach(item => { item.state = 'delivered'; });
    if (items.length) this.notify('delivery', items);
    return structuredClone(items);
  };
  acknowledge = (id: string, message?: string) => {
    const item = this.data.inputs.find(input => input.id === id);
    if (!item || item.state === 'queued') throw new Error('Input must be delivered before acknowledgement');
    item.state = 'acknowledged'; item.acknowledgement = message;
    this.notify('acknowledgement', item);
  };
  requestInteraction = (card: AgentCard) => {
    if (!card || !types.has(card.type) || typeof card.id !== 'string' || !card.id || typeof card.title !== 'string' || typeof card.summary !== 'string') throw new Error('Invalid interaction card');
    if (this.data.interactions.some(item => item.card.id === card.id)) throw new Error('Interaction id already exists');
    if (card.selection && !['one', 'many'].includes(card.selection)) throw new Error('Invalid selection mode');
    if (card.deadline !== undefined && (!Number.isFinite(card.deadline) || card.type !== 'owner-turn' || !card.allowPass)) throw new Error('Deadline requires an owner turn with pass enabled');
    if (card.choices && (!Array.isArray(card.choices) || card.choices.some(choice => !choice || typeof choice.id !== 'string' || typeof choice.title !== 'string') || new Set(card.choices.map(choice => choice.id)).size !== card.choices.length)) throw new Error('Invalid choices');
    if (card.type === 'variants' && !card.choices?.length) throw new Error('Variants require choices');
    for (const artifact of [...(card.artifacts ?? []), ...(card.choices ?? []).flatMap(choice => choice.artifacts ?? [])]) {
      if (!artifact || !safeArtifactUrl(artifact.url) || !['image', 'preview', 'artifact'].includes(artifact.kind)) throw new Error('Artifacts require browser-accessible image or HTTP URLs');
    }
    this.data.interactions.push({ card: structuredClone(card), time: Date.now(), state: 'waiting' });
    this.notify('interaction', card);
  };
  respond = (response: AgentResponse) => {
    const item = this.data.interactions.find(item => item.card.id === response?.cardId);
    if (!item || item.state !== 'waiting') throw new Error('Interaction is not awaiting a response');
    const card = item.card;
    if (!actions[card.type].includes(response.action) || (response.action === 'revert' && !card.canRevert) || (response.action === 'pass' && !card.allowPass)) throw new Error('Unsupported interaction action');
    if ((response.action === 'revise' || (card.type === 'implementation-approval' && response.action === 'reject')) && !response.text?.trim()) throw new Error(response.action === 'reject' ? 'What should happen next?' : 'Describe the revision');
    const selected = response.selected ?? [];
    if (!Array.isArray(selected) || selected.some(id => !card.choices?.some(choice => choice.id === id)) || new Set(selected).size !== selected.length || (card.selection !== 'many' && selected.length > 1)) throw new Error('Invalid selection');
    if (response.action === 'select' && !selected.length) throw new Error('Select a variant');
    if (response.action === 'answer' && !selected.length && !response.text?.trim()) throw new Error('Provide an answer');
    if (response.action === 'answer' && response.text?.trim() && card.allowText === false) throw new Error('Free-text answers are disabled');
    this.input(undefined, structuredClone(response));
    item.response = structuredClone(response); item.state = 'submitted';
    this.notify('response', response);
  };
  reportInteraction = (cardId: string, result: { success: boolean; summary: string }) => {
    const item = this.data.interactions.find(item => item.card.id === cardId);
    if (!item || item.state !== 'submitted' || typeof result?.success !== 'boolean' || typeof result.summary !== 'string') throw new Error('Expected submitted interaction and result');
    item.state = result.success ? 'completed' : 'failed'; item.result = result.summary;
    this.notify('result', { cardId, ...result });
  };
  setStatus = (status: string) => {
    if (typeof status !== 'string' || status.length > 200) throw new Error('Invalid status');
    this.data.status = status; this.notify('status', status);
  };
  reset = () => { this.data = { inputs: [], interactions: [], status: 'Idle' }; this.notify('reset', {}); };
}
