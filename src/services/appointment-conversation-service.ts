import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { APPOINTMENT_SLOT_STAGE } from '../domain/engine.js';
import { formatSlotLabel, generateAppointmentSlots } from '../domain/appointment-slots.js';
import { renderTemplate } from '../domain/render.js';
import type { CompiledConfig, ConversationState, Language, ReplyDecision } from '../domain/types.js';
import type { MessagingPayload } from '../integrations/messaging/types.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import { AppointmentService } from './appointment-service.js';

type Db = typeof pool | PoolClient;

const SLOT_DURATION_MINUTES = 60;
const OFFER_DAYS = 3;
const MAX_SLOTS = 9;

/**
 * Slot messages are not part of the published question/message config, so a
 * client that has never been re-published still gets usable copy. A config key
 * of the same name overrides the built-in text when one exists.
 */
const DEFAULT_TEXTS: Record<string, Record<Language, string>> = {
  appointment_slot_offer: {
    English: 'Great 🙌 Pick the time that suits you and we will arrange the visit.',
    Arabic: 'تمام 🙌 اختار الميعاد اللي يناسبك وإحنا هنرتب الزيارة.',
  },
  appointment_booked_ack: {
    English: 'Done ✅ Your visit is booked for {{slot}}. Your consultant will confirm the details shortly.',
    Arabic: 'تمام ✅ زيارتك اتحجزت {{slot}}. المستشار المختص هيأكدلك التفاصيل قريب.',
  },
  appointment_slot_taken: {
    English: 'That time has just been taken 🙏 Please pick another one.',
    Arabic: 'الميعاد ده اتحجز للأسف 🙏 اختار ميعاد تاني لو سمحت.',
  },
};

export interface AppointmentTarget {
  leadId: string;
  clientId: string;
  contactId: string;
}

export interface AppointmentTurnResult {
  decision: ReplyDecision;
  /** True when this service already persisted and enqueued the outbound reply. */
  replySent: boolean;
}

interface TurnContext {
  state: ConversationState;
  config: CompiledConfig;
  decision: ReplyDecision;
  target: AppointmentTarget;
  phoneNumberId: string;
  toE164: string;
  appConversationId: string;
  sourceEventId: string;
  correlationId: string;
  causationId: string;
}

interface SchedulingConfigRow {
  timezone: string;
  appointment_hours: unknown;
  appointment_blackout_days: string[];
}

export class AppointmentConversationService {
  constructor(
    private readonly appointments = new AppointmentService(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Turns an `appointment_slot_offer` decision into a WhatsApp interactive
   * list, or falls through to the closing message when no offer can be made.
   */
  async composeSlotOffer(client: Db, context: TurnContext): Promise<AppointmentTurnResult> {
    const language: Language = context.state.preferredLanguage || 'Arabic';

    // The interactive list is a session message. Meta only accepts it inside
    // the 24-hour customer service window, and no approved template covers a
    // slot offer, so a closed window means falling through, not templating.
    if (!this.windowIsOpen(context.state)) {
      return this.fallThroughToClosing(client, context, 'conversation_window_closed');
    }

    const scheduling = await this.loadSchedulingConfig(client, context.target);
    if (!scheduling) return this.fallThroughToClosing(client, context, 'client_scheduling_config_missing');

    const taken = await client.query<{ starts_at: Date }>(
      `SELECT starts_at
       FROM app.appointments
       WHERE lead_id=$1
         AND status IN ('pending','booked','confirmed')`,
      [context.target.leadId],
    );
    const slots = generateAppointmentSlots({
      config: {
        timezone: scheduling.timezone,
        appointmentHours: Array.isArray(scheduling.appointment_hours) ? scheduling.appointment_hours : [],
        blackoutDays: scheduling.appointment_blackout_days || [],
      },
      now: this.clock(),
      days: OFFER_DAYS,
      maxSlots: MAX_SLOTS,
      excludeStartsAt: taken.rows.map((row) => row.starts_at.toISOString()),
    });
    if (slots.length === 0) return this.fallThroughToClosing(client, context, 'no_available_slots');

    const offer = await this.appointments.createOffer(client, {
      leadId: context.target.leadId,
      startsAt: slots.map((slot) => slot.startsAt),
      durationMinutes: SLOT_DURATION_MINUTES,
      actorId: 'appointment-conversation-service',
      correlationId: context.correlationId,
      causationId: context.causationId,
    });
    // `createOffer` returns an empty offer id rather than throwing when the
    // lead is stopped or closed. Treat that as "no offer", never as an offer
    // with zero rows.
    if (!offer.appointmentOfferId) {
      return this.fallThroughToClosing(client, context, 'lead_not_eligible_for_offer');
    }

    const rows = await client.query<{ appointment_slot_id: string; starts_at: Date; timezone: string }>(
      `SELECT appointment_slot_id, starts_at, timezone
       FROM app.appointment_slots
       WHERE appointment_offer_id=$1
         AND status='offered'
       ORDER BY starts_at, appointment_slot_id`,
      [offer.appointmentOfferId],
    );
    if (rows.rows.length === 0) return this.fallThroughToClosing(client, context, 'no_available_slots');

    const options = rows.rows.slice(0, MAX_SLOTS).map((row) => ({
      id: `appt:${offer.appointmentOfferId}:${row.appointment_slot_id}`,
      label: formatSlotLabel(row.starts_at.toISOString(), row.timezone || scheduling.timezone)[language],
    }));

    await this.audit.record(client, {
      eventType: 'appointment.offer_sent',
      actorType: 'worker',
      actorId: 'appointment-conversation-service',
      aggregateType: 'lead',
      aggregateId: context.target.leadId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      payload: {
        appointmentOfferId: offer.appointmentOfferId,
        slotCount: options.length,
        timezone: scheduling.timezone,
        reused: !offer.inserted,
      },
      after: { currentStage: APPOINTMENT_SLOT_STAGE },
    });

    return {
      decision: {
        ...context.decision,
        action: 'reply',
        replyKey: 'appointment_slot_offer',
        text: this.textFor(context, 'appointment_slot_offer', language),
        messageKind: 'list',
        interactiveOptions: options,
        stageAfter: APPOINTMENT_SLOT_STAGE,
      },
      replySent: false,
    };
  }

  /**
   * Books the tapped slot, then enqueues the confirmation and the salesperson
   * notification. `AppointmentService.bookSlot` runs its own transaction and
   * enqueues the calendar command inside it; this method's own writes ride the
   * caller's transaction, keyed off the resulting appointment id so a replay
   * cannot double-send.
   */
  async resolveSlotReply(client: Db, context: TurnContext): Promise<AppointmentTurnResult> {
    const selected = context.decision.outboxEvents
      .find((event) => event.eventType === 'appointment_slot_selected')?.payload as
      { appointmentOfferId?: string; appointmentSlotId?: string } | undefined;
    const appointmentOfferId = String(selected?.appointmentOfferId || '');
    const appointmentSlotId = String(selected?.appointmentSlotId || '');
    if (!appointmentOfferId || !appointmentSlotId) {
      return this.reofferOrClose(client, context, 'slot_reply_missing_identifiers');
    }

    let outcome: string;
    let appointmentId: string;
    try {
      const booking = await this.appointments.bookSlot({
        appointmentOfferId,
        appointmentSlotId,
        sourceEventId: context.sourceEventId,
        bookedBy: context.target.leadId,
        correlationId: context.correlationId,
        causationId: context.causationId,
      });
      outcome = booking.outcome;
      appointmentId = booking.appointmentId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith('appointment_slot_not_found')) throw error;
      return this.reofferOrClose(client, context, 'slot_no_longer_offered');
    }

    if (outcome !== 'booked' && outcome !== 'duplicate') {
      // `already_booked`, `expired` or `cancelled`: the lead loses the race and
      // is offered a fresh set, unless the window has since closed.
      return this.reofferOrClose(client, context, `slot_${outcome}`);
    }

    const language: Language = context.state.preferredLanguage || 'Arabic';
    const appointment = await client.query<{ starts_at: Date; timezone: string }>(
      'SELECT starts_at, timezone FROM app.appointments WHERE appointment_id=$1',
      [appointmentId],
    );
    const booked = appointment.rows[0];
    const slotLabel = booked
      ? formatSlotLabel(booked.starts_at.toISOString(), booked.timezone)[language]
      : '';
    const text = this.textFor(context, 'appointment_booked_ack', language).replace('{{slot}}', slotLabel);

    const sent = await this.enqueueReply(client, context, {
      requestKey: `appointment_booked:${appointmentId}`,
      text,
    });
    const notificationCommandId = await this.notifySalesperson(client, context, appointmentId, slotLabel);

    const nextState: ConversationState = {
      ...context.decision.nextState,
      currentStage: 'appointment_booked',
      currentQuestionKey: '',
      appointmentStatus: 'booked',
      retryCount: 0,
    };

    await this.audit.record(client, {
      eventType: 'appointment.booking_confirmed',
      actorType: 'external_user',
      actorId: context.target.leadId,
      aggregateType: 'lead',
      aggregateId: context.target.leadId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      payload: {
        appointmentId,
        appointmentOfferId,
        appointmentSlotId,
        outcome,
        messageId: sent.messageId,
        outboxCommandId: sent.outboxCommandId,
        notificationCommandId,
      },
      before: { currentStage: context.state.currentStage },
      after: { currentStage: nextState.currentStage, appointmentStatus: 'booked' },
    });

    return {
      decision: {
        ...context.decision,
        action: 'complete',
        replyKey: 'appointment_booked_ack',
        text,
        messageKind: 'text',
        stageAfter: nextState.currentStage,
        outboxEvents: [
          ...context.decision.outboxEvents,
          { eventType: 'appointment_booked', payload: { appointmentId, outcome } },
        ],
        nextState,
      },
      replySent: true,
    };
  }

  private async reofferOrClose(client: Db, context: TurnContext, reason: string): Promise<AppointmentTurnResult> {
    if (!this.windowIsOpen(context.state)) {
      return this.fallThroughToClosing(client, context, `${reason}_window_closed`);
    }
    const language: Language = context.state.preferredLanguage || 'Arabic';
    const reoffer = await this.composeSlotOffer(client, context);
    if (reoffer.decision.replyKey !== 'appointment_slot_offer') return reoffer;
    return {
      ...reoffer,
      decision: {
        ...reoffer.decision,
        text: `${this.textFor(context, 'appointment_slot_taken', language)}\n\n${reoffer.decision.text}`,
        outboxEvents: [
          ...reoffer.decision.outboxEvents,
          { eventType: 'appointment_slot_reoffered', payload: { reason } },
        ],
      },
    };
  }

  private async fallThroughToClosing(
    client: Db,
    context: TurnContext,
    reason: string,
  ): Promise<AppointmentTurnResult> {
    const language: Language = context.state.preferredLanguage || 'Arabic';
    const message = context.config.messages.qualified_closing;
    const text = message
      ? renderTemplate(message.texts[language], {
          lead_name: context.state.leadName,
          company_name: context.state.companyName,
          project_name: context.state.projectName,
        }, language)
      : '';

    await this.audit.record(client, {
      eventType: 'appointment.offer_skipped',
      actorType: 'worker',
      actorId: 'appointment-conversation-service',
      aggregateType: 'lead',
      aggregateId: context.target.leadId,
      correlationId: context.correlationId,
      causationId: context.causationId,
      payload: {
        reason,
        conversationWindowExpiresAt: context.state.conversationWindowExpiresAt,
        replyKey: 'qualified_closing',
      },
      before: { currentStage: context.state.currentStage },
      after: { currentStage: 'qualified' },
    });

    return {
      decision: {
        ...context.decision,
        action: 'complete',
        replyKey: 'qualified_closing',
        text,
        messageKind: 'text',
        stageAfter: 'qualified',
        outboxEvents: [
          ...context.decision.outboxEvents.filter((event) => event.eventType !== 'appointment_slot_offer_requested'),
          { eventType: 'appointment_offer_skipped', payload: { reason } },
        ],
        nextState: {
          ...context.decision.nextState,
          currentStage: 'qualified',
          currentQuestionKey: '',
          status: 'qualified',
          retryCount: 0,
        },
      },
      replySent: false,
    };
  }

  private windowIsOpen(state: ConversationState): boolean {
    if (!state.conversationWindowExpiresAt) return false;
    const expiresAt = Date.parse(state.conversationWindowExpiresAt);
    return Number.isFinite(expiresAt) && expiresAt > this.clock().getTime();
  }

  private textFor(context: TurnContext, key: string, language: Language): string {
    const configured = context.config.messages[key]?.texts[language];
    const template = configured || DEFAULT_TEXTS[key]?.[language] || '';
    return renderTemplate(template, {
      lead_name: context.state.leadName,
      company_name: context.state.companyName,
      project_name: context.state.projectName,
    }, language);
  }

  private async loadSchedulingConfig(client: Db, target: AppointmentTarget): Promise<SchedulingConfigRow | null> {
    const result = await client.query<SchedulingConfigRow>(
      `SELECT c.timezone, c.appointment_hours, c.appointment_blackout_days
       FROM app.clients c
       JOIN app.leads l ON l.client_id=c.client_id
       WHERE l.lead_id=$1
         AND l.client_id=$2`,
      [target.leadId, target.clientId],
    );
    return result.rows[0] || null;
  }

  private async enqueueReply(
    client: Db,
    context: TurnContext,
    input: { requestKey: string; text: string },
  ): Promise<{ messageId: string; outboxCommandId: string }> {
    const payload: MessagingPayload = { kind: 'text', text: input.text };
    const idempotencyKey = `whatsapp.send:${context.target.clientId}:${input.requestKey}:${sha256Hex(stableJson(payload)).slice(0, 24)}`;
    const message = await client.query<{ message_id: string }>(
      `INSERT INTO app.messages
        (conversation_id, lead_id, client_id, contact_id, direction, channel, to_address,
         message_text, message_type, state, raw_payload, idempotency_key)
       VALUES ($1, $2, $3, $4, 'outbound', 'whatsapp', $5, $6, $7, 'queued', $8::jsonb, $9)
       ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key <> ''
       DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
       RETURNING message_id`,
      [
        context.appConversationId || null,
        context.target.leadId,
        context.target.clientId,
        context.target.contactId,
        context.toE164,
        input.text,
        payload.kind,
        JSON.stringify({
          provider: 'meta',
          phoneNumberId: context.phoneNumberId,
          toE164: context.toE164,
          message: payload,
          idempotencyKey,
          source: 'appointment_conversation',
        }),
        idempotencyKey,
      ],
    );
    const messageId = message.rows[0]?.message_id || '';
    if (!messageId) throw new Error('appointment_reply_message_not_created');
    const outboxCommandId = await this.outbox.enqueue(client, {
      commandType: 'whatsapp.send_message',
      destination: context.toE164,
      idempotencyKey,
      aggregateKey: context.target.leadId,
      payload: {
        provider: 'meta',
        phoneNumberId: context.phoneNumberId,
        toE164: context.toE164,
        message: payload,
        messageId,
        leadId: context.target.leadId,
      },
    });
    return { messageId, outboxCommandId };
  }

  private async notifySalesperson(
    client: Db,
    context: TurnContext,
    appointmentId: string,
    slotLabel: string,
  ): Promise<string> {
    const assignment = await client.query<{
      lead_assignment_id: string;
      salesperson_id: string;
      phone_e164: string;
      name: string;
    }>(
      `SELECT la.lead_assignment_id, la.salesperson_id, sp.phone_e164, sp.name
       FROM app.lead_assignments la
       JOIN app.salespeople sp ON sp.salesperson_id=la.salesperson_id
       WHERE la.lead_id=$1
         AND la.status='assigned'
         AND sp.client_id=$2
       ORDER BY la.assigned_at DESC, la.lead_assignment_id
       LIMIT 1`,
      [context.target.leadId, context.target.clientId],
    );
    const row = assignment.rows[0];
    if (!row) return '';
    return this.outbox.enqueue(client, {
      commandType: 'salesperson.appointment_booked_notification',
      destination: row.phone_e164,
      idempotencyKey: `salesperson.appointment_booked:${appointmentId}`,
      aggregateKey: context.target.leadId,
      payload: {
        appointmentId,
        leadId: context.target.leadId,
        clientId: context.target.clientId,
        assignmentId: row.lead_assignment_id,
        salespersonId: row.salesperson_id,
        salespersonName: row.name,
        leadName: context.state.leadName,
        slotLabel,
      },
    });
  }
}
