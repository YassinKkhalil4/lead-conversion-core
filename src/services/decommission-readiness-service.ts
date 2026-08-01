import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';

export interface DecommissionCheck {
  area: 'n8n' | 'typebot' | 'airtable';
  checkKey: string;
  status: 'pass' | 'warn' | 'fail';
  details: Record<string, unknown>;
}

export interface DecommissionReadinessOptions {
  directStabilityDays?: number;
  minCompletedEdgeQualifications?: number;
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
    newLegacyConversationCount: number;
    activeLegacyConversationCount: number;
    directIngressStableEventCount: number;
    directIngressUnresolvedCount: number;
    activeConfigurationCount: number;
    completedEdgeQualificationCount: number;
    airtableProjectionBlockedCount: number;
    airtableReconciliationResultCount: number;
    airtableReconciliationFailureCount: number;
  };
  checks: DecommissionCheck[];
}

function passFail(condition: boolean): 'pass' | 'fail' {
  return condition ? 'pass' : 'fail';
}

function areaReady(checks: DecommissionCheck[], area: DecommissionCheck['area']): boolean {
  return checks.filter((check) => check.area === area).every((check) => check.status === 'pass');
}

async function scalar(sql: string, values: unknown[] = []): Promise<number> {
  const result = await pool.query<{ count: number }>(sql, values);
  return result.rows[0]?.count || 0;
}

export class DecommissionReadinessService {
  async report(options: DecommissionReadinessOptions = {}): Promise<DecommissionReadinessReport> {
    const directStabilityDays = options.directStabilityDays ?? 14;
    const minCompletedEdgeQualifications = options.minCompletedEdgeQualifications ?? 100;
    const env = getEnv();

    const [
      legacyEdgeOutboxOpenCount,
      n8nScheduledAuthorityCount,
      n8nInboxUnresolvedCount,
      n8nInboxRecentCount,
      newLegacyConversationCount,
      activeLegacyConversationCount,
      directIngressStableEventCount,
      directIngressUnresolvedCount,
      activeConfigurationCount,
      completedEdgeQualificationCount,
      airtableProjectionBlockedCount,
      airtableReconciliationResultCount,
      airtableReconciliationFailureCount,
    ] = await Promise.all([
      scalar("SELECT count(*)::int AS count FROM edge_outbox WHERE status IN ('pending','processing','failed','dead_lettered')"),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.scheduled_jobs
         WHERE status IN ('pending','processing','retryable')
           AND (job_type ILIKE '%n8n%' OR payload_json::text ILIKE '%n8n%')`,
      ),
      scalar("SELECT count(*)::int AS count FROM runtime.inbox_events WHERE provider='n8n' AND status IN ('pending','processing','retryable')"),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider='n8n'
           AND created_at >= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
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
           AND status='processed'
           AND created_at <= now() - make_interval(days => $1)`,
        [directStabilityDays],
      ),
      scalar(
        `SELECT count(*)::int AS count
         FROM runtime.inbox_events
         WHERE provider IN ('meta','website','facebook')
           AND status IN ('pending','processing','retryable','dead_lettered')`,
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
           AND state IN ('pending','processing','retryable','delivery_unknown','permanently_failed','dead_lettered')`,
      ),
      scalar('SELECT count(*)::int AS count FROM migration.reconciliation_results'),
      scalar("SELECT count(*)::int AS count FROM migration.reconciliation_results WHERE status='fail'"),
    ]);

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
        checkKey: 'direct_ingress_stable',
        status: passFail(directIngressStableEventCount > 0 && directIngressUnresolvedCount === 0),
        details: { stableEventCount: directIngressStableEventCount, unresolvedCount: directIngressUnresolvedCount, requiredDays: directStabilityDays },
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
        status: passFail(airtableReconciliationResultCount > 0 && airtableReconciliationFailureCount === 0),
        details: { resultCount: airtableReconciliationResultCount, failureCount: airtableReconciliationFailureCount },
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
      thresholds: { directStabilityDays, minCompletedEdgeQualifications },
      summary,
      metrics: {
        legacyEdgeOutboxOpenCount,
        n8nScheduledAuthorityCount,
        n8nInboxUnresolvedCount,
        n8nInboxRecentCount,
        newLegacyConversationCount,
        activeLegacyConversationCount,
        directIngressStableEventCount,
        directIngressUnresolvedCount,
        activeConfigurationCount,
        completedEdgeQualificationCount,
        airtableProjectionBlockedCount,
        airtableReconciliationResultCount,
        airtableReconciliationFailureCount,
      },
      checks,
    };
  }
}
