import { useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import type { Lead, QualificationAnswer } from '@/api/types';
import { Button } from '@/design/Button';
import { Temperature } from '@/design/Temperature';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { fourFacts, indexAnswers, openingLine } from '@/leads/qualification';
import { PAST_SLA_SECONDS } from '@/leads/queue';
import { queueClock } from '@/time/format';

function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '');
}

/**
 * Everything above the fold. Read in the ten seconds before dialling, so it
 * holds only what is needed to make the call: who they are, how to reach them,
 * the four facts, something to open with, and one action.
 */
export function CallPrep({
  lead,
  answers,
  waitingSeconds,
  onAcknowledge,
  acknowledging,
}: {
  lead: Lead;
  answers: QualificationAnswer[];
  waitingSeconds: number | null;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const index = indexAnswers(answers);
  const facts = fourFacts(index);
  const opening = openingLine(lead.contact.name, index);
  const phone = dialable(lead.contact.phoneE164);
  const whatsappNumber = phone.replace('+', '');

  const needsAcknowledgement = Boolean(
    lead.assignment && lead.assignment.status === 'assigned' && !lead.assignment.acknowledgedAt,
  );
  const pastSla = needsAcknowledgement && (waitingSeconds ?? 0) >= PAST_SLA_SECONDS;

  const openWhatsApp = () =>
    void Linking.openURL(
      Platform.OS === 'web' ? `https://wa.me/${whatsappNumber}` : `whatsapp://send?phone=${whatsappNumber}`,
    );

  return (
    <View style={{ backgroundColor: color.surface, paddingBottom: space.xl }}>
      <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, gap: space.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.lg }}>
          <Text size="headline" weight="bold" autoDirection style={{ flex: 1 }}>
            {lead.contact.name || lead.contact.phoneE164}
          </Text>
          <Temperature value={lead.temperature} />
        </View>

        {needsAcknowledgement ? (
          <Text
            size="small"
            weight="semibold"
            numeric
            style={{ color: pastSla ? color.alert : color.warning }}
          >
            Unacknowledged {queueClock(lead.assignment?.assignedAt ?? null)}
            {pastSla ? ' · past SLA' : ''}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${lead.contact.phoneE164}`}
            onPress={() => void Linking.openURL(`tel:${phone}`)}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 48,
              justifyContent: 'center',
              paddingHorizontal: space.lg,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.hairlineStrong,
              backgroundColor: pressed ? color.surfacePressed : color.surface,
            })}
          >
            <Text size="large" weight="semibold" numeric>
              {lead.contact.phoneE164}
            </Text>
            <Text size="micro" tone="faint">
              Tap to call
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open WhatsApp"
            onPress={openWhatsApp}
            style={({ pressed }) => ({
              minHeight: 48,
              paddingHorizontal: space.xl,
              justifyContent: 'center',
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: color.hairlineStrong,
              backgroundColor: pressed ? color.surfacePressed : color.surface,
            })}
          >
            <Text size="small" weight="semibold">
              WhatsApp
            </Text>
          </Pressable>
        </View>

        <FactGrid facts={facts} />

        <OpeningLine text={opening} />
      </View>

      <View style={{ paddingHorizontal: space.xl, paddingTop: space.lg }}>
        {needsAcknowledgement ? (
          <Button
            label={acknowledging ? 'Acknowledging…' : 'Acknowledge'}
            variant="primary"
            size="large"
            grow
            busy={acknowledging}
            onPress={onAcknowledge}
          />
        ) : (
          <Button label="Open WhatsApp" variant="primary" size="large" grow onPress={openWhatsApp} />
        )}
      </View>
    </View>
  );
}

/**
 * Four cells in a fixed order, so position identifies a value even when the
 * label is skimmed past. An unanswered question keeps its cell rather than
 * collapsing the grid and moving everything else.
 */
function FactGrid({ facts }: { facts: ReturnType<typeof fourFacts> }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderTopColor: color.hairline }}>
      {facts.map((fact, index) => (
        <View
          key={fact.label}
          style={{
            width: '50%',
            paddingVertical: space.lg,
            paddingRight: space.lg,
            borderBottomWidth: index < 2 ? 1 : 0,
            borderBottomColor: color.hairline,
            gap: 2,
          }}
        >
          <Text size="micro" tone="faint" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
            {fact.label}
          </Text>
          {fact.value ? (
            <Text size="large" weight="semibold" numeric={fact.numeric} autoDirection numberOfLines={2}>
              {fact.value}
            </Text>
          ) : (
            <Text size="large" tone="faint">
              —
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function OpeningLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <View
      style={{
        backgroundColor: color.surfaceSunken,
        borderRadius: radius.md,
        padding: space.lg,
        gap: space.md,
      }}
    >
      <Text size="micro" tone="faint" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        Open with
      </Text>
      <Text size="body" autoDirection>
        {text}
      </Text>
      <Pressable accessibilityRole="button" onPress={() => void copy()} hitSlop={hitSlop}>
        <Text size="small" weight="semibold" style={{ textDecorationLine: 'underline' }}>
          {copied ? 'Copied' : 'Copy'}
        </Text>
      </Pressable>
    </View>
  );
}
