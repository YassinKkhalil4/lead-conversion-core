import type { QualificationAnswer } from '@/api/types';

export const QUESTION = {
  permission: 'q_permission',
  location: 'q_location',
  unitType: 'q_unit_type',
  budget: 'q_budget',
  paymentPlan: 'q_payment_plan',
  downPayment: 'q_down_payment',
  timeline: 'q_timeline',
  budgetMin: 'q_budget_min',
  budgetMax: 'q_budget_max',
  purpose: 'q_purpose',
  siteVisit: 'q_site_visit',
} as const;

export type AnswerIndex = Map<string, QualificationAnswer>;

export function indexAnswers(answers: QualificationAnswer[]): AnswerIndex {
  return new Map(answers.map((answer) => [answer.questionKey, answer]));
}

/**
 * The list endpoint returns answers as a flat `{question: value}` object while
 * the detail endpoint returns full answer records. Both are read through the
 * same index so a queue row and a call-prep sheet cannot disagree about what a
 * lead said.
 */
export function indexAnswerMap(answers: Record<string, string>): AnswerIndex {
  return new Map(
    Object.entries(answers ?? {})
      .filter(([, value]) => typeof value === 'string' && value.trim() !== '')
      .map(([questionKey, value]) => [
        questionKey,
        {
          questionKey,
          order: 0,
          answered: true,
          normalizedValue: value,
          rawValue: value,
          parserSource: '',
          answeredAt: null,
        } satisfies QualificationAnswer,
      ]),
  );
}

/**
 * Budget reaches the client in two shapes. The current configuration stores a
 * single range string on `q_budget` (`10000000-50000000`), while other
 * configuration versions split it across `q_budget_min` and `q_budget_max`.
 * Both are normalised to the range form before any formatting happens, so the
 * rest of the code only ever sees one.
 */
export function budgetValue(answers: AnswerIndex): string {
  const single = valueOf(answers, QUESTION.budget);
  if (single) return single;

  const low = valueOf(answers, QUESTION.budgetMin);
  const high = valueOf(answers, QUESTION.budgetMax);
  if (low && high) return `${low}-${high}`;
  return low || high;
}

/** The stored value, or empty string when the question was never answered. */
export function valueOf(answers: AnswerIndex, key: string): string {
  const answer = answers.get(key);
  if (!answer?.answered) return '';
  return (answer.normalizedValue || answer.rawValue || '').trim();
}

/** 10000000 -> "10M", 1500000 -> "1.5M", 500000 -> "500K". */
export function formatEgp(amount: number): string {
  if (!Number.isFinite(amount)) return '';
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    return `${Number.isInteger(millions) ? millions : Number(millions.toFixed(1))}M`;
  }
  if (amount >= 1_000) {
    const thousands = amount / 1_000;
    return `${Number.isInteger(thousands) ? thousands : Number(thousands.toFixed(1))}K`;
  }
  return String(Math.round(amount));
}

function parseRange(value: string): { low: number; high: number | null } | null {
  const trimmed = value.trim();
  const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range?.[1] && range[2]) return { low: Number(range[1]), high: Number(range[2]) };
  const single = trimmed.match(/^(\d+)$/);
  if (single?.[1]) return { low: Number(single[1]), high: null };
  return null;
}

/**
 * Budget answers are stored as raw range strings from the configuration's
 * option list, for example `10000000-50000000`. Nobody reads that on a phone
 * ten seconds before dialling, so it is rendered as `10M – 50M EGP`.
 * Free-text budgets that do not parse are passed through untouched.
 */
export function formatBudget(value: string): string {
  const parsed = parseRange(value);
  if (!parsed) return value;
  if (parsed.high === null) return `${formatEgp(parsed.low)} EGP`;
  if (parsed.low === 0) return `Under ${formatEgp(parsed.high)} EGP`;
  return `${formatEgp(parsed.low)} – ${formatEgp(parsed.high)} EGP`;
}

/** The one-line form used in a queue row and in the opening line: `10M+`. */
export function formatBudgetCompact(value: string): string {
  const parsed = parseRange(value);
  if (!parsed) return value;
  if (parsed.high === null) return formatEgp(parsed.low);
  if (parsed.low === 0) return `<${formatEgp(parsed.high)}`;
  return `${formatEgp(parsed.low)}+`;
}

export interface Fact {
  label: string;
  value: string;
  numeric: boolean;
}

/**
 * The four facts someone needs before dialling. Order is fixed so the position
 * of a value carries meaning even when a label is skimmed past.
 */
export function fourFacts(answers: AnswerIndex): Fact[] {
  const budget = budgetValue(answers);
  return [
    { label: 'Budget', value: budget ? formatBudget(budget) : '', numeric: true },
    { label: 'Unit', value: valueOf(answers, QUESTION.unitType), numeric: false },
    { label: 'Location', value: valueOf(answers, QUESTION.location), numeric: false },
    { label: 'Timeline', value: valueOf(answers, QUESTION.timeline), numeric: false },
  ];
}

/**
 * The conversation engine skips the down-payment question when the lead is
 * paying cash. Saying so is more useful than showing an unexplained gap.
 */
export function skipReason(questionKey: string, answers: AnswerIndex): string {
  if (questionKey === QUESTION.downPayment) {
    const plan = valueOf(answers, QUESTION.paymentPlan).toLowerCase();
    if (plan === 'cash') return 'skipped — paying cash';
  }
  if (questionKey !== QUESTION.permission && !valueOf(answers, QUESTION.permission)) {
    return 'not reached';
  }
  return 'not answered';
}

/**
 * One line describing what the lead wants, for a queue row. Missing parts are
 * omitted rather than rendered as empty slots, so the line is always readable.
 */
export function summaryLine(answers: AnswerIndex): string {
  const budget = budgetValue(answers);
  const parts = [
    valueOf(answers, QUESTION.unitType),
    valueOf(answers, QUESTION.location),
    budget ? formatBudgetCompact(budget) : '',
    valueOf(answers, QUESTION.paymentPlan),
    valueOf(answers, QUESTION.timeline),
  ].filter(Boolean);
  return parts.join(' · ');
}

const UNIT_TYPE_AR: Record<string, string> = {
  apartment: 'شقة',
  villa: 'فيلا',
  townhouse: 'تاون هاوس',
  duplex: 'دوبلكس',
  studio: 'استوديو',
  chalet: 'شاليه',
  commercial: 'وحدة تجارية',
};

function budgetArabic(value: string): string {
  const compact = formatBudgetCompact(value);
  if (!compact) return '';
  if (compact.startsWith('<')) return `أقل من ${compact.slice(1).replace('M', ' مليون').replace('K', ' ألف')}`;
  return compact.replace('M', ' مليون').replace('K', ' ألف');
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

/**
 * The line to open a call with, assembled from answers already in the lead
 * response. No model call, no network. Every missing part shortens the sentence
 * rather than leaving a hole, so it never reads as broken.
 *
 * Written in the language the lead chose during qualification. An empty
 * preference means the conversation never settled on one, which falls back to
 * English rather than guessing from the script of a name.
 */
export function openingLine(
  contactName: string,
  answers: AnswerIndex,
  preferredLanguage = '',
): string {
  if (preferredLanguage === 'Arabic') return openingLineArabic(contactName, answers);
  const name = firstName(contactName);
  const greeting = name ? `Hi ${name} — following up` : 'Following up';

  const unit = valueOf(answers, QUESTION.unitType).toLowerCase();
  const location = valueOf(answers, QUESTION.location);
  const budget = budgetValue(answers);
  const budgetText = budget ? formatBudgetCompact(budget) : '';

  const interest = [
    unit ? `a ${unit}` : '',
    location ? `in ${location}` : '',
    budgetText ? `around ${budgetText}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!interest) {
    return `${greeting} on your enquiry. I have a few options that might suit you.`;
  }
  return `${greeting} on your interest in ${interest}. I have a few options that fit.`;
}

function openingLineArabic(contactName: string, answers: AnswerIndex): string {
  const name = firstName(contactName);
  const greeting = name ? `أهلاً ${name}،` : 'أهلاً،';

  const unit = valueOf(answers, QUESTION.unitType);
  const unitArabic = UNIT_TYPE_AR[unit.toLowerCase()] ?? '';
  const location = valueOf(answers, QUESTION.location);
  const budget = budgetValue(answers);
  const budgetText = budget ? budgetArabic(budget) : '';

  const interest = [
    // A recognised unit type takes the attached prefix; anything else stays
    // detached, which is how Arabic handles a foreign word.
    unitArabic ? `ب${unitArabic}` : unit ? `بـ${unit}` : '',
    location ? `في ${location}` : '',
    budgetText ? `حوالي ${budgetText}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!interest) {
    return `${greeting} بخصوص طلبك. عندي كام خيار ممكن يناسبك.`;
  }
  return `${greeting} بخصوص اهتمامك ${interest}. عندي كام خيار مناسب.`;
}
