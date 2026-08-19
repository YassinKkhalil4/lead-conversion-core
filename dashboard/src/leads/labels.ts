/** Question keys are stable identifiers from the conversation configuration. */
const QUESTION_LABELS: Record<string, string> = {
  q_permission: 'Permission to ask',
  q_location: 'Location',
  q_unit_type: 'Unit type',
  q_budget: 'Budget',
  q_payment_plan: 'Payment plan',
  q_down_payment: 'Down payment',
  q_timeline: 'Timeline',
  q_purpose: 'Purpose',
  q_site_visit: 'Site visit',
};

export function questionLabel(key: string): string {
  return QUESTION_LABELS[key] ?? humanise(key.replace(/^q_/, ''));
}

const FACTOR_LABELS: Record<string, string> = {
  base: 'Base score',
  budget: 'Budget',
  timeline: 'Timeline',
  site_visit: 'Site visit',
  payment_plan: 'Payment plan',
  purpose: 'Purpose',
  unit_type: 'Unit type',
  location_present: 'Location given',
  qualified_state: 'Reached qualified',
};

export function factorLabel(key: string): string {
  return FACTOR_LABELS[key] ?? humanise(key);
}

const EVENT_LABELS: Record<string, string> = {
  'lead.intake_received': 'Lead received',
  'message.send_requested': 'Outbound message queued',
  'sla.scheduled': 'SLA timer scheduled',
  'sla.cancelled': 'SLA timer cancelled',
  'sla.sent': 'SLA reminder sent',
  'followup.scheduled': 'Follow-up scheduled',
  'followup.cancelled': 'Follow-up cancelled',
  'dashboard.assignment_acknowledged': 'Assignment acknowledged',
  'dashboard.lead_closed': 'Lead closed',
  'dashboard.followups_stopped': 'Follow-ups stopped',
  'dashboard.human_takeover_enabled': 'Human took over',
  'dashboard.human_takeover_disabled': 'Handed back to the bot',
};

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? humanise(eventType.replace(/^[a-z]+\./, ''));
}

/** The pipeline stages accepted by PATCH /api/leads/:id/stage, in order. */
export const PIPELINE_STAGES = [
  'new',
  'in_progress',
  'site_visit_scheduled',
  'closed_won',
  'closed_lost',
  'ghosted',
] as const;

const STAGE_LABELS: Record<string, string> = {
  new: 'New',
  in_progress: 'In progress',
  site_visit_scheduled: 'Site visit scheduled',
  closed_won: 'Closed won',
  closed_lost: 'Closed lost',
  ghosted: 'Ghosted',
};

export function stageLabel(stage: string | null | undefined): string {
  // A lead from an API build before pipeline_stage existed, or from a cached
  // response persisted before it, has no stage. Read it as the default rather
  // than throwing inside humanise.
  if (typeof stage !== 'string' || stage === '') return STAGE_LABELS.new ?? 'New';
  return STAGE_LABELS[stage] ?? humanise(stage);
}

/** Outbound delivery state, phrased the way a salesperson would read it. */
export function deliveryLabel(state: string): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'requested':
      return 'Queued';
    case 'processing':
      return 'Sending';
    case 'accepted':
      return 'Sent';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
    case 'failed':
      return 'Failed';
    case 'delivery_unknown':
      return 'Unconfirmed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return humanise(state);
  }
}

function humanise(value: string): string {
  const spaced = value.replace(/[_.]/g, ' ').trim();
  return spaced.length === 0 ? value : spaced[0]!.toUpperCase() + spaced.slice(1);
}
