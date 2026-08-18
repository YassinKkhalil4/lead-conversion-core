import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { explain } from '@/api/errors';
import type { Lead, PeriodKey } from '@/api/types';
import { Temperature } from '@/design/Temperature';
import { ErrorState } from '@/design/StateBlock';
import { Skeleton } from '@/design/Skeleton';
import { Text } from '@/design/Text';
import { color, radius, space } from '@/design/tokens';
import { BarChart, DistributionBar, StatTile } from '@/desk/charts';
import { type Column, DataTable } from '@/desk/DataTable';
import { Page, Panel, Section } from '@/desk/Page';
import { useLeadList } from '@/leads/hooks';
import { useSalespeople, useSummary } from '@/manage/hooks';
import { PAST_SLA_SECONDS } from '@/leads/queue';
import { duration, queueClock } from '@/time/format';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

const TEMPERATURE_COLOR: Record<string, string> = {
  hot: color.hot,
  warm: color.warm,
  cold: color.cold,
};

export default function ManagerOverview() {
  const router = useRouter();
  const [period, setPeriod] = useState<PeriodKey>('today');

  const summary = useSummary();
  const salespeople = useSalespeople();

  // Qualified leads nobody has acknowledged, ranked by score. The server does
  // the ranking and the filtering, so this is not a client-side approximation
  // over a page of leads.
  const atRisk = useLeadList({
    status: ['qualified'],
    unacknowledged: true,
    sort: 'lead_score',
    direction: 'desc',
  });

  const data = summary.data?.summary;
  const current = data?.periods[period];
  const previous = data?.previousPeriods[period];
  const riskLeads = useMemo(() => atRisk.data?.pages.flatMap((page) => page.leads) ?? [], [atRisk.data]);

  if (summary.isError) {
    const explained = explain(summary.error, 'Loading the overview');
    return (
      <Page title="Overview">
        <ErrorState title={explained.title} detail={explained.detail} onRetry={() => void summary.refetch()} />
      </Page>
    );
  }

  return (
    <Page
      title="Overview"
      subtitle={data ? `${data.timezone} · updated ${queueClock(data.generatedAt)} ago` : undefined}
      actions={
        <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: color.hairlineStrong, borderRadius: radius.md, overflow: 'hidden' }}>
          {PERIODS.map((option) => {
            const selected = option.key === period;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setPeriod(option.key)}
                style={({ pressed }) => ({
                  minHeight: 40,
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
      }
    >
      {summary.isLoading || !current || !previous ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          {[0, 1, 2, 3].map((index) => (
            <View key={index} style={{ flexGrow: 1, flexBasis: 180, padding: space.xl, borderWidth: 1, borderColor: color.hairline, gap: space.md }}>
              <Skeleton width={90} height={11} />
              <Skeleton width={64} height={28} />
              <Skeleton width={110} height={11} />
            </View>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
          <StatTile label="New leads" value={current.newLeads} previous={previous.newLeads} />
          <StatTile label="Qualified" value={current.qualifiedLeads} previous={previous.qualifiedLeads} />
          <StatTile
            label="Speed to acknowledge"
            value={data?.responseTime.medianAcknowledgementSeconds ?? null}
            previous={null}
            format={(value) => duration(value)}
            lowerIsBetter
            hint="median, all time"
          />
          <StatTile
            label="Pending acknowledgement"
            value={data?.responseTime.pendingAcknowledgements ?? null}
            previous={previous.assignedUnacknowledged}
            lowerIsBetter
            hint={
              data?.responseTime.oldestPendingAcknowledgementSeconds
                ? `oldest ${duration(data.responseTime.oldestPendingAcknowledgementSeconds)}`
                : undefined
            }
          />
        </View>
      )}

      <Section
        title="Response time"
        note="The bar runs to p90 and the red mark is the worst case. An average would hide it."
      >
        <Panel>
          <DistributionBar
            label="Lead arrival to first contact"
            median={data?.responseTime.medianFirstContactSeconds ?? null}
            p90={data?.responseTime.p90FirstContactSeconds ?? null}
            worst={data?.responseTime.slowestFirstContactSeconds ?? null}
          />
          <DistributionBar
            label="Assignment to acknowledgement"
            median={data?.responseTime.medianAcknowledgementSeconds ?? null}
            p90={data?.responseTime.p90AcknowledgementSeconds ?? null}
            worst={data?.responseTime.slowestAcknowledgementSeconds ?? null}
          />
        </Panel>
      </Section>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xl }}>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: space.lg }}>
          <Section title="Open leads by temperature">
            <Panel>
              <BarChart
                rows={(data?.leadsByTemperature ?? []).map((entry) => ({
                  label: entry.temperature,
                  value: entry.count,
                }))}
                colorFor={(label) => TEMPERATURE_COLOR[label] ?? color.unscored}
                emptyLabel="No open leads yet. Temperature appears once a lead is scored."
              />
            </Panel>
          </Section>
        </View>
        <View style={{ flexGrow: 1, flexBasis: 320, gap: space.lg }}>
          <Section title="Leads by source" note="Last 30 days">
            <Panel>
              <BarChart
                rows={(data?.leadsBySource ?? []).map((entry) => ({ label: entry.source, value: entry.count }))}
                emptyLabel="No leads in the last 30 days."
              />
            </Panel>
          </Section>
        </View>
      </View>

      <Section
        title="Leads at risk"
        note="Qualified and still unacknowledged, highest score first. This is revenue leaking right now."
      >
        <DataTable
          rows={riskLeads}
          keyOf={(lead) => lead.leadId}
          onRowPress={(lead) => router.push(`/leads/${lead.leadId}`)}
          initialSort={{ key: 'score', direction: 'desc' }}
          emptyTitle="Nothing at risk"
          emptyDetail="Qualified leads appear here while they are waiting to be acknowledged. An empty table means the team is keeping up."
          columns={riskColumns}
        />
      </Section>

      <Section title="Team" note="Sortable. Acknowledgement figures are all time.">
        {salespeople.isError ? (
          <ErrorState
            title="Could not load the team"
            detail={explain(salespeople.error, 'Loading salespeople').detail}
            onRetry={() => void salespeople.refetch()}
          />
        ) : (
          <DataTable
            rows={salespeople.data?.salespeople ?? []}
            keyOf={(person) => person.salespersonId}
            initialSort={{ key: 'overdue', direction: 'desc' }}
            emptyTitle="No salespeople yet"
            emptyDetail="Add salespeople under Salespeople. Routing cannot assign a lead until at least one exists."
            columns={teamColumns}
          />
        )}
      </Section>
    </Page>
  );
}

const riskColumns: Column<Lead>[] = [
  {
    key: 'contact',
    header: 'Contact',
    width: 220,
    sortValue: (lead) => lead.contact.name || lead.contact.phoneE164,
    render: (lead) => (
      <Text size="small" weight="semibold" autoDirection numberOfLines={1}>
        {lead.contact.name || lead.contact.phoneE164}
      </Text>
    ),
  },
  {
    key: 'score',
    header: 'Score',
    width: 90,
    numeric: true,
    sortValue: (lead) => lead.leadScore,
    render: (lead) => (
      <Text size="small" weight="semibold" numeric tone={lead.leadScore === null ? 'faint' : 'default'}>
        {lead.leadScore ?? '—'}
      </Text>
    ),
  },
  {
    key: 'temperature',
    header: 'Temp',
    width: 120,
    sortValue: (lead) => lead.temperature,
    render: (lead) => <Temperature value={lead.temperature} />,
  },
  {
    key: 'assignee',
    header: 'Assigned to',
    width: 190,
    sortValue: (lead) => lead.assignment?.salespersonName ?? null,
    render: (lead) => (
      <Text size="small" tone={lead.assignment ? 'default' : 'faint'} numberOfLines={1}>
        {lead.assignment?.salespersonName || 'Unassigned'}
      </Text>
    ),
  },
  {
    key: 'waiting',
    header: 'Waiting',
    width: 120,
    numeric: true,
    sortValue: (lead) => (lead.assignment ? -Date.parse(lead.assignment.assignedAt) : null),
    render: (lead) => {
      const since = lead.assignment?.assignedAt ?? null;
      const waited = since ? (Date.now() - Date.parse(since)) / 1000 : 0;
      return (
        <Text
          size="small"
          weight="semibold"
          numeric
          style={{ color: waited >= PAST_SLA_SECONDS ? color.alert : color.inkMuted }}
        >
          {queueClock(since)}
        </Text>
      );
    },
  },
];

type TeamRow = ReturnType<typeof useSalespeople>['data'] extends { salespeople: (infer T)[] } | undefined ? T : never;

const teamColumns: Column<TeamRow>[] = [
  {
    key: 'name',
    header: 'Salesperson',
    width: 200,
    sortValue: (person) => person.name,
    render: (person) => (
      <View style={{ gap: 1 }}>
        <Text size="small" weight="semibold" numberOfLines={1}>
          {person.name}
        </Text>
        {person.active ? null : (
          <Text size="micro" tone="faint">
            inactive
          </Text>
        )}
      </View>
    ),
  },
  {
    key: 'load',
    header: 'Active / capacity',
    width: 150,
    numeric: true,
    sortValue: (person) => person.activeAssignmentCount / Math.max(1, person.capacityLimit),
    render: (person) => {
      const full = person.activeAssignmentCount >= person.capacityLimit;
      return (
        <Text size="small" weight="semibold" numeric style={full ? { color: color.warning } : undefined}>
          {person.activeAssignmentCount} / {person.capacityLimit}
        </Text>
      );
    },
  },
  {
    key: 'overdue',
    header: 'Overdue',
    width: 110,
    numeric: true,
    sortValue: (person) => person.overdueAssignmentCount,
    render: (person) => (
      <Text
        size="small"
        weight={person.overdueAssignmentCount > 0 ? 'bold' : 'regular'}
        numeric
        style={person.overdueAssignmentCount > 0 ? { color: color.alert } : undefined}
      >
        {person.overdueAssignmentCount}
      </Text>
    ),
  },
  {
    key: 'acknowledged',
    header: 'Acknowledged',
    width: 140,
    numeric: true,
    sortValue: (person) => person.acknowledgedCount,
    render: (person) => (
      <Text size="small" numeric>
        {person.acknowledgedCount}
      </Text>
    ),
  },
  {
    key: 'avgAck',
    header: 'Avg to ack',
    width: 130,
    numeric: true,
    sortValue: (person) => person.avgAcknowledgementSeconds,
    render: (person) => (
      <Text size="small" numeric tone={person.avgAcknowledgementSeconds === null ? 'faint' : 'default'}>
        {person.avgAcknowledgementSeconds === null ? '—' : duration(person.avgAcknowledgementSeconds)}
      </Text>
    ),
  },
  {
    key: 'priority',
    header: 'Priority',
    width: 100,
    numeric: true,
    sortValue: (person) => person.priorityRank,
    render: (person) => (
      <Text size="small" numeric tone="muted">
        {person.priorityRank}
      </Text>
    ),
  },
];
