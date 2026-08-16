import pg from 'pg';
import { getEnv } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { pool } from '../../db/pool.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import type { DashboardScope, DashboardUser } from './types.js';

const { Client } = pg;

export const DASHBOARD_CHANNEL = 'dashboard_events';

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 30_000;

export interface DashboardEvent {
  kind: string;
  clientId: string;
  leadId?: string;
  messageId?: string;
  assignmentId?: string;
  salespersonId?: string;
  notificationId?: string;
  recipientType?: string;
  recipientId?: string | null;
  notificationType?: string;
  direction?: string;
  priority?: string;
  status?: string;
}

type Subscriber = {
  user: DashboardUser;
  scope: DashboardScope;
  deliver: (event: DashboardEvent) => void;
};

function parseEvent(payload: string): DashboardEvent | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const kind = typeof record.kind === 'string' ? record.kind : '';
    const clientId = typeof record.clientId === 'string' ? record.clientId : '';
    if (!kind || !clientId) return null;
    return { ...(record as Omit<DashboardEvent, 'kind' | 'clientId'>), kind, clientId };
  } catch {
    return null;
  }
}

/**
 * One dedicated PostgreSQL connection LISTENs on `dashboard_events` and fans
 * notifications out to every open SSE response. Pooled connections cannot be
 * used because LISTEN is per-session state.
 */
export class DashboardEventBus {
  private readonly subscribers = new Set<Subscriber>();
  private listener: pg.Client | null = null;
  private connecting: Promise<void> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  async subscribe(subscriber: Subscriber): Promise<() => void> {
    this.stopped = false;
    this.subscribers.add(subscriber);
    await this.ensureListening();
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  async close(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribers.clear();
    const listener = this.listener;
    this.listener = null;
    if (listener) await listener.end().catch(() => undefined);
  }

  private async ensureListening(): Promise<void> {
    if (this.listener) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect();
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    const client = new Client({
      connectionString: getEnv().DATABASE_URL,
      application_name: 'dashboard-events',
    });
    client.on('error', (error: Error) => {
      logger.error({ error }, 'Dashboard event listener connection failed');
      this.handleDisconnect(client);
    });
    client.on('end', () => this.handleDisconnect(client));
    client.on('notification', (message: pg.Notification) => {
      if (message.channel !== DASHBOARD_CHANNEL || !message.payload) return;
      const event = parseEvent(message.payload);
      if (event) void this.fanOut(event);
    });
    await client.connect();
    await client.query(`LISTEN ${DASHBOARD_CHANNEL}`);
    this.listener = client;
    this.reconnectAttempts = 0;
  }

  private handleDisconnect(client: pg.Client): void {
    if (this.listener !== client) return;
    this.listener = null;
    if (this.stopped || this.subscribers.size === 0) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.reconnectAttempts, 6));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped || this.subscribers.size === 0) return;
      void this.ensureListening().catch((error: unknown) => {
        logger.error({ error }, 'Dashboard event listener reconnect failed');
        this.scheduleReconnect();
      });
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private async fanOut(event: DashboardEvent): Promise<void> {
    const targets = [...this.subscribers].filter((subscriber) => subscriber.scope.clientId === event.clientId);
    if (targets.length === 0) return;
    for (const subscriber of targets) {
      try {
        if (await this.isVisible(subscriber, event)) subscriber.deliver(event);
      } catch (error) {
        logger.error({ error }, 'Dashboard event delivery check failed');
      }
    }
  }

  private async isVisible(subscriber: Subscriber, event: DashboardEvent): Promise<boolean> {
    if (event.kind === 'notification.created') {
      if (subscriber.user.role === 'salesperson') {
        return event.recipientType === 'salesperson' && event.recipientId === subscriber.user.salespersonId;
      }
      return event.recipientType === 'operator';
    }
    if (!subscriber.scope.restrictToOwnLeads) return true;
    if (!event.leadId) return false;
    // Re-check visibility in SQL rather than trusting the payload, so a
    // salesperson can never be pushed an event for someone else's lead.
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', subscriber.scope, params);
    const leadParam = params.bind(event.leadId);
    const result = await pool.query<{ lead_id: string }>(
      `SELECT l.lead_id FROM app.leads l WHERE (${visibility}) AND l.lead_id = ${leadParam}::uuid`,
      params.list(),
    );
    return Boolean(result.rows[0]);
  }
}

export const dashboardEventBus = new DashboardEventBus();
