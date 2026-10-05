import type { CalendarDate } from './hospitality-normalization.js';
import type { Language } from './types.js';

const LOCALE: Record<Language, string> = { English: 'en-GB', Spanish: 'es-ES', Catalan: 'ca-ES', Arabic: 'ar-EG' };

/** "viernes, 9 de octubre": a calendar date written for a guest, in their language. */
export function describeDate(date: CalendarDate, language: Language): string {
  return new Intl.DateTimeFormat(LOCALE[language], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(date.year, date.month - 1, date.day)));
}

