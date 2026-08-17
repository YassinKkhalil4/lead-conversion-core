import { View } from 'react-native';
import { Text } from './Text';
import { color, radius, space } from './tokens';

export type TemperatureValue = 'hot' | 'warm' | 'cold' | string;

interface Spec {
  label: string;
  bars: number;
  fg: string;
  bg: string;
}

/**
 * Temperature is the only place colour carries meaning, so it never carries it
 * alone: each value also has a distinct filled-bar count and a text label.
 * Readable with any colour vision, and in greyscale.
 */
function specFor(value: TemperatureValue): Spec {
  switch (value) {
    case 'hot':
      return { label: 'HOT', bars: 3, fg: color.hot, bg: color.hotWash };
    case 'warm':
      return { label: 'WARM', bars: 2, fg: color.warm, bg: color.warmWash };
    case 'cold':
      return { label: 'COLD', bars: 1, fg: color.cold, bg: color.coldWash };
    default:
      return { label: 'UNSCORED', bars: 0, fg: color.unscored, bg: color.unscoredWash };
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
        borderRadius: radius.sm,
        paddingHorizontal: space.sm,
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
        <Text size="micro" weight="bold" style={{ color: spec.fg, letterSpacing: 0.4 }}>
          {spec.label}
        </Text>
      )}
    </View>
  );
}
