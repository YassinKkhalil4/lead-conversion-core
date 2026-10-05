import { normalizeDigits } from './digits.js';

/**
 * Reading a guest's reservation answers in English, Spanish and Catalan.
 *
 * Pure functions, no clock and no I/O: "today" is passed in as a calendar date
 * in the venue's timezone, so "tomorrow" is the venue's tomorrow wherever the
 * server runs.
 */

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export type ShiftKey = 'lunch' | 'dinner';

const fold = (text: string): string =>
  normalizeDigits(text)
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ');

const words = (text: string): string[] => fold(text).split(/[^a-z0-9·]+/).filter(Boolean);

// ── party size ─────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20,
  // Spanish (accents folded away)
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, veinte: 20,
  // Catalan
  un: 1, dues: 2, quatre: 4, cinc: 5, sis: 6, set: 7, vuit: 8, nou: 9, deu: 10,
  onze: 11, dotze: 12, tretze: 13, catorze: 14, quinze: 15, setze: 16, vint: 20,
};

/**
 * Number words that are also ordinary words ("una mesa", "el nou menú", "set"
 * for thirst): they count only as the whole answer or right before "people".
 */
const AMBIGUOUS_WORDS = new Set(['una', 'un', 'set', 'nou', 'once', 'deu']);
const PEOPLE_WORDS = new Set(['persona', 'personas', 'persones', 'person', 'people', 'pax', 'comensales', 'adultos', 'guests']);

const MAX_PARTY_SIZE = 100;

/**
 * "4", "somos 6", "mesa para cuatro", "table for two", "dues persones".
 * A digit wins. A number word counts when the sentence is about people, or when
 * it is the whole answer, so "una mesa" is not a party of one.
 */
export function parsePartySize(text: string): number | null {
  const digits = normalizeDigits(text).match(/\d+/);
  if (digits) {
    const n = Number(digits[0]);
    return n >= 1 && n <= MAX_PARTY_SIZE ? n : null;
  }
  const tokens = words(text);
  for (const token of tokens) {
    const n = NUMBER_WORDS[token];
    if (n !== undefined && !AMBIGUOUS_WORDS.has(token)) return n;
  }
  for (const [i, token] of tokens.entries()) {
    const n = NUMBER_WORDS[token];
    if (n === undefined) continue;
    if (tokens.length === 1 || PEOPLE_WORDS.has(tokens[i + 1] ?? '')) return n;
  }
  return null;
}

// ── shift ──────────────────────────────────────────────────────────────────

// Catalan "dinar" is lunch and "sopar" is dinner; English "dinner" and Spanish
// "cena" are the evening meal. Listed per word so no language leaks into another.
const LUNCH_WORDS = new Set(['lunch', 'almuerzo', 'almorzar', 'comida', 'mediodia', 'dinar', 'migdia', 'noon', 'midday']);
const DINNER_WORDS = new Set(['dinner', 'cena', 'cenar', 'sopar', 'supper', 'noche', 'nit', 'night', 'evening']);

export function parseShift(text: string): ShiftKey | null {
  const tokens = words(text);
  const lunch = tokens.some((t) => LUNCH_WORDS.has(t));
  const dinner = tokens.some((t) => DINNER_WORDS.has(t));
  if (lunch === dinner) return null; // neither, or both: ask again
  return lunch ? 'lunch' : 'dinner';
}

// ── date ───────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, enero: 1, gener: 1, february: 2, feb: 2, febrero: 2, febrer: 2,
  march: 3, mar: 3, marzo: 3, marc: 3, april: 4, apr: 4, abril: 4,
  may: 5, mayo: 5, maig: 5, june: 6, jun: 6, junio: 6, juny: 6,
  july: 7, jul: 7, julio: 7, juliol: 7, august: 8, aug: 8, agosto: 8, agost: 8,
  september: 9, sep: 9, sept: 9, septiembre: 9, setembre: 9, october: 10, oct: 10, octubre: 10,
  november: 11, nov: 11, noviembre: 11, novembre: 11, december: 12, dec: 12, diciembre: 12, desembre: 12,
};

/** ISO weekday numbers: 1 = Monday .. 7 = Sunday. */
const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, lunes: 1, dilluns: 1,
  tuesday: 2, tue: 2, tues: 2, martes: 2, dimarts: 2,
  wednesday: 3, wed: 3, miercoles: 3, dimecres: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, jueves: 4, dijous: 4,
  friday: 5, fri: 5, viernes: 5, divendres: 5,
  saturday: 6, sat: 6, sabado: 6, dissabte: 6,
  sunday: 7, sun: 7, domingo: 7, diumenge: 7,
};

const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] as number;

const toUtc = (d: CalendarDate): number => Date.UTC(d.year, d.month - 1, d.day);
const fromUtc = (ms: number): CalendarDate => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
export const addDays = (d: CalendarDate, n: number): CalendarDate => fromUtc(toUtc(d) + n * 86_400_000);
const isoWeekday = (d: CalendarDate): number => ((new Date(toUtc(d)).getUTCDay() + 6) % 7) + 1;
const valid = (d: CalendarDate): boolean => d.month >= 1 && d.month <= 12 && d.day >= 1 && d.day <= daysIn(d.year, d.month);

export const formatDate = (d: CalendarDate): string =>
  `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

export function parseCalendarDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  return valid(d) ? d : null;
}

/** A day-month with no year means the next one that is not in the past. */
function withYear(today: CalendarDate, month: number, day: number, year?: number): CalendarDate | null {
  if (year !== undefined) {
    const d = { year: year < 100 ? 2000 + year : year, month, day };
    return valid(d) ? d : null;
  }
  const thisYear = { year: today.year, month, day };
  if (valid(thisYear) && toUtc(thisYear) >= toUtc(today)) return thisYear;
  const next = { year: today.year + 1, month, day };
  return valid(next) ? next : null;
}

/**
 * "hoy", "tomorrow", "demà", "viernes", "next friday", "15/10", "15 de octubre",
 * "october 15", "15 d'octubre". A weekday names its next occurrence: said on a
 * Friday, "viernes" means a week from today ("hoy" is how a guest says today).
 */
export function parseServiceDate(text: string, today: CalendarDate): CalendarDate | null {
  const folded = fold(text);
  const tokens = words(text);
  const has = (...w: string[]) => w.some((x) => tokens.includes(x));

  // Numeric: 15/10, 15-10-2026, 15.10
  const numeric = /\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/.exec(folded);
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3]) : undefined;
    return withYear(today, Number(numeric[2]), Number(numeric[1]), year);
  }

  // Day and month name, either order: "15 de octubre", "15 octubre", "october 15"
  for (const [i, token] of tokens.entries()) {
    const month = MONTHS[token];
    if (month === undefined) continue;
    const before = tokens.slice(0, i).reverse().find((t) => /^\d{1,2}$/.test(t));
    const after = tokens.slice(i + 1).find((t) => /^\d{1,2}$/.test(t));
    const day = before ?? after;
    if (day) return withYear(today, month, Number(day));
  }

  if (has('pasado') && has('manana')) return addDays(today, 2);
  if (has('dema') && has('passat')) return addDays(today, 2);
  if (has('day') && has('after') && has('tomorrow')) return addDays(today, 2);
  if (has('hoy', 'today', 'avui')) return today;
  if (has('tomorrow', 'manana', 'dema')) return addDays(today, 1);

  for (const token of tokens) {
    const weekday = WEEKDAYS[token];
    if (weekday === undefined) continue;
    const ahead = ((weekday - isoWeekday(today) + 7) % 7) || 7;
    return addDays(today, ahead);
  }
  return null;
}

/** "Friday dinner" and its Spanish and Catalan forms. Both halves are required. */
export function parseDateShift(text: string, today: CalendarDate): { date: CalendarDate; shift: ShiftKey } | null {
  const date = parseServiceDate(text, today);
  const shift = parseShift(text);
  return date && shift ? { date, shift } : null;
}

/** The stored value of the `q_date_shift` answer: `2026-10-09|dinner`. */
export const formatDateShift = (date: CalendarDate, shift: ShiftKey): string => `${formatDate(date)}|${shift}`;

export function readDateShift(value: string): { date: CalendarDate; shift: ShiftKey } | null {
  const [date, shift] = value.split('|');
  const parsed = date ? parseCalendarDate(date) : null;
  return parsed && (shift === 'lunch' || shift === 'dinner') ? { date: parsed, shift } : null;
}

/** The calendar date in `timezone` at `now`. */
export function calendarDateIn(timezone: string, now: Date): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// ── intent ─────────────────────────────────────────────────────────────────

const CANCEL_WORDS = new Set(['cancel', 'cancelar', 'cancela', 'cancelo', 'cancellar', 'anular', 'anullar', 'cancelled', 'canceled']);

/** "cancelar", "CANCEL", "cancel·lar", "anular mi reserva". */
export function isCancelIntent(text: string): boolean {
  // Catalan writes cancel·lar with a middle dot; fold it into one word first.
  const tokens = fold(text).replace(/·/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => CANCEL_WORDS.has(t));
}

const BOOKING_WORDS = new Set([
  'reservar', 'reserva', 'reservas', 'reservation', 'reservations', 'book', 'booking', 'table', 'tables', 'mesa', 'mesas', 'taula', 'taules',
  'hola', 'hello', 'hi', 'hey', 'buenas', 'bon', 'bones', 'buenos',
]);

/**
 * Whether a message from a guest who already has a booking is a new request:
 * a greeting, a booking word, or a number (a party size). "Gracias" is not.
 */
export function isNewBookingIntent(text: string): boolean {
  const tokens = words(text);
  return tokens.some((t) => BOOKING_WORDS.has(t)) || /\d/.test(normalizeDigits(text));
}
