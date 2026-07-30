export interface CreateCalendarEventCommand {
  calendarId: string;
  idempotencyKey: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export type CalendarProviderResult =
  | { outcome: 'created'; providerEventId: string; providerResponse: Record<string, unknown> }
  | { outcome: 'retryable'; error: string; retryAfterSeconds?: number; providerResponse?: Record<string, unknown> }
  | { outcome: 'permanently_failed'; error: string; providerResponse?: Record<string, unknown> }
  | { outcome: 'delivery_unknown'; error: string; providerResponse?: Record<string, unknown> };

export interface CalendarProvider {
  createEvent(command: CreateCalendarEventCommand): Promise<CalendarProviderResult>;
}
