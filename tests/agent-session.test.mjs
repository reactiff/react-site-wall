import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentSession } from '../dist/agent-session.js';

test('owner input is ordered, redelivered until acknowledged, and reset is ephemeral', () => {
  const events = [];
  const agent = new AgentSession((type, detail) => events.push({ type, detail }));
  const first = agent.enqueue('First thought'), second = agent.enqueue('Second thought');
  assert.throws(() => agent.acknowledge(first.id), /delivered/);
  const snapshot = agent.snapshot(); snapshot.inputs[0].instruction = 'tampered';
  assert.deepEqual(agent.takeOwnerInput().map(item => item.instruction), ['First thought', 'Second thought']);
  agent.acknowledge(first.id, 'Applied the first direction');
  assert.deepEqual(agent.takeOwnerInput().map(item => item.id), [second.id]);
  assert.equal(agent.snapshot().inputs[0].acknowledgement, 'Applied the first direction');
  agent.reset(); assert.deepEqual(agent.snapshot(), { inputs: [], interactions: [], status: 'Idle' });
  assert.ok(events.every(event => event.type.startsWith('agent-')));
});

test('interaction responses enforce selection and required followups; results stay agent-owned', () => {
  const agent = new AgentSession(() => {});
  agent.requestInteraction({ id: 'implementation', type: 'implementation-approval', title: 'Implement', summary: 'Change the header', metadata: { branch: 'internal' } });
  assert.equal(agent.snapshot().status, 'Waiting for you');
  assert.throws(() => agent.respond({ cardId: 'implementation', action: 'reject' }), /next/);
  agent.respond({ cardId: 'implementation', action: 'reject', text: 'Explore another direction' });
  assert.equal(agent.snapshot().interactions[0].state, 'submitted');
  assert.throws(() => agent.respond({ cardId: 'implementation', action: 'implement' }), /awaiting/);
  assert.equal(agent.takeOwnerInput()[0].response.text, 'Explore another direction');
  agent.reportInteraction('implementation', { success: true, summary: 'New direction started' });
  assert.equal(agent.snapshot().interactions[0].state, 'completed');
  agent.requestInteraction({ id: 'variants', type: 'variants', title: 'Choose', summary: 'Select one', choices: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] });
  assert.throws(() => agent.respond({ cardId: 'variants', action: 'select', selected: ['a', 'b'] }), /selection/);
  assert.throws(() => agent.respond({ cardId: 'variants', action: 'select', selected: ['unknown'] }), /selection/);
  agent.respond({ cardId: 'variants', action: 'select', selected: ['b'] });
  agent.requestInteraction({ id: 'review', type: 'review', title: 'Review', summary: 'Result' });
  assert.throws(() => agent.respond({ cardId: 'review', action: 'revert' }), /Unsupported/);
  agent.respond({ cardId: 'review', action: 'accept' });
  agent.reportInteraction('review', { success: false, summary: 'Merge conflict; no merge performed' });
  assert.equal(agent.snapshot().interactions.at(-1).state, 'failed');
});

test('cards validate pass deadlines and browser-safe artifact URLs', () => {
  const agent = new AgentSession(() => {});
  assert.throws(() => agent.requestInteraction({ id: 'bad', type: 'owner-turn', title: 'Question', summary: '?', deadline: Date.now() }), /pass/);
  assert.throws(() => agent.requestInteraction({ id: 'bad', type: 'review', title: 'Result', summary: 'Done', artifacts: [{ title: 'Bad', kind: 'preview', url: 'javascript:alert(1)' }] }), /URLs/);
  agent.requestInteraction({ id: 'turn', type: 'owner-turn', title: 'Question', summary: '?', deadline: Date.now(), allowPass: true });
  agent.respond({ cardId: 'turn', action: 'pass' });
  assert.equal(agent.takeOwnerInput()[0].response.action, 'pass');
});
