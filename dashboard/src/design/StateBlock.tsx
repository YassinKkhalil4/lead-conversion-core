import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { color, hitSlop, radius, space } from './tokens';

/**
 * Left-aligned, no illustration, no encouragement. States what will appear here
 * and why it is not here yet.
 */
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={{ paddingHorizontal: space.xl, paddingVertical: space.xxxl, gap: space.sm }}>
      <Text size="body" weight="semibold">
        {title}
      </Text>
      <Text size="small" tone="muted">
        {detail}
      </Text>
    </View>
  );
}

/**
 * Names what failed and what the reader can do about it. Never a generic
 * apology.
 */
export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = 'Try again',
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <View
      style={{
        marginHorizontal: space.xl,
        marginVertical: space.xl,
        padding: space.lg,
        gap: space.sm,
        backgroundColor: color.dangerWash,
        borderLeftWidth: 3,
        borderLeftColor: color.danger,
        borderRadius: radius.sm,
      }}
    >
      <Text size="small" weight="semibold" style={{ color: color.danger }}>
        {title}
      </Text>
      <Text size="small" tone="muted">
        {detail}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={hitSlop} style={{ paddingTop: space.xs }}>
          <Text size="small" weight="semibold" tone="accent">
            {retryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A one-line inline notice used inside a screen that already has content. */
export function InlineNotice({
  text,
  variant = 'neutral',
}: {
  text: string;
  variant?: 'neutral' | 'warning';
}) {
  const isWarning = variant === 'warning';
  return (
    <View
      style={{
        paddingHorizontal: space.xl,
        paddingVertical: space.md,
        backgroundColor: isWarning ? color.dangerWash : color.surfaceSunken,
        borderBottomWidth: 1,
        borderBottomColor: isWarning ? color.danger : color.hairline,
      }}
    >
      <Text size="small" style={{ color: isWarning ? color.danger : color.inkMuted }}>
        {text}
      </Text>
    </View>
  );
}
