import Svg, { Path } from 'react-native-svg';
import { brand, color } from './tokens';

/**
 * The Kadensio cadence mark.
 *
 * Every value below — the path data, the stroke width, the caps and joins, the
 * opacity ramp — is taken from `assets/kadensio-mark.svg` and its reversed
 * twin. Nothing here is reconstructed: `<Path d="…">` renders the file's own
 * geometry, so the mark cannot drift from the artwork by arithmetic.
 *
 * The ramp is the idea, not decoration. Two chevrons wait, faint; the third
 * arrives solid green. It is never reordered, never equalised, and the terminal
 * chevron is #00B368 on every ground.
 */

/** From the source file: `viewBox="0 0 64 64"`. */
const VIEW_BOX = '0 0 64 64';
const STROKE_WIDTH = 8;

const CHEVRONS = [
  'M12 20 L24 32 L12 44',
  'M26 20 L38 32 L26 44',
  'M40 20 L52 32 L40 44',
] as const;

/** Light ground, then dark. Both pairs are the values the two files carry. */
const RAMP = {
  light: [0.28, 0.6],
  dark: [0.25, 0.55],
} as const;

/**
 * @param size Rendered height in points. The brand's floor for the
 *   three-chevron mark is 24 — below that the faded chevrons merge and the
 *   two-chevron small icon should be used instead.
 */
export function Mark({ size = 24, reversed = false }: { size?: number; reversed?: boolean }) {
  const base = reversed ? color.inkInverse : color.ink;
  const [faint, mid] = reversed ? RAMP.dark : RAMP.light;

  return (
    <Svg width={size} height={size} viewBox={VIEW_BOX} accessibilityRole="image" accessibilityLabel="Kadensio">
      <Path
        d={CHEVRONS[0]}
        fill="none"
        stroke={base}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={faint}
      />
      <Path
        d={CHEVRONS[1]}
        fill="none"
        stroke={base}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={mid}
      />
      <Path
        d={CHEVRONS[2]}
        fill="none"
        stroke={brand.green}
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
