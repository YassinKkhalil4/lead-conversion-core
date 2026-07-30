import { z } from 'zod';
import type { ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import type { OutboxDispatchResult } from './runtime-worker.js';
import type { CalendarProvider } from '../integrations/calendar/types.js';

const createEventSchema = z.object({
  appointmentId: z.string().uuid(),
  leadId: z.string().uuid(),
  clientId: z.string().uuid(),
  calendarId: z.string().min(1),
  summary: z.string().min(1),
  description: z.string().default(''),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().min(1),
});

export class CalendarOutboxDispatcher {
  constructor(private readonly providers: { calendar: CalendarProvider }) {}

  async dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> {
    if (command.commandType !== 'calendar.create_event') {
      return { outcome: 'permanently_failed', error: `unsupported_calendar_outbox_command:${command.commandType}` };
    }
    const parsed = createEventSchema.safeParse(command.payload);
    if (!parsed.success) {
      return { outcome: 'permanently_failed', error: `invalid_calendar_create_event_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }
    const result = await this.providers.calendar.createEvent({
      calendarId: parsed.data.calendarId || command.destination,
      idempotencyKey: command.idempotencyKey,
      summary: parsed.data.summary,
      description: parsed.data.description,
      startsAt: parsed.data.startsAt,
      endsAt: parsed.data.endsAt,
      timezone: parsed.data.timezone,
    });
    if (result.outcome === 'created') return { outcome: 'delivered', providerMessageId: result.providerEventId };
    if (result.outcome === 'retryable') {
      return result.retryAfterSeconds === undefined
        ? { outcome: 'retryable', error: result.error }
        : { outcome: 'retryable', error: result.error, retryAfterSeconds: result.retryAfterSeconds };
    }
    if (result.outcome === 'delivery_unknown') return { outcome: 'delivery_unknown', error: result.error };
    return { outcome: 'permanently_failed', error: result.error };
  }
}
