import { Platform } from 'react-native';

/**
 * Colour carries exactly two meanings: lead temperature, and how late you are.
 * Nothing else is coloured — no accent, no coloured headers, no gradients.
 *
 * The two families are kept apart by chroma and by position. Temperature is a
 * low-chroma glyph on the right of a row that always carries bars and a label,
 * so its colour is supplementary. Urgency is high-chroma and appears only on
 * the left edge marker and the clock.
 */
export const color = {
  paper: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceSunken: '#F2F0EA',
  surfacePressed: '#EBE8E0',

  ink: '#141310',
  inkStrong: '#000000',
  inkMuted: '#66625B',
  inkFaint: '#928D85',
  inkInverse: '#FBFAF7',

  hairline: '#E5E2DA',
  hairlineStrong: '#D0CCC2',

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
  unscored: '#8A867F',
  unscoredWash: '#EFEDE7',
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

export const fontFamily = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
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
 * Density is deliberately uneven. A row that needs action is taller and louder
 * than one that is only reference material, because uniform padding is what
 * makes every lead look equally important.
 */
export const rowHeight = {
  urgent: 96,
  standard: 72,
} as const;

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 } as const;
