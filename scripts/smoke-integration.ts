import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import { compareParity } from '../src/services/parity.js';
import type { ConversationState } from '../src/domain/types.js';

function parseArgs(argv = process.argv.slice(2)): void {
  for (const arg of argv) {
    if (/[\u0000-\u001f\u007f]/.test(arg)) {
      throw new Error('Invalid smoke-integration argument');
    }
  }
  if (argv.length > 0) {
    throw new Error('smoke-integration does not accept arguments');
  }
}

parseArgs();

const seed = JSON.parse(await readFile('./config/seed-real-estate.json', 'utf8')) as CompileInput;
const config = compileConfig({ ...seed, now: '2026-07-28T00:00:00.000Z' });
const base: ConversationState = {
  clientRecordId: 'recCLIENT00000001', clientId: 'client_demo', phoneNormalized: '+201000000000',
  leadRecordId: 'recLEAD000000001', leadId: 'lead_demo', leadName: 'Ahmed', companyName: 'Demo Realty',
  projectName: 'Palm Heights', projectRecordId: 'recPROJECT000001', preferredLanguage: 'English',
  currentStage: 'awaiting_permission', currentQuestionKey: 'q_permission', answers: {}, retryCount: 0,
  status: 'in_qualification', humanTakeover: false, stopFollowUp: false, closedStatus: '',
  appointmentStatus: '', assignedSalespersonRecordId: '', assignedSalespersonPhone: '',
  lastInboundAt: '2026-07-28T00:00:00.000Z', conversationWindowExpiresAt: '2026-07-29T00:00:00.000Z',
  conversationEngine: 'legacy', stateAuthority: 'legacy', configVersion: config.version, stateVersion: 0,
};

const suppressed: Array<Partial<ConversationState>> = [
  { stopFollowUp: true },
  { humanTakeover: true },
  { currentStage: 'human_takeover' },
  { currentStage: 'stopped' },
  { status: 'unsubscribed' },
  { status: 'not_interested' },
  { status: 'invalid_number' },
  { status: 'won' },
  { status: 'lost' },
  { closedStatus: 'Won' },
  { closedStatus: 'Lost' },
  { appointmentStatus: 'booked' },
];
for (const override of suppressed) {
  const decision = evaluateConversation({ state: { ...base, ...override }, config, messageText: 'hello' });
  assert.equal(decision.action, 'no_reply', JSON.stringify(override));
  assert.ok(decision.suppressionReason);
}

const retry = evaluateConversation({
  state: { ...base, currentStage: 'asking_budget', currentQuestionKey: 'q_budget', retryCount: 1 },
  config,
  messageText: 'not a budget at all',
});
assert.equal(retry.parseSource, 'raw_fallback');
assert.match(retry.nextState.answers.qualification_notes || '', /unparsed answer/);

const parity = compareParity(
  {
    ...retry,
    text: 'Question',
    messageKind: 'buttons',
    interactiveOptions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  },
  { text: 'Question', messageKind: 'buttons', interactiveOptionIds: ['a', 'b'], interactiveOptionLabels: ['A', 'B'] },
);
assert.equal(parity.status, 'match');

console.log(JSON.stringify({
  ok: true,
  stopConditionsChecked: suppressed.length,
  rawFallbackNotes: true,
  structuralParity: true,
  configVersion: config.version,
}, null, 2));
