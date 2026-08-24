import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Temperature } from '@/design/Temperature';
import { Text } from '@/design/Text';
import { color, rowHeight, space, tracking } from '@/design/tokens';
import { QueueState, type RankedLead, rowSummary } from '@/leads/queue';
import { queueClock } from '@/time/format';

/**
 * Urgent rows are taller, larger and louder than the rest. Uniform padding is
 * what made the old inbox read as a list of equivalent things, which is the
 * opposite of what this screen is for.
 */
export const QueueRow = memo(function QueueRow({
  entry,
  onPress,
}: {
  entry: RankedLead;
  onPress: (leadId: string) => void;
}) {
  const { lead, state } = entry;
  const pastSla = state === QueueState.UnacknowledgedPastSla;
  const withinSla = state === QueueState.UnacknowledgedWithinSla;
  const isUrgent = pastSla || withinSla;

  const edge = pastSla ? color.alert : withinSla ? color.warning : 'transparent';
  const clockColor = pastSla ? color.alert : withinSla ? color.warning : color.inkMuted;
  const summary = rowSummary(lead);
  const clock = queueClock(entry.clockFrom);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        lead.contact.name || lead.contact.phoneE164,
        isUrgent ? `unacknowledged for ${clock}` : `last activity ${clock}`,
        pastSla ? 'past SLA' : '',
        lead.temperature || 'unscored',
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onPress(lead.leadId)}
      style={({ pressed }) => ({
        minHeight: isUrgent ? rowHeight.urgent : rowHeight.standard,
        flexDirection: 'row',
        backgroundColor: pressed ? color.surfacePressed : color.surface,
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
      })}
    >
      <View style={{ width: isUrgent ? 4 : 0, backgroundColor: edge }} />

      <View
        style={{
          flex: 1,
          paddingLeft: isUrgent ? space.lg : space.xl,
          paddingRight: space.xl,
          paddingVertical: isUrgent ? space.lg : space.md,
          justifyContent: 'center',
          gap: isUrgent ? space.sm : space.xs,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.lg }}>
          <Text
            size={isUrgent ? 'title' : 'large'}
            weight={isUrgent ? 'bold' : 'semibold'}
            numberOfLines={1}
            autoDirection
            style={{ flex: 1 }}
          >
            {lead.contact.name || lead.contact.phoneE164}
          </Text>
          <Text
            size={isUrgent ? 'large' : 'small'}
            weight={isUrgent ? 'bold' : 'medium'}
            numeric
            style={{ color: clockColor }}
          >
            {clock}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
          {summary ? (
            <Text size="small" tone="muted" numberOfLines={1} autoDirection style={{ flex: 1 }}>
              {summary}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Temperature value={lead.temperature} />
        </View>

        {isUrgent ? (
          <Text size="micro" weight="bold" style={{ color: clockColor, letterSpacing: tracking.label }}>
            {pastSla ? 'NEEDS ACK · PAST SLA' : 'NEEDS ACK'}
          </Text>
        ) : state === QueueState.AwaitingReply ? (
          <Text size="micro" weight="medium" tone="faint" style={{ letterSpacing: tracking.label }}>
            NO REPLY SINCE THEIR MESSAGE
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});
