import { getEnv } from '../config/env.js';
import type { Env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { workerHeartbeatOperationalState } from './worker-heartbeat-readiness.js';

export interface DecommissionCheck {
  area: 'n8n' | 'typebot' | 'airtable';
  checkKey: string;
  status: 'pass' | 'warn' | 'fail';
  details: Record<string, unknown>;
}

export interface DecommissionReadinessOptions {
  directStabilityDays?: number;
  minCompletedEdgeQualifications?: number;
  maxWorkerHeartbeatAgeSeconds?: number;
  ownerApprovedN8n?: boolean;
  ownerApprovedTypebot?: boolean;
  ownerApprovedAirtable?: boolean;
  finalLegacyExportComplete?: boolean;
  finalAirtableExportComplete?: boolean;
  appointmentMediaMigrated?: boolean;
  airtableProjectionOnlyVerified?: boolean;
}

export interface DecommissionReadinessReport {
  ok: boolean;
  generatedAt: string;
  thresholds: {
    directStabilityDays: number;
    minCompletedEdgeQualifications: number;
    maxWorkerHeartbeatAgeSeconds: number;
  };
  summary: {
    n8nReady: boolean;
    typebotReady: boolean;
    airtableReady: boolean;
  };
  metrics: {
    legacyEdgeOutboxOpenCount: number;
    n8nScheduledAuthorityCount: number;
    n8nInboxUnresolvedCount: number;
    n8nInboxRecentCount: number;
    n8nRejectedSalespersonCommandCount: number;
    newLegacyConversationCount: number;
    activeLegacyConversationCount: number;
    directIngressStableEventCount: number;
    directMetaStableEventCount: number;
    directLeadStableEventCount: number;
    directIngressUnresolvedCount: number;
    activeConfigurationCount: number;
    completedEdgeQualificationCount: number;
    airtableProjectionBlockedCount: number;
    airtableReconciliationResultCount: number;
    airtableReconciliationFailureCount: number;
  };
  workerHeartbeat: {
    latestWorkerName: string;
    heartbeatAgeSeconds: number | null;
    operational: boolean;
  };
  checks: DecommissionCheck[];
}

function passFail(condition: boolean): 'pass' | 'fail' {
  return condition ? 'pass' : 'fail';
}

function areaReady(checks: DecommissionCheck[], area: DecommissionCheck['area']): boolean {
  return checks.filter((check) => check.area === area).every((check) => check.status === 'pass');
}

const directIngressBusinessEventTypes = ['whatsapp.message_received', 'lead.created', 'leadgen.created'];

export const REQUIRED_AIRTABLE_RECONCILIATION_CHECK_KEYS = [
  'rejected_records',
  'clients_mapped',
  'projects_mapped',
  'salespeople_mapped',
  'leads_mapped',
  'qualifications_mapped',
  'scores_mapped',
  'messages_mapped',
  'followups_mapped',
  'appointments_mapped',
  'events_mapped',
  'contact_phone_uniqueness',
  'lead_contact_links',
  'lead_status_distribution',
  'active_leads_count',
  'stop_follow_up_count',
  'opt_out_count',
  'pending_followups_count',
  'open_booked_appointments_count',
  'message_provider_id_uniqueness',
] as const;

async function scalar(sql: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ count: number }>(sql, values);
  return result.rows[0]?.count || 0;
}

export class DecommissionReadinessService {
  constructor(private readonly envProvider: () => Env = getEnv) {}

  async report(options: DecommissionReadinessOptions = {}): Promise<DecommissionReadinessReport> {
    const directStabilityDays = options.directStabilityDays ?? 14;
    const minCompletedEdgeQualifications = options.minCompletedEdgeQualifications ?? 100;
    const maxWorkerHeartbeatAgeSeconds = options.maxWorkerHeartbeatAgeSeconds ?? 120;
    const env = this.envProvider();
    const directIngressCurrentlyEnabled = env.RUNTIME_WORKER_ENABLED
      && (env.DIRECT_META_WEBHOOK_ENABLED || env.DIRECT_LEAD_INGRESS_ENABLED);

    const [
      legacyEdgeOutboxOpenCount,
      n8nScheduledAuthorityCount,
      n8nInboxUnresolvedCount,
      n8nInboxRecentCount,
      n8nRejectedSalespersonCommandCount,
      newLegacyConversationCount,
      activeLegacyConversationCount,
      directIngressStableEventCount,
      directMetaStableEventCount,
      directLeadStableEventCount,
      directIngressUnresolvedCount,
      activeConfigurationCount,
      completedEdgeQualificationCount,
      airtableProjectionBlockedCount,
      airtableReconciliationResultCount,
      airtableReconciliationFailureCount,
      airtableRequiredReconciliationKeys,
      heartbeat,
    ] = await Promise.all([
      scalar("SELECT count(*)::int AS count FROM edge_outbox WHERE status IN ('pending','processing','failed','parked','dead_lettered')"),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.scheduled_jobs
         WHERE status IN ('pending','processing','retryable')
           AND (job_type ILIKE '%n8n%' OR payload_json::text ILIKE '%n8n%')`,
      ),
      scalar("SELECT count(*)::int AS count FROM runtime.inbox_events WHERE provider='n8n' AND status IN ('pending','processing','retryable','dead_lettered')"),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider='n8n'
           AND created_at >= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
      scalar("SELECT count(*)::int AS count FROM app.salesperson_commands WHERE provider='n8n' AND status='rejected'"),
      scalar(
        `SELECT count(*)::int AS count
         FROM edge_conversations
         WHERE (conversation_engine='legacy' OR state_authority='legacy')
           AND created_at >= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM edge_conversations
         WHERE (conversation_engine='legacy' OR state_authority='legacy')
           AND status NOT IN ('completed','closed','lost','not_interested','opted_out','archived')`,
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider IN ('meta','website','facebook')
           AND event_type = ANY($2::text[])
           AND status='processed'
           AND created_at <= now() - make_interval(days => $1)`,
        [directStabilityDays, directIngressBusinessEventTypes],
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider='meta'
           AND event_type='whatsapp.message_received'
           AND status='processed'
           AND created_at <= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider IN ('website','facebook')
           AND event_type IN ('lead.created','leadgen.created')
           AND status='processed'
           AND created_at <= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider IN ('meta','website','facebook')
           AND event_type = ANY($1::text[])
           AND status IN ('pending','processing','retryable','dead_lettered')`,
        [directIngressBusinessEventTypes],
      ),
      scalar('SELECT count(*)::int AS count FROM configuration.active_versions'),
      scalar(
        `SELECT count(*)::int AS count
         FROM app.qualification_sessions
         WHERE status='completed'
           AND completed_at IS NOT NULL`,
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.outbox_commands
         WHERE command_type='airtable.project_lead_visibility'
           AND state IN ('pending','processing','retryable','delivery_unknown','permanently_failed','cancelled','dead_lettered')`,
      ),
      scalar('SELECT count(*)::int AS count FROM migration.reconciliation_results'),
      scalar("SELECT count(*)::int AS count FROM migration.reconciliation_results WHERE status <> 'pass'"),
      pool.query<{ check_key: string }>(
        `SELECT DISTINCT check_key
         FROM migration.reconciliation_results
         WHERE check_key = ANY($1::text[])`,
        [REQUIRED_AIRTABLE_RECONCILIATION_CHECK_KEYS],
      ),
      pool.query<{ worker_name: string; heartbeat_age_seconds: number | null; metadata_json: Record<string, unknown> }>(
        `SELECT
           worker_name,
           EXTRACT(EPOCH FROM now() - heartbeat_at)::int AS heartbeat_age_seconds,
           metadata_json
         FROM runtime.worker_heartbeats
         WHERE worker_kind='runtime'
         ORDER BY heartbeat_at DESC
         LIMIT 1`,
      ),
    ]);
    const heartbeatRow = heartbeat.rows[0] || null;
    const heartbeatAgeSeconds = heartbeatRow?.heartbeat_age_seconds ?? null;
    const runtimeOperationalState = heartbeatRow
      ? workerHeartbeatOperationalState('runtime', heartbeatRow.metadata_json)
      : { operational: false, metadata: {} };
    const inboxEventTypes = Array.isArray(runtimeOperationalState.metadata.inboxEventTypes)
      ? runtimeOperationalState.metadata.inboxEventTypes.filter((value): value is string => typeof value === 'string')
      : [];
    const inboxProviders = Array.isArray(runtimeOperationalState.metadata.inboxProviders)
      ? runtimeOperationalState.metadata.inboxProviders.filter((value): value is string => typeof value === 'string')
      : [];
    const directMetaProcessorConfigured = inboxEventTypes.includes('whatsapp.message_status')
      && inboxEventTypes.includes('whatsapp.message_received')
      && inboxEventTypes.includes('whatsapp.webhook_ignored')
      && inboxProviders.includes('meta');
    const directLeadProcessorConfigured = inboxEventTypes.includes('lead.created')
      && inboxEventTypes.includes('leadgen.created')
      && inboxProviders.includes('website')
      && inboxProviders.includes('facebook');
    const directIngressWorkerOperational = directIngressCurrentlyEnabled
      && heartbeatAgeSeconds !== null
      && heartbeatAgeSeconds <= maxWorkerHeartbeatAgeSeconds
      && runtimeOperationalState.operational
      && (!env.DIRECT_META_WEBHOOK_ENABLED || directMetaProcessorConfigured)
      && (!env.DIRECT_LEAD_INGRESS_ENABLED || directLeadProcessorConfigured);
    const directIngressStable = directIngressUnresolvedCount === 0
      && (!env.DIRECT_META_WEBHOOK_ENABLED || directMetaStableEventCount > 0)
      && (!env.DIRECT_LEAD_INGRESS_ENABLED || directLeadStableEventCount > 0);
    const presentAirtableReconciliationKeys = new Set(airtableRequiredReconciliationKeys.rows.map((row) => row.check_key));
    const missingAirtableReconciliationKeys = REQUIRED_AIRTABLE_RECONCILIATION_CHECK_KEYS
      .filter((checkKey) => !presentAirtableReconciliationKeys.has(checkKey));
    const airtableReconciliationStable = airtableReconciliationResultCount > 0
      && airtableReconciliationFailureCount === 0
      && missingAirtableReconciliationKeys.length === 0;

    const checks: DecommissionCheck[] = [
      {
        area: 'n8n',
        checkKey: 'legacy_edge_outbox_drained',
        status: passFail(legacyEdgeOutboxOpenCount === 0),
        details: { count: legacyEdgeOutboxOpenCount },
      },
      {
        area: 'n8n',
        checkKey: 'no_n8n_scheduled_authority',
        status: passFail(n8nScheduledAuthorityCount === 0),
        details: { count: n8nScheduledAuthorityCount },
      },
      {
        area: 'n8n',
        checkKey: 'no_unresolved_n8n_inbox',
        status: passFail(n8nInboxUnresolvedCount === 0),
        details: { count: n8nInboxUnresolvedCount },
      },
      {
        area: 'n8n',
        checkKey: 'no_recent_n8n_compat_usage',
        status: passFail(n8nInboxRecentCount === 0),
        details: { count: n8nInboxRecentCount, windowDays: directStabilityDays },
      },
      {
        area: 'n8n',
        checkKey: 'no_rejected_n8n_salesperson_commands',
        status: passFail(n8nRejectedSalespersonCommandCount === 0),
        details: { count: n8nRejectedSalespersonCommandCount },
      },
      {
        area: 'n8n',
        checkKey: 'no_new_legacy_conversations',
        status: passFail(newLegacyConversationCount === 0),
        details: { count: newLegacyConversationCount, windowDays: directStabilityDays },
      },
      {
        area: 'n8n',
        checkKey: 'no_active_legacy_conversations',
        status: passFail(activeLegacyConversationCount === 0),
        details: { count: activeLegacyConversationCount },
      },
      {
        area: 'n8n',
        checkKey: 'active_turn_compat_disabled',
        status: passFail(!env.ACTIVE_TURN_COMPAT_ENABLED),
        details: { enabled: env.ACTIVE_TURN_COMPAT_ENABLED },
      },
      {
        area: 'n8n',
        checkKey: 'n8n_compatibility_routes_disabled',
        status: passFail(!env.N8N_COMPAT_ROUTES_ENABLED),
        details: { enabled: env.N8N_COMPAT_ROUTES_ENABLED },
      },
      {
        area: 'n8n',
        checkKey: 'direct_ingress_stable',
        status: passFail(directIngressStable),
        details: {
          stableEventCount: directIngressStableEventCount,
          directMetaStableEventCount,
          directLeadStableEventCount,
          directMetaWebhookEnabled: env.DIRECT_META_WEBHOOK_ENABLED,
          directLeadIngressEnabled: env.DIRECT_LEAD_INGRESS_ENABLED,
          unresolvedCount: directIngressUnresolvedCount,
          requiredDays: directStabilityDays,
        },
      },
      {
        area: 'n8n',
        checkKey: 'direct_ingress_currently_enabled',
        status: passFail(directIngressCurrentlyEnabled),
        details: {
          directMetaWebhookEnabled: env.DIRECT_META_WEBHOOK_ENABLED,
          directLeadIngressEnabled: env.DIRECT_LEAD_INGRESS_ENABLED,
          runtimeWorkerEnabled: env.RUNTIME_WORKER_ENABLED,
        },
      },
      {
        area: 'n8n',
        checkKey: 'direct_ingress_worker_operational',
        status: passFail(directIngressWorkerOperational),
        details: {
          latestWorkerName: heartbeatRow?.worker_name || '',
          heartbeatAgeSeconds,
          maxWorkerHeartbeatAgeSeconds,
          operational: runtimeOperationalState.operational,
          directMetaProcessorConfigured,
          directLeadProcessorConfigured,
          inboxEventTypes,
          inboxProviders,
        },
      },
      {
        area: 'n8n',
        checkKey: 'final_legacy_export_complete',
        status: passFail(Boolean(options.finalLegacyExportComplete)),
        details: { ownerRecorded: Boolean(options.finalLegacyExportComplete) },
      },
      {
        area: 'n8n',
        checkKey: 'owner_approved_n8n_decommission',
        status: passFail(Boolean(options.ownerApprovedN8n)),
        details: { ownerRecorded: Boolean(options.ownerApprovedN8n) },
      },
      {
        area: 'typebot',
        checkKey: 'no_resumable_legacy_sessions',
        status: passFail(activeLegacyConversationCount === 0),
        details: { count: activeLegacyConversationCount },
      },
      {
        area: 'typebot',
        checkKey: 'versioned_config_active',
        status: passFail(activeConfigurationCount > 0),
        details: { count: activeConfigurationCount },
      },
      {
        area: 'typebot',
        checkKey: 'edge_qualification_volume',
        status: passFail(completedEdgeQualificationCount >= minCompletedEdgeQualifications),
        details: { count: completedEdgeQualificationCount, required: minCompletedEdgeQualifications },
      },
      {
        area: 'typebot',
        checkKey: 'appointment_media_paths_migrated',
        status: passFail(Boolean(options.appointmentMediaMigrated)),
        details: { ownerRecorded: Boolean(options.appointmentMediaMigrated) },
      },
      {
        area: 'typebot',
        checkKey: 'owner_approved_typebot_decommission',
        status: passFail(Boolean(options.ownerApprovedTypebot)),
        details: { ownerRecorded: Boolean(options.ownerApprovedTypebot) },
      },
      {
        area: 'airtable',
        checkKey: 'airtable_projection_only_verified',
        status: passFail(Boolean(options.airtableProjectionOnlyVerified)),
        details: { ownerRecorded: Boolean(options.airtableProjectionOnlyVerified) },
      },
      {
        area: 'airtable',
        checkKey: 'airtable_projection_outbox_stable',
        status: passFail(airtableProjectionBlockedCount === 0),
        details: { blockedCount: airtableProjectionBlockedCount },
      },
      {
        area: 'airtable',
        checkKey: 'airtable_reconciliation_stable',
        status: passFail(airtableReconciliationStable),
        details: {
          resultCount: airtableReconciliationResultCount,
          nonPassCount: airtableReconciliationFailureCount,
          requiredCheckKeys: [...REQUIRED_AIRTABLE_RECONCILIATION_CHECK_KEYS],
          missingCheckKeys: missingAirtableReconciliationKeys,
        },
      },
      {
        area: 'airtable',
        checkKey: 'final_airtable_export_complete',
        status: passFail(Boolean(options.finalAirtableExportComplete)),
        details: { ownerRecorded: Boolean(options.finalAirtableExportComplete) },
      },
      {
        area: 'airtable',
        checkKey: 'owner_approved_airtable_decommission',
        status: passFail(Boolean(options.ownerApprovedAirtable)),
        details: { ownerRecorded: Boolean(options.ownerApprovedAirtable) },
      },
    ];

    const summary = {
      n8nReady: areaReady(checks, 'n8n'),
      typebotReady: areaReady(checks, 'typebot'),
      airtableReady: areaReady(checks, 'airtable'),
    };

    return {
      ok: summary.n8nReady && summary.typebotReady && summary.airtableReady,
      generatedAt: new Date().toISOString(),
      thresholds: { directStabilityDays, minCompletedEdgeQualifications, maxWorkerHeartbeatAgeSeconds },
      summary,
      metrics: {
        legacyEdgeOutboxOpenCount,
        n8nScheduledAuthorityCount,
        n8nInboxUnresolvedCount,
        n8nInboxRecentCount,
        n8nRejectedSalespersonCommandCount,
        newLegacyConversationCount,
        activeLegacyConversationCount,
        directIngressStableEventCount,
        directMetaStableEventCount,
        directLeadStableEventCount,
        directIngressUnresolvedCount,
        activeConfigurationCount,
        completedEdgeQualificationCount,
        airtableProjectionBlockedCount,
        airtableReconciliationResultCount,
        airtableReconciliationFailureCount,
      },
      workerHeartbeat: {
        latestWorkerName: heartbeatRow?.worker_name || '',
        heartbeatAgeSeconds,
        operational: runtimeOperationalState.operational,
      },
      checks,
    };
  }
}
