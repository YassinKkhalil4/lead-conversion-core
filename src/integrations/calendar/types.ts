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

export type CalendarAvailabilityResult =
  | { outcome: 'available'; providerResponse?: Record<string, unknown> }
  | { outcome: 'busy'; error: string; providerResponse?: Record<string, unknown> }
  | { outcome: 'retryable'; error: string; retryAfterSeconds?: number; providerResponse?: Record<string, unknown> }
  | { outcome: 'permanently_failed'; error: string; providerResponse?: Record<string, unknown> }
  | { outcome: 'delivery_unknown'; error: string; providerResponse?: Record<string, unknown> };

export interface CalendarProvider {
  checkAvailability(command: CreateCalendarEventCommand): Promise<CalendarAvailabilityResult>;
  createEvent(command: CreateCalendarEventCommand): Promise<CalendarProviderResult>;
}
