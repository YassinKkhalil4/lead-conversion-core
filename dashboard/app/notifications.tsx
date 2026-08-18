import { useEffect, useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '@/api/client';
import { explain } from '@/api/errors';
import type { Notification } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/design/Button';
import { EmptyState, ErrorState } from '@/design/StateBlock';
import { Skeleton } from '@/design/Skeleton';
import { Text } from '@/design/Text';
import { color, radius, space } from '@/design/tokens';
import { Page, Section } from '@/desk/Page';
import { eventLabel } from '@/leads/labels';
import { manageKeys, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@/manage/hooks';
import { ageAgo, clock, dayHeading } from '@/time/format';

export default function NotificationsScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const queryClient = useQueryClient();
  const query = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // The stream carries identifiers only, so an arrival invalidates the list
  // rather than trying to splice a payload the server never sent.
  useEffect(() => {
    if (status !== 'authenticated' || typeof EventSource === 'undefined') return;
    const source = new EventSource(`${API_BASE}/api/stream`, { withCredentials: true });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: manageKeys.notifications });
    };
    source.addEventListener('notification.created', refresh);
    source.addEventListener('assignment.created', refresh);
    return () => {
      source.removeEventListener('notification.created', refresh);
      source.removeEventListener('assignment.created', refresh);
      source.close();
    };
  }, [status, queryClient]);

  const grouped = useMemo(() => groupByDay(query.data?.notifications ?? []), [query.data]);
  const unread = query.data?.unreadCount ?? 0;

  if (query.isError) {
    const explained = explain(query.error, 'Loading notifications');
    return (
      <Page title="Notifications">
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void query.refetch()} />
      </Page>
    );
  }

  return (
    <Page
      title="Notifications"
      subtitle={unread > 0 ? `${unread} unread` : 'Everything read'}
      actions={
        unread > 0 ? (
          <Button label="Mark all read" busy={markAll.isPending} onPress={() => void markAll.mutateAsync()} />
        ) : undefined
      }
    >
      {query.isLoading ? (
        <View style={{ gap: space.lg }}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={{ gap: space.sm, padding: space.lg, borderWidth: 1, borderColor: color.hairline, backgroundColor: color.surface }}>
              <Skeleton width={200} height={14} />
              <Skeleton width={120} height={11} />
            </View>
          ))}
        </View>
      ) : grouped.length === 0 ? (
        <EmptyState
          title="No notifications"
          detail="Assignment alerts, SLA reminders and escalations arrive here as the system sends them. Nothing has been sent to you yet."
        />
      ) : (
        grouped.map((group) => (
          <Section key={group.day} title={group.day}>
            <View style={{ borderWidth: 1, borderColor: color.hairline, backgroundColor: color.surface }}>
              {group.items.map((item, index) => (
                <Pressable
                  key={item.notificationId}
                  accessibilityRole={item.leadId ? 'button' : undefined}
                  onPress={() => {
                    if (!item.readAt) void markRead.mutateAsync(item.notificationId);
                    if (item.leadId) router.push(`/leads/${item.leadId}`);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: space.lg,
                    padding: space.lg,
                    backgroundColor: pressed ? color.surfacePressed : 'transparent',
                    borderBottomWidth: index === group.items.length - 1 ? 0 : 1,
                    borderBottomColor: color.hairline,
                  })}
                >
                  {/* Unread is a filled marker plus weight, never colour alone. */}
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      marginTop: 6,
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: item.readAt ? color.hairlineStrong : color.ink,
                      backgroundColor: item.readAt ? 'transparent' : color.ink,
                    }}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text size="small" weight={item.readAt ? 'regular' : 'semibold'}>
                      {eventLabel(item.notificationType)}
                    </Text>
                    <Text size="micro" tone="faint">
                      {describe(item)}
                    </Text>
                  </View>
                  {item.priority === 'high' ? (
                    <View style={{ backgroundColor: color.alertWash, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 1 }}>
                      <Text size="micro" weight="bold" style={{ color: color.alert }}>
                        HIGH
                      </Text>
                    </View>
                  ) : null}
                  <Text size="micro" tone="faint" numeric>
                    {clock(item.createdAt)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
        ))
      )}
    </Page>
  );
}

function describe(item: Notification): string {
  const contact = typeof item.payload.contactName === 'string' ? item.payload.contactName : '';
  const reason = typeof item.payload.reason === 'string' ? item.payload.reason.replace(/_/g, ' ') : '';
  const parts = [contact, reason, item.leadId ? 'tap to open the lead' : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : ageAgo(item.createdAt);
}

function groupByDay(items: Notification[]): { day: string; items: Notification[] }[] {
  const groups = new Map<string, Notification[]>();
  for (const item of items) {
    const day = dayHeading(item.createdAt);
    const existing = groups.get(day);
    if (existing) existing.push(item);
    else groups.set(day, [item]);
  }
  return [...groups.entries()].map(([day, grouped]) => ({ day, items: grouped }));
}
