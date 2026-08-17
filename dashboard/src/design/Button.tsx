import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { color, radius, space } from './tokens';

/**
 * There is one dominant action per screen and it is `primary`. It is solid ink
 * rather than a coloured accent, because colour in this app means temperature
 * or lateness and a button is neither. Everything else is a `text` control.
 */
type Variant = 'primary' | 'outline' | 'text';

export function Button({
  label,
  onPress,
  variant = 'outline',
  disabled = false,
  busy = false,
  grow = false,
  size = 'regular',
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  busy?: boolean;
  grow?: boolean;
  size?: 'regular' | 'large';
  style?: ViewStyle;
}) {
  const inactive = disabled || busy;
  const height = size === 'large' ? 54 : 44;

  const surface =
    variant === 'primary'
      ? { bg: color.ink, pressed: color.inkStrong, fg: color.inkInverse, border: color.ink }
      : variant === 'outline'
        ? { bg: color.surface, pressed: color.surfacePressed, fg: color.ink, border: color.hairlineStrong }
        : { bg: 'transparent', pressed: 'transparent', fg: color.inkMuted, border: 'transparent' };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: variant === 'text' ? 36 : height,
          flexGrow: grow ? 1 : 0,
          flexBasis: grow ? 0 : 'auto',
          paddingHorizontal: variant === 'text' ? 0 : space.lg,
          borderRadius: variant === 'text' ? 0 : radius.md,
          borderWidth: variant === 'text' ? 0 : 1,
          borderColor: surface.border,
          backgroundColor: pressed ? surface.pressed : surface.bg,
          alignItems: variant === 'text' ? 'flex-start' : 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.4 : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {busy ? <ActivityIndicator size="small" color={surface.fg} /> : null}
        <Text
          size={size === 'large' ? 'large' : 'small'}
          weight={variant === 'text' ? 'medium' : 'semibold'}
          style={{ color: surface.fg }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
