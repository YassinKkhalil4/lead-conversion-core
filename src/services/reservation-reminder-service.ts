import { z } from 'zod';
import { pool, type Db } from '../db/pool.js';
import { describeDate } from '../domain/hospitality-format.js';
import { parseCalendarDate } from '../domain/hospitality-normalization.js';
import { isLanguage } from '../domain/language.js';
import type { Language } from '../domain/types.js';
import { AuditRepository, JobRepository, type ClaimedJob } from '../infrastructure/runtime.js';
import type { MessagingPayload } from '../integrations/messaging/types.js';
import type { JobProcessingResult } from '../worker/runtime-worker.js';
import { MessageRequestService } from './message-request-service.js';


export const REMINDER_JOB_TYPE = 'reservation.reminder';
/** The Meta template a reminder uses outside the 24-hour window. Submitted per language. */
export const REMINDER_TEMPLATE = 'reservation_reminder';
/** Payload of the template's quick-reply button; the inbound processor cancels exactly this reservation. */
export const REMINDER_CANCEL_PREFIX = 'rcancel:';

/** A reminder less than this far from the table is not worth sending. */
const MIN_LEAD_MS = 2 * 3600 * 1000;

const TEMPLATE_LANGUAGE: Record<Language, string> = { Spanish: 'es', Catalan: 'ca', English: 'en', Arabic: 'en' };

const TEXT: Record<Language, string> = {
  Spanish: 'Recordatorio 👋 Tu mesa para {{party_size}} en {{venue}} es {{date}} ({{shift}}). Responde CANCELAR si no puedes venir.',
  Catalan: 'Recordatori 👋 La teva taula per a {{party_size}} a {{venue}} és {{date}} ({{shift}}). Respon CANCEL·LAR si no pots venir.',
  English: 'Reminder 👋 Your table for {{party_size}} at {{venue}} is {{date}} ({{shift}}). Reply CANCEL if you cannot come.',
  Arabic: 'Reminder 👋 Your table for {{party_size}} at {{venue}} is {{date}} ({{shift}}). Reply CANCEL if you cannot come.',
};

const payloadSchema = z.object({ reservationId: z.string().uuid(), startsAtEpoch: z.number().int() });

/**
 * The template's components, checked before they reach Meta (which accepts any
 * JSON here and rejects a wrong variable count only at send time).
 */
const componentsSchema = z.tuple([
  z.object({ type: z.literal('body'), parameters: z.array(z.object({ type: z.literal('text'), text: z.string().min(1) })).length(4) }),
  z.object({
    type: z.literal('button'),
    sub_type: z.literal('quick_reply'),
    index: z.literal('0'),
    parameters: z.tuple([z.object({ type: z.literal('payload'), payload: z.string().startsWith(REMINDER_CANCEL_PREFIX) })]),
  }),
]);

export function reminderTemplate(language: Language, vars: { partySize: string; venue: string; date: string; shift: string }, reservationId: string): MessagingPayload {
  const components = componentsSchema.parse([
    { type: 'body', parameters: [vars.partySize, vars.venue, vars.date, vars.shift].map((text) => ({ type: 'text', text })) },
    { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: `${REMINDER_CANCEL_PREFIX}${reservationId}` }] },
  ]);
  return { kind: 'template', templateName: REMINDER_TEMPLATE, languageCode: TEMPLATE_LANGUAGE[language], components };
}

interface Row {
  status: string;
  starts_at: Date;
  reminder_sent_at: Date | null;
  client_id: string;
  contact_id: string;
  lead_id: string | null;
  conversation_id: string | null;
  window_expires_at: Date | null;
  phone_e164: string;
  language: string;
  party_size: number;
  service_date: string;
  venue_name: string;
  shift_labels: Record<string, string>;
}

export class ReservationReminderService {
  constructor(
    private readonly jobs = new JobRepository(),
    private readonly audit = new AuditRepository(),
    private readonly messages = new MessageRequestService(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Schedules the reminder for a confirmed reservation, on the caller's
   * transaction. The start time is part of the job key and payload: the job
   * repository rejects a reused key whose due time changed, so a rescheduled
   * table gets its own job and the old one finds the start time moved.
   */
  async schedule(db: Db, reservationId: string): Promise<{ scheduled: boolean; reason?: string }> {
    const found = await db.query<{ starts_at: Date; status: string; lead_id: string | null; reminder_lead_hours: number; timezone: string }>(
      `SELECT r.starts_at, r.status, r.lead_id, c.reminder_lead_hours, c.timezone
       FROM app.reservations r JOIN app.clients c ON c.client_id=r.client_id
       WHERE r.reservation_id=$1`,
      [reservationId],
    );
    const row = found.rows[0];
    if (!row || row.status !== 'confirmed') return { scheduled: false, reason: 'not_confirmed' };
    const now = this.clock().getTime();
    const startsAt = row.starts_at.getTime();
    if (startsAt - now < MIN_LEAD_MS) return { scheduled: false, reason: 'too_close' };
    const due = Math.max(now, startsAt - row.reminder_lead_hours * 3600 * 1000);
    const startsAtEpoch = Math.floor(startsAt / 1000);
    const jobId = await this.jobs.schedule(db, {
      jobKey: `${REMINDER_JOB_TYPE}:${reservationId}:${startsAtEpoch}`,
      jobType: REMINDER_JOB_TYPE,
      aggregateKey: reservationId,
      dueAt: new Date(due).toISOString(),
      timezone: row.timezone,
      payload: { reservationId, startsAtEpoch },
    });
    await this.audit.record(db, {
      eventType: 'reservation.reminder_scheduled',
      actorType: 'system',
      actorId: 'reservation-reminder',
      aggregateType: 'lead',
      ...(row.lead_id ? { aggregateId: row.lead_id } : {}),
      payload: { reservationId, scheduledJobId: jobId, dueAt: new Date(due).toISOString() },
    });
    return { scheduled: true };
  }

  /** Cancels the waiting reminder, on the caller's transaction. A job already claimed re-checks the reservation itself. */
  async cancel(db: Db, reservationId: string, reason: string): Promise<void> {
    await this.jobs.cancelForAggregate(db, REMINDER_JOB_TYPE, reservationId, reason);
  }

  async process(job: ClaimedJob): Promise<JobProcessingResult> {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success) return { outcome: 'dead_lettered', reason: `invalid_reminder_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    const { reservationId, startsAtEpoch } = parsed.data;

    const found = await pool.query<Row>(
      `SELECT r.status, r.starts_at, r.reminder_sent_at, r.client_id, r.contact_id, r.lead_id,
              conv.conversation_id, conv.conversation_window_expires_at AS window_expires_at,
              ct.phone_e164, r.language, r.party_size, to_char(r.service_date, 'YYYY-MM-DD') AS service_date,
              p.project_name AS venue_name, s.labels AS shift_labels
       FROM app.reservations r
       JOIN app.contacts ct ON ct.contact_id=r.contact_id
       JOIN app.projects p ON p.project_id=r.project_id
       JOIN app.venue_shifts s ON s.shift_id=r.shift_id
       LEFT JOIN app.conversations conv ON conv.lead_id=r.lead_id
       WHERE r.reservation_id=$1`,
      [reservationId],
    );
    const row = found.rows[0];
    const skip = async (reason: string): Promise<JobProcessingResult> => {
      await this.audit.record(pool, {
        eventType: 'reservation.reminder_skipped',
        actorType: 'worker',
        actorId: 'reservation-reminder',
        aggregateType: 'lead',
        ...(row?.lead_id ? { aggregateId: row.lead_id } : {}),
        causationId: job.scheduledJobId,
        payload: { reservationId, reason },
      });
      return { outcome: 'completed' };
    };
    if (!row) return skip('reservation_missing');
    // The guards that matter: the worker runs late jobs and a claimed job cannot be pre-empted.
    if (row.status !== 'confirmed') return skip(`status_${row.status}`);
    if (Math.floor(row.starts_at.getTime() / 1000) !== startsAtEpoch) return skip('rescheduled');
    if (row.starts_at.getTime() <= this.clock().getTime()) return skip('already_started');
    if (row.reminder_sent_at) return skip('already_sent');

    const language: Language = isLanguage(row.language) ? row.language : 'Spanish';
    const date = parseCalendarDate(row.service_date);
    const vars = {
      partySize: String(row.party_size),
      venue: row.venue_name,
      date: date ? describeDate(date, language) : row.service_date,
      shift: row.shift_labels?.[language] || row.shift_labels?.English || '',
    };
    const windowOpen = Boolean(row.window_expires_at && row.window_expires_at.getTime() > this.clock().getTime());
    const payload: MessagingPayload = windowOpen
      ? {
          kind: 'text',
          text: TEXT[language]
            .replace('{{party_size}}', vars.partySize).replace('{{venue}}', vars.venue)
            .replace('{{date}}', vars.date).replace('{{shift}}', vars.shift),
        }
      : reminderTemplate(language, vars, reservationId);

    try {
      await this.messages.requestWhatsAppSend({
        clientId: row.client_id,
        contactId: row.contact_id,
        ...(row.lead_id ? { leadId: row.lead_id } : {}),
        ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
        requestKey: `reservation-reminder:${reservationId}:${startsAtEpoch}`,
        toE164: row.phone_e164,
        actorId: 'reservation-reminder',
        ...(windowOpen && row.window_expires_at ? { conversationWindowExpiresAt: row.window_expires_at.toISOString() } : {}),
        payload,
      });
    } catch (error) {
      // An unapproved template is retried (and ends in the dead-letter list if it
      // never gets approved) rather than silently dropped.
      return { outcome: 'retryable', error: String(error instanceof Error ? error.message : error).slice(0, 500) };
    }

    const marked = await pool.query(
      `UPDATE app.reservations SET reminder_sent_at=now(), updated_at=now()
       WHERE reservation_id=$1 AND reminder_sent_at IS NULL`,
      [reservationId],
    );
    if (marked.rowCount) {
      await this.audit.record(pool, {
        eventType: 'reservation.reminder_sent',
        actorType: 'worker',
        actorId: 'reservation-reminder',
        aggregateType: 'lead',
        ...(row.lead_id ? { aggregateId: row.lead_id } : {}),
        causationId: job.scheduledJobId,
        payload: { reservationId, kind: payload.kind },
      });
    }
    return { outcome: 'completed' };
  }
}
