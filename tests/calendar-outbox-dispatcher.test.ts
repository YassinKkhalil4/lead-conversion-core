import { afterEach, describe, expect, it, vi } from 'vitest';
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


function tokenResponse(token = 'test-google-access-token', expiresIn = 3600) {
  return new Response(
    JSON.stringify({ access_token: token, expires_in: expiresIn }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function googleAdapter() {
  return new GoogleCalendarAdapter({
    clientId: 'test-google-client-id',
    clientSecret: 'test-google-client-secret',
    refreshToken: 'test-google-refresh-token',
  });
}

function calendarCommand() {
  return {
    calendarId: 'calendar-primary',
    idempotencyKey: 'calendar.create_event:retry-after',
    summary: 'Appointment with Lead',
    description: '',
    startsAt: '2026-07-31T09:00:00.000Z',
    endsAt: '2026-07-31T09:45:00.000Z',
    timezone: 'Africa/Cairo',
  };
}

describe('CalendarOutboxDispatcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('maps created provider events to delivered outbox outcomes', async () => {
    const provider: CalendarProvider = {
      checkAvailability: vi.fn(async () => ({
        outcome: 'available' as const,
      })),
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
    expect(provider.checkAvailability).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: 'calendar-primary',
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T09:45:00.000Z',
    }));
  });

  it('preserves retry hints from retryable provider outcomes', async () => {
    const provider: CalendarProvider = {
      checkAvailability: vi.fn(async () => ({
        outcome: 'available' as const,
      })),
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

  it('rejects busy availability without creating an event', async () => {
    const provider: CalendarProvider = {
      checkAvailability: vi.fn(async () => ({
        outcome: 'busy' as const,
        error: 'google_calendar_slot_busy',
      })),
      createEvent: vi.fn(async () => ({
        outcome: 'created' as const,
        providerEventId: 'should-not-create',
        providerResponse: {},
      })),
    };
    const dispatcher = new CalendarOutboxDispatcher({ calendar: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'permanently_failed',
      error: 'google_calendar_slot_busy',
    });
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('preserves retry hints from availability recheck failures', async () => {
    const provider: CalendarProvider = {
      checkAvailability: vi.fn(async () => ({
        outcome: 'retryable' as const,
        error: 'google freebusy rate limit',
        retryAfterSeconds: 12,
      })),
      createEvent: vi.fn(async () => ({
        outcome: 'created' as const,
        providerEventId: 'should-not-create',
        providerResponse: {},
      })),
    };
    const dispatcher = new CalendarOutboxDispatcher({ calendar: provider });

    await expect(dispatcher.dispatch(command())).resolves.toEqual({
      outcome: 'retryable',
      error: 'google freebusy rate limit',
      retryAfterSeconds: 12,
    });
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('rejects malformed calendar payloads without calling the provider', async () => {
    const provider: CalendarProvider = {
      checkAvailability: vi.fn(async () => ({
        outcome: 'available' as const,
      })),
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
    expect(provider.checkAvailability).not.toHaveBeenCalled();
    expect(provider.createEvent).not.toHaveBeenCalled();
  });

  it('requires real Google credentials when constructing the adapter', () => {
    expect(() => new GoogleCalendarAdapter({ clientId: '', clientSecret: 'secret', refreshToken: 'refresh' })).toThrow('google_calendar_clientId_required');
  });

  it('caps numeric Google retry-after hints', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) return tokenResponse();
      return new Response(
        JSON.stringify({ error: { message: 'rate limited' } }),
        { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '999999' } },
      );
    }));
    const adapter = googleAdapter();

    await expect(adapter.checkAvailability(calendarCommand())).resolves.toEqual({
      outcome: 'retryable',
      error: 'google_calendar_freebusy_retryable:429',
      retryAfterSeconds: 3600,
      providerResponse: { error: { message: 'rate limited' } },
    });
  });

  it('parses date-based Google retry-after hints', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T09:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('oauth2.googleapis.com/token')) return tokenResponse();
      return new Response(
        JSON.stringify({ error: { message: 'try later' } }),
        { status: 503, headers: { 'content-type': 'application/json', 'retry-after': 'Fri, 31 Jul 2026 09:02:00 GMT' } },
      );
    }));
    const adapter = googleAdapter();

    await expect(adapter.createEvent(calendarCommand())).resolves.toEqual({
      outcome: 'retryable',
      error: 'google_calendar_retryable:503',
      retryAfterSeconds: 120,
      providerResponse: { error: { message: 'try later' } },
    });
  });

  it('refreshes once and caches Google access tokens across calls', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://tokens.test/google') return tokenResponse('cached-token');
      expect(String((init?.headers as Record<string, string> | undefined)?.authorization || '')).toBe('Bearer cached-token');
      return new Response(JSON.stringify({
        calendars: { 'calendar-primary': { busy: [] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const adapter = new GoogleCalendarAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      refreshToken: 'test-google-refresh-token',
      fetchImpl: fetchMock as typeof fetch,
      tokenEndpoint: 'https://tokens.test/google',
    });

    await expect(adapter.checkAvailability(calendarCommand())).resolves.toMatchObject({ outcome: 'available' });
    await expect(adapter.checkAvailability(calendarCommand())).resolves.toMatchObject({ outcome: 'available' });

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://tokens.test/google')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('freeBusy'))).toHaveLength(2);
  });

  it('refreshes Google access tokens again after simulated expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T09:00:00.000Z'));
    const tokens = ['token-before-expiry', 'token-after-expiry'];
    const calendarAuthorizations: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://tokens.test/google') return tokenResponse(tokens.shift() || 'unexpected-token', 1);
      calendarAuthorizations.push(String((init?.headers as Record<string, string> | undefined)?.authorization || ''));
      return new Response(JSON.stringify({
        calendars: { 'calendar-primary': { busy: [] } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const adapter = new GoogleCalendarAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      refreshToken: 'test-google-refresh-token',
      fetchImpl: fetchMock as typeof fetch,
      tokenEndpoint: 'https://tokens.test/google',
      tokenRefreshLeewayMs: 0,
    });

    await expect(adapter.checkAvailability(calendarCommand())).resolves.toMatchObject({ outcome: 'available' });
    vi.setSystemTime(new Date('2026-07-31T09:01:01.000Z'));
    await expect(adapter.checkAvailability(calendarCommand())).resolves.toMatchObject({ outcome: 'available' });

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://tokens.test/google')).toHaveLength(2);
    expect(calendarAuthorizations).toEqual(['Bearer token-before-expiry', 'Bearer token-after-expiry']);
  });

  it('refreshes Google access tokens and retries once after authorization failure', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://tokens.test/google') return tokenResponse(fetchMock.mock.calls.length === 1 ? 'expired-token' : 'fresh-token');
      const authorization = String((init?.headers as Record<string, string> | undefined)?.authorization || '');
      if (authorization.includes('expired-token')) return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
      return new Response(JSON.stringify({ id: 'google-event-after-refresh' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const adapter = new GoogleCalendarAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      refreshToken: 'test-google-refresh-token',
      fetchImpl: fetchMock as typeof fetch,
      tokenEndpoint: 'https://tokens.test/google',
    });

    await expect(adapter.createEvent(calendarCommand())).resolves.toMatchObject({
      outcome: 'created',
      providerEventId: 'google-event-after-refresh',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://tokens.test/google')).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/events'))).toHaveLength(2);
  });

  it('classifies token endpoint failures without using a stale cached token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T09:00:00.000Z'));
    let tokenCalls = 0;
    const calendarAuthorizations: string[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === 'https://tokens.test/google') {
        tokenCalls += 1;
        if (tokenCalls === 1) return tokenResponse('stale-after-expiry', 1);
        return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      calendarAuthorizations.push(String((init?.headers as Record<string, string> | undefined)?.authorization || ''));
      return new Response(JSON.stringify({ id: 'google-event-before-expiry' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const adapter = new GoogleCalendarAdapter({
      clientId: 'test-google-client-id',
      clientSecret: 'test-google-client-secret',
      refreshToken: 'test-google-refresh-token',
      fetchImpl: fetchMock as typeof fetch,
      tokenEndpoint: 'https://tokens.test/google',
      tokenRefreshLeewayMs: 0,
    });

    await expect(adapter.createEvent(calendarCommand())).resolves.toMatchObject({ outcome: 'created' });
    vi.setSystemTime(new Date('2026-07-31T09:01:01.000Z'));
    await expect(adapter.createEvent(calendarCommand())).resolves.toEqual({
      outcome: 'delivery_unknown',
      error: 'google_calendar_create_network:Error: google_calendar_token_refresh_rejected:400',
      providerResponse: {},
    });

    expect(fetchMock.mock.calls.filter(([url]) => String(url) === 'https://tokens.test/google')).toHaveLength(2);
    expect(calendarAuthorizations).toEqual(['Bearer stale-after-expiry']);
  });

  it('classifies Google free/busy network failures as retryable before event creation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network unavailable');
    }));
    const adapter = googleAdapter();

    await expect(adapter.checkAvailability({
      calendarId: 'calendar-primary',
      idempotencyKey: 'calendar.create_event:network-freebusy',
      summary: 'Appointment with Lead',
      description: '',
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T09:45:00.000Z',
      timezone: 'Africa/Cairo',
    })).resolves.toEqual({
      outcome: 'retryable',
      error: 'google_calendar_freebusy_network:Error: network unavailable',
      providerResponse: {},
    });
  });

  it('classifies Google create-event network failures as delivery unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('socket closed after write');
    }));
    const adapter = googleAdapter();

    await expect(adapter.createEvent({
      calendarId: 'calendar-primary',
      idempotencyKey: 'calendar.create_event:network-create',
      summary: 'Appointment with Lead',
      description: '',
      startsAt: '2026-07-31T09:00:00.000Z',
      endsAt: '2026-07-31T09:45:00.000Z',
      timezone: 'Africa/Cairo',
    })).resolves.toEqual({
      outcome: 'delivery_unknown',
      error: 'google_calendar_create_network:Error: socket closed after write',
      providerResponse: {},
    });
  });
});
