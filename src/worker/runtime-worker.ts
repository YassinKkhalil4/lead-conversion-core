import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import {
  InboxRepository,
  JobRepository,
  RuntimeOutboxRepository,
  WorkerHeartbeatRepository,
  type ClaimedInboxEvent,
  type ClaimedJob,
  type ClaimedOutboxCommand,
  type WorkerLease,
} from '../infrastructure/runtime.js';

function leaseOf(claimed: { workerId: string; attemptCount: number }): WorkerLease {
  return { workerId: claimed.workerId, attemptCount: claimed.attemptCount };
}

export type InboxProcessingResult =
  | { outcome: 'processed' }
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'retryable'; error: string }
  | { outcome: 'dead_lettered'; reason: string };

export type OutboxDispatchResult =
  | { outcome: 'delivered'; providerMessageId: string }
  | { outcome: 'retryable'; error: string; retryAfterSeconds?: number }
  | { outcome: 'permanently_failed'; error: string }
  | { outcome: 'delivery_unknown'; error: string };

export type JobProcessingResult =
  | { outcome: 'completed' }
  | { outcome: 'retryable'; error: string }
  | { outcome: 'dead_lettered'; reason: string };

export interface RuntimeWorkerHandlers {
  processInbox?: (event: ClaimedInboxEvent) => Promise<InboxProcessingResult>;
  dispatchOutbox?: (command: ClaimedOutboxCommand) => Promise<OutboxDispatchResult>;
  processJob?: (job: ClaimedJob) => Promise<JobProcessingResult>;
}

export interface RuntimeWorkerOptions {
  batchSize?: number;
  leaseSeconds?: number;
  idleSleepMs?: number;
  /** First pause after a failed tick; doubles per consecutive failure. */
  errorBackoffMs?: number;
  maxErrorBackoffMs?: number;
  heartbeatIntervalMs?: number;
  enabled?: boolean;
  inboxEventTypes?: string[];
  inboxProviders?: string[];
}

export class RuntimeWorker {
  private stopping = false;
  private loop: Promise<void> | null = null;
  private readonly wake = new AbortController();
  private readonly env = getEnv();
  private readonly workerName = this.env.WORKER_NAME || `${this.env.WORKER_KIND}-${hostname()}-${process.pid}`;
  private readonly startedAt = new Date().toISOString();
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly idleSleepMs: number;
  private readonly errorBackoffMs: number;
  private readonly maxErrorBackoffMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly enabled: boolean;
  private readonly inboxEventTypes: string[];
  private readonly inboxProviders: string[];
  private lastHeartbeatAt = 0;

  constructor(
    private readonly handlers: RuntimeWorkerHandlers = {},
    options: RuntimeWorkerOptions = {},
    private readonly inbox = new InboxRepository(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly jobs = new JobRepository(),
    private readonly heartbeats = new WorkerHeartbeatRepository(),
  ) {
    this.batchSize = options.batchSize || 20;
    this.leaseSeconds = options.leaseSeconds || 60;
    this.idleSleepMs = options.idleSleepMs || 1_000;
    this.errorBackoffMs = options.errorBackoffMs || 1_000;
    this.maxErrorBackoffMs = options.maxErrorBackoffMs || 30_000;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
    this.enabled = options.enabled ?? this.env.RUNTIME_WORKER_ENABLED;
    this.inboxEventTypes = options.inboxEventTypes || [];
    this.inboxProviders = options.inboxProviders || [];
  }

  /**
   * Resolves once the batch in flight has recorded its outcomes. The pool must
   * stay open until then: closing it under a dispatch that the provider has
   * already accepted would leave the command to be sent again after its lease
   * expires.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.wake.abort();
    await this.loop;
  }

  run(): Promise<void> {
    this.loop ??= this.runLoop();
    return this.loop;
  }

  /**
   * A failed tick — the database restarting, a dropped connection — is logged
   * and retried with backoff instead of ending the process. Rows claimed in a
   * failed tick keep their lease and are picked up again when it expires.
   */
  private async runLoop(): Promise<void> {
    logger.info({ enabled: this.enabled }, 'Runtime worker started');
    let consecutiveFailures = 0;
    while (!this.stopping) {
      let pauseMs = 0;
      try {
        const processed = await this.tick();
        consecutiveFailures = 0;
        if (processed === 0) pauseMs = this.idleSleepMs;
      } catch (error) {
        consecutiveFailures += 1;
        pauseMs = Math.min(this.maxErrorBackoffMs, this.errorBackoffMs * 2 ** (consecutiveFailures - 1));
        logger.error({ error, consecutiveFailures, retryInMs: pauseMs }, 'Runtime worker tick failed');
      }
      if (pauseMs > 0) await this.pause(pauseMs);
    }
    logger.info('Runtime worker stopped');
  }

  private async pause(ms: number): Promise<void> {
    if (this.stopping) return;
    await sleep(ms, undefined, { signal: this.wake.signal }).catch(() => undefined);
  }

  async tick(): Promise<number> {
    await this.heartbeat();
    if (!this.enabled) return 0;

    let processed = 0;
    if (this.handlers.processInbox) processed += await this.processInboxBatch();
    if (this.handlers.dispatchOutbox) processed += await this.processOutboxBatch();
    if (this.handlers.processJob) processed += await this.processJobBatch();
    return processed;
  }

  private async heartbeat(): Promise<void> {
    const now = Date.now();
    if (this.lastHeartbeatAt > 0 && now - this.lastHeartbeatAt < this.heartbeatIntervalMs) return;
    await this.heartbeats.beat({
      workerName: this.workerName,
      workerKind: 'runtime',
      startedAt: this.startedAt,
      metadata: {
        enabled: this.enabled,
        inboxProcessorConfigured: Boolean(this.handlers.processInbox),
        inboxEventTypes: this.inboxEventTypes,
        inboxProviders: this.inboxProviders,
        outboxDispatcherConfigured: Boolean(this.handlers.dispatchOutbox),
        jobProcessorConfigured: Boolean(this.handlers.processJob),
      },
    });
    // Only after a successful write, so a failed heartbeat is retried on the
    // next tick instead of leaving readiness stale for a whole interval.
    this.lastHeartbeatAt = now;
  }

  private async processInboxBatch(): Promise<number> {
    const handler = this.handlers.processInbox;
    if (!handler) return 0;
    const events = await this.inbox.claim(this.workerName, this.batchSize, this.leaseSeconds, {
      eventTypes: this.inboxEventTypes,
      providers: this.inboxProviders,
    });
    for (const event of events) {
      const lease = leaseOf(event);
      let recorded: boolean;
      try {
        const result = await handler(event);
        recorded = result.outcome === 'processed'
          ? await this.inbox.complete(event.inboxEventId, lease)
          : result.outcome === 'ignored'
            ? await this.inbox.ignore(event.inboxEventId, result.reason, lease)
            : result.outcome === 'retryable'
              ? await this.inbox.retry(event.inboxEventId, result.error, lease)
              : await this.inbox.deadLetter(event.inboxEventId, result.reason, lease);
      } catch (error) {
        recorded = await this.inbox.retry(event.inboxEventId, String(error), lease);
      }
      if (!recorded) this.leaseLost('inbox', event.inboxEventId, lease);
    }
    return events.length;
  }

  private async processOutboxBatch(): Promise<number> {
    const dispatcher = this.handlers.dispatchOutbox;
    if (!dispatcher) return 0;
    const commands = await this.outbox.claim(this.workerName, this.batchSize, this.leaseSeconds);
    for (const command of commands) {
      const lease = leaseOf(command);
      let recorded: boolean;
      try {
        const result = await dispatcher(command);
        recorded = result.outcome === 'delivered'
          ? await this.outbox.markDelivered(command.outboxCommandId, result.providerMessageId, lease)
          : result.outcome === 'retryable'
            ? await this.outbox.markRetryable(command.outboxCommandId, result.error, result.retryAfterSeconds, lease)
            : result.outcome === 'permanently_failed'
              ? await this.outbox.markPermanentlyFailed(command.outboxCommandId, result.error, lease)
              : await this.outbox.markDeliveryUnknown(command.outboxCommandId, result.error, lease);
      } catch (error) {
        recorded = await this.outbox.markRetryable(command.outboxCommandId, String(error), undefined, lease);
      }
      if (!recorded) this.leaseLost('outbox', command.outboxCommandId, lease);
    }
    return commands.length;
  }

  private async processJobBatch(): Promise<number> {
    const processor = this.handlers.processJob;
    if (!processor) return 0;
    const jobs = await this.jobs.claim(this.workerName, this.batchSize, this.leaseSeconds);
    for (const job of jobs) {
      const lease = leaseOf(job);
      let recorded: boolean;
      try {
        const result = await processor(job);
        recorded = result.outcome === 'completed'
          ? await this.jobs.complete(job.scheduledJobId, lease)
          : result.outcome === 'retryable'
            ? await this.jobs.retry(job.scheduledJobId, result.error, lease)
            : await this.jobs.deadLetter(job.scheduledJobId, result.reason, lease);
      } catch (error) {
        recorded = await this.jobs.retry(job.scheduledJobId, String(error), lease);
      }
      if (!recorded) this.leaseLost('job', job.scheduledJobId, lease);
    }
    return jobs.length;
  }

  /**
   * The row was reclaimed, replayed or cancelled while this worker held it, so
   * its outcome was not recorded. Whoever owns the row now decides it. For an
   * outbox command this can mean the provider saw the request twice; the
   * idempotency key sent with it is what makes that safe.
   */
  private leaseLost(kind: 'inbox' | 'outbox' | 'job', id: string, lease: WorkerLease): void {
    logger.warn({ kind, id, attempt: lease.attemptCount, worker: lease.workerId }, 'lease_lost');
  }
}
