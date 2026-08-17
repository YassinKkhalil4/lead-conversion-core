import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { Lead } from '@/api/types';
import { Temperature } from '@/design/Temperature';
import { Text } from '@/design/Text';
import { color, rowHeight, space } from '@/design/tokens';
import { acknowledgementUrgency, age, secondsSince } from '@/time/format';

function assignmentLabel(lead: Lead): { text: string; urgent: boolean } {
  const assignment = lead.assignment;
  if (!assignment || assignment.status !== 'assigned') return { text: 'Unassigned', urgent: false };
  if (!assignment.acknowledgedAt) {
    const waiting = secondsSince(assignment.assignedAt);
    const urgency = acknowledgementUrgency(waiting);
    return {
      text: `Waiting ${age(assignment.assignedAt)} · ${assignment.salespersonName || 'assigned'}`,
      urgent: urgency !== 'calm',
    };
  }
  return { text: assignment.salespersonName || 'Assigned', urgent: false };
}

export const LeadRow = memo(function LeadRow({ lead, onPress }: { lead: Lead; onPress: (leadId: string) => void }) {
  const needsAcknowledgement = Boolean(
    lead.assignment && lead.assignment.status === 'assigned' && !lead.assignment.acknowledgedAt,
  );
  const assignment = assignmentLabel(lead);
  const waitingSeconds = needsAcknowledgement ? secondsSince(lead.assignment?.assignedAt ?? null) : null;
  const urgency = acknowledgementUrgency(waitingSeconds);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${lead.contact.name || lead.contact.phoneE164}, ${lead.temperature || 'unscored'}${
        needsAcknowledgement ? ', needs acknowledgement' : ''
      }`}
      onPress={() => onPress(lead.leadId)}
      style={({ pressed }) => ({
        height: rowHeight.lead,
        flexDirection: 'row',
        backgroundColor: pressed ? color.surfacePressed : color.surface,
        borderBottomWidth: 1,
        borderBottomColor: color.hairline,
      })}
    >
      {/* Unacknowledged work is marked by a solid edge, not by colour alone. */}
      <View
        style={{
          width: 3,
          backgroundColor: needsAcknowledgement
            ? urgency === 'overdue'
              ? color.overdue
              : color.accent
            : 'transparent',
        }}
      />

      <View style={{ flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text size="body" weight="semibold" numberOfLines={1} autoDirection style={{ flex: 1 }}>
            {lead.contact.name || lead.contact.phoneE164}
          </Text>
          <Text size="small" weight="semibold" numeric tone={lead.leadScore === null ? 'faint' : 'default'}>
            {lead.leadScore === null ? '––' : String(lead.leadScore).padStart(2, ' ')}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text size="small" tone="muted" numeric numberOfLines={1} style={{ flex: 1 }}>
            {lead.contact.phoneE164}
          </Text>
          <Temperature value={lead.temperature} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text
            size="micro"
            numberOfLines={1}
            style={{ flex: 1, color: assignment.urgent ? color.overdue : color.inkFaint }}
          >
            {needsAcknowledgement ? 'NEEDS ACK · ' : ''}
            {assignment.text}
            {lead.source ? ` · ${lead.source}` : ''}
          </Text>
          <Text size="micro" tone="faint" numeric>
            {age(lead.lastMessageAt ?? lead.createdAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});
