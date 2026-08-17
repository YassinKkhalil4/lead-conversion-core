import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { color, fontFamily, fontSize, fontWeight, lineHeight } from './tokens';
import { isArabic } from '@/i18n/direction';

type Size = keyof typeof fontSize;
type Weight = keyof typeof fontWeight;
type Tone = 'default' | 'muted' | 'faint' | 'inverse' | 'alert' | 'warning';

const tone: Record<Tone, string> = {
  default: color.ink,
  muted: color.inkMuted,
  faint: color.inkFaint,
  inverse: color.inkInverse,
  alert: color.alert,
  warning: color.warning,
};

export interface AppTextProps extends TextProps {
  size?: Size;
  weight?: Weight;
  tone?: Tone;
  /** Tabular figures, so numbers line up in columns. */
  numeric?: boolean;
  /**
   * Right-aligns and sets RTL writing direction when the content is Arabic,
   * regardless of the interface language. Conversation content is frequently
   * Arabic while the interface is English.
   */
  autoDirection?: boolean;
  style?: StyleProp<TextStyle>;
}

export function Text({
  size = 'body',
  weight = 'regular',
  tone: toneName = 'default',
  numeric = false,
  autoDirection = false,
  style,
  children,
  ...rest
}: AppTextProps) {
  const directionStyle: TextStyle =
    autoDirection && typeof children === 'string' && isArabic(children)
      ? { writingDirection: 'rtl', textAlign: 'right' }
      : {};

  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily,
          fontSize: fontSize[size],
          lineHeight: lineHeight[size],
          fontWeight: fontWeight[weight],
          color: tone[toneName],
        },
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        directionStyle,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
