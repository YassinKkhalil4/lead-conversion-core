import { describe, expect, it } from 'vitest';
import {
  SLOT_TITLE_MAX_LENGTH,
  generateAppointmentSlots,
  parseAppointmentHours,
} from '../src/domain/appointment-slots.js';

const defaultConfig = {
  timezone: 'Africa/Cairo',
  appointmentHours: ['11:00', '14:00', '16:00'],
  blackoutDays: ['Friday'],
};

describe('appointment slot generation', () => {
  it('offers at most nine slots across three non-blackout days', () => {
    // Monday 2026-06-01 12:00 Cairo. Tomorrow is Tuesday, so Tue/Wed/Thu.
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-06-01T09:00:00Z') });

    expect(slots).toHaveLength(9);
    expect([...new Set(slots.map((slot) => slot.localDate))]).toEqual(['2026-06-02', '2026-06-03', '2026-06-04']);
    expect(slots.map((slot) => slot.localTime).slice(0, 3)).toEqual(['11:00', '14:00', '16:00']);
  });

  it('skips blackout weekdays instead of shrinking the offer', () => {
    // Wednesday 2026-06-03. Tomorrow is Thursday; Friday is blacked out.
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-06-03T09:00:00Z') });

    const dates = [...new Set(slots.map((slot) => slot.localDate))];
    expect(dates).toEqual(['2026-06-04', '2026-06-06', '2026-06-07']);
    expect(dates).not.toContain('2026-06-05');
    expect(slots).toHaveLength(9);
  });

  it('honours a multi-day blackout list', () => {
    const slots = generateAppointmentSlots({
      config: { ...defaultConfig, blackoutDays: ['Friday', 'saturday'] },
      now: new Date('2026-06-03T09:00:00Z'),
    });

    const dates = [...new Set(slots.map((slot) => slot.localDate))];
    expect(dates).toEqual(['2026-06-04', '2026-06-07', '2026-06-08']);
  });

  it('keeps local appointment hours correct across the end of Egyptian DST', () => {
    // Egypt leaves DST after the last Thursday of October, which is
    // 2026-10-29. Thursday is still +03:00; Saturday is already +02:00.
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-10-28T09:00:00Z') });

    const dates = [...new Set(slots.map((slot) => slot.localDate))];
    expect(dates).toEqual(['2026-10-29', '2026-10-31', '2026-11-01']);

    const at = (localDate: string, localTime: string): string =>
      slots.find((slot) => slot.localDate === localDate && slot.localTime === localTime)?.startsAt || '';

    // Same wall-clock hour, different UTC instants either side of the change.
    expect(at('2026-10-29', '11:00')).toBe('2026-10-29T08:00:00.000Z');
    expect(at('2026-10-31', '11:00')).toBe('2026-10-31T09:00:00.000Z');
    expect(at('2026-11-01', '16:00')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('keeps local appointment hours correct across the start of Egyptian DST', () => {
    // DST resumes on the last Friday of April, 2026-04-24.
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-04-22T09:00:00Z') });

    const at = (localDate: string, localTime: string): string =>
      slots.find((slot) => slot.localDate === localDate && slot.localTime === localTime)?.startsAt || '';

    expect(at('2026-04-23', '11:00')).toBe('2026-04-23T09:00:00.000Z');
    expect(at('2026-04-25', '11:00')).toBe('2026-04-25T08:00:00.000Z');
  });

  it('renders real Arabic and English titles inside the Meta 24-character cap', () => {
    // 2026-09-29 is a Tuesday: the longest Arabic weekday paired with a
    // six-letter Arabic month is the worst case for the row title.
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-09-28T09:00:00Z') });

    expect(slots[0]?.labels.Arabic).toBe('الثلاثاء 29 سبتمبر 11:00');
    expect(slots[0]?.labels.Arabic).toHaveLength(24);
    expect(slots[0]?.labels.English).toBe('Tuesday 29 Sep 11:00');

    for (const slot of slots) {
      expect(slot.labels.Arabic.length).toBeLessThanOrEqual(SLOT_TITLE_MAX_LENGTH);
      expect(slot.labels.English.length).toBeLessThanOrEqual(SLOT_TITLE_MAX_LENGTH);
    }
  });

  it('falls back to a numeric month when a title would overflow the cap', () => {
    const slots = generateAppointmentSlots({
      config: { ...defaultConfig, appointmentHours: ['11:00'], timezone: 'Africa/Cairo' },
      now: new Date('2026-09-28T09:00:00Z'),
    });
    const [first] = slots;
    expect(first?.labels.Arabic).toBe('الثلاثاء 29 سبتمبر 11:00');

    // A wider label than the cap allows must degrade, never be truncated.
    const wide = generateAppointmentSlots({
      config: { timezone: 'Africa/Cairo', appointmentHours: ['11:00'], blackoutDays: [] },
      now: new Date('2026-12-28T09:00:00Z'),
    });
    for (const slot of wide) {
      expect(slot.labels.Arabic.length).toBeLessThanOrEqual(SLOT_TITLE_MAX_LENGTH);
    }
  });

  it('excludes instants the lead has already booked', () => {
    const slots = generateAppointmentSlots({ config: defaultConfig, now: new Date('2026-06-01T09:00:00Z') });
    const taken = slots[0]?.startsAt || '';

    const reoffered = generateAppointmentSlots({
      config: defaultConfig,
      now: new Date('2026-06-01T09:00:00Z'),
      excludeStartsAt: [taken],
    });

    expect(reoffered.map((slot) => slot.startsAt)).not.toContain(taken);
    expect(reoffered).toHaveLength(8);
  });

  it('returns nothing when no appointment hour is usable', () => {
    expect(generateAppointmentSlots({ config: { ...defaultConfig, appointmentHours: [] } })).toEqual([]);
    expect(generateAppointmentSlots({ config: { ...defaultConfig, appointmentHours: ['25:00', 'noon'] } })).toEqual([]);
  });

  it('parses, sorts, and deduplicates configured appointment hours', () => {
    expect(parseAppointmentHours(['16:00', '9:30', '16:00', 'bad', '11:00']).map((hour) => hour.text))
      .toEqual(['09:30', '11:00', '16:00']);
    expect(parseAppointmentHours('not-an-array')).toEqual([]);
  });
});
