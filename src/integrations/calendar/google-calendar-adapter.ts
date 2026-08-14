import { getEnv } from '../../config/env.js';
import type {
  CalendarAvailabilityResult,
  CalendarProvider,
  CalendarProviderResult,
  CreateCalendarEventCommand,
} from './types.js';

interface GoogleCalendarAdapterOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
  tokenEndpoint?: string;
  tokenRefreshLeewayMs?: number;
}

interface TokenCache {
  accessToken: string;
  expiresAtMs: number;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 3600);
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.min(Math.max(0, Math.ceil((dateMs - Date.now()) / 1000)), 3600);
  return undefined;
}

function requireOption(name: keyof GoogleCalendarAdapterOptions, value: string): void {
  if (!value) throw new Error(`google_calendar_${name}_required`);
}

export class GoogleCalendarAdapter implements CalendarProvider {
  private tokenCache: TokenCache | null = null;

  constructor(private readonly options: GoogleCalendarAdapterOptions) {
    requireOption('clientId', options.clientId);
    requireOption('clientSecret', options.clientSecret);
    requireOption('refreshToken', options.refreshToken);
  }

  static fromEnv(): GoogleCalendarAdapter {
    const env = getEnv();
    if (!env.GOOGLE_CALENDAR_ENABLED) throw new Error('google_calendar_disabled');
    return new GoogleCalendarAdapter({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
    });
  }

  private fetchImpl(): typeof fetch {
    return this.options.fetchImpl || fetch;
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    const leewayMs = this.options.tokenRefreshLeewayMs ?? 60_000;
    if (!forceRefresh && this.tokenCache && this.tokenCache.expiresAtMs - leewayMs > Date.now()) {
      return this.tokenCache.accessToken;
    }
    const response = await this.fetchImpl()(this.options.tokenEndpoint || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
        refresh_token: this.options.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await parseResponse(response);
    if (!response.ok) throw new Error(`google_calendar_token_refresh_rejected:${response.status}`);
    const accessToken = String(body.access_token || '');
    if (!accessToken) throw new Error('google_calendar_token_refresh_missing_access_token');
    const expiresInSeconds = Number(body.expires_in || 3600);
    const expiresAtMs = Date.now() + Math.max(60, Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000;
    this.tokenCache = { accessToken, expiresAtMs };
    return accessToken;
  }

  private async calendarRequest(url: string, command: CreateCalendarEventCommand, body: Record<string, unknown>, forceRefresh = false): Promise<Response> {
    const token = await this.accessToken(forceRefresh);
    return this.fetchImpl()(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-goog-request-reason': command.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async checkAvailability(command: CreateCalendarEventCommand): Promise<CalendarAvailabilityResult> {
    let response: Response;
    try {
      const body = {
        timeMin: command.startsAt,
        timeMax: command.endsAt,
        timeZone: command.timezone,
        items: [{ id: command.calendarId }],
      };
      response = await this.calendarRequest('https://www.googleapis.com/calendar/v3/freeBusy', command, body);
      if (response.status === 401) response = await this.calendarRequest('https://www.googleapis.com/calendar/v3/freeBusy', command, body, true);
    } catch (error) {
      return { outcome: 'retryable', error: `google_calendar_freebusy_network:${String(error)}`, providerResponse: {} };
    }
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
    let response: Response;
    try {
      const body = {
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
      };
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(command.calendarId)}/events`;
      response = await this.calendarRequest(url, command, body);
      if (response.status === 401) response = await this.calendarRequest(url, command, body, true);
    } catch (error) {
      return { outcome: 'delivery_unknown', error: `google_calendar_create_network:${String(error)}`, providerResponse: {} };
    }
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
