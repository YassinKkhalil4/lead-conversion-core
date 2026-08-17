import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { explain } from '@/api/errors';
import type { Lead, Message } from '@/api/types';
import { Button } from '@/design/Button';
import { EmptyState, ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, fontFamily, fontSize, radius, space } from '@/design/tokens';
import { isArabic } from '@/i18n/direction';
import { deliveryLabel } from '@/leads/labels';
import { clock, dayHeading, windowRemaining } from '@/time/format';
import { requestKey as newRequestKey } from '@/util/id';

export function ConversationTab({
  lead,
  messages,
  onSend,
  sending,
  sendError,
}: {
  lead: Lead;
  messages: Message[];
  onSend: (input: { text: string; requestKey: string }) => Promise<void>;
  sending: boolean;
  sendError: unknown;
}) {
  const [draft, setDraft] = useState('');
  const [pendingKey, setPendingKey] = useState(() => newRequestKey());

  const windowOpen = lead.sessionWindowOpen;
  const explained = sendError ? explain(sendError, 'Sending the reply') : null;

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    await onSend({ text, requestKey: pendingKey });
    // A delivered message gets a fresh key; a failed one keeps its key so the
    // retry is the same message rather than a second one.
    setDraft('');
    setPendingKey(newRequestKey());
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.lg }}>
        {messages.length === 0 ? (
          <EmptyState
            title="No messages yet"
            detail="The qualification conversation appears here once the first WhatsApp template is delivered and the lead replies."
          />
        ) : (
          messages.map((message, index) => (
            <MessageBubble
              key={message.messageId}
              message={message}
              showDay={index === 0 || dayHeading(messages[index - 1]?.createdAt) !== dayHeading(message.createdAt)}
            />
          ))
        )}
      </View>

      {explained ? <ErrorState title={explained.title} detail={explained.detail} /> : null}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          backgroundColor: color.surface,
          padding: space.lg,
          gap: space.md,
        }}
      >
        {windowOpen ? (
          <>
            <TextInput
              accessibilityLabel="Reply message"
              value={draft}
              onChangeText={setDraft}
              placeholder="Write a reply"
              placeholderTextColor={color.inkFaint}
              multiline
              style={{
                fontFamily,
                fontSize: fontSize.body,
                color: color.ink,
                backgroundColor: color.surfaceSunken,
                borderRadius: radius.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                minHeight: 44,
                maxHeight: 120,
                ...(isArabic(draft) ? { writingDirection: 'rtl' as const, textAlign: 'right' as const } : {}),
              }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg }}>
              <Text size="micro" tone="faint" style={{ flex: 1 }}>
                Window closes in {windowRemaining(lead.sessionWindowExpiresAt)}
              </Text>
              <Button
                label={sending ? 'Sending…' : 'Send'}
                variant="primary"
                busy={sending}
                disabled={draft.trim().length === 0}
                onPress={() => void submit()}
              />
            </View>
          </>
        ) : (
          /* The composer disables itself and says exactly why, rather than
             failing at send time. */
          <View style={{ gap: space.sm }}>
            <View
              style={{
                backgroundColor: color.surfaceSunken,
                borderRadius: radius.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.lg,
                borderWidth: 1,
                borderColor: color.hairline,
              }}
            >
              <Text size="small" weight="semibold">
                Free-form replies are closed
              </Text>
              <Text size="small" tone="muted" style={{ paddingTop: space.xs }}>
                {lead.lastInboundAt
                  ? 'WhatsApp only allows free text for 24 hours after the lead’s last message, and that window has passed.'
                  : 'This lead has not sent a message yet, so WhatsApp has not opened a 24-hour session window.'}{' '}
                An approved template will reach them and reopens the window when they reply.
              </Text>
            </View>
            <Text size="micro" tone="faint">
              Template sending is not in this build. Call or use WhatsApp directly from the header for now.
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function MessageBubble({ message, showDay }: { message: Message; showDay: boolean }) {
  const outbound = message.direction === 'outbound';
  const rtl = isArabic(message.messageText);
  const failed = message.state === 'failed';

  return (
    <View style={{ gap: space.sm }}>
      {showDay ? (
        <Text size="micro" tone="faint" style={{ textAlign: 'center', paddingVertical: space.xs }}>
          {dayHeading(message.createdAt)}
        </Text>
      ) : null}
      <View style={{ alignItems: outbound ? 'flex-end' : 'flex-start' }}>
        <View
          style={{
            maxWidth: '86%',
            backgroundColor: outbound ? color.surfaceSunken : color.surface,
            borderWidth: 1,
            borderColor: outbound ? color.surfaceSunken : color.hairline,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            gap: space.xs,
          }}
        >
          <Text
            size="body"
            style={rtl ? { writingDirection: 'rtl', textAlign: 'right' } : undefined}
          >
            {message.messageText || `(${message.messageType})`}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              gap: space.md,
              justifyContent: outbound ? 'flex-end' : 'flex-start',
            }}
          >
            <Text size="micro" tone="faint" numeric>
              {clock(message.createdAt)}
            </Text>
            {outbound ? (
              <Text size="micro" numeric style={{ color: failed ? color.alert : color.inkFaint }}>
                {deliveryLabel(message.state)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
