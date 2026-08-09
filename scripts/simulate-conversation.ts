import { readFile } from 'node:fs/promises';
import { compileConfig, type CompileInput } from '../src/domain/compiler.js';
import { evaluateConversation } from '../src/domain/engine.js';
import type { ConversationState } from '../src/domain/types.js';

function parseArgs(argv = process.argv.slice(2)): void {
  for (const arg of argv) {
    if (/[\u0000-\u001f\u007f]/.test(arg)) {
      throw new Error('Invalid simulate-conversation argument');
    }
  }
  if (argv.length > 0) {
    throw new Error('simulate-conversation does not accept arguments');
  }
}

parseArgs();

const seed = JSON.parse(await readFile('./config/seed-real-estate.json', 'utf8')) as CompileInput;
const config = compileConfig(seed);
let state: ConversationState = {
  clientRecordId: 'recCLIENT00000001',
  clientId: 'client_demo',
  phoneNormalized: '+201000000000',
  leadRecordId: 'recLEAD000000001',
  leadId: 'lead_demo',
  leadName: 'Ahmed',
  companyName: 'Demo Realty',
  projectName: 'Palm Heights',
  projectRecordId: 'recPROJECT000001',
  preferredLanguage: '',
  currentStage: '',
  currentQuestionKey: '',
  answers: {},
  retryCount: 0,
  status: 'contacted',
  humanTakeover: false,
  stopFollowUp: false,
  closedStatus: '',
  appointmentStatus: '',
  assignedSalespersonRecordId: '',
  assignedSalespersonPhone: '',
  lastInboundAt: '2026-07-28T00:00:00.000Z',
  conversationWindowExpiresAt: '2026-07-29T00:00:00.000Z',
  conversationEngine: 'legacy',
  stateAuthority: 'legacy',
  configVersion: config.version,
  stateVersion: 0,
};

const turns: Array<{ text?: string; optionId?: string }> = [
  { text: 'hello' },
  { optionId: 'lang_en' },
  { optionId: 'perm_yes' },
  { text: 'New Cairo' },
  { optionId: 'unit_villa' },
  { optionId: 'budget_3_5' },
  { optionId: 'pay_cash' },
  { optionId: 'tl_now' },
  { optionId: 'pur_residence' },
  { optionId: 'sv_no' },
];

for (const [index, turn] of turns.entries()) {
  const decision = evaluateConversation({
    state,
    config,
    ...(turn.text !== undefined ? { messageText: turn.text } : {}),
    ...(turn.optionId !== undefined ? { messageOptionId: turn.optionId } : {}),
  });
  state = decision.nextState;
  console.log(
    JSON.stringify(
      {
        turn: index + 1,
        input: turn,
        action: decision.action,
        replyKey: decision.replyKey,
        stageBefore: decision.stageBefore,
        stageAfter: decision.stageAfter,
        parsedValue: decision.parsedValue ?? null,
        reply: decision.text,
      },
      null,
      2,
    ),
  );
}

if (state.currentStage !== 'qualified') {
  throw new Error(`Expected qualified, got ${state.currentStage}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      finalStage: state.currentStage,
      answers: state.answers,
      stateVersion: state.stateVersion,
    },
    null,
    2,
  ),
);
