import type { Lead } from '@/api/types';

/**
 * The backend schedules its first assignment reminder 15 minutes after
 * assignment and escalates to the manager at 30. Past the reminder you are
 * already late, so that is where the queue draws the line.
 */
export const PAST_SLA_SECONDS = 15 * 60;

/**
 * Strict priority. Chronological ordering is what this rebuild exists to
 * remove: a hot lead assigned 40 minutes ago and unacknowledged must never sit
 * below a cold lead that merely arrived more recently.
 */
export enum QueueState {
  UnacknowledgedPastSla = 1,
  UnacknowledgedWithinSla = 2,
  AwaitingReply = 3,
  Everything = 4,
}

export interface RankedLead {
  lead: Lead;
  state: QueueState;
  /** The timestamp the row's clock counts from. */
  clockFrom: string | null;
  waitingSeconds: number;
  needsAcknowledgement: boolean;
}

function seconds(from: string | null | undefined, now: Date): number {
  if (!from) return 0;
  const parsed = Date.parse(from);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor((now.getTime() - parsed) / 1000)) : 0;
}

function isUnacknowledged(lead: Lead): boolean {
  return Boolean(lead.assignment && lead.assignment.status === 'assigned' && !lead.assignment.acknowledgedAt);
}

/**
 * A qualified hot lead whose last inbound message has had no outbound reply
 * after it. These are the leads going cold while nobody notices.
 */
function isAwaitingReply(lead: Lead): boolean {
  if (lead.status === 'closed') return false;
  const qualifiedAndHot = lead.status === 'qualified' && lead.temperature === 'hot';
  if (!qualifiedAndHot || !lead.lastInboundAt) return false;
  if (!lead.lastOutboundAt) return true;
  return Date.parse(lead.lastOutboundAt) < Date.parse(lead.lastInboundAt);
}

export function classify(lead: Lead, now: Date = new Date()): RankedLead {
  const needsAcknowledgement = isUnacknowledged(lead);

  if (needsAcknowledgement) {
    const clockFrom = lead.assignment?.assignedAt ?? null;
    const waitingSeconds = seconds(clockFrom, now);
    return {
      lead,
      state:
        waitingSeconds >= PAST_SLA_SECONDS
          ? QueueState.UnacknowledgedPastSla
          : QueueState.UnacknowledgedWithinSla,
      clockFrom,
      waitingSeconds,
      needsAcknowledgement: true,
    };
  }

  // Everything else counts from the lead's last inbound message, falling back
  // to any activity so a row never shows an empty clock.
  const clockFrom = lead.lastInboundAt ?? lead.lastMessageAt ?? lead.createdAt;
  return {
    lead,
    state: isAwaitingReply(lead) ? QueueState.AwaitingReply : QueueState.Everything,
    clockFrom,
    waitingSeconds: seconds(clockFrom, now),
    needsAcknowledgement: false,
  };
}

export function rankLeads(leads: Lead[], now: Date = new Date()): RankedLead[] {
  const seen = new Set<string>();
  const ranked: RankedLead[] = [];
  for (const lead of leads) {
    if (seen.has(lead.leadId)) continue;
    seen.add(lead.leadId);
    ranked.push(classify(lead, now));
  }

  return ranked.sort((a, b) => {
    if (a.state !== b.state) return a.state - b.state;
    // Within the action states the longest wait is the most urgent. In the
    // remainder, the most recently active lead is the most relevant.
    if (a.state === QueueState.Everything) return a.waitingSeconds - b.waitingSeconds;
    return b.waitingSeconds - a.waitingSeconds;
  });
}

export function urgentCount(ranked: RankedLead[]): number {
  return ranked.filter((entry) => entry.state === QueueState.UnacknowledgedPastSla).length;
}

/** The timestamp used to decide whether a row changed since the last visit. */
export function lastActivityAt(lead: Lead): string | null {
  const candidates = [lead.lastMessageAt, lead.assignment?.assignedAt ?? null, lead.createdAt].filter(
    (value): value is string => Boolean(value),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest));
}

function humaniseStage(stage: string): string {
  const cleaned = stage.replace(/_/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned[0]!.toUpperCase() + cleaned.slice(1);
}

/**
 * The row's one-line context.
 *
 * The intended line is the lead's own answers — unit, location, budget,
 * payment plan, timeline — but `/api/leads` does not return qualification
 * answers, only `/api/leads/:id` does. Rather than fetch a full detail payload
 * per visible row, this shows what the list genuinely knows: the matched
 * project, or where the conversation has reached. See DEPLOY notes in the
 * session report for the one-line backend change that would fix this properly.
 */
export function rowSummary(lead: Lead): string {
  const project = [lead.project?.projectName, lead.project?.location].filter(Boolean).join(' · ');
  if (project) return project;
  if (lead.status !== 'qualified' && lead.currentStage) return humaniseStage(lead.currentStage);
  return '';
}

export interface DayCounts {
  received: number;
  acknowledged: number;
  replied: number;
}

/**
 * Counted from the leads currently loaded, which is exact for a salesperson's
 * own queue and an undercount only if they have more leads than a page holds.
 */
export function countToday(leads: Lead[], now: Date = new Date()): DayCounts {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const isToday = (value: string | null | undefined): boolean =>
    Boolean(value) && Date.parse(value as string) >= dayStart;

  return {
    received: leads.filter((lead) => isToday(lead.createdAt)).length,
    acknowledged: leads.filter((lead) => isToday(lead.assignment?.acknowledgedAt ?? null)).length,
    replied: leads.filter((lead) => isToday(lead.lastOutboundAt)).length,
  };
}
