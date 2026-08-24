import { View } from 'react-native';
import { brand, color } from './tokens';

/**
 * The Kadensio cadence mark, drawn in plain Views.
 *
 * There is no SVG primitive in React Native and `react-native-svg` is not a
 * dependency, so the three chevrons are built from rotated bars. The geometry
 * is transcribed from `assets/kadensio-mark.svg` rather than eyeballed: each
 * chevron is two arms from (12,20) to (24,32) to (12,44) in a 64-unit box, at
 * stroke width 8 with round caps, and the second and third chevrons are the
 * same shape translated by 14 and 28 units. A bar of height 8 with a 4-point
 * radius reproduces a round cap exactly, and two of them overlapping at the
 * apex reproduce the round join.
 *
 * The opacity ramp is the idea, not decoration: 28% → 60% → solid green on
 * light, 25% → 55% → solid on dark. It is never reordered, never equalised,
 * and the terminal chevron is #00B368 on every ground.
 *
 * This renders the mark alone. The app does not rebuild the lockup — where the
 * name appears beside it, that name is the app's own type, which is the
 * "mark alone, where the name is already present" case the brand sanctions.
 */

/** Geometry of one chevron in the source file's 64-unit box. */
const APEX_X = 24;
const TOP_Y = 20;
const MID_Y = 32;
const BOT_Y = 44;
const START_X = 12;
const STROKE = 8;
const CHEVRON_STEP = 14;

/**
 * The source viewBox. All three chevrons fit inside it: the last one starts at
 * x 40 and its apex reaches 52, which with the 4-unit cap is 56.
 */
const BOX = 64;

const ARM_LENGTH = Math.hypot(APEX_X - START_X, MID_Y - TOP_Y);
const BAR_LENGTH = ARM_LENGTH + STROKE;

function Chevron({ offset, stroke, opacity, unit }: { offset: number; stroke: string; opacity: number; unit: number }) {
  const arms = [
    { midX: (START_X + APEX_X) / 2 + offset, midY: (TOP_Y + MID_Y) / 2, rotate: '45deg' },
    { midX: (START_X + APEX_X) / 2 + offset, midY: (MID_Y + BOT_Y) / 2, rotate: '-45deg' },
  ];

  // The opacity belongs to the pair, not to each arm. Fading them separately
  // makes the overlap at the apex composite twice — 28% becomes 48% — and the
  // ramp the mark is built on stops being the ramp the brand specifies.
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity }}>
      {arms.map((arm) => (
        <View
          key={arm.rotate}
          style={{
            position: 'absolute',
            left: (arm.midX - BAR_LENGTH / 2) * unit,
            top: (arm.midY - STROKE / 2) * unit,
            width: BAR_LENGTH * unit,
            height: STROKE * unit,
            borderRadius: (STROKE / 2) * unit,
            backgroundColor: stroke,
            transform: [{ rotate: arm.rotate }],
          }}
        />
      ))}
    </View>
  );
}

/**
 * @param size Height of the mark's box in points. The brand's minimum for the
 *   three-chevron mark is 24; below that the faded chevrons merge into a smudge
 *   and the small icon should be used instead.
 */
export function Mark({ size = 24, reversed = false }: { size?: number; reversed?: boolean }) {
  const unit = size / BOX;
  const base = reversed ? color.inkInverse : color.ink;
  const [faint, mid] = reversed ? ([0.25, 0.55] as const) : ([0.28, 0.6] as const);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="Kadensio"
      style={{ width: size, height: size }}
    >
      <Chevron offset={0} stroke={base} opacity={faint} unit={unit} />
      <Chevron offset={CHEVRON_STEP} stroke={base} opacity={mid} unit={unit} />
      <Chevron offset={CHEVRON_STEP * 2} stroke={brand.green} opacity={1} unit={unit} />
    </View>
  );
}
