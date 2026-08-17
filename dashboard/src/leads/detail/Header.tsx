import { Linking, Platform, Pressable, View } from 'react-native';
import type { Lead } from '@/api/types';
import { Temperature } from '@/design/Temperature';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { acknowledgementUrgency, age, duration, secondsSince } from '@/time/format';

function digitsOnly(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

export function LeadHeader({ lead, onBack }: { lead: Lead; onBack: () => void }) {
  const phone = digitsOnly(lead.contact.phoneE164);
  const needsAcknowledgement = Boolean(
    lead.assignment && lead.assignment.status === 'assigned' && !lead.assignment.acknowledgedAt,
  );
  const waiting = needsAcknowledgement ? secondsSince(lead.assignment?.assignedAt ?? null) : null;
  const urgency = acknowledgementUrgency(waiting);
  const firstResponse =
    lead.firstReceivedAt && lead.firstContactedAt
      ? (new Date(lead.firstContactedAt).getTime() - new Date(lead.firstReceivedAt).getTime()) / 1000
      : null;

  return (
    <View style={{ backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.hairline }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.md }}>
        <Pressable onPress={onBack} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel="Back to inbox">
          <Text size="small" tone="accent" weight="semibold">
            ← Inbox
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.lg }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text size="large" weight="bold" autoDirection numberOfLines={2}>
              {lead.contact.name || lead.contact.phoneE164}
            </Text>
            <Text size="small" tone="muted" numeric>
              {lead.contact.phoneE164}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: space.sm }}>
            <Text size="title" weight="bold" numeric tone={lead.leadScore === null ? 'faint' : 'default'}>
              {lead.leadScore === null ? '––' : lead.leadScore}
            </Text>
            <Temperature value={lead.temperature} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Pill text={lead.status} />
          {lead.currentStage ? <Pill text={lead.currentStage.replace(/_/g, ' ')} /> : null}
          {lead.humanTakeover ? <Pill text="human takeover" tone="accent" /> : null}
          {lead.stopFollowUp ? <Pill text="follow-ups stopped" tone="warn" /> : null}
          {lead.project ? <Pill text={lead.project.projectName} /> : null}
        </View>

        {/* Response time is the point of the product, so it is stated, not buried. */}
        <View style={{ flexDirection: 'row', gap: space.xl }}>
          <Metric label="First contact" value={duration(firstResponse)} />
          <Metric label="Last message" value={age(lead.lastMessageAt ?? lead.createdAt)} />
          <Metric
            label="Reply window"
            value={lead.sessionWindowOpen ? 'open' : 'closed'}
            tone={lead.sessionWindowOpen ? 'default' : 'warn'}
          />
        </View>

        {needsAcknowledgement ? (
          <View
            style={{
              paddingHorizontal: space.lg,
              paddingVertical: space.md,
              borderRadius: radius.sm,
              backgroundColor: urgency === 'overdue' ? color.dangerWash : color.accentWash,
              borderLeftWidth: 3,
              borderLeftColor: urgency === 'overdue' ? color.overdue : color.accent,
            }}
          >
            <Text size="small" weight="semibold" style={{ color: urgency === 'overdue' ? color.overdue : color.accent }}>
              Unacknowledged for {age(lead.assignment?.assignedAt ?? null)}
              {urgency === 'overdue' ? ' — escalation has fired' : urgency === 'slow' ? ' — reminder has fired' : ''}
            </Text>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <ContactAction
            label="Call"
            onPress={() => void Linking.openURL(`tel:${phone}`)}
          />
          <ContactAction
            label="WhatsApp"
            onPress={() =>
              void Linking.openURL(
                Platform.OS === 'web'
                  ? `https://wa.me/${phone.replace('+', '')}`
                  : `whatsapp://send?phone=${phone.replace('+', '')}`,
              )
            }
          />
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warn' }) {
  return (
    <View style={{ gap: 1 }}>
      <Text size="micro" tone="faint" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Text>
      <Text size="small" weight="semibold" numeric style={tone === 'warn' ? { color: color.warm } : undefined}>
        {value}
      </Text>
    </View>
  );
}

function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'accent' | 'warn' }) {
  const palette =
    tone === 'accent'
      ? { bg: color.accentWash, fg: color.accent }
      : tone === 'warn'
        ? { bg: color.warmWash, fg: color.warm }
        : { bg: color.surfaceSunken, fg: color.inkMuted };
  return (
    <View style={{ backgroundColor: palette.bg, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 2 }}>
      <Text size="micro" weight="medium" style={{ color: palette.fg }}>
        {text}
      </Text>
    </View>
  );
}

function ContactAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.hairlineStrong,
        backgroundColor: pressed ? color.surfacePressed : color.surface,
      })}
    >
      <Text size="small" weight="semibold" tone="accent">
        {label}
      </Text>
    </Pressable>
  );
}
