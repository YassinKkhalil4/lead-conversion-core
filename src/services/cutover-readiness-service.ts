import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';

export interface ReadinessCheck {
  checkKey: string;
  status: 'pass' | 'warn' | 'fail';
  details: Record<string, unknown>;
}

export interface CutoverReadinessReport {
  ok: boolean;
  generatedAt: string;
  config: {
    directMetaWebhookEnabled: boolean;
    directLeadIngressEnabled: boolean;
    n8nCompatRoutesEnabled: boolean;
    activeTurnCompatEnabled: boolean;
    runtimeWorkerEnabled: boolean;
  };
  queues: {
    inboxPendingCount: number;
    inboxOldestAgeSeconds: number | null;
    outboxPendingCount: number;
    outboxOldestAgeSeconds: number | null;
    scheduledJobPendingCount: number;
    scheduledJobOldestAgeSeconds: number | null;
    deliveryUnknownCount: number;
    deadLetterCount: number;
  };
  workerHeartbeat: {
    latestWorkerName: string;
    heartbeatAgeSeconds: number | null;
  };
  checks: ReadinessCheck[];
}

export interface CutoverReadinessOptions {
  maxPendingInbox?: number;
  maxPendingOutbox?: number;
  maxPendingScheduledJobs?: number;
  maxQueueAgeSeconds?: number;
  maxWorkerHeartbeatAgeSeconds?: number;
}

function backlogStatus(count: number, oldestAgeSeconds: number | null, maxCount: number, maxAgeSeconds: number): 'pass' | 'fail' {
  if (count > maxCount) return 'fail';
  if (oldestAgeSeconds !== null && oldestAgeSeconds > maxAgeSeconds) return 'fail';
  return 'pass';
}

export class CutoverReadinessService {
  async report(options: CutoverReadinessOptions = {}): Promise<CutoverReadinessReport> {
    const env = getEnv();
    const maxPendingInbox = options.maxPendingInbox ?? 0;
    const maxPendingOutbox = options.maxPendingOutbox ?? 0;
    const maxPendingScheduledJobs = options.maxPendingScheduledJobs ?? 0;
    const maxQueueAgeSeconds = options.maxQueueAgeSeconds ?? 300;
    const maxWorkerHeartbeatAgeSeconds = options.maxWorkerHeartbeatAgeSeconds ?? 120;

    const [inbox, outbox, scheduledJobs, deadLetters, heartbeat] = await Promise.all([
      pool.query<{ count: number; oldest_age_seconds: number | null }>(
        `SELECT
           count(*)::int AS count,
           EXTRACT(EPOCH FROM now() - min(created_at))::int AS oldest_age_seconds
         FROM runtime.inbox_events
         WHERE status IN ('pending','processing','retryable')`,
      ),
      pool.query<{
        pending_count: number;
        oldest_age_seconds: number | null;
        delivery_unknown_count: number;
      }>(
        `SELECT
           count(*) FILTER (WHERE state IN ('pending','processing','retryable'))::int AS pending_count,
           EXTRACT(EPOCH FROM now() - (min(created_at) FILTER (WHERE state IN ('pending','processing','retryable'))))::int AS oldest_age_seconds,
           count(*) FILTER (WHERE state='delivery_unknown')::int AS delivery_unknown_count
         FROM runtime.outbox_commands`,
      ),
      pool.query<{ count: number; oldest_age_seconds: number | null }>(
        `SELECT
           count(*)::int AS count,
           EXTRACT(EPOCH FROM now() - min(due_at))::int AS oldest_age_seconds
         FROM runtime.scheduled_jobs
         WHERE status='processing'
            OR (status IN ('pending','retryable') AND due_at <= now())`,
      ),
      pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM runtime.dead_letters
         WHERE replayed_at IS NULL`,
      ),
      pool.query<{ worker_name: string; heartbeat_age_seconds: number | null }>(
        `SELECT
           worker_name,
           EXTRACT(EPOCH FROM now() - heartbeat_at)::int AS heartbeat_age_seconds
         FROM runtime.worker_heartbeats
         WHERE worker_kind='runtime'
         ORDER BY heartbeat_at DESC
         LIMIT 1`,
      ),
    ]);

    const inboxRow = inbox.rows[0] || { count: 0, oldest_age_seconds: null };
    const outboxRow = outbox.rows[0] || { pending_count: 0, oldest_age_seconds: null, delivery_unknown_count: 0 };
    const scheduledJobRow = scheduledJobs.rows[0] || { count: 0, oldest_age_seconds: null };
    const deadLetterCount = deadLetters.rows[0]?.count || 0;
    const heartbeatRow = heartbeat.rows[0] || null;
    const heartbeatAgeSeconds = heartbeatRow?.heartbeat_age_seconds ?? null;

    const checks: ReadinessCheck[] = [
      {
        checkKey: 'direct_meta_webhook_flag',
        status: env.DIRECT_META_WEBHOOK_ENABLED ? 'pass' : 'warn',
        details: { enabled: env.DIRECT_META_WEBHOOK_ENABLED },
      },
      {
        checkKey: 'direct_lead_ingress_flag',
        status: env.DIRECT_LEAD_INGRESS_ENABLED ? 'pass' : 'warn',
        details: { enabled: env.DIRECT_LEAD_INGRESS_ENABLED },
      },
      {
        checkKey: 'n8n_compatibility_flag',
        status: env.N8N_COMPAT_ROUTES_ENABLED ? 'pass' : 'warn',
        details: { enabled: env.N8N_COMPAT_ROUTES_ENABLED },
      },
      {
        checkKey: 'active_turn_compatibility_disabled',
        status: env.ACTIVE_TURN_COMPAT_ENABLED ? 'fail' : 'pass',
        details: { enabled: env.ACTIVE_TURN_COMPAT_ENABLED },
      },
      {
        checkKey: 'inbox_backlog',
        status: backlogStatus(inboxRow.count, inboxRow.oldest_age_seconds, maxPendingInbox, maxQueueAgeSeconds),
        details: { count: inboxRow.count, oldestAgeSeconds: inboxRow.oldest_age_seconds, maxPendingInbox, maxQueueAgeSeconds },
      },
      {
        checkKey: 'outbox_backlog',
        status: backlogStatus(outboxRow.pending_count, outboxRow.oldest_age_seconds, maxPendingOutbox, maxQueueAgeSeconds),
        details: { count: outboxRow.pending_count, oldestAgeSeconds: outboxRow.oldest_age_seconds, maxPendingOutbox, maxQueueAgeSeconds },
      },
      {
        checkKey: 'scheduled_job_backlog',
        status: backlogStatus(scheduledJobRow.count, scheduledJobRow.oldest_age_seconds, maxPendingScheduledJobs, maxQueueAgeSeconds),
        details: { count: scheduledJobRow.count, oldestAgeSeconds: scheduledJobRow.oldest_age_seconds, maxPendingScheduledJobs, maxQueueAgeSeconds },
      },
      {
        checkKey: 'delivery_unknown',
        status: outboxRow.delivery_unknown_count === 0 ? 'pass' : 'fail',
        details: { count: outboxRow.delivery_unknown_count },
      },
      {
        checkKey: 'dead_letters',
        status: deadLetterCount === 0 ? 'pass' : 'fail',
        details: { count: deadLetterCount },
      },
      {
        checkKey: 'runtime_worker_heartbeat',
        status: heartbeatAgeSeconds !== null && heartbeatAgeSeconds <= maxWorkerHeartbeatAgeSeconds
          ? 'pass'
          : env.RUNTIME_WORKER_ENABLED ? 'fail' : 'warn',
        details: { latestWorkerName: heartbeatRow?.worker_name || '', heartbeatAgeSeconds, maxWorkerHeartbeatAgeSeconds },
      },
    ];

    return {
      ok: checks.every((check) => check.status !== 'fail'),
      generatedAt: new Date().toISOString(),
      config: {
        directMetaWebhookEnabled: env.DIRECT_META_WEBHOOK_ENABLED,
        directLeadIngressEnabled: env.DIRECT_LEAD_INGRESS_ENABLED,
        n8nCompatRoutesEnabled: env.N8N_COMPAT_ROUTES_ENABLED,
        activeTurnCompatEnabled: env.ACTIVE_TURN_COMPAT_ENABLED,
        runtimeWorkerEnabled: env.RUNTIME_WORKER_ENABLED,
      },
      queues: {
        inboxPendingCount: inboxRow.count,
        inboxOldestAgeSeconds: inboxRow.oldest_age_seconds,
        outboxPendingCount: outboxRow.pending_count,
        outboxOldestAgeSeconds: outboxRow.oldest_age_seconds,
        scheduledJobPendingCount: scheduledJobRow.count,
        scheduledJobOldestAgeSeconds: scheduledJobRow.oldest_age_seconds,
        deliveryUnknownCount: outboxRow.delivery_unknown_count,
        deadLetterCount,
      },
      workerHeartbeat: {
        latestWorkerName: heartbeatRow?.worker_name || '',
        heartbeatAgeSeconds,
      },
      checks,
    };
  }
}
