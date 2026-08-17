import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { explain } from '@/api/errors';
import type { Lead, LeadFilters } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Skeleton } from '@/design/Skeleton';
import { EmptyState, ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, hitSlop, radius, rowHeight, space } from '@/design/tokens';
import { QueueRow } from '@/leads/QueueRow';
import { useLeadList, useUnacknowledgedLeads } from '@/leads/hooks';
import { useLastLook } from '@/leads/lastLook';
import { QueueState, type RankedLead, countToday, lastActivityAt, rankLeads, urgentCount } from '@/leads/queue';
import { ageAgo } from '@/time/format';

type Scope = 'mine' | 'all';
type Filter = 'none' | 'pastSla' | 'unacknowledged';

type Item = { kind: 'lead'; entry: RankedLead } | { kind: 'divider'; label: string };

export default function Queue() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { previousLook } = useLastLook();

  const [scope, setScope] = useState<Scope>('mine');
  const [filter, setFilter] = useState<Filter>('none');

  const baseFilters = useMemo<LeadFilters>(
    () => ({
      ...(scope === 'mine' ? { assignedTo: 'me' as const } : {}),
      sort: 'last_message_at',
      direction: 'desc',
    }),
    [scope],
  );

  const unacknowledged = useUnacknowledgedLeads(baseFilters);
  const recent = useLeadList(baseFilters);

  const allLeads = useMemo<Lead[]>(
    () => [...(unacknowledged.data?.leads ?? []), ...(recent.data?.pages.flatMap((page) => page.leads) ?? [])],
    [unacknowledged.data, recent.data],
  );

  const ranked = useMemo(() => rankLeads(allLeads), [allLeads]);
  const urgent = urgentCount(ranked);
  const today = useMemo(() => countToday(allLeads), [allLeads]);

  const visible = useMemo(() => {
    if (filter === 'pastSla') return ranked.filter((entry) => entry.state === QueueState.UnacknowledgedPastSla);
    if (filter === 'unacknowledged') return ranked.filter((entry) => entry.needsAcknowledgement);
    return ranked;
  }, [ranked, filter]);

  const items = useMemo<Item[]>(() => withSinceDivider(visible, previousLook), [visible, previousLook]);

  const loading = unacknowledged.isLoading && recent.isLoading;
  const failed = recent.isError && allLeads.length === 0;
  const explained = failed ? explain(recent.error, 'Loading your queue') : null;

  const refreshing = (recent.isRefetching || unacknowledged.isRefetching) && !recent.isFetchingNextPage;
  const refreshAll = () => {
    void recent.refetch();
    void unacknowledged.refetch();
  };

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View style={{ paddingTop: insets.top + space.md, backgroundColor: color.surface }}>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.xl }}>
          <Pressable onPress={() => void signOut()} hitSlop={hitSlop} accessibilityRole="button">
            <Text size="micro" tone="faint">
              {user?.name ? `${user.name} · sign out` : 'Sign out'}
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={{ paddingHorizontal: space.xl, paddingVertical: space.xl, gap: space.md }}>
            <Skeleton width={140} height={52} />
            <Skeleton width={180} height={14} />
          </View>
        ) : urgent > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${urgent} assignments need you now. Show only these.`}
            onPress={() => setFilter('pastSla')}
            style={({ pressed }) => ({
              paddingHorizontal: space.xl,
              paddingTop: space.sm,
              paddingBottom: space.xl,
              backgroundColor: pressed ? color.surfacePressed : 'transparent',
            })}
          >
            <Text size="display" weight="bold" numeric style={{ color: color.alert }}>
              {urgent}
            </Text>
            <Text size="large" weight="semibold" style={{ color: color.alert }}>
              need you now
            </Text>
          </Pressable>
        ) : (
          <View style={{ paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.xl, gap: space.sm }}>
            <Text size="large" weight="semibold">
              Nothing is past its SLA.
            </Text>
            <Text size="small" tone="muted" numeric>
              {today.received} received · {today.acknowledged} acknowledged · {today.replied} replied today
            </Text>
          </View>
        )}

        {filter !== 'none' ? (
          <View style={{ paddingHorizontal: space.xl, paddingBottom: space.md }}>
            <Text size="micro" tone="muted">
              Showing {filter === 'pastSla' ? 'assignments past SLA' : 'unacknowledged assignments'} only
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <QueueSkeleton />
      ) : explained ? (
        <ErrorState title={explained.title} detail={explained.detail} onRetry={refreshAll} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => (item.kind === 'lead' ? item.entry.lead.leadId : `divider-${item.label}`)}
          renderItem={({ item }) =>
            item.kind === 'divider' ? (
              <SinceDivider label={item.label} />
            ) : (
              <QueueRow entry={item.entry} onPress={(leadId) => router.push(`/leads/${leadId}`)} />
            )
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refreshAll} tintColor={color.inkMuted} />
          }
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (filter === 'none' && recent.hasNextPage && !recent.isFetchingNextPage) void recent.fetchNextPage();
          }}
          ListEmptyComponent={<QueueEmpty filter={filter} scope={scope} />}
          ListFooterComponent={
            recent.isFetchingNextPage ? (
              <View style={{ paddingVertical: space.xl }}>
                <ActivityIndicator size="small" color={color.inkMuted} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: space.xl }}
        />
      )}

      {/* Thumb reach. At most two controls; nothing else earns this space. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          backgroundColor: color.surface,
          paddingHorizontal: space.xl,
          paddingTop: space.lg,
          paddingBottom: insets.bottom + space.lg,
        }}
      >
        {filter !== 'none' ? (
          <Control label="Show whole queue" active onPress={() => setFilter('none')} grow />
        ) : (
          <>
            <Segmented
              options={[
                { key: 'mine', label: 'Mine' },
                { key: 'all', label: 'All' },
              ]}
              value={scope}
              onChange={(next) => setScope(next as Scope)}
            />
            <Control label="Unacknowledged" active={false} onPress={() => setFilter('unacknowledged')} grow />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Splits the ranked list where activity stops being newer than the previous
 * visit. Drawn only when it genuinely falls between rows: a divider at the very
 * top or the very bottom tells the reader nothing.
 */
function withSinceDivider(entries: RankedLead[], previousLook: number | null): Item[] {
  const items: Item[] = entries.map((entry) => ({ kind: 'lead', entry }));
  if (!previousLook || entries.length === 0) return items;

  const firstOlder = entries.findIndex((entry) => {
    const activity = lastActivityAt(entry.lead);
    return !activity || Date.parse(activity) <= previousLook;
  });
  if (firstOlder <= 0 || firstOlder >= entries.length) return items;

  const label = `Last looked ${ageAgo(new Date(previousLook).toISOString())}`;
  return [...items.slice(0, firstOlder), { kind: 'divider', label }, ...items.slice(firstOlder)];
}

function SinceDivider({ label }: { label: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingHorizontal: space.xl,
        paddingVertical: space.lg,
      }}
    >
      <View style={{ height: 1, width: space.xxl, backgroundColor: color.hairlineStrong }} />
      <Text size="micro" tone="faint" style={{ letterSpacing: 0.4 }}>
        {label}
      </Text>
      <View style={{ height: 1, flex: 1, backgroundColor: color.hairline }} />
    </View>
  );
}

function QueueSkeleton() {
  return (
    <View>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <View
          key={index}
          style={{
            height: index < 2 ? rowHeight.urgent : rowHeight.standard,
            paddingHorizontal: space.xl,
            paddingVertical: space.lg,
            borderBottomWidth: 1,
            borderBottomColor: color.hairline,
            justifyContent: 'center',
            gap: space.md,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton width={index < 2 ? 190 : 150} height={index < 2 ? 18 : 15} />
            <Skeleton width={index < 2 ? 54 : 38} height={index < 2 ? 18 : 13} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Skeleton width={130} height={12} />
            <Skeleton width={64} height={12} />
          </View>
        </View>
      ))}
    </View>
  );
}

function QueueEmpty({ filter, scope }: { filter: Filter; scope: Scope }) {
  if (filter === 'pastSla') {
    return (
      <EmptyState
        title="Nothing is past its SLA"
        detail="An assignment appears here once it has gone 15 minutes without being acknowledged, which is when the system sends its first reminder."
      />
    );
  }
  if (filter === 'unacknowledged') {
    return (
      <EmptyState
        title="Every assignment is acknowledged"
        detail="A lead lands here the moment routing assigns it to you, and stays until you acknowledge it."
      />
    );
  }
  return (
    <EmptyState
      title={scope === 'mine' ? 'No leads assigned to you' : 'No leads yet'}
      detail="Leads arrive from the website form, Facebook lead ads and WhatsApp. Each one appears here once the qualification conversation starts."
    />
  );
}

function Control({
  label,
  active,
  onPress,
  grow = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  grow?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexGrow: grow ? 1 : 0,
        flexBasis: grow ? 0 : 'auto',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? color.ink : color.hairlineStrong,
        backgroundColor: active ? color.ink : pressed ? color.surfacePressed : color.surface,
      })}
    >
      <Text size="small" weight="semibold" style={{ color: active ? color.inkInverse : color.ink }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        borderWidth: 1,
        borderColor: color.hairlineStrong,
        borderRadius: radius.md,
        overflow: 'hidden',
      }}
    >
      {options.map((option) => {
        const selected = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: space.xl,
              backgroundColor: selected ? color.ink : pressed ? color.surfacePressed : color.surface,
            })}
          >
            <Text size="small" weight="semibold" style={{ color: selected ? color.inkInverse : color.inkMuted }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
