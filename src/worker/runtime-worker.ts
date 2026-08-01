import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { getEnv } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pool } from '../db/pool.js';
import {
  InboxRepository,
  JobRepository,
  RuntimeOutboxRepository,
  type ClaimedInboxEvent,
  type ClaimedJob,
  type ClaimedOutboxCommand,
} from '../infrastructure/runtime.js';

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
  enabled?: boolean;
  inboxEventTypes?: string[];
  inboxProviders?: string[];
}

export class RuntimeWorker {
  private running = true;
  private readonly env = getEnv();
  private readonly workerName = this.env.WORKER_NAME || `${this.env.WORKER_KIND}-${hostname()}-${process.pid}`;
  private readonly startedAt = new Date().toISOString();
  private readonly batchSize: number;
  private readonly leaseSeconds: number;
  private readonly idleSleepMs: number;
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
  ) {
    this.batchSize = options.batchSize || 20;
    this.leaseSeconds = options.leaseSeconds || 60;
    this.idleSleepMs = options.idleSleepMs || 1_000;
    this.enabled = options.enabled ?? this.env.RUNTIME_WORKER_ENABLED;
    this.inboxEventTypes = options.inboxEventTypes || [];
    this.inboxProviders = options.inboxProviders || [];
  }

  stop(): void {
    this.running = false;
  }

  async run(): Promise<void> {
    logger.info({ enabled: this.enabled }, 'Runtime worker started');
    while (this.running) {
      const processed = await this.tick();
      if (processed === 0) await sleep(this.idleSleepMs);
    }
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
    if (now - this.lastHeartbeatAt < 15_000) return;
    this.lastHeartbeatAt = now;
    await pool.query(
      `INSERT INTO runtime.worker_heartbeats
        (worker_name, worker_kind, process_id, started_at, heartbeat_at, metadata_json)
       VALUES ($1, $2, $3, $4::timestamptz, now(), $5::jsonb)
       ON CONFLICT (worker_name) DO UPDATE SET
        worker_kind=EXCLUDED.worker_kind,
        process_id=EXCLUDED.process_id,
        heartbeat_at=EXCLUDED.heartbeat_at,
        metadata_json=EXCLUDED.metadata_json`,
      [
        this.workerName,
        'runtime',
        process.pid,
        this.startedAt,
        JSON.stringify({
          enabled: this.enabled,
          inboxProcessorConfigured: Boolean(this.handlers.processInbox),
          inboxEventTypes: this.inboxEventTypes,
          inboxProviders: this.inboxProviders,
          outboxDispatcherConfigured: Boolean(this.handlers.dispatchOutbox),
          jobProcessorConfigured: Boolean(this.handlers.processJob),
        }),
      ],
    );
  }

  private async processInboxBatch(): Promise<number> {
    const handler = this.handlers.processInbox;
    if (!handler) return 0;
    const events = await this.inbox.claim(this.workerName, this.batchSize, this.leaseSeconds, {
      eventTypes: this.inboxEventTypes,
      providers: this.inboxProviders,
    });
    for (const event of events) {
      try {
        const result = await handler(event);
        if (result.outcome === 'processed') await this.inbox.complete(event.inboxEventId);
        if (result.outcome === 'ignored') await this.inbox.ignore(event.inboxEventId, result.reason);
        if (result.outcome === 'retryable') await this.inbox.retry(event.inboxEventId, result.error);
        if (result.outcome === 'dead_lettered') await this.inbox.deadLetter(event.inboxEventId, result.reason);
      } catch (error) {
        await this.inbox.retry(event.inboxEventId, String(error));
      }
    }
    return events.length;
  }

  private async processOutboxBatch(): Promise<number> {
    const dispatcher = this.handlers.dispatchOutbox;
    if (!dispatcher) return 0;
    const commands = await this.outbox.claim(this.workerName, this.batchSize, this.leaseSeconds);
    for (const command of commands) {
      try {
        const result = await dispatcher(command);
        if (result.outcome === 'delivered') await this.outbox.markDelivered(command.outboxCommandId, result.providerMessageId);
        if (result.outcome === 'retryable') {
          await this.outbox.markRetryable(command.outboxCommandId, result.error, result.retryAfterSeconds);
        }
        if (result.outcome === 'permanently_failed') await this.outbox.markPermanentlyFailed(command.outboxCommandId, result.error);
        if (result.outcome === 'delivery_unknown') await this.outbox.markDeliveryUnknown(command.outboxCommandId, result.error);
      } catch (error) {
        await this.outbox.markRetryable(command.outboxCommandId, String(error));
      }
    }
    return commands.length;
  }

  private async processJobBatch(): Promise<number> {
    const processor = this.handlers.processJob;
    if (!processor) return 0;
    const jobs = await this.jobs.claim(this.workerName, this.batchSize, this.leaseSeconds);
    for (const job of jobs) {
      try {
        const result = await processor(job);
        if (result.outcome === 'completed') await this.jobs.complete(job.scheduledJobId);
        if (result.outcome === 'retryable') await this.jobs.retry(job.scheduledJobId, result.error);
        if (result.outcome === 'dead_lettered') await this.jobs.deadLetter(job.scheduledJobId, result.reason);
      } catch (error) {
        await this.jobs.retry(job.scheduledJobId, String(error));
      }
    }
    return jobs.length;
  }
}
