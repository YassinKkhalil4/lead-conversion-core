import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { explain } from '@/api/errors';
import type { Lead, LeadFilters } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { LeadListSkeleton } from '@/design/Skeleton';
import { EmptyState, ErrorState } from '@/design/StateBlock';
import { Text } from '@/design/Text';
import { color, fontFamily, fontSize, hitSlop, radius, space } from '@/design/tokens';
import { LeadRow } from '@/leads/LeadRow';
import { useLeadList } from '@/leads/hooks';

type Scope = 'all' | 'mine' | 'unassigned';

export default function LeadInbox() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  const [scope, setScope] = useState<Scope>('all');
  const [temperature, setTemperature] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [unacknowledged, setUnacknowledged] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo<LeadFilters>(
    () => ({
      ...(scope === 'mine' ? { assignedTo: 'me' as const } : {}),
      ...(scope === 'unassigned' ? { assignedTo: 'unassigned' as const } : {}),
      ...(temperature.length > 0 ? { temperature } : {}),
      ...(status.length > 0 ? { status } : {}),
      ...(unacknowledged ? { unacknowledged: true } : {}),
      ...(search ? { search } : {}),
      sort: 'last_message_at',
      direction: 'desc',
    }),
    [scope, temperature, status, unacknowledged, search],
  );

  const query = useLeadList(filters);
  const leads = useMemo(() => query.data?.pages.flatMap((page) => page.leads) ?? [], [query.data]);
  const total = query.data?.pages[0]?.total ?? 0;

  const pendingAcknowledgement = leads.filter(
    (lead) => lead.assignment?.status === 'assigned' && !lead.assignment.acknowledgedAt,
  ).length;

  const explained = query.isError ? explain(query.error, 'Loading the inbox') : null;
  const isStaleCache = query.isError && leads.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: color.paper }}>
      <View
        style={{
          paddingTop: insets.top + space.lg,
          paddingHorizontal: space.xl,
          paddingBottom: space.lg,
          backgroundColor: color.surface,
          borderBottomWidth: 1,
          borderBottomColor: color.hairline,
          gap: space.lg,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
          <Text size="title" weight="bold">
            Inbox
          </Text>
          <Text size="small" tone="muted" numeric>
            {query.isLoading ? '' : `${total} lead${total === 1 ? '' : 's'}`}
          </Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => void signOut()} hitSlop={hitSlop} accessibilityRole="button">
            <Text size="micro" tone="accent" weight="semibold">
              Sign out
            </Text>
          </Pressable>
        </View>

        <TextInput
          accessibilityLabel="Search by name or phone"
          value={searchInput}
          onChangeText={setSearchInput}
          placeholder="Search name or phone"
          placeholderTextColor={color.inkFaint}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{
            fontFamily,
            fontSize: fontSize.body,
            color: color.ink,
            backgroundColor: color.surfaceSunken,
            borderRadius: radius.md,
            paddingHorizontal: space.lg,
            minHeight: 40,
          }}
        />
        <Text size="micro" tone="faint">
          {user?.companyName ?? ''}
          {user?.role ? ` · ${user.role}` : ''}
        </Text>
      </View>

      {isStaleCache && explained ? (
        <View
          style={{
            paddingHorizontal: space.xl,
            paddingVertical: space.md,
            backgroundColor: color.warmWash,
            borderBottomWidth: 1,
            borderBottomColor: color.hairline,
          }}
        >
          <Text size="micro" style={{ color: color.warm }}>
            {explained.title}. Showing the last leads saved on this device.
          </Text>
        </View>
      ) : null}

      {query.isLoading ? (
        <LeadListSkeleton rows={8} />
      ) : explained && leads.length === 0 ? (
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          data={leads}
          keyExtractor={(lead: Lead) => lead.leadId}
          renderItem={({ item }) => <LeadRow lead={item} onPress={(id) => router.push(`/leads/${id}`)} />}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
              tintColor={color.inkMuted}
            />
          }
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          ListEmptyComponent={
            <EmptyState
              title={emptyTitle({ search, scope, unacknowledged, temperature, status })}
              detail={emptyDetail({ search, scope, unacknowledged, temperature, status })}
            />
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <View style={{ paddingVertical: space.xl }}>
                <ActivityIndicator size="small" color={color.inkMuted} />
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingBottom: space.xl }}
        />
      )}

      {/* Filters sit at the bottom: this is used one-handed, between viewings. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: color.hairline,
          backgroundColor: color.surface,
          paddingBottom: insets.bottom,
        }}
      >
        {pendingAcknowledgement > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setUnacknowledged(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingHorizontal: space.xl,
              paddingVertical: space.lg,
              backgroundColor: pressed ? color.accentPressed : color.accent,
            })}
          >
            <Text size="small" weight="semibold" tone="inverse" numeric>
              {pendingAcknowledgement}
            </Text>
            <Text size="small" weight="semibold" tone="inverse" style={{ flex: 1 }}>
              {pendingAcknowledgement === 1 ? 'assignment needs acknowledging' : 'assignments need acknowledging'}
            </Text>
            <Text size="small" weight="bold" tone="inverse">
              →
            </Text>
          </Pressable>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.lg, gap: space.md }}
        >
          <Chip label="All" active={scope === 'all' && !unacknowledged} onPress={() => { setScope('all'); setUnacknowledged(false); }} />
          <Chip label="Mine" active={scope === 'mine'} onPress={() => setScope(scope === 'mine' ? 'all' : 'mine')} />
          <Chip
            label="Unassigned"
            active={scope === 'unassigned'}
            onPress={() => setScope(scope === 'unassigned' ? 'all' : 'unassigned')}
          />
          <Chip label="Needs ack" active={unacknowledged} onPress={() => setUnacknowledged(!unacknowledged)} />
          <Divider />
          {(['hot', 'warm', 'cold'] as const).map((value) => (
            <Chip
              key={value}
              label={value[0]!.toUpperCase() + value.slice(1)}
              active={temperature.includes(value)}
              onPress={() => setTemperature(toggle(temperature, value))}
            />
          ))}
          <Divider />
          {(['open', 'qualified', 'closed'] as const).map((value) => (
            <Chip
              key={value}
              label={value[0]!.toUpperCase() + value.slice(1)}
              active={status.includes(value)}
              onPress={() => setStatus(toggle(status, value))}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function Divider() {
  return <View style={{ width: 1, alignSelf: 'stretch', marginHorizontal: space.xs, backgroundColor: color.hairline }} />;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 34,
        justifyContent: 'center',
        paddingHorizontal: space.lg,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? color.accent : color.hairlineStrong,
        backgroundColor: active ? color.accentWash : pressed ? color.surfacePressed : color.surface,
      })}
    >
      <Text size="small" weight={active ? 'semibold' : 'regular'} style={{ color: active ? color.accent : color.inkMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

interface EmptyContext {
  search: string;
  scope: Scope;
  unacknowledged: boolean;
  temperature: string[];
  status: string[];
}

function hasFilters(context: EmptyContext): boolean {
  return (
    context.scope !== 'all' ||
    context.unacknowledged ||
    context.temperature.length > 0 ||
    context.status.length > 0
  );
}

function emptyTitle(context: EmptyContext): string {
  if (context.search) return `No lead matches "${context.search}"`;
  if (hasFilters(context)) return 'No leads match these filters';
  return 'No leads yet';
}

function emptyDetail(context: EmptyContext): string {
  if (context.search) {
    return 'Search covers contact name and phone number only. Check the spelling, or clear the search to see the full inbox.';
  }
  if (hasFilters(context)) {
    return 'Leads appear here as they arrive and are scored. Clear a filter above to widen the list.';
  }
  return 'Leads arrive from your website form, Facebook lead ads, and WhatsApp. Each one appears here once the qualification conversation starts.';
}
