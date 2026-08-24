import { ActivityIndicator, Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { color, fontSize, radius, space } from './tokens';

/**
 * The landing page's `.btn`.
 *
 * `.btn`         — 15px/500, padding .72rem 1.1rem, radius --r, 1px border
 * `.btn-primary` — background --accent, white text, --accent-dk when pressed
 * `.btn-ghost`   — --line border, ink text, --ink border when pressed
 * `.mini-btn`    — 13px/500, .45rem .7rem, --accent border and text, radius 3
 *
 * `mini` is what the landing page's own queue mockup uses for the row action.
 */
type Variant = 'primary' | 'outline' | 'mini' | 'text';

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

  const skin =
    variant === 'primary'
      ? { bg: color.accent, pressed: color.accentDk, fg: color.onAccent, border: color.accent }
      : variant === 'outline'
        ? { bg: color.paper, pressed: color.tint, fg: color.ink, border: color.line }
        : variant === 'mini'
          ? { bg: color.paper, pressed: color.accentBg, fg: color.accent, border: color.accent }
          : { bg: 'transparent', pressed: 'transparent', fg: color.ink2, border: 'transparent' };

  const mini = variant === 'mini';
  const plain = variant === 'text';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: plain ? 32 : mini ? 30 : size === 'large' ? 48 : 40,
          flexGrow: grow ? 1 : 0,
          flexBasis: grow ? 0 : 'auto',
          paddingHorizontal: plain ? 0 : mini ? 11 : 18,
          borderRadius: plain ? 0 : mini ? radius.sm : radius.md,
          borderWidth: plain ? 0 : 1,
          borderColor: skin.border,
          backgroundColor: pressed ? skin.pressed : skin.bg,
          alignItems: plain ? 'flex-start' : 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.45 : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        {busy ? <ActivityIndicator size="small" color={skin.fg} /> : null}
        <Text
          weight="medium"
          style={{ color: skin.fg, fontSize: mini || plain ? fontSize.small : fontSize.body }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
