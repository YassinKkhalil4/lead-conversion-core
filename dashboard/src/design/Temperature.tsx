import { View } from 'react-native';
import { Text } from './Text';
import { color, radius, space, tracking } from './tokens';

export type TemperatureValue = 'hot' | 'warm' | 'cold' | string;

interface Spec {
  value: string;
  label: string;
  bars: number;
  fg: string;
  bg: string;
}

/**
 * Shaped like the landing page's `.chip`, coloured by its own model: the site
 * marks a strong score with `--accent` (`.score-hi`) and leaves the rest in
 * ink. Colour still never travels alone here — each value keeps a distinct
 * filled-bar count and a text label, so the chip reads in greyscale.
 */
function specFor(value: TemperatureValue): Spec {
  switch (value) {
    case 'hot':
      return { value: 'hot', label: 'HOT', bars: 3, fg: color.accent, bg: color.accentBg };
    case 'warm':
      return { value: 'warm', label: 'WARM', bars: 2, fg: color.ink2, bg: color.tint };
    case 'cold':
      return { value: 'cold', label: 'COLD', bars: 1, fg: color.ink3, bg: color.tint };
    default:
      return { value: 'unscored', label: 'UNSCORED', bars: 0, fg: color.ink3, bg: color.tint };
  }
}

export function Temperature({ value, compact = false }: { value: TemperatureValue; compact?: boolean }) {
  const spec = specFor(value);
  return (
    <View
      accessibilityLabel={`Temperature ${spec.label.toLowerCase()}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: spec.bg,
        borderWidth: 1,
        borderColor: spec.value === 'hot' ? color.accent : color.line,
        borderRadius: radius.md,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={{
              width: 3,
              height: 6 + index * 3,
              borderRadius: 1,
              backgroundColor: index < spec.bars ? spec.fg : 'transparent',
              borderWidth: index < spec.bars ? 0 : 1,
              borderColor: spec.fg,
              opacity: index < spec.bars ? 1 : 0.35,
            }}
          />
        ))}
      </View>
      {compact ? null : (
        <Text size="micro" weight="semibold" numeric style={{ color: spec.fg, letterSpacing: tracking.label }}>
          {spec.label}
        </Text>
      )}
    </View>
  );
}
