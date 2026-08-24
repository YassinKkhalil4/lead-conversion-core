import { Platform } from 'react-native';

/**
 * The landing page's design system, in React Native.
 *
 * Every value here is lifted from `landing/styles.css` so the dashboard and the
 * marketing site are visibly the same product. Names follow the CSS custom
 * properties they come from — `ink`, `ink2`, `ink3`, `paper`, `tint`, `line`,
 * `line2`, `accent`, `accentDk`, `accentLt`, `accentBg`, `warn` — so the two
 * can be compared line by line.
 *
 * The landing page carries its own dashboard mockup (`.panel-queue`, `.queue`,
 * `.score-hi`, `.mini-btn`, `.prep`, `.score-big`), and its shapes are the
 * reference for these screens: panel, panel-head, queue table, score figure.
 *
 * Its *use of accent* is not. A marketing mockup can spend green on a row, a
 * button and a score at once because none of them mean anything. On a working
 * queue they compete with the two signals that do — see `accent` below.
 */
export const color = {
  ink: '#0C1F1A',
  /** Pressed state of an ink fill. */
  inkStrong: '#061310',
  ink2: '#474f52',
  /**
   * Darkened from the landing page's `--ink-3` (#6d7679).
   *
   * That value reaches 4.65:1 on white and fails AA on every other ground this
   * app has — 4.32 on tint, which is the page ground, 4.15 on the highlighted
   * row, 4.09 on a pressed row. Lightening the grounds could not fix it,
   * because the failure is against the page itself. This measures 5.71 / 5.31 /
   * 5.09 / 5.02 across paper, tint, accentBg and line2.
   */
  ink3: '#5f686b',

  paper: '#ffffff',
  tint: '#f5f7f6',
  /** Panel edges and separators. Decorative, so 1.4.11's 3:1 does not apply. */
  line: '#e3e7e5',
  /** Row rules, from `--line-2`. Also decorative. */
  line2: '#eef1ef',
  /**
   * Control boundaries: inputs, outline buttons, segmented controls.
   *
   * These are covered by WCAG 1.4.11 and `line` is 1.25:1, so they cannot use
   * it. Clears 3:1 on every ground here — 3.96 paper, 3.68 tint, 3.53 accentBg,
   * 3.48 line2. The landing page has no equivalent because it has no forms.
   */
  lineStrong: '#75837E',

  /**
   * Accent is not a general-purpose colour here.
   *
   * Lead temperature and lateness have to stay the most visually distinct
   * things on a screen. Accent spent on navigation, buttons, stat figures and
   * chart fills is accent the eye stops reading as meaning, so it survives in
   * three places only: the logo, the focus ring, and the hot temperature chip
   * — which is the signal itself. Everything else is ink.
   */
  accent: '#007A47',
  accentDk: '#00603A',
  /** The logo's diagonal. 2.75:1 on paper — logotype only, never text. */
  accentLt: '#00B368',
  /** Ground of the hot chip, and nothing else. */
  accentBg: '#E8F5EE',

  /** Lateness. The only other colour that carries meaning. */
  warn: '#9a4b1e',

  // Dark section palette, for surfaces that invert.
  darkBg: '#0C1F1A',
  darkInk: '#f3f5f4',
  darkInk2: '#a3adaa',
  darkLine: 'rgba(255,255,255,0.13)',
  darkLine2: 'rgba(255,255,255,0.07)',

  /** Modal backdrop, from the brand ink. */
  scrim: 'rgba(12,31,26,0.45)',

  onAccent: '#ffffff',
  /** Label on an ink fill. 17.12:1. */
  onInk: '#ffffff',
} as const;

/** `--r: 4px`, plus the two other radii the landing page uses. */
export const radius = {
  none: 0,
  sm: 3,
  md: 4,
  lg: 10,
  pill: 999,
} as const;

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const fontFamily = Platform.select({ web: SANS, default: undefined });
export const fontFamilyMono = Platform.select({ web: MONO, ios: 'Menlo', default: 'monospace' });

/**
 * The landing page's rem sizes at a 16px root.
 *
 * micro .6875 · small .8125 · label .875 · body .9375 · large 1.0625 ·
 * title 1.1875 · headline 1.625 · display 2.75 (`.score-big`).
 */
export const fontSize = {
  micro: 11,
  small: 13,
  label: 14,
  body: 15,
  large: 17,
  title: 19,
  headline: 26,
  display: 44,
} as const;

export const lineHeight = {
  micro: 14,
  small: 18,
  label: 20,
  body: 22,
  large: 24,
  title: 25,
  headline: 31,
  display: 46,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Tracking. The landing page opens mono labels up (.08–.09em) and closes
 * headings down; both are reproduced here in points against the fixed scale.
 */
export const tracking = {
  /** Mono uppercase labels: table headers, panel heads, eyebrows. */
  label: 1,
} as const;

export const displayTracking: Partial<Record<keyof typeof fontSize, number>> = {
  title: -0.3,
  headline: -0.7,
  display: -1.3,
};

/**
 * Spacing, from the landing page's padding values at a 16px root.
 * .3rem 5 · .45rem 7 · .6rem 10 · .7rem 11 · .85rem 14 · 1.1rem 18 · 1.25rem 20
 */
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

/**
 * Composition, matching the landing page's own components.
 *
 * `.panel-head` is `.85rem 1.1rem`; `.queue th/td` is `.8rem 1.1rem`;
 * `.prep > div` is `.6rem 1.1rem`; `.card` is `clamp(1.5rem, 3vw, 2rem)`.
 */
export const layout = {
  pageDesk: 32,
  pagePhone: 18,
  sectionGap: 28,
  /** `.panel` inner padding. */
  panel: 18,
  /** `.queue` cell padding: horizontal, then vertical. */
  rowX: 18,
  rowY: 13,
  /** `.panel-head` vertical padding. */
  headerY: 14,
  inline: 10,
  stack: 4,
  emptyY: 28,
  tableRow: 48,
  edgeMarker: 3,
  queueHeader: 104,
} as const;

/**
 * Table column widths, named for what a column holds.
 * Sized against the landing table's 15px cells and mono figures.
 */
export const colWidth = {
  num: 92,
  short: 120,
  medium: 180,
  name: 200,
  long: 220,
  wide: 260,
} as const;

export const rowHeight = {
  urgent: 76,
  standard: 62,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
