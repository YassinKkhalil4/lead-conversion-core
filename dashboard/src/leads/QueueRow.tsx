import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Temperature } from '@/design/Temperature';
import { Text } from '@/design/Text';
import { color, layout, rowHeight, tracking } from '@/design/tokens';
import { QueueState, type RankedLead, rowSummary } from '@/leads/queue';
import { queueClock } from '@/time/format';

/**
 * Urgent rows are taller, larger and louder than the rest. Uniform padding is
 * what made the old inbox read as a list of equivalent things, which is the
 * opposite of what this screen is for.
 *
 * The row carries two lines and, on an urgent row, two things worth looking at:
 * who it is, and how late you are. The clock and the state it describes are one
 * block on the right — they used to sit at opposite corners, which made the
 * reader assemble one message out of two glances.
 *
 * The lead score is deliberately absent. `rankLeads` orders by urgency state,
 * not by score, so a number printed next to that order would not explain it.
 * Temperature carries the score already, bucketed, with bars and a label.
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

  const edge = pastSla ? color.warn : withinSla ? color.warn : 'transparent';
  const clockColor = pastSla ? color.warn : withinSla ? color.warn : color.ink2;
  const summary = rowSummary(lead);
  const clock = queueClock(entry.clockFrom);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        lead.contact.name || lead.contact.phoneE164,
        isUrgent ? `unacknowledged for ${clock}` : `last activity ${clock}`,
        pastSla ? 'past SLA' : '',
        state === QueueState.AwaitingReply ? 'no reply since their message' : '',
        lead.temperature || 'unscored',
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={() => onPress(lead.leadId)}
      style={({ pressed }) => ({
        minHeight: isUrgent ? rowHeight.urgent : rowHeight.standard,
        flexDirection: 'row',
        backgroundColor: pressed ? color.line2 : color.paper,
        borderBottomWidth: 1,
        borderBottomColor: color.line2,
      })}
    >
      <View style={{ width: isUrgent ? layout.edgeMarker : 0, backgroundColor: edge }} />

      <View
        style={{
          flex: 1,
          paddingLeft: isUrgent ? layout.rowX - layout.edgeMarker : layout.rowX,
          paddingRight: layout.rowX,
          justifyContent: 'center',
          gap: layout.stack + 2,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: layout.inline }}>
          <Text
            size={isUrgent ? 'title' : 'large'}
            weight={isUrgent ? 'bold' : 'semibold'}
            numberOfLines={1}
            autoDirection
            style={{ flex: 1 }}
          >
            {lead.contact.name || lead.contact.phoneE164}
          </Text>

          {/* Clock and state, one block. On an urgent row the state is what the
              clock means, so reading one without the other is half a message. */}
          <View style={{ alignItems: 'flex-end' }}>
            <Text
              size={isUrgent ? 'large' : 'small'}
              weight={isUrgent ? 'bold' : 'medium'}
              numeric
              style={{ color: clockColor }}
            >
              {clock}
            </Text>
            {isUrgent ? (
              <Text size="micro" weight="bold" style={{ color: clockColor, letterSpacing: tracking.label }}>
                {pastSla ? 'PAST SLA' : 'NEEDS ACK'}
              </Text>
            ) : state === QueueState.AwaitingReply ? (
              <Text size="micro" weight="medium" tone="faint" style={{ letterSpacing: tracking.label }}>
                NO REPLY
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: layout.inline }}>
          {summary ? (
            <Text size="small" tone="muted" numberOfLines={1} autoDirection style={{ flex: 1 }}>
              {summary}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Temperature value={lead.temperature} />
        </View>
      </View>
    </Pressable>
  );
});
