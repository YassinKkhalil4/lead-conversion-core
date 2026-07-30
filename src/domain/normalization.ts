import type {
  CompiledQuestion,
  Language,
  ParserHint,
} from './types.js';

const arabicDigits: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

export function normalizeDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => arabicDigits[digit] ?? digit)
    .replace(/ـ/g, '')
    .trim();
}

export function parseEgpAmount(value: unknown): number | null {
  const text = normalizeDigits(value).replace(/,/g, '').replace(/٫/g, '.');
  let extra = 0;
  if (/و\s*نص/.test(text)) extra = 0.5;
  else if (/و\s*ربع/.test(text)) extra = 0.25;
  else if (/و\s*تلت/.test(text)) extra = 1 / 3;

  const million = text.match(/(\d+(?:\.\d+)?)\s*(مليون|م|m|million)/i);
  if (million?.[1]) return Math.round((Number(million[1]) + extra) * 1_000_000);

  const thousand = text.match(/(\d+(?:\.\d+)?)\s*(الف|ألف|k|thousand)/i);
  if (thousand?.[1]) return Math.round((Number(thousand[1]) + extra) * 1_000);

  const explicit = text.match(/(\d{4,})/);
  if (explicit?.[1]) return Number.parseInt(explicit[1], 10);

  const short = text.match(/(\d+(?:\.\d+)?)/);
  if (short?.[1] && Number(short[1]) <= 100) {
    return Math.round((Number(short[1]) + extra) * 1_000_000);
  }

  return null;
}

export function parseEgpRange(value: unknown): { min: number; max: number } | null {
  const text = normalizeDigits(value).replace(/,/g, '');
  const scale = (raw: string): number => {
    const n = Number(raw);
    if (n <= 100) return Math.round(n * 1_000_000);
    if (n <= 10_000) return Math.round(n * 1_000);
    return Math.round(n);
  };

  if (/أقل|اقل|تحت|less|under/i.test(text)) {
    const amount = parseEgpAmount(text);
    if (amount !== null) return { min: 0, max: amount };
  }

  if (/أكتر|أكثر|اكتر|اكثر|فوق|more|above|over/i.test(text)) {
    const amount = parseEgpAmount(text);
    if (amount !== null) return { min: amount, max: Math.min(amount * 5, 50_000_000) };
  }

  const range = text.match(
    /(\d+(?:\.\d+)?)\s*(?:مليون|م|m|million|الف|ألف|k)?\s*(?:ل|الى|إلى|حتى|-|to|–)\s*(\d+(?:\.\d+)?)/i,
  );
  if (range?.[1] && range[2]) return { min: scale(range[1]), max: scale(range[2]) };

  const amount = parseEgpAmount(text);
  if (amount === null) return null;
  return { min: Math.round(amount * 0.8), max: Math.round(amount * 1.2) };
}

export interface ParseResult {
  ok: boolean;
  value?: string;
  source?: 'option_id' | 'index' | 'value' | 'label' | 'parser' | 'free_text';
}

function parseIndex(text: string, optionCount: number): number | null {
  const match = text.match(/^\s*([1-9])\s*[).\-]?\s*$/);
  if (!match?.[1]) return null;
  const index = Number.parseInt(match[1], 10) - 1;
  return index >= 0 && index < optionCount ? index : null;
}

function parseWithHint(text: string, hint: ParserHint): string | null {
  if (hint === 'egp_amount') {
    const amount = parseEgpAmount(text);
    return amount === null ? null : String(amount);
  }
  if (hint === 'egp_range') {
    const range = parseEgpRange(text);
    return range ? `${range.min}-${range.max}` : null;
  }
  return null;
}

export function parseQuestionAnswer(
  question: CompiledQuestion,
  input: { text?: string; optionId?: string },
  language: Language,
): ParseResult {
  const raw = String(input.optionId || input.text || '');
  const normalized = normalizeDigits(raw);
  const lower = normalized.toLocaleLowerCase();

  const byId = question.options.find(
    (option) => option.id === raw || option.id === normalized,
  );
  if (byId) return { ok: true, value: byId.value, source: 'option_id' };

  const index = parseIndex(normalized, question.options.length);
  if (index !== null) {
    const option = question.options[index];
    if (option) return { ok: true, value: option.value, source: 'index' };
  }

  const byValue = question.options.find(
    (option) => option.value.toLocaleLowerCase() === lower,
  );
  if (byValue) return { ok: true, value: byValue.value, source: 'value' };

  const byLabel = question.options.find((option) => {
    const labels = [option.labels[language], option.labels.Arabic, option.labels.English]
      .filter(Boolean)
      .map((label) => normalizeDigits(label).toLocaleLowerCase());
    return labels.some(
      (label) =>
        label === lower ||
        (label.length > 2 && lower.includes(label)) ||
        (lower.length > 2 && label.includes(lower)),
    );
  });
  if (byLabel) return { ok: true, value: byLabel.value, source: 'label' };

  const parsed = parseWithHint(normalized, question.parserHint);
  if (parsed !== null) return { ok: true, value: parsed, source: 'parser' };

  if (question.type === 'Free Text' && normalized) {
    return { ok: true, value: normalized.slice(0, 200), source: 'free_text' };
  }

  return { ok: false };
}
