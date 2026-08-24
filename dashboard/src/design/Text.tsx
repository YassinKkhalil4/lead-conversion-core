import { Text as RNText, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { color, displayTracking, fontFamily, fontFamilyMono, fontSize, fontWeight, lineHeight } from './tokens';
import { isArabic } from '@/i18n/direction';

type Size = keyof typeof fontSize;
type Weight = keyof typeof fontWeight;
type Tone = 'default' | 'muted' | 'faint' | 'inverse' | 'alert' | 'warning';

/**
 * The landing page's three ink steps, plus lateness.
 *
 * There is deliberately no accent tone. The handful of places that do carry
 * accent — the active nav item, the stat figures — set it by style at the call
 * site, because they are countable. A tone would make it available everywhere
 * and that is how it would creep back across the screens.
 */
const tone: Record<Tone, string> = {
  default: color.ink,
  muted: color.ink2,
  faint: color.ink3,
  inverse: color.paper,
  alert: color.warn,
  warning: color.warn,
};

export interface AppTextProps extends TextProps {
  size?: Size;
  weight?: Weight;
  tone?: Tone;
  /**
   * Marks the content as measured: a score, a phone number, a clock, a count,
   * an identifier. Sets the mono face and tabular figures, so columns of
   * numbers line up and a digit never changes width as a value ticks.
   */
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

  // Brand tracking is a display device and is applied from `title` upward only.
  const track = displayTracking[size];

  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: numeric ? fontFamilyMono : fontFamily,
          fontSize: fontSize[size],
          lineHeight: lineHeight[size],
          fontWeight: fontWeight[weight],
          color: tone[toneName],
        },
        track === undefined ? null : { letterSpacing: track },
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        directionStyle,
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
