import { describe, expect, it, vi } from 'vitest';
import { CalendarOutboxDispatcher } from '../src/worker/calendar-outbox-dispatcher.js';
import { GoogleCalendarAdapter } from '../src/integrations/calendar/google-calendar-adapter.js';
import type { ClaimedOutboxCommand } from '../src/infrastructure/runtime.js';
import type { CalendarProvider } from '../src/integrations/calendar/types.js';

function command(overrides: Partial<ClaimedOutboxCommand> = {}): ClaimedOutboxCommand {
  return {
    outboxCommandId: '6f5f5aa4-21e3-4877-b844-ccdc3563e21b',
    commandType: 'calendar.create_event',
    destination: 'calendar-primary',
    idempotencyKey: 'calendar.create_event:appointment-1',
    attemptCount: 1,
    payload: {
      appointmentId: '11111111-1111-4111-8111-111111111111',
      leadId: '22222222-2222-4222-8222-222222222222',
      clientId: '33333333-3333-4333-8333-333333333333',
      calendarId: 'calendar-primary',
      summary: 'Appointment with Lead',
      description: 'Lead phone: +201099999999',
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T09:45:00.000Z',
      timezone: 'Africa/Cairo',
    },
    ...overrides,
  };
}

describe('CalendarOutboxDispatcher', () => {
  it('maps created provider events to delivered outbox outcomes', async () => {
    const provider: CalendarProvider = {
      createEvent: vi.fn(async () => ({
        outcome: 'created' as const,
        providerEventId: 'google-event-sanitized',
        providerResponse: {},
      })),
    };
    const dispatcher = new CalendarOutboxDispatcher({ calendar: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'delivered',
      providerMessageId: 'google-event-sanitized',
    });
    expect(provider.createEvent).toHaveBeenCalledWith({
      calendarId: 'calendar-primary',
      idempotencyKey: 'calendar.create_event:appointment-1',
      summary: 'Appointment with Lead',
      description: 'Lead phone: +201099999999',
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T09:45:00.000Z',
      timezone: 'Africa/Cairo',
    });
  });

  it('preserves retry hints from retryable provider outcomes', async () => {
    const provider: CalendarProvider = {
      createEvent: vi.fn(async () => ({
        outcome: 'retryable' as const,
        error: 'google rate limit',
        retryAfterSeconds: 30,
      })),
    };
    const dispatcher = new CalendarOutboxDispatcher({ calendar: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'retryable',
      error: 'google rate limit',
      retryAfterSeconds: 30,
    });
  });

  it('rejects malformed calendar payloads without calling the provider', async () => {
    const provider: CalendarProvider = {
      createEvent: vi.fn(async () => ({
        outcome: 'created' as const,
        providerEventId: 'should-not-create',
        providerResponse: {},
      })),
    };
    const dispatcher = new CalendarOutboxDispatcher({ calendar: provider });

    const result = await dispatcher.dispatch(command({ payload: { calendarId: 'calendar-primary' } }));
    expect(result.outcome).toBe('permanently_failed');
    if (result.outcome !== 'permanently_failed') throw new Error('expected_permanent_failure');
    expect(result.error).toContain('invalid_calendar_create_event_payload');
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('requires real Google credentials when constructing the adapter', () => {
    expect(() => new GoogleCalendarAdapter({ accessToken: '' })).toThrow('google_calendar_access_token_required');
  });
});
