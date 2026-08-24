import { Platform } from 'react-native';

/**
 * Colour carries exactly two meanings: lead temperature, and how late you are.
 * Nothing else is coloured — no accent, no coloured headers, no gradients.
 *
 * The two families are kept apart by chroma and by position. Temperature is a
 * low-chroma glyph on the right of a row that always carries bars and a label,
 * so its colour is supplementary. Urgency is high-chroma and appears only on
 * the left edge marker and the clock.
 *
 * The Kadensio brand green is deliberately absent from this list. It appears in
 * exactly two places in the app — the logo mark, and the focus ring — and both
 * read it from `brand` below rather than from the palette a screen composes
 * with. Promoting it to a general accent would give colour a third meaning and
 * cost the two above their scarcity.
 */
export const color = {
  // Grounds. Green-biased neutrals, matching the brand ink's own bias, so a
  // surface never reads as cold grey next to the mark.
  paper: '#F9FBFA',
  surface: '#FFFFFF',
  surfaceSunken: '#EFF3F1',
  surfacePressed: '#E7ECE9',

  ink: '#0C1F1A',
  inkStrong: '#061310',
  inkMuted: '#46534E',
  inkFaint: '#5F6D68',
  /**
   * Placeholder text only, and nothing else.
   *
   * This is the brand's `--ink-3`, which reaches 4.43:1 on white — under AA for
   * normal text. That is acceptable for a placeholder, which restates a label
   * the field already carries, and unacceptable for anything a reader has to
   * act on. `inkFaint` above is the darker step everything else uses.
   */
  inkPlaceholder: '#6D7B76',
  inkInverse: '#FFFFFF',

  hairline: '#E3E7E5',
  hairlineStrong: '#C9D3CE',

  /** Modal and drawer backdrop, derived from the brand ink. */
  scrim: 'rgba(12, 31, 26, 0.4)',

  // Urgency. Saturated, used only for the left edge marker and the clock.
  alert: '#B3261E',
  alertWash: '#FBEBE9',
  warning: '#9A6206',
  warningWash: '#FAF2E2',

  // Temperature. Low chroma, always paired with bars and a label.
  hot: '#8C3A2A',
  hotWash: '#F6EBE8',
  warm: '#6F5A24',
  warmWash: '#F4F1E4',
  cold: '#41566A',
  coldWash: '#EBEFF3',
  unscored: '#5F6D68',
  unscoredWash: '#EDF0EE',
} as const;

/**
 * Brand values, kept apart from `color` on purpose.
 *
 * Nothing in a screen composes with these. `green` is the mark's terminal
 * chevron and is fixed at #00B368 on every ground — it reaches only 2.63:1 on
 * paper and must never carry text. `focus` is the darkened green the brand
 * specifies for light grounds, 5.22:1 on paper, used for the focus ring.
 */
export const brand = {
  green: '#00B368',
  focus: '#007A47',
} as const;

export const space = {
  hair: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 20,
  xxxl: 28,
  huge: 40,
} as const;

export const radius = {
  none: 0,
  sm: 3,
  md: 6,
  pill: 999,
} as const;

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

/**
 * The system stack, on purpose: it renders on the first paint, with no webfont
 * to arrive late over a hotel connection.
 *
 * `mono` is the second voice, and the brand reserves it for anything measured —
 * figures, phone numbers, scores, labels, timings. In this app that set is
 * already named: it is every `Text` marked `numeric`.
 */
export const fontFamily = Platform.select({
  web: SANS,
  default: undefined,
});

export const fontFamilyMono = Platform.select({
  web: MONO,
  ios: 'Menlo',
  default: 'monospace',
});

/**
 * `display` exists for one thing only: the count of assignments that need you
 * now. Keeping it the single large number in the app is what makes it read as
 * the answer to the question this app is opened to ask.
 */
export const fontSize = {
  micro: 11,
  small: 13,
  body: 15,
  large: 17,
  title: 20,
  headline: 26,
  display: 56,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeight = {
  micro: 14,
  small: 17,
  body: 20,
  large: 22,
  title: 25,
  headline: 30,
  display: 58,
} as const;

/**
 * Letter spacing, in points rather than em, because the type scale is fixed.
 *
 * The brand's negative tracking is a display device: −0.026em at 26px is what
 * stops a heading looking loose, and the same figure at 15px closes body text
 * up until it is harder to read. So it is applied from `title` (20px) upward
 * and nowhere below — see `Text`.
 */
export const tracking = {
  /**
   * Uppercase labels, and the small sentence-case text that divides a list.
   *
   * The screens previously alternated between 0.4 and 0.5 for the same job with
   * nothing to separate the two, so this is one value.
   */
  label: 0.5,
} as const;

/** Brand display tracking, by size. Sizes absent from this map get none. */
export const displayTracking: Partial<Record<keyof typeof fontSize, number>> = {
  title: -0.5,
  headline: -0.7,
  display: -1.8,
};

/**
 * Density is deliberately uneven. A row that needs action is taller and louder
 * than one that is only reference material, because uniform padding is what
 * makes every lead look equally important.
 */
export const rowHeight = {
  urgent: 96,
  standard: 72,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
