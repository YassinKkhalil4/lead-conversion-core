import { pool } from '../../db/pool.js';
import { QueryParams } from './sql.js';
import { badRequest, type DashboardUser, notFound } from './types.js';

export interface NotificationView {
  notificationId: string;
  notificationType: string;
  recipientType: string;
  recipientId: string | null;
  priority: string;
  payload: Record<string, unknown>;
  leadId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface NotificationRow {
  notification_id: string;
  notification_type: string;
  recipient_type: string;
  recipient_id: string | null;
  priority: string;
  payload_json: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
  total_count?: string;
}

function toView(row: NotificationRow): NotificationView {
  const payload = row.payload_json ?? {};
  const leadId = typeof payload.leadId === 'string' && payload.leadId ? payload.leadId : null;
  return {
    notificationId: row.notification_id,
    notificationType: row.notification_type,
    recipientType: row.recipient_type,
    recipientId: row.recipient_id,
    priority: row.priority,
    payload,
    leadId,
    readAt: row.read_at ? row.read_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * A salesperson sees notifications addressed to their own salesperson record.
 * Managers and admins see the operator notifications for their client. Every
 * variant is additionally constrained by client_id in SQL.
 */
function recipientPredicate(user: DashboardUser, params: QueryParams): string {
  const clientParam = params.bind(user.clientId);
  if (user.role === 'salesperson') {
    const salespersonParam = params.bind(user.salespersonId);
    return `n.client_id = ${clientParam}::uuid
            AND n.recipient_type = 'salesperson'
            AND n.recipient_id = ${salespersonParam}::uuid`;
  }
  return `n.client_id = ${clientParam}::uuid AND n.recipient_type = 'operator'`;
}

export class DashboardNotificationService {
  async list(
    user: DashboardUser,
    options: { unreadOnly: boolean; limit: number; offset: number },
  ): Promise<{ notifications: NotificationView[]; total: number; unreadCount: number; limit: number; offset: number }> {
    if (user.role === 'salesperson' && !user.salespersonId) {
      throw badRequest('salesperson_user_missing_salesperson_link');
    }
    const params = new QueryParams();
    const predicate = recipientPredicate(user, params);
    const conditions = [predicate];
    if (options.unreadOnly) conditions.push('n.read_at IS NULL');
    const limitParam = params.bind(options.limit);
    const offsetParam = params.bind(options.offset);

    const result = await pool.query<NotificationRow>(
      `SELECT n.notification_id, n.notification_type, n.recipient_type, n.recipient_id,
              n.priority, n.payload_json, n.read_at, n.created_at,
              count(*) OVER () AS total_count
       FROM app.notifications n
       WHERE ${conditions.map((condition) => `(${condition})`).join(' AND ')}
       ORDER BY (n.read_at IS NULL) DESC, n.created_at DESC, n.notification_id DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params.list(),
    );

    const unreadParams = new QueryParams();
    const unreadPredicate = recipientPredicate(user, unreadParams);
    const unread = await pool.query<{ unread_count: string }>(
      `SELECT count(*) AS unread_count
       FROM app.notifications n
       WHERE (${unreadPredicate}) AND n.read_at IS NULL`,
      unreadParams.list(),
    );

    return {
      notifications: result.rows.map(toView),
      total: Number(result.rows[0]?.total_count ?? 0),
      unreadCount: Number(unread.rows[0]?.unread_count ?? 0),
      limit: options.limit,
      offset: options.offset,
    };
  }

  async markRead(user: DashboardUser, notificationId: string): Promise<NotificationView> {
    const params = new QueryParams();
    const predicate = recipientPredicate(user, params);
    const idParam = params.bind(notificationId);
    const result = await pool.query<NotificationRow>(
      `UPDATE app.notifications n
       SET read_at = COALESCE(n.read_at, now())
       WHERE (${predicate}) AND n.notification_id = ${idParam}::uuid
       RETURNING n.notification_id, n.notification_type, n.recipient_type, n.recipient_id,
                 n.priority, n.payload_json, n.read_at, n.created_at`,
      params.list(),
    );
    const row = result.rows[0];
    if (!row) throw notFound('notification_not_found');
    return toView(row);
  }

  async markAllRead(user: DashboardUser): Promise<number> {
    const params = new QueryParams();
    const predicate = recipientPredicate(user, params);
    const result = await pool.query<{ notification_id: string }>(
      `UPDATE app.notifications n
       SET read_at = now()
       WHERE (${predicate}) AND n.read_at IS NULL
       RETURNING n.notification_id`,
      params.list(),
    );
    return result.rowCount ?? result.rows.length;
  }

  async registerDevice(
    user: DashboardUser,
    input: { platform: 'ios' | 'android' | 'web'; token: string },
  ): Promise<{ deviceTokenId: string; platform: string }> {
    if (!user.salespersonId) throw badRequest('device_registration_requires_salesperson_user');
    const result = await pool.query<{ device_token_id: string; platform: string }>(
      `INSERT INTO app.device_tokens (salesperson_id, platform, token, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (platform, token) DO UPDATE SET
         salesperson_id = EXCLUDED.salesperson_id,
         active = true,
         registered_at = now()
       RETURNING device_token_id, platform`,
      [user.salespersonId, input.platform, input.token],
    );
    const row = result.rows[0];
    if (!row) throw new Error('device_token_not_registered');
    return { deviceTokenId: row.device_token_id, platform: row.platform };
  }

  async deactivateDevice(user: DashboardUser, token: string): Promise<boolean> {
    if (!user.salespersonId) throw badRequest('device_registration_requires_salesperson_user');
    const result = await pool.query<{ device_token_id: string }>(
      `UPDATE app.device_tokens
       SET active = false
       WHERE salesperson_id = $1 AND token = $2 AND active
       RETURNING device_token_id`,
      [user.salespersonId, token],
    );
    return Boolean(result.rows[0]);
  }
}
