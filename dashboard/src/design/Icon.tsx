import { Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color as palette } from './tokens';

/**
 * The handful of glyphs the dashboard needs, from Phosphor Icons (bold
 * weight, MIT licence, phosphoricons.com), drawn on its 256-unit grid. One
 * library and one weight, so strokes match wherever an icon appears.
 */
const PATHS = {
  check: 'M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z',
  x: 'M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z',
  plus: 'M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z',
  minus: 'M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z',
  arrowLeft: 'M228,128a12,12,0,0,1-12,12H69l51.52,51.51a12,12,0,0,1-17,17l-72-72a12,12,0,0,1,0-17l72-72a12,12,0,0,1,17,17L69,116H216A12,12,0,0,1,228,128Z',
  arrowUp: 'M208.49,120.49a12,12,0,0,1-17,0L140,69V216a12,12,0,0,1-24,0V69L64.49,120.49a12,12,0,0,1-17-17l72-72a12,12,0,0,1,17,0l72,72A12,12,0,0,1,208.49,120.49Z',
  arrowDown: 'M208.49,152.49l-72,72a12,12,0,0,1-17,0l-72-72a12,12,0,0,1,17-17L116,187V40a12,12,0,0,1,24,0V187l51.51-51.52a12,12,0,0,1,17,17Z',
} as const;

export type IconName = keyof typeof PATHS;

// Decorative: the control around the icon carries the label. The props that
// say so differ by platform, and react-native-svg passes them straight to the
// DOM on web, so web gets the DOM attribute.
const HIDDEN = Platform.OS === 'web'
  ? ({ 'aria-hidden': true } as const)
  : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const);

export function Icon({ name, size = 16, color = palette.ink }: { name: IconName; size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" {...HIDDEN}>
      <Path d={PATHS[name]} fill={color} />
    </Svg>
  );
}
