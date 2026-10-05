import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { explain } from '@/api/errors';
import type { Reservation } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/design/Button';
import { DetailSkeleton } from '@/design/Skeleton';
import { ErrorState, InlineNotice } from '@/design/StateBlock';
import { Label, Text } from '@/design/Text';
import { color, layout, radius, space } from '@/design/tokens';
import { Page } from '@/desk/Page';
import { type ReservationAction, actionLabel, actionsFor, dayLabel, depositLabel, statusLabel, timeIn, todayIn } from '@/reservations/format';
import { useCancelReservation, useConfirmReservation, useReservation, useSetReservationStatus } from '@/reservations/hooks';

export default function ReservationDetail() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const timezone = user?.timezone ?? 'Europe/Madrid';
  const query = useReservation(id);

  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError || !query.data) {
    const explained = explain(query.error, 'Loading this reservation');
    return (
      <Page title="Reservation">
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void query.refetch()} />
        <Button label="Back to reservations" variant="outline" onPress={() => router.replace('/reservations')} />
      </Page>
    );
  }
  const r = query.data.reservation;
  return <Detail reservation={r} timezone={timezone} onBack={() => router.replace('/reservations')} onLead={() => r.leadId && router.push(`/leads/${r.leadId}`)} />;
}

function Detail({ reservation: r, timezone, onBack, onLead }: { reservation: Reservation; timezone: string; onBack: () => void; onLead: () => void }) {
  const confirm = useConfirmReservation(r.reservationId);
  const cancel = useCancelReservation(r.reservationId);
  const setStatus = useSetReservationStatus(r.reservationId);
  const [declining, setDeclining] = useState(false);
  const [notice, setNotice] = useState<{ text: string; variant: 'neutral' | 'warning' } | null>(null);
  const [failure, setFailure] = useState<{ title: string; detail: string } | null>(null);

  const busy = confirm.isPending || cancel.isPending || setStatus.isPending;
  const today = todayIn(timezone);
  const actions = actionsFor(r.status);

  const guestNote = (guestNotified: boolean, verb: string) =>
    guestNotified
      ? { text: `${verb}. The guest was told on WhatsApp.`, variant: 'neutral' as const }
      : {
          text: `${verb}. The guest could not be messaged here: WhatsApp only allows free text within 24 hours of their last message. Message them from their conversation.`,
          variant: 'warning' as const,
        };

  const run = async (action: ReservationAction, deposit?: 'pending' | 'paid' | 'waived') => {
    setFailure(null);
    setNotice(null);
    try {
      if (action === 'confirm') {
        const result = await confirm.mutateAsync(deposit);
        setNotice(guestNote(result.guestNotified, 'Confirmed'));
      } else if (action === 'decline') {
        const result = await cancel.mutateAsync();
        setDeclining(false);
        setNotice(guestNote(result.guestNotified, r.status === 'requested' ? 'Declined' : 'Cancelled'));
      } else {
        await setStatus.mutateAsync(action);
        setNotice({ text: `Marked ${statusLabel(action === 'no_show' ? 'no_show' : action).toLowerCase()}.`, variant: 'neutral' });
      }
    } catch (error) {
      setFailure(explain(error, 'Updating this reservation'));
    }
  };

  const facts: Array<[string, string]> = [
    ['When', `${dayLabel(r.serviceDate, today)}, ${r.shift} · ${timeIn(timezone, r.startsAt)}`],
    ['Party', `${r.partySize} ${r.partySize === 1 ? 'guest' : 'guests'}`],
    ['Zone', r.zone],
    ['Venue', r.venueName],
    ['Guest', r.guestName || '—'],
    ['Phone', r.guestPhone],
    ['Language', r.language || '—'],
    ['Host', r.hostName || 'Unassigned'],
    ...(r.depositRequired ? ([['Deposit', depositLabel(r)]] as Array<[string, string]>) : []),
    ...(r.notes ? ([['Notes', r.notes]] as Array<[string, string]>) : []),
  ];

  return (
    <Page
      title={`${r.partySize} ${r.partySize === 1 ? 'guest' : 'guests'} · ${r.guestName || r.guestPhone}`}
      subtitle={`${statusLabel(r.status)}${r.status === 'requested' ? ': the venue has not confirmed this yet.' : ''}`}
      actions={<Button label="All reservations" variant="outline" onPress={onBack} />}
    >
      {notice ? <InlineNotice text={notice.text} variant={notice.variant} /> : null}
      {failure ? <ErrorState title={failure.title} detail={failure.detail} /> : null}

      <View style={{ borderWidth: 1, borderColor: color.line, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.paper }}>
        {facts.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', gap: space.xl, paddingHorizontal: layout.rowX, paddingVertical: layout.rowY, borderBottomWidth: 1, borderBottomColor: color.line2 }}>
            <View style={{ width: 96 }}>
              <Label>{label}</Label>
            </View>
            <View style={{ flex: 1 }}>
              <Text size="body" autoDirection>
                {value}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {actions.length > 0 ? (
        <View style={{ gap: layout.rowY }}>
          <Text size="title" weight="semibold" role="heading" aria-level={2}>
            Actions
          </Text>

          {actions.includes('confirm') ? (
            r.depositRequired ? (
              <View style={{ gap: space.md }}>
                <Text size="small" tone="muted">
                  This group is held for a deposit. Record where the deposit stands as you confirm.
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                  <Button label="Confirm: deposit paid" variant="primary" busy={busy} onPress={() => void run('confirm', 'paid')} />
                  <Button label="Confirm: deposit waived" variant="outline" busy={busy} onPress={() => void run('confirm', 'waived')} />
                  <Button label="Confirm: deposit still pending" variant="outline" busy={busy} onPress={() => void run('confirm', 'pending')} />
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: 'row' }}>
                <Button label="Confirm" variant="primary" busy={busy} onPress={() => void run('confirm')} />
              </View>
            )
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
            {actions
              .filter((a) => a !== 'confirm' && a !== 'decline')
              .map((action) => (
                <Button key={action} label={actionLabel(action, r.status)} variant={action === 'seated' ? 'primary' : 'outline'} busy={busy} onPress={() => void run(action)} />
              ))}
            {actions.includes('decline') && !declining ? (
              <Button label={actionLabel('decline', r.status)} variant="text" disabled={busy} onPress={() => setDeclining(true)} />
            ) : null}
          </View>

          {declining ? (
            <View style={{ gap: space.md, padding: layout.rowX, borderWidth: 1, borderColor: color.warn, borderRadius: radius.lg, backgroundColor: color.paper }}>
              <Text size="body" weight="medium">
                {r.status === 'requested' ? 'Decline this reservation?' : 'Cancel this confirmed reservation?'}
              </Text>
              <Text size="small" tone="muted">
                The covers go back on sale and the guest is told.
              </Text>
              <View style={{ flexDirection: 'row', gap: space.md, flexWrap: 'wrap' }}>
                <Button label={r.status === 'requested' ? 'Yes, decline' : 'Yes, cancel it'} variant="primary" busy={busy} onPress={() => void run('decline')} />
                <Button label="Keep it" variant="outline" disabled={busy} onPress={() => setDeclining(false)} />
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {r.leadId ? (
        <View style={{ flexDirection: 'row' }}>
          <Button label="Open the conversation" variant="outline" onPress={onLead} />
        </View>
      ) : null}
    </Page>
  );
}
