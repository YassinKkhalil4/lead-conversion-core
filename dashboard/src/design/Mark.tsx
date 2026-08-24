import Svg, { Path, Rect, Text as SvgText } from 'react-native-svg';
import { color } from './tokens';

/**
 * The logo, matching what the landing page ships.
 *
 * Geometry is the `d`, stroke width and cap from
 * `landing/assets/kadensio-mark.svg` and `kadensio-lockup.svg`, so the header
 * of the app and the header of the site draw the same artwork.
 */

const STROKE_WIDTH = 9;

/** From `kadensio-mark.svg`, viewBox 0 0 64 64. */
const GLYPH = [
  { d: 'M17 16 V48', accent: false },
  { d: 'M29 30 L47 14', accent: false },
  { d: 'M29 34 L47 50', accent: true },
] as const;

function Glyph({ reversed }: { reversed: boolean }) {
  const base = reversed ? color.tint : color.ink;
  return (
    <>
      {GLYPH.map((stroke) => (
        <Path
          key={stroke.d}
          d={stroke.d}
          fill="none"
          stroke={stroke.accent ? color.accentLt : base}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
        />
      ))}
    </>
  );
}

/** Mark alone. Use where the name is already present. */
export function Mark({ size = 26, reversed = false }: { size?: number; reversed?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityRole="image" accessibilityLabel="Kadensio">
      <Glyph reversed={reversed} />
    </Svg>
  );
}

/**
 * Mark plus wordmark, at the lockup's own 256 × 64 proportions. Scale by
 * height and let the width follow, exactly as the landing header does.
 */
export function Lockup({ height = 26, reversed = false }: { height?: number; reversed?: boolean }) {
  return (
    <Svg
      width={height * (256 / 64)}
      height={height}
      viewBox="0 0 256 64"
      accessibilityRole="image"
      accessibilityLabel="Kadensio"
    >
      <Glyph reversed={reversed} />
      {/* The source sets `dominant-baseline: central` at y=32; that attribute
          is unreliable across react-native-svg targets, so the baseline is
          resolved here instead — same result on every platform. */}
      <SvgText
        x={74}
        y={43}
        fill={reversed ? color.tint : color.ink}
        fontSize={33}
        fontWeight="600"
        letterSpacing={-0.8}
        fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
      >
        kadensio
      </SvgText>
    </Svg>
  );
}

/** Rounded tile, from `kadensio-icon.svg`. */
export function Icon({ size = 32 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityRole="image" accessibilityLabel="Kadensio">
      <Rect width={64} height={64} rx={14} fill={color.ink} />
      {GLYPH.map((stroke) => (
        <Path
          key={stroke.d}
          d={stroke.d}
          fill="none"
          stroke={stroke.accent ? color.accentLt : color.paper}
          strokeWidth={7}
          strokeLinecap="round"
          transform="translate(32 32) scale(0.78) translate(-32 -32)"
        />
      ))}
    </Svg>
  );
}
