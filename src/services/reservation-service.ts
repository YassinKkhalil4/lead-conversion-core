import type { Db } from '../db/pool.js';
import { localized } from '../domain/language.js';
import { calendarDateIn, formatDate, parseCalendarDate, readDateShift } from '../domain/hospitality-normalization.js';
import { describeDate } from '../domain/hospitality-format.js';
import { renderTemplate } from '../domain/render.js';
import { ReservationReminderService } from './reservation-reminder-service.js';
import type { CompiledConfig, ConversationState, Language, ReplyDecision } from '../domain/types.js';
import { KadensioFloorPlanProvider } from '../integrations/reservations/kadensio-floor-plan.js';
import type { ReservationProvider } from '../integrations/reservations/types.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex } from '../infrastructure/runtime.js';

/**
 * The reservation step of a hospitality conversation.
 *
 * The engine is pure and only collects the answers. When it reports
 * `qualification_completed`, this service turns them into a booking on the same
 * transaction as the turn: it resolves the venue, zone and shift, checks the
 * date, asks the floor-plan provider for the table, assigns a host, and swaps
 * the engine's closing text for the one that says what actually happened
 * (booked, waiting for the venue, no table, closed that day).
 */

export interface ReservationTurn {
  state: ConversationState;
  config: CompiledConfig;
  decision: ReplyDecision;
  target: { leadId: string; clientId: string; contactId: string };
  appConversationId: string;
  now?: Date;
}

export type ReservationOutcome = 'booked' | 'requested' | 'unavailable' | 'closed' | 'handoff';

export interface ReservationTurnResult {
  decision: ReplyDecision;
  outcome: ReservationOutcome;
  reservationId?: string;
}

interface Tenant {
  timezone: string;
  deposit_threshold_party_size: number | null;
  floor_plan_provider: string;
  project_id: string | null;
  project_name: string;
  maps_url: string;
}

function labelOf(labels: unknown, language: Language, fallback: string): string {
  const map = (labels && typeof labels === 'object' ? labels : {}) as Record<string, string>;
  return map[language] || map.English || fallback;
}

export { describeDate };

export class ReservationService {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly providers: Record<string, ReservationProvider> = { kadensio: new KadensioFloorPlanProvider() },
    private readonly reminders = new ReservationReminderService(),
  ) {}

  /** Books the finished conversation. Throws only for database errors, which retry the turn. */
  async complete(db: Db, turn: ReservationTurn): Promise<ReservationTurnResult> {
    const { state, config, target } = turn;
    const language: Language = state.preferredLanguage || 'Spanish';
    const now = turn.now ?? new Date();

    const tenantRow = await db.query<Tenant>(
      `SELECT c.timezone, c.deposit_threshold_party_size, c.floor_plan_provider,
              pr.project_id, COALESCE(pr.project_name, '') AS project_name, COALESCE(pr.maps_url, '') AS maps_url
       FROM app.leads l
       JOIN app.clients c ON c.client_id=l.client_id
       -- The lead's venue, or else the client's first active one.
       LEFT JOIN LATERAL (
         SELECT p.project_id, p.project_name, p.maps_url
         FROM app.projects p
         WHERE p.client_id=c.client_id AND p.active=true
         ORDER BY (p.project_id = l.project_id) DESC, p.created_at, p.project_id
         LIMIT 1
       ) pr ON true
       WHERE l.lead_id=$1`,
      [target.leadId],
    );
    const tenant = tenantRow.rows[0];
    // The final answer is only in the engine's next state, not in the state the turn started from.
    const answers = turn.decision.nextState.answers;
    const partySize = Number.parseInt(answers.q_party_size || '', 10);
    const dateShift = readDateShift(answers.q_date_shift || '');
    const zoneKey = answers.q_zone || '';
    if (!tenant || !tenant.project_id || !Number.isInteger(partySize) || !dateShift || !zoneKey) {
      return this.handoff(turn, 'reservation_incomplete_or_venue_missing');
    }
    const provider = this.providers[tenant.floor_plan_provider];
    // A floor plan Kadensio cannot read yet (CoverManager before its adapter
    // exists) is never guessed at: a person confirms the table.
    if (!provider) return this.handoff(turn, `floor_plan_provider_unavailable:${tenant.floor_plan_provider}`);

    const venue = await db.query<{ zone_id: string; zone_labels: unknown; shift_id: string; shift_labels: unknown; days_open: number[]; starts_at_local: string; last_seating_local: string }>(
      `SELECT z.zone_id, z.labels AS zone_labels, s.shift_id, s.labels AS shift_labels,
              s.days_open, s.starts_at_local::text, s.last_seating_local::text
       FROM app.venue_zones z, app.venue_shifts s
       WHERE z.project_id=$1 AND z.zone_key=$2 AND z.active=true
         AND s.project_id=$1 AND s.shift_key=$3 AND s.active=true`,
      [tenant.project_id, zoneKey, dateShift.shift],
    );
    const v = venue.rows[0];
    if (!v) return this.handoff(turn, 'reservation_zone_or_shift_not_configured');

    const vars = (extra: Record<string, string> = {}) => ({
      party_size: String(partySize),
      date: describeDate(dateShift.date, language),
      shift: labelOf(v.shift_labels, language, dateShift.shift),
      zone: labelOf(v.zone_labels, language, zoneKey),
      maps_url: tenant.maps_url,
      ...extra,
    });

    // Open that day, and not already past.
    const today = calendarDateIn(tenant.timezone, now);
    const isoDay = ((new Date(Date.UTC(dateShift.date.year, dateShift.date.month - 1, dateShift.date.day)).getUTCDay() + 6) % 7) + 1;
    const dateString = formatDate(dateShift.date);
    const past = dateString < formatDate(today);
    const tooLateToday = dateString === formatDate(today) && this.localTime(now, tenant.timezone) > v.last_seating_local.slice(0, 5);
    if (past || tooLateToday || !v.days_open.includes(isoDay)) {
      return this.reprompt(turn, 'closed', 'reservation_closed', vars(), tenant);
    }

    const idempotencyKey = `reservation:${state.conversationId || target.leadId}:${sha256Hex(`${partySize}|${answers.q_date_shift}|${zoneKey}`).slice(0, 24)}`;
    const result = await provider.book(db, {
      clientId: target.clientId,
      projectId: tenant.project_id,
      contactId: target.contactId,
      leadId: target.leadId,
      conversationId: turn.appConversationId || null,
      zoneId: v.zone_id,
      shiftId: v.shift_id,
      serviceDate: dateString,
      timezone: tenant.timezone,
      partySize,
      depositThreshold: tenant.deposit_threshold_party_size,
      language,
      channel: 'whatsapp',
      notes: answers.qualification_notes || '',
      idempotencyKey,
    });

    if (result.outcome === 'unavailable') {
      return this.reprompt(turn, 'unavailable', 'reservation_unavailable', vars(), tenant);
    }

    // The dashboard's "reservation booked" stage is the pipeline stage the real-estate
    // flow calls site_visit_scheduled; a request waiting for the venue stays "in progress".
    await db.query(
      `UPDATE app.leads
       SET project_id=COALESCE(project_id, $2),
           pipeline_stage=CASE WHEN $3 THEN 'site_visit_scheduled' ELSE 'in_progress' END,
           updated_at=now()
       WHERE lead_id=$1`,
      [target.leadId, tenant.project_id, result.status === 'confirmed'],
    );
    if (!result.replayed) {
      await this.assignHostAndNotify(db, turn, tenant.project_id, tenant.project_name, result.reservationId, vars());
      if (result.status === 'confirmed') await this.reminders.schedule(db, result.reservationId);
    }

    const key = result.status === 'requested' ? 'reservation_requested' : 'reservation_confirmed';
    const text = this.text(config, key, language, state, tenant.project_name, vars());
    const nextState: ConversationState = {
      ...turn.decision.nextState,
      answers: { ...turn.decision.nextState.answers, q_deposit: result.depositRequired ? 'required' : 'none' },
    };
    return {
      outcome: result.status === 'requested' ? 'requested' : 'booked',
      reservationId: result.reservationId,
      decision: {
        ...turn.decision,
        replyKey: key,
        text,
        messageKind: 'text',
        nextState,
        outboxEvents: [
          ...turn.decision.outboxEvents,
          { eventType: 'reservation_created', payload: { reservationId: result.reservationId, status: result.status, replayed: result.replayed } },
        ],
      },
    };
  }

  /**
   * A guest asks to cancel. Cancels their next active reservation and says so;
   * null when they have none, so the message goes on to the normal flow.
   */
  async cancel(db: Db, input: { state: ConversationState; config: CompiledConfig; leadId: string; reservationId?: string }): Promise<ReplyDecision | null> {
    const { state, config } = input;
    const found = await db.query<{ reservation_id: string; party_size: number; service_date: string; shift_labels: unknown; zone_labels: unknown; project_name: string; timezone: string }>(
      `SELECT r.reservation_id, r.party_size, to_char(r.service_date, 'YYYY-MM-DD') AS service_date,
              s.labels AS shift_labels, z.labels AS zone_labels, p.project_name, c.timezone
       FROM app.leads l
       JOIN app.reservations r ON r.contact_id=l.contact_id AND r.client_id=l.client_id
       JOIN app.venue_shifts s ON s.shift_id=r.shift_id
       JOIN app.venue_zones z ON z.zone_id=r.zone_id
       JOIN app.projects p ON p.project_id=r.project_id
       JOIN app.clients c ON c.client_id=r.client_id
       WHERE l.lead_id=$1 AND r.status IN ('requested', 'confirmed') AND r.starts_at > now()
         AND ($2::uuid IS NULL OR r.reservation_id=$2::uuid)
       ORDER BY r.starts_at
       LIMIT 1
       FOR UPDATE OF r`,
      [input.leadId, input.reservationId ?? null],
    );
    const row = found.rows[0];
    if (!row) return null;
    await db.query(
      `UPDATE app.reservations SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE reservation_id=$1`,
      [row.reservation_id],
    );
    await this.reminders.cancel(db, row.reservation_id, 'guest_cancelled');
    await db.query(
      `UPDATE app.leads l SET pipeline_stage='closed_lost', updated_at=now()
       WHERE l.lead_id=$1
         AND NOT EXISTS (SELECT 1 FROM app.reservations r WHERE r.contact_id=l.contact_id AND r.client_id=l.client_id
                           AND r.status IN ('requested','confirmed') AND r.starts_at > now())`,
      [input.leadId],
    );
    await this.audit.record(db, {
      eventType: 'reservation.cancelled',
      actorType: 'external_user',
      actorId: state.phoneNormalized,
      aggregateType: 'lead',
      aggregateId: input.leadId,
      payload: { reservationId: row.reservation_id, by: 'guest' },
    });
    const language: Language = state.preferredLanguage || 'Spanish';
    const date = parseCalendarDate(row.service_date);
    const text = this.text(config, 'reservation_cancelled', language, state, row.project_name, {
      party_size: String(row.party_size),
      date: date ? describeDate(date, language) : row.service_date,
      shift: labelOf(row.shift_labels, language, ''),
      zone: labelOf(row.zone_labels, language, ''),
    });
    const nextState: ConversationState = {
      ...state,
      currentStage: 'qualified',
      currentQuestionKey: '',
      status: 'qualified',
      retryCount: 0,
      stateVersion: state.stateVersion + 1,
    };
    return {
      action: 'reply',
      replyKey: 'reservation_cancelled',
      text,
      messageKind: 'text',
      stageBefore: state.currentStage,
      stageAfter: 'qualified',
      outboxEvents: [{ eventType: 'reservation_cancelled', payload: { reservationId: row.reservation_id, by: 'guest' } }],
      nextState,
    };
  }

  private localTime(now: Date, timezone: string): string {
    return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  }

  private text(config: CompiledConfig, key: string, language: Language, state: ConversationState, projectName: string, extra: Record<string, string>): string {
    const message = config.messages[key];
    if (!message) return '';
    return renderTemplate(
      localized(message.texts, language),
      { lead_name: state.leadName, company_name: state.companyName, project_name: projectName || state.projectName },
      language,
      extra,
    );
  }

  /** The table is not available: say so and ask for another day or area, keeping the party size. */
  private reprompt(
    turn: ReservationTurn,
    outcome: 'unavailable' | 'closed',
    messageKey: string,
    vars: Record<string, string>,
    tenant: Tenant,
  ): ReservationTurnResult {
    const language: Language = turn.state.preferredLanguage || 'Spanish';
    const { q_date_shift: _date, q_zone: _zone, ...kept } = turn.decision.nextState.answers;
    const nextState: ConversationState = {
      ...turn.decision.nextState,
      answers: kept,
      currentStage: 'asking_date_shift',
      currentQuestionKey: 'q_date_shift',
      status: 'in_qualification',
      retryCount: 0,
    };
    return {
      outcome,
      decision: {
        ...turn.decision,
        action: 'reply',
        replyKey: messageKey,
        text: this.text(turn.config, messageKey, language, turn.state, tenant.project_name, vars),
        messageKind: 'text',
        stageAfter: 'asking_date_shift',
        // Nothing was booked, so the engine's completion event must not stand.
        outboxEvents: turn.decision.outboxEvents.filter((e) => e.eventType !== 'qualification_completed'),
        nextState,
      },
    };
  }

  /** Something a person has to sort out: park the conversation on a human. */
  private handoff(turn: ReservationTurn, reason: string): ReservationTurnResult {
    const language: Language = turn.state.preferredLanguage || 'Spanish';
    const nextState: ConversationState = {
      ...turn.decision.nextState,
      humanTakeover: true,
      currentStage: 'human_takeover',
      currentQuestionKey: '',
    };
    return {
      outcome: 'handoff',
      decision: {
        ...turn.decision,
        action: 'handoff',
        replyKey: 'fallback',
        text: this.text(turn.config, 'fallback', language, turn.state, '', {}),
        messageKind: 'text',
        stageAfter: 'human_takeover',
        outboxEvents: [
          ...turn.decision.outboxEvents.filter((e) => e.eventType !== 'qualification_completed'),
          { eventType: 'reservation_handoff', payload: { reason } },
        ],
        nextState,
      },
    };
  }

  /** The least-loaded active host of the venue gets the reservation, once per lead. */
  private async assignHostAndNotify(
    db: Db,
    turn: ReservationTurn,
    projectId: string,
    projectName: string,
    reservationId: string,
    vars: Record<string, string>,
  ): Promise<void> {
    const { target } = turn;
    const existing = await db.query<{ salesperson_id: string }>(
      `SELECT salesperson_id FROM app.lead_assignments WHERE lead_id=$1 AND status='assigned'`,
      [target.leadId],
    );
    let salespersonId = existing.rows[0]?.salesperson_id || '';
    let phone = '';
    if (!salespersonId) {
      const host = await db.query<{ salesperson_id: string; phone_e164: string }>(
        `SELECT sp.salesperson_id, sp.phone_e164
         FROM app.salespeople sp
         JOIN app.salesperson_projects spp ON spp.salesperson_id=sp.salesperson_id AND spp.project_id=$2
         WHERE sp.client_id=$1 AND sp.active=true
         ORDER BY (SELECT count(*) FROM app.lead_assignments la WHERE la.salesperson_id=sp.salesperson_id AND la.status='assigned'),
                  sp.priority_rank, sp.name, sp.salesperson_id
         LIMIT 1
         FOR UPDATE OF sp`,
        [target.clientId, projectId],
      );
      const row = host.rows[0];
      if (!row) return; // No host linked to the venue: the manager still sees the reservation.
      salespersonId = row.salesperson_id;
      phone = row.phone_e164;
      await db.query(
        `INSERT INTO app.lead_assignments (lead_id, salesperson_id, routing_version, idempotency_key)
         VALUES ($1, $2, 'hospitality_v1', $3)`,
        [target.leadId, salespersonId, `lead_assignment:${target.leadId}:hospitality_v1:${salespersonId}`],
      );
    }
    await this.outbox.enqueue(db, {
      commandType: 'salesperson.lead_assignment_notification',
      destination: phone || 'dashboard',
      idempotencyKey: `salesperson.notify:reservation:${reservationId}`,
      aggregateKey: target.leadId,
      payload: {
        leadId: target.leadId,
        reservationId,
        salespersonId,
        clientId: target.clientId,
        contactId: target.contactId,
        contactName: turn.state.leadName,
        projectName,
        partySize: vars.party_size,
        date: vars.date,
        shift: vars.shift,
        zone: vars.zone,
      },
    });
    await this.audit.record(db, {
      eventType: 'reservation.created',
      actorType: 'worker',
      actorId: 'reservation-service',
      aggregateType: 'lead',
      aggregateId: target.leadId,
      payload: { reservationId, projectId, partySize: vars.party_size },
    });
  }
}
