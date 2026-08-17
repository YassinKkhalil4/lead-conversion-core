import { Platform } from 'react-native';

/**
 * A working tool, not a marketing surface. The base is a warm neutral, one
 * accent carries interactivity, and colour carries meaning in exactly one
 * place: lead temperature. Separation is done with hairlines and weight, never
 * with drop shadows on floating cards.
 */
export const color = {
  paper: '#FBFAF7',
  surface: '#FFFFFF',
  surfaceSunken: '#F2F0EA',
  surfacePressed: '#EDEAE2',

  ink: '#171613',
  inkStrong: '#0C0B09',
  inkMuted: '#6B6760',
  inkFaint: '#96918A',
  inkInverse: '#FBFAF7',

  hairline: '#E4E1D9',
  hairlineStrong: '#D2CEC4',

  accent: '#1B4AA8',
  accentPressed: '#153B87',
  accentWash: '#E9EFFA',

  // Temperature is the one semantic colour. Always paired with a label and a
  // bar-count glyph so it reads correctly without colour vision.
  hot: '#A83214',
  hotWash: '#FBEAE5',
  warm: '#8A5A0B',
  warmWash: '#FAF0DC',
  cold: '#3A5568',
  coldWash: '#EAEFF4',
  unscored: '#8A867F',
  unscoredWash: '#EFEDE7',

  danger: '#A32B1C',
  dangerWash: '#FBEAE7',
  overdue: '#A83214',
  ok: '#2F6B4F',
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
} as const;

export const radius = {
  none: 0,
  sm: 3,
  md: 6,
  pill: 999,
} as const;

/**
 * One workhorse sans at a small number of sizes. `numeric` is the same family
 * with tabular figures so scores, counts, times and phone numbers align in
 * columns.
 */
export const fontFamily = Platform.select({
  web: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  default: undefined,
});

export const fontSize = {
  micro: 11,
  small: 13,
  body: 15,
  large: 17,
  title: 22,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const lineHeight = {
  micro: 14,
  small: 18,
  body: 20,
  large: 22,
  title: 27,
} as const;

/** Row heights tuned for density: more rows visible, not fewer prettier ones. */
export const rowHeight = {
  lead: 76,
  compact: 44,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
