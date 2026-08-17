import { useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { explain } from '@/api/errors';
import { Button } from '@/design/Button';
import { DetailSkeleton } from '@/design/Skeleton';
import { ErrorState, InlineNotice } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, radius, space } from '@/design/tokens';
import { ConversationTab } from '@/leads/detail/ConversationTab';
import { LeadHeader } from '@/leads/detail/Header';
import { ActivityTab, QualificationTab, RoutingTab, ScoreTab } from '@/leads/detail/sections';
import {
  useAcknowledge,
  useCloseLead,
  useLeadDetail,
  useReply,
  useStopFollowUp,
  useTakeover,
} from '@/leads/hooks';

const TABS = ['Conversation', 'Qualification', 'Score', 'Routing', 'Activity'] as const;
type Tab = (typeof TABS)[number];

const CLOSE_REASONS = ['won', 'lost', 'not_interested', 'unreachable', 'duplicate'];

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const leadId = String(id ?? '');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('Conversation');
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useLeadDetail(leadId);
  const acknowledge = useAcknowledge(leadId);
  const takeover = useTakeover(leadId);
  const close = useCloseLead(leadId);
  const stopFollowUp = useStopFollowUp(leadId);
  const reply = useReply(leadId);

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
        <Pressable onPress={() => router.back()} style={{ paddingHorizontal: space.xl, paddingBottom: space.lg }}>
          <Text size="small" tone="accent" weight="semibold">
            ← Inbox
          </Text>
        </Pressable>
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void query.refetch()} />
      </View>
    );
  }

  const detail = query.data;
  const lead = detail.lead;
  const needsAcknowledgement = Boolean(
    lead.assignment && lead.assignment.status === 'assigned' && !lead.assignment.acknowledgedAt,
  );
  const acknowledgedOffline = acknowledge.isPaused;
  const actionExplained = actionError ? explain(actionError, 'That action') : null;

  const run = async (operation: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await operation();
    } catch (error) {
      setActionError(error);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top }}
        refreshControl={
          <RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={color.inkMuted} />
        }
      >
        <LeadHeader lead={lead} onBack={() => router.back()} />

        {acknowledgedOffline ? (
          <InlineNotice text="Acknowledgement saved on this device. It will be sent as soon as you are back online." />
        ) : null}
        {actionExplained ? <ErrorState title={actionExplained.title} detail={actionExplained.detail} /> : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: color.surface, borderBottomWidth: 1, borderBottomColor: color.hairline }}
          contentContainerStyle={{ paddingHorizontal: space.lg }}
        >
          {TABS.map((name) => {
            const active = tab === name;
            return (
              <Pressable
                key={name}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(name)}
                style={{
                  paddingHorizontal: space.lg,
                  paddingVertical: space.lg,
                  borderBottomWidth: 2,
                  borderBottomColor: active ? color.accent : 'transparent',
                }}
              >
                <Text size="small" weight={active ? 'semibold' : 'regular'} tone={active ? 'accent' : 'muted'}>
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {tab === 'Conversation' ? (
          <ConversationTab
            lead={lead}
            messages={detail.messages}
            sending={reply.isPending}
            sendError={reply.error}
            onSend={async ({ text, requestKey }) => {
              await reply.mutateAsync({ requestKey, payload: { kind: 'text', text } });
            }}
          />
        ) : null}
        {tab === 'Qualification' ? <QualificationTab qualification={detail.qualification} /> : null}
        {tab === 'Score' ? <ScoreTab scoreRun={detail.latestScoreRun} /> : null}
        {tab === 'Routing' ? <RoutingTab routingRun={detail.latestRoutingRun} /> : null}
        {tab === 'Activity' ? <ActivityTab activity={detail.activity} /> : null}

        <View style={{ height: space.xxxl }} />
      </ScrollView>

      {/* Actions live at the bottom, within thumb reach. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          backgroundColor: color.surface,
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.md,
        }}
      >
        {needsAcknowledgement ? (
          <Button
            label={acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge assignment'}
            variant="primary"
            grow
            busy={acknowledge.isPending}
            onPress={() => void run(() => acknowledge.mutateAsync(leadId))}
          />
        ) : null}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <Button
            label={lead.humanTakeover ? 'Hand back' : 'Take over'}
            grow
            busy={takeover.isPending}
            onPress={() => void run(() => takeover.mutateAsync(!lead.humanTakeover))}
          />
          <Button
            label="Stop follow-up"
            grow
            disabled={lead.stopFollowUp}
            busy={stopFollowUp.isPending}
            onPress={() => void run(() => stopFollowUp.mutateAsync('stopped_from_dashboard'))}
          />
          <Button
            label="Close"
            variant="danger"
            grow
            disabled={lead.status === 'closed'}
            onPress={() => setClosing(true)}
          />
        </View>
      </View>

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
            <Button label="Cancel" variant="quiet" grow onPress={() => setClosing(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
