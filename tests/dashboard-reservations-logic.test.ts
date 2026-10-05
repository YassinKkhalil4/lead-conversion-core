import { describe, expect, it } from 'vitest';
import type { Reservation } from '../dashboard/src/api/types.js';
import { navFor } from '../dashboard/src/nav/routes.js';
import { hospitality } from '../dashboard/src/profile/hospitality.js';
import { realEstate } from '../dashboard/src/profile/real-estate.js';
import {
  actionsFor,
  coversOf,
  dayLabel,
  depositLabel,
  groupByDay,
  heldCount,
  rangeFor,
  statusLabel,
  timeIn,
  todayIn,
} from '../dashboard/src/reservations/format.js';

function res(overrides: Partial<Reservation>): Reservation {
  return {
    reservationId: 'r', leadId: 'l', guestName: 'Marta', guestPhone: '+34600000000', venueId: 'v', venueName: 'Cal Demo',
    partySize: 2, serviceDate: '2026-10-09', shift: 'Dinner', zone: 'Terrace', startsAt: '2026-10-09T18:30:00.000Z',
    status: 'confirmed', depositRequired: false, depositStatus: 'none', provider: 'kadensio', language: 'Spanish',
    notes: '', hostId: null, hostName: '', createdAt: '2026-10-05T10:00:00.000Z', ...overrides,
  };
}

describe('what a host may do', () => {
  it('follows the backend transitions', () => {
    expect(actionsFor('requested')).toEqual(['confirm', 'decline']);
    expect(actionsFor('confirmed')).toEqual(['seated', 'no_show', 'decline']);
    expect(actionsFor('seated')).toEqual(['completed']);
    for (const status of ['completed', 'cancelled', 'no_show'] as const) expect(actionsFor(status)).toEqual([]);
  });

  it('names statuses for a host, not for a database', () => {
    expect(statusLabel('requested')).toBe('Needs approval');
    expect(statusLabel('no_show')).toBe('No-show');
  });
});

describe('days and shifts', () => {
  const today = '2026-10-05';

  it('labels days relative to the venue\'s today', () => {
    expect(dayLabel('2026-10-05', today)).toBe('Today');
    expect(dayLabel('2026-10-06', today)).toBe('Tomorrow');
    expect(dayLabel('2026-10-04', today)).toBe('Yesterday');
    expect(dayLabel('2026-10-09', today)).toBe('Fri 9 Oct');
    expect(dayLabel('2026-12-31', '2026-12-30')).toBe('Tomorrow');
    expect(dayLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow');
  });

  it('groups by day in order, then shift, then time', () => {
    const items = [
      res({ reservationId: 'c', serviceDate: '2026-10-09', shift: 'Dinner', startsAt: '2026-10-09T19:30:00.000Z' }),
      res({ reservationId: 'a', serviceDate: '2026-10-06', shift: 'Lunch', startsAt: '2026-10-06T11:30:00.000Z' }),
      res({ reservationId: 'b', serviceDate: '2026-10-09', shift: 'Dinner', startsAt: '2026-10-09T18:30:00.000Z' }),
    ];
    const days = groupByDay(items, today);
    expect(days.map((d) => d.label)).toEqual(['Tomorrow', 'Fri 9 Oct']);
    expect(days[1]!.shifts[0]!.items.map((i) => i.reservationId)).toEqual(['b', 'c']);
  });

  it('counts covers for tables still in play, not cancelled or no-show ones', () => {
    const items = [
      res({ partySize: 4 }), res({ partySize: 6, status: 'requested' }), res({ partySize: 2, status: 'seated' }),
      res({ partySize: 8, status: 'cancelled' }), res({ partySize: 3, status: 'no_show' }), res({ partySize: 5, status: 'completed' }),
    ];
    expect(coversOf(items)).toBe(12);
    expect(groupByDay(items, today)[0]!.covers).toBe(12);
    expect(heldCount(items)).toBe(1);
  });

  it('builds the query range for each chip', () => {
    expect(rangeFor('today', today)).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(rangeFor('tomorrow', today)).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    expect(rangeFor('upcoming', today)).toEqual({ from: '2026-10-05' });
  });
});

describe('venue time', () => {
  it('reads today and the clock in the venue\'s timezone, not the phone\'s', () => {
    const instant = new Date('2026-10-05T22:30:00Z'); // 00:30 on the 6th in Madrid
    expect(todayIn('Europe/Madrid', instant)).toBe('2026-10-06');
    expect(todayIn('UTC', instant)).toBe('2026-10-05');
    expect(timeIn('Europe/Madrid', '2026-10-09T18:30:00.000Z')).toBe('20:30');
    expect(timeIn('Europe/Madrid', '2026-12-09T19:30:00.000Z')).toBe('20:30'); // winter time
  });
});

describe('deposit', () => {
  it('says nothing when none was needed', () => {
    expect(depositLabel({ depositRequired: false, depositStatus: 'none' })).toBe('');
    expect(depositLabel({ depositRequired: true, depositStatus: 'pending' })).toBe('Deposit pending');
    expect(depositLabel({ depositRequired: true, depositStatus: 'paid' })).toBe('Deposit paid');
  });
});

describe('navigation', () => {
  it('shows Reservations to hospitality tenants only, to every role', () => {
    for (const role of ['salesperson', 'manager', 'admin'] as const) {
      expect(navFor(role, hospitality).map((i) => i.href)).toContain('/reservations');
      expect(navFor(role, realEstate).map((i) => i.href)).not.toContain('/reservations');
    }
  });

  it('keeps every other link as it was', () => {
    expect(navFor('admin', realEstate).map((i) => i.href)).toEqual(['/manage', '/leads', '/manage/salespeople', '/manage/projects', '/manage/users', '/notifications']);
    expect(navFor('salesperson', hospitality).map((i) => i.href)).toEqual(['/leads', '/reservations', '/notifications']);
  });
});
