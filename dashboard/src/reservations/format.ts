import type { Reservation, ReservationStatus } from '../api/types';

/**
 * Pure helpers for the reservations screens. No React Native imports, so the
 * root test suite can import this file and check grouping, labels and which
 * actions a status allows.
 */

export type ReservationAction = 'confirm' | 'decline' | 'seated' | 'completed' | 'no_show';

const STATUS_LABEL: Record<ReservationStatus, string> = {
  requested: 'Needs approval',
  confirmed: 'Confirmed',
  seated: 'Seated',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export const statusLabel = (status: ReservationStatus): string => STATUS_LABEL[status] ?? status;

/** What a host may do from each status. The backend enforces the same transitions. */
export function actionsFor(status: ReservationStatus): ReservationAction[] {
  switch (status) {
    case 'requested':
      return ['confirm', 'decline'];
    case 'confirmed':
      return ['seated', 'no_show', 'decline'];
    case 'seated':
      return ['completed'];
    default:
      return [];
  }
}

export const actionLabel = (action: ReservationAction, status: ReservationStatus): string => {
  if (action === 'decline') return status === 'requested' ? 'Decline' : 'Cancel reservation';
  return { confirm: 'Confirm', seated: 'Mark seated', completed: 'Mark completed', no_show: 'Mark no-show' }[action];
};

export const isHeld = (r: Pick<Reservation, 'status'>): boolean => r.status === 'requested';
export const heldCount = (items: Pick<Reservation, 'status'>[]): number => items.filter(isHeld).length;

/** Reservations that still occupy a table, which is what a day's cover count is made of. */
const ACTIVE: ReservationStatus[] = ['requested', 'confirmed', 'seated'];
export const coversOf = (items: Pick<Reservation, 'status' | 'partySize'>[]): number =>
  items.filter((r) => ACTIVE.includes(r.status)).reduce((sum, r) => sum + r.partySize, 0);

/** YYYY-MM-DD for `now` in `timezone`: the venue's today, not the phone's. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const addDays = (date: string, n: number): string => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d + n));
  return out.toISOString().slice(0, 10);
};

/** "Today", "Tomorrow", otherwise "Fri 9 Oct". */
export function dayLabel(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The local clock time of a reservation, in the venue's timezone. */
export function timeIn(timezone: string, iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export interface DayGroup {
  date: string;
  label: string;
  covers: number;
  shifts: Array<{ shift: string; items: Reservation[] }>;
}

/**
 * Days in date order, each split by shift in time order. Cancelled reservations
 * are left out of a day's covers but still listed, so a host sees what changed.
 */
export function groupByDay(items: Reservation[], today: string): DayGroup[] {
  const days = new Map<string, Reservation[]>();
  for (const item of items) days.set(item.serviceDate, [...(days.get(item.serviceDate) ?? []), item]);
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => {
      const shifts = new Map<string, Reservation[]>();
      for (const item of [...list].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
        shifts.set(item.shift, [...(shifts.get(item.shift) ?? []), item]);
      }
      return {
        date,
        label: dayLabel(date, today),
        covers: coversOf(list),
        shifts: [...shifts.entries()].map(([shift, shiftItems]) => ({ shift, items: shiftItems })),
      };
    });
}

export type RangeKey = 'today' | 'tomorrow' | 'upcoming';

/** The `from` / `to` query for a range chip, in the venue's calendar. */
export function rangeFor(key: RangeKey, today: string): { from: string; to?: string } {
  if (key === 'today') return { from: today, to: today };
  if (key === 'tomorrow') return { from: addDays(today, 1), to: addDays(today, 1) };
  return { from: today };
}

export function depositLabel(r: Pick<Reservation, 'depositRequired' | 'depositStatus'>): string {
  if (!r.depositRequired) return '';
  const labels: Record<string, string> = { pending: 'Deposit pending', paid: 'Deposit paid', waived: 'Deposit waived' };
  return labels[r.depositStatus] ?? 'Deposit';
}
