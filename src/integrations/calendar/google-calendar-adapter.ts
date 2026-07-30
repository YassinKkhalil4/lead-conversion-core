import { getEnv } from '../../config/env.js';
import type {
  CalendarAvailabilityResult,
  CalendarProvider,
  CalendarProviderResult,
  CreateCalendarEventCommand,
} from './types.js';

interface GoogleCalendarAdapterOptions {
  accessToken: string;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after') || '';
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

export class GoogleCalendarAdapter implements CalendarProvider {
  constructor(private readonly options: GoogleCalendarAdapterOptions) {
    if (!options.accessToken) throw new Error('google_calendar_access_token_required');
  }

  static fromEnv(): GoogleCalendarAdapter {
    const env = getEnv();
    if (!env.GOOGLE_CALENDAR_ENABLED) throw new Error('google_calendar_disabled');
    return new GoogleCalendarAdapter({ accessToken: env.GOOGLE_CALENDAR_ACCESS_TOKEN });
  }

  async checkAvailability(command: CreateCalendarEventCommand): Promise<CalendarAvailabilityResult> {
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        'content-type': 'application/json',
        'x-goog-request-reason': command.idempotencyKey,
      },
      body: JSON.stringify({
        timeMin: command.startsAt,
        timeMax: command.endsAt,
        timeZone: command.timezone,
        items: [{ id: command.calendarId }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const providerResponse = await parseResponse(response);
    if (response.ok) {
      const calendars = providerResponse.calendars as Record<string, { busy?: unknown[] }> | undefined;
      const busy = calendars?.[command.calendarId]?.busy || [];
      return busy.length === 0
        ? { outcome: 'available', providerResponse }
        : { outcome: 'busy', error: 'google_calendar_slot_busy', providerResponse };
    }
    if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = retryAfterSeconds(response);
      return retryAfter === undefined
        ? { outcome: 'retryable', error: `google_calendar_freebusy_retryable:${response.status}`, providerResponse }
        : { outcome: 'retryable', error: `google_calendar_freebusy_retryable:${response.status}`, retryAfterSeconds: retryAfter, providerResponse };
    }
    return { outcome: 'permanently_failed', error: `google_calendar_freebusy_rejected:${response.status}`, providerResponse };
  }

  async createEvent(command: CreateCalendarEventCommand): Promise<CalendarProviderResult> {
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(command.calendarId)}/events`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.options.accessToken}`,
        'content-type': 'application/json',
        'x-goog-request-reason': command.idempotencyKey,
      },
      body: JSON.stringify({
        summary: command.summary,
        description: command.description,
        start: {
          dateTime: command.startsAt,
          timeZone: command.timezone,
        },
        end: {
          dateTime: command.endsAt,
          timeZone: command.timezone,
        },
        extendedProperties: {
          private: {
            idempotencyKey: command.idempotencyKey,
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const providerResponse = await parseResponse(response);
    if (response.ok) {
      const providerEventId = String(providerResponse.id || '');
      if (!providerEventId) {
        return { outcome: 'delivery_unknown', error: 'google_calendar_created_without_event_id', providerResponse };
      }
      return { outcome: 'created', providerEventId, providerResponse };
    }
    if ([408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
      const retryAfter = retryAfterSeconds(response);
      return retryAfter === undefined
        ? { outcome: 'retryable', error: `google_calendar_retryable:${response.status}`, providerResponse }
        : { outcome: 'retryable', error: `google_calendar_retryable:${response.status}`, retryAfterSeconds: retryAfter, providerResponse };
    }
    return { outcome: 'permanently_failed', error: `google_calendar_rejected:${response.status}`, providerResponse };
  }
}
