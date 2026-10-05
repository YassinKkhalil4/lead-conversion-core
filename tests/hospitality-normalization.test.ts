import { describe, expect, it } from 'vitest';
import {
  calendarDateIn,
  isCancelIntent,
  isNewBookingIntent,
  formatDate,
  formatDateShift,
  parseDateShift,
  parsePartySize,
  parseServiceDate,
  parseShift,
  readDateShift,
} from '../src/domain/hospitality-normalization.js';

// Monday 5 October 2026.
const today = { year: 2026, month: 10, day: 5 };
const date = (text: string) => {
  const d = parseServiceDate(text, today);
  return d ? formatDate(d) : null;
};

describe('party size', () => {
  it.each([
    ['4', 4], ['somos 6', 6], ['mesa para cuatro', 4], ['table for two', 2], ['dues persones', 2],
    ['٤', 4], ['for 12 people', 12], ['cinc', 5], ['una mesa', null], ['una mesa para cuatro', 4], ['una persona', 1], ['un', 1], ['mesa para dos', 2], ['once personas', 11], ['el nou menu', null], ['hola', null], ['0', null], ['600', null],
  ])('reads %s as %s', (text, expected) => expect(parsePartySize(text)).toBe(expected));
});

describe('shift', () => {
  it.each([
    ['dinner', 'dinner'], ['cena', 'dinner'], ['sopar', 'dinner'], ['por la noche', 'dinner'],
    ['lunch', 'lunch'], ['comida', 'lunch'], ['almuerzo', 'lunch'], ['dinar', 'lunch'],
    ['whenever', null], ['lunch or dinner', null],
  ])('reads %s as %s', (text, expected) => expect(parseShift(text)).toBe(expected));
});

describe('service date, with Monday 5 October 2026 as today', () => {
  it.each([
    ['today', '2026-10-05'], ['hoy', '2026-10-05'], ['avui', '2026-10-05'],
    ['tomorrow', '2026-10-06'], ['mañana', '2026-10-06'], ['demà', '2026-10-06'],
    ['pasado mañana', '2026-10-07'], ['demà passat', '2026-10-07'],
    ['friday', '2026-10-09'], ['el viernes', '2026-10-09'], ['divendres', '2026-10-09'],
    ['monday', '2026-10-12'], ['el lunes', '2026-10-12'],
    ['15/10', '2026-10-15'], ['15-10-2026', '2026-10-15'], ['3/2', '2027-02-03'],
    ['15 de octubre', '2026-10-15'], ['october 15', '2026-10-15'], ["15 d'octubre", '2026-10-15'],
    ['2 de enero', '2027-01-02'], ['31/4', null], ['whenever', null],
  ])('reads %s as %s', (text, expected) => expect(date(text)).toBe(expected));

  it('keeps leap days', () => {
    expect(formatDate(parseServiceDate('29/2/2028', today)!)).toBe('2028-02-29');
    expect(parseServiceDate('29/2/2027', today)).toBeNull();
  });
});

describe('date and shift together', () => {
  it('needs both halves', () => {
    expect(parseDateShift('friday dinner', today)).toEqual({ date: { year: 2026, month: 10, day: 9 }, shift: 'dinner' });
    expect(parseDateShift('el sábado a la comida', today)?.shift).toBe('lunch');
    expect(parseDateShift('divendres sopar', today)?.shift).toBe('dinner');
    expect(parseDateShift('friday', today)).toBeNull();
    expect(parseDateShift('dinner', today)).toBeNull();
  });

  it('round-trips the stored value', () => {
    const parsed = parseDateShift('friday dinner', today)!;
    const stored = formatDateShift(parsed.date, parsed.shift);
    expect(stored).toBe('2026-10-09|dinner');
    expect(readDateShift(stored)).toEqual(parsed);
    expect(readDateShift('nonsense')).toBeNull();
  });
});

describe('calendar date in a timezone', () => {
  it('is the venue\'s date, not the server\'s', () => {
    const instant = new Date('2026-10-05T22:30:00Z'); // 00:30 on the 6th in Madrid
    expect(calendarDateIn('Europe/Madrid', instant)).toEqual({ year: 2026, month: 10, day: 6 });
    expect(calendarDateIn('UTC', instant)).toEqual({ year: 2026, month: 10, day: 5 });
  });
});

describe('intent', () => {
  it.each(['cancelar', 'CANCEL', 'cancel·lar', 'quiero anular mi reserva', 'please cancel it'])('"%s" is a cancellation', (t) => expect(isCancelIntent(t)).toBe(true));
  it.each(['gracias', 'hola', 'una mesa para cuatro'])('"%s" is not a cancellation', (t) => expect(isCancelIntent(t)).toBe(false));
  it.each(['hola', 'quiero reservar', 'una taula per a dos', '4', 'hello'])('"%s" starts a new booking', (t) => expect(isNewBookingIntent(t)).toBe(true));
  it.each(['gracias', 'ok', 'perfecto', 'merci'])('"%s" does not', (t) => expect(isNewBookingIntent(t)).toBe(false));
});
