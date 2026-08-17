import { differenceInSeconds, format, isValid, parseISO } from 'date-fns';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  return isValid(parsed) ? parsed : null;
}

export function secondsSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  const parsed = parse(iso);
  return parsed ? differenceInSeconds(now, parsed) : null;
}

/**
 * Relative inside the first 24 hours, absolute after that. A salesperson cares
 * that a lead replied "6m" ago; four days later the exact date is what matters.
 */
export function age(iso: string | null | undefined, now: Date = new Date()): string {
  const parsed = parse(iso);
  if (!parsed) return '—';
  const seconds = differenceInSeconds(now, parsed);
  if (seconds < 0) return 'now';
  if (seconds < 45) return 'now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h`;
  return format(parsed, 'd MMM');
}

/**
 * The queue clock. Minutes under an hour, hours and minutes under a day, an
 * absolute weekday and time beyond that: `41m`, `2h 14m`, `Tue 14:20`.
 *
 * Minutes are kept alongside hours because the difference between 2h 05m and
 * 2h 55m is what decides whether a lead is still worth calling today.
 */
export function queueClock(iso: string | null | undefined, now: Date = new Date()): string {
  const parsed = parse(iso);
  if (!parsed) return '—';
  const seconds = differenceInSeconds(now, parsed);
  if (seconds < 60) return 'now';
  if (seconds < HOUR) return `${Math.floor(seconds / MINUTE)}m`;
  if (seconds < DAY) {
    const hours = Math.floor(seconds / HOUR);
    const minutes = Math.floor((seconds % HOUR) / MINUTE);
    return minutes === 0 ? `${hours}h` : `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return format(parsed, 'EEE HH:mm');
}

/** Same rule as `age`, phrased for prose. */
export function ageAgo(iso: string | null | undefined, now: Date = new Date()): string {
  const parsed = parse(iso);
  if (!parsed) return 'never';
  const seconds = differenceInSeconds(now, parsed);
  if (seconds < DAY) {
    const relative = age(iso, now);
    return relative === 'now' ? 'just now' : `${relative} ago`;
  }
  return format(parsed, 'd MMM, HH:mm');
}

export function timestamp(iso: string | null | undefined): string {
  const parsed = parse(iso);
  return parsed ? format(parsed, 'd MMM yyyy, HH:mm') : '—';
}

export function clock(iso: string | null | undefined): string {
  const parsed = parse(iso);
  return parsed ? format(parsed, 'HH:mm') : '';
}

export function dayHeading(iso: string | null | undefined): string {
  const parsed = parse(iso);
  return parsed ? format(parsed, 'EEEE d MMM') : '';
}

/** Compact duration for response-time figures: "38s", "6m", "2h 10m". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.round(seconds));
  if (total < MINUTE) return `${total}s`;
  if (total < HOUR) return `${Math.floor(total / MINUTE)}m`;
  const hours = Math.floor(total / HOUR);
  const minutes = Math.floor((total % HOUR) / MINUTE);
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type Urgency = 'calm' | 'slow' | 'overdue';

/**
 * Response time is the product's value proposition, so waiting is graded rather
 * than merely displayed. An assignment unacknowledged past 15 minutes is what
 * the backend's own SLA reminder fires on; 30 minutes is its escalation.
 */
export function acknowledgementUrgency(waitingSeconds: number | null): Urgency {
  if (waitingSeconds === null) return 'calm';
  if (waitingSeconds >= 30 * MINUTE) return 'overdue';
  if (waitingSeconds >= 15 * MINUTE) return 'slow';
  return 'calm';
}

/** Hours remaining in the 24-hour WhatsApp session window. */
export function windowRemaining(expiresAt: string | null | undefined, now: Date = new Date()): string {
  const parsed = parse(expiresAt);
  if (!parsed) return 'closed';
  const seconds = differenceInSeconds(parsed, now);
  if (seconds <= 0) return 'closed';
  return duration(seconds);
}
