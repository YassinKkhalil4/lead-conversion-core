import { Pressable, View } from 'react-native';
import { Button } from './Button';
import { Text } from './Text';
import { color, hitSlop, layout, radius, space } from './tokens';

/**
 * Left-aligned, no illustration, no encouragement. States what will appear here
 * and why it is not here yet.
 *
 * Where the reader can do something about it, the control belongs here. Naming
 * an action the reader has to go elsewhere to take — "add salespeople under
 * Salespeople" — is a worse empty state than one that names none.
 */
export function EmptyState({
  title,
  detail,
  actionLabel,
  onAction,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: layout.rowX, paddingVertical: layout.emptyY, gap: space.sm, maxWidth: 560 }}>
      <Text size="body" weight="semibold">
        {title}
      </Text>
      <Text size="small" tone="muted">
        {detail}
      </Text>
      {actionLabel && onAction ? (
        <View style={{ flexDirection: 'row', paddingTop: space.md }}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
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
        backgroundColor: color.alertWash,
        borderLeftWidth: 3,
        borderLeftColor: color.alert,
        borderRadius: radius.sm,
      }}
    >
      <Text size="small" weight="semibold" style={{ color: color.alert }}>
        {title}
      </Text>
      <Text size="small" tone="muted">
        {detail}
      </Text>
      {onRetry ? (
        <Pressable onPress={onRetry} hitSlop={hitSlop} style={{ paddingTop: space.xs }}>
          <Text size="small" weight="semibold" style={{ textDecorationLine: 'underline' }}>
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
        backgroundColor: isWarning ? color.alertWash : color.surfaceSunken,
        borderBottomWidth: 1,
        borderBottomColor: isWarning ? color.alert : color.hairline,
      }}
    >
      <Text size="small" style={{ color: isWarning ? color.alert : color.inkMuted }}>
        {text}
      </Text>
    </View>
  );
}
