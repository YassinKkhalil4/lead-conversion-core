import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { color, radius, space } from './tokens';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet';

const surfaces: Record<Variant, { bg: string; pressed: string; fg: string; border: string }> = {
  primary: { bg: color.accent, pressed: color.accentPressed, fg: color.inkInverse, border: color.accent },
  secondary: { bg: color.surface, pressed: color.surfacePressed, fg: color.ink, border: color.hairlineStrong },
  danger: { bg: color.surface, pressed: color.dangerWash, fg: color.danger, border: color.danger },
  quiet: { bg: 'transparent', pressed: color.surfacePressed, fg: color.inkMuted, border: 'transparent' },
};

export function Button({
  label,
  onPress,
  variant = 'secondary',
  disabled = false,
  busy = false,
  grow = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  grow?: boolean;
  style?: ViewStyle;
}) {
  const surface = surfaces[variant];
  const inactive = disabled || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: 44,
          flexGrow: grow ? 1 : 0,
          flexBasis: grow ? 0 : 'auto',
          paddingHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: surface.border,
          backgroundColor: pressed ? surface.pressed : surface.bg,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.45 : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {busy ? <ActivityIndicator size="small" color={surface.fg} /> : null}
        <Text size="small" weight="semibold" style={{ color: surface.fg }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
