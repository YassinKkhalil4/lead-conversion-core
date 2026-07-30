import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import { parseEgpAmount, parseEgpRange } from '../src/domain/normalization.js';
import type { ConversationState } from '../src/domain/types.js';

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

assert.equal(parseEgpAmount('٥ مليون ونص'), 5_500_000);
assert.deepEqual(parseEgpRange('من ٣ لـ ٥ مليون'), { min: 3_000_000, max: 5_000_000 });

const permission = evaluateConversation({ state: base, config, messageOptionId: 'perm_yes' });
assert.equal(permission.stageAfter, 'asking_location');

const cash = evaluateConversation({
  state: { ...base, currentStage: 'asking_payment_plan', currentQuestionKey: 'q_payment_plan' },
  config,
  messageOptionId: 'pay_cash',
});
assert.equal(cash.stageAfter, 'asking_timeline');

const completion = evaluateConversation({
  state: {
    ...base,
    currentStage: 'asking_site_visit',
    currentQuestionKey: 'q_site_visit',
    answers: { q_location: 'New Cairo', q_unit_type: 'Villa', q_purpose: 'Primary Residence' },
  },
  config,
  messageOptionId: 'sv_yes',
});
assert.equal(completion.action, 'complete');
assert.equal(completion.stageAfter, 'qualified');

console.log(JSON.stringify({
  ok: true,
  configVersion: config.version,
  questions: config.questions.length,
  options: config.questions.reduce((sum, q) => sum + q.options.length, 0),
  messages: Object.keys(config.messages).length,
}, null, 2));
