import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import { explain } from '@/api/errors';
import type { Reservation } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/design/Button';
import { LeadListSkeleton } from '@/design/Skeleton';
import { EmptyState, ErrorState } from '@/design/StateBlock';
import { Label, Text } from '@/design/Text';
import { color, hitSlop, layout, radius, space } from '@/design/tokens';
import { Page } from '@/desk/Page';
import {
  type RangeKey,
  coversOf,
  dayLabel,
  depositLabel,
  groupByDay,
  heldCount,
  rangeFor,
  statusLabel,
  timeIn,
  todayIn,
} from '@/reservations/format';
import { useHeldReservations, useReservationList } from '@/reservations/hooks';

const RANGES: Array<{ key: RangeKey; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'upcoming', label: 'Upcoming' },
];

export default function Reservations() {
  const { user } = useAuth();
  const router = useRouter();
  const timezone = user?.timezone ?? 'Europe/Madrid';
  const today = useMemo(() => todayIn(timezone), [timezone]);
  const [range, setRange] = useState<RangeKey>('today');

  const filters = useMemo(() => rangeFor(range, today), [range, today]);
  const list = useReservationList(filters);
  const held = useHeldReservations();

  const items = useMemo<Reservation[]>(() => list.data?.pages.flatMap((page) => page.reservations) ?? [], [list.data]);
  const days = useMemo(() => groupByDay(items, today), [items, today]);
  const waiting = held.data?.reservations ?? [];

  const failed = list.isError && items.length === 0;
  const explained = failed ? explain(list.error, 'Loading reservations') : null;
  const refreshAll = () => {
    void list.refetch();
    void held.refetch();
  };

  const subtitle = list.isLoading
    ? undefined
    : waiting.length > 0
      ? `${waiting.length} ${waiting.length === 1 ? 'request needs' : 'requests need'} your approval.`
      : `${coversOf(items)} covers in this view.`;

  return (
    <Page
      title="Reservations"
      {...(subtitle ? { subtitle } : {})}
      actions={
        <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
          {RANGES.map((option) => (
            <Chip key={option.key} label={option.label} active={range === option.key} onPress={() => setRange(option.key)} />
          ))}
        </View>
      }
    >
      {waiting.length > 0 ? (
        <View style={{ gap: layout.rowY }}>
          <Text size="title" weight="semibold" role="heading" aria-level={2}>
            Needs your approval
          </Text>
          <Panel>
            {waiting.map((item) => (
              <Row key={item.reservationId} item={item} timezone={timezone} today={today} showDay onPress={() => router.push(`/reservations/${item.reservationId}`)} />
            ))}
          </Panel>
        </View>
      ) : null}

      {list.isLoading ? (
        <Panel>
          <LeadListSkeleton rows={5} urgent={0} />
        </Panel>
      ) : explained ? (
        <ErrorState title={explained.title} detail={explained.detail} onRetry={refreshAll} />
      ) : days.length === 0 ? (
        <Panel>
          <EmptyState
            title={range === 'today' ? 'Nothing booked for today' : range === 'tomorrow' ? 'Nothing booked for tomorrow' : 'No upcoming reservations'}
            detail="Reservations appear here as guests book on WhatsApp. A large group waits in the approval list above until you confirm it."
          />
        </Panel>
      ) : (
        days.map((day) => (
          <View key={day.date} style={{ gap: layout.rowY }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.lg }}>
              <Text size="title" weight="semibold" role="heading" aria-level={2}>
                {day.label}
              </Text>
              <Text size="small" tone="faint" numeric>
                {day.covers} covers
              </Text>
            </View>
            {day.shifts.map((shift) => (
              <View key={shift.shift} style={{ gap: space.sm }}>
                <Label>{shift.shift}</Label>
                <Panel>
                  {shift.items.map((item) => (
                    <Row key={item.reservationId} item={item} timezone={timezone} today={today} onPress={() => router.push(`/reservations/${item.reservationId}`)} />
                  ))}
                </Panel>
              </View>
            ))}
          </View>
        ))
      )}

      {list.hasNextPage ? (
        <View style={{ alignItems: 'center' }}>
          <Button label="Show more" variant="outline" busy={list.isFetchingNextPage} onPress={() => void list.fetchNextPage()} />
        </View>
      ) : null}
      {/* Pull-to-refresh is the page's own scroll on mobile web; this keeps a manual path for desk. */}
      <View style={{ alignItems: 'flex-start' }}>
        <Button label="Refresh" variant="text" busy={list.isRefetching} onPress={refreshAll} />
      </View>
      <RefreshControl refreshing={false} onRefresh={refreshAll} style={{ height: 0 }} />
    </Page>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color.line, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.paper }}>
      {children}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={hitSlop}
      onPress={onPress}
      style={{
        paddingVertical: space.md,
        paddingHorizontal: space.xl,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: active ? color.ink : color.lineStrong,
        backgroundColor: active ? color.ink : color.paper,
      }}
    >
      <Text size="small" weight="medium" tone={active ? 'inverse' : 'default'}>
        {label}
      </Text>
    </Pressable>
  );
}

function Row({ item, timezone, today, showDay = false, onPress }: { item: Reservation; timezone: string; today: string; showDay?: boolean; onPress: () => void }) {
  const deposit = depositLabel(item);
  const dim = item.status === 'cancelled' || item.status === 'no_show';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.guestName || item.guestPhone}, ${item.partySize} guests, ${statusLabel(item.status)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: space.lg,
        paddingHorizontal: layout.rowX,
        paddingVertical: layout.rowY,
        minHeight: layout.tableRow,
        borderBottomWidth: 1,
        borderBottomColor: color.line2,
        backgroundColor: pressed ? color.line2 : color.paper,
        opacity: dim ? 0.6 : 1,
      })}
    >
      <Text size="body" weight="semibold" numeric style={{ width: 64 }}>
        {timeIn(timezone, item.startsAt)}
      </Text>
      <View style={{ flexGrow: 1, flexBasis: 180, gap: space.hair }}>
        <Text size="body" weight="medium" autoDirection>
          {item.guestName || item.guestPhone}
        </Text>
        <Text size="small" tone="muted">
          {[showDay ? `${dayLabel(item.serviceDate, today)} · ${item.shift}` : '', item.zone, item.hostName ? `Host ${item.hostName}` : ''].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text size="body" numeric style={{ width: 84 }}>
        {item.partySize} {item.partySize === 1 ? 'guest' : 'guests'}
      </Text>
      <View style={{ alignItems: 'flex-end', flexGrow: 1, flexBasis: 120, gap: space.hair }}>
        <Text size="small" weight="medium" tone={item.status === 'requested' ? 'warning' : 'default'}>
          {statusLabel(item.status)}
        </Text>
        {deposit ? (
          <Text size="small" tone="faint">
            {deposit}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
