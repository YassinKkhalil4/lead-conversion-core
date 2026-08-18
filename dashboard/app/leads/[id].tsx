import { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { explain } from '@/api/errors';
import { Button } from '@/design/Button';
import { DetailSkeleton } from '@/design/Skeleton';
import { ErrorState, InlineNotice } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, space } from '@/design/tokens';
import { CallPrep } from '@/leads/detail/CallPrep';
import { Collapsible } from '@/leads/detail/Collapsible';
import { ConversationTab } from '@/leads/detail/ConversationTab';
import { ActivityTab, QualificationTab, RoutingTab, ScoreTab } from '@/leads/detail/sections';
import {
  useAcknowledge,
  useCloseLead,
  useLeadDetail,
  useReply,
  useSetStage,
  useStopFollowUp,
  useTakeover,
} from '@/leads/hooks';
import { classify } from '@/leads/queue';

const CLOSE_REASONS = ['won', 'lost', 'not_interested', 'unreachable', 'duplicate'];

export default function CallPrepScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useLeadDetail(leadId);
  const acknowledge = useAcknowledge(leadId);
  const takeover = useTakeover(leadId);
  const close = useCloseLead(leadId);
  const stopFollowUp = useStopFollowUp(leadId);
  const reply = useReply(leadId);
  const setStage = useSetStage(leadId);

  if (query.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top + space.xl }}>
        <DetailSkeleton />
      </View>
    );
  }

  if (query.isError || !query.data) {
    const explained = explain(query.error, 'Loading this lead');
    return (
      <View style={{ flex: 1, backgroundColor: color.paper, paddingTop: insets.top + space.xl }}>
        <BackLink onPress={() => router.back()} />
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const detail = query.data;
  const lead = detail.lead;
  const ranked = classify(lead);
  const actionExplained = actionError ? explain(actionError, 'That action') : null;

  const run = async (operation: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(error);
    }
  };

  const inboundCount = detail.messages.filter((message) => message.direction === 'inbound').length;
  const answered = detail.qualification.answers.filter((answer) => answer.answered).length;

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + space.sm }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.inkMuted} />
        }
      >
        <View style={{ backgroundColor: color.surface }}>
          <BackLink onPress={() => router.back()} />
        </View>

        {acknowledge.isPaused ? (
          <InlineNotice text="Acknowledgement saved on this device. It will be sent as soon as you are back online." />
        ) : null}
        {actionExplained ? <ErrorState title={actionExplained.title} detail={actionExplained.detail} /> : null}

        <CallPrep
          lead={lead}
          answers={detail.qualification.answers}
          waitingSeconds={ranked.needsAcknowledgement ? ranked.waitingSeconds : null}
          acknowledging={acknowledge.isPending}
          onAcknowledge={() => void run(() => acknowledge.mutateAsync(leadId))}
          changingStage={setStage.isPending}
          onChangeStage={(stage) => void run(() => setStage.mutateAsync(stage))}
        />

        {/* Everything below here is reference material and starts closed. */}
        <Collapsible title="Conversation" note={`${detail.messages.length} messages · ${inboundCount} from them`}>
          <ConversationTab
            lead={lead}
            messages={detail.messages}
            sending={reply.isPending}
            sendError={reply.error}
            onSend={async ({ text, requestKey }) => {
              await reply.mutateAsync({ requestKey, payload: { kind: 'text', text } });
            }}
          />
        </Collapsible>

        <Collapsible title="Qualification" note={`${answered} of ${detail.qualification.answers.length} answered`}>
          <QualificationTab qualification={detail.qualification} />
        </Collapsible>

        <Collapsible
          title="Why this score"
          note={detail.latestScoreRun ? `${detail.latestScoreRun.score} · ${detail.latestScoreRun.temperature}` : 'not scored'}
        >
          <ScoreTab scoreRun={detail.latestScoreRun} />
        </Collapsible>

        <Collapsible
          title="Why you got this lead"
          note={
            detail.latestRoutingRun
              ? `${detail.latestRoutingRun.candidates.length} candidates considered`
              : 'not routed'
          }
        >
          <RoutingTab routingRun={detail.latestRoutingRun} />
        </Collapsible>

        <Collapsible title="Activity" note={`${detail.activity.length} events`}>
          <ActivityTab activity={detail.activity} />
        </Collapsible>

        {/* Secondary actions are text controls, not buttons: they are rare and
            must not compete with the one action above. */}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: color.hairline,
            paddingHorizontal: space.xl,
            paddingVertical: space.xl,
            gap: space.lg,
          }}
        >
          <Button
            label={lead.humanTakeover ? 'Hand back to the bot' : 'Take over the conversation'}
            variant="text"
            busy={takeover.isPending}
            onPress={() => void run(() => takeover.mutateAsync(!lead.humanTakeover))}
          />
          <Button
            label={lead.stopFollowUp ? 'Follow-ups already stopped' : 'Stop follow-ups'}
            variant="text"
            disabled={lead.stopFollowUp}
            busy={stopFollowUp.isPending}
            onPress={() => void run(() => stopFollowUp.mutateAsync('stopped_from_dashboard'))}
          />
          <Button
            label={lead.status === 'closed' ? `Closed — ${lead.closedStatus}` : 'Close this lead'}
            variant="text"
            disabled={lead.status === 'closed'}
            onPress={() => setClosing(true)}
          />
        </View>

        <View style={{ height: insets.bottom + space.xl }} />
      </ScrollView>

      <Modal visible={closing} transparent animationType="fade" onRequestClose={() => setClosing(false)}>
        <Pressable
          onPress={() => setClosing(false)}
          style={{ flex: 1, backgroundColor: 'rgba(12,11,9,0.4)', justifyContent: 'flex-end' }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: color.surface,
              borderTopLeftRadius: radius.md,
              borderTopRightRadius: radius.md,
              paddingTop: space.xl,
              paddingBottom: insets.bottom + space.xl,
              paddingHorizontal: space.xl,
              gap: space.md,
            }}
          >
            <Text size="body" weight="semibold">
              Close this lead as
            </Text>
            <Text size="small" tone="muted" style={{ paddingBottom: space.sm }}>
              This stops scheduled follow-ups and SLA timers for the lead.
            </Text>
            {CLOSE_REASONS.map((reason) => (
              <Button
                key={reason}
                label={reason.replace(/_/g, ' ')}
                grow
                onPress={() => {
                  setClosing(false);
                  void run(() => close.mutateAsync(reason));
                }}
              />
            ))}
            <Button label="Cancel" variant="text" grow onPress={() => setClosing(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function BackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel="Back to the queue"
      style={{ paddingHorizontal: space.xl, paddingVertical: space.md }}
    >
      <Text size="small" weight="semibold" tone="muted">
        ← Queue
      </Text>
    </Pressable>
  );
}
