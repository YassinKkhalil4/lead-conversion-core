import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { AuditRepository } from '../../infrastructure/runtime.js';
import { hashPassword, verifyPassword } from './password.js';
import { normalizeEmail } from './session-service.js';
import { badRequest, conflict, type DashboardRole, type DashboardUser, notFound, unauthorized } from './types.js';

type Db = typeof pool | PoolClient;

export interface DashboardUserRecord {
  userId: string;
  clientId: string;
  salespersonId: string | null;
  email: string;
  name: string;
  role: DashboardRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserRow {
  user_id: string;
  client_id: string;
  salesperson_id: string | null;
  email: string;
  name: string;
  role: DashboardRole;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

function toRecord(row: UserRow): DashboardUserRecord {
  return {
    userId: row.user_id,
    clientId: row.client_id,
    salespersonId: row.salesperson_id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const RECORD_COLUMNS = 'user_id, client_id, salesperson_id, email, name, role, active, last_login_at, created_at';

export interface CreateUserInput {
  clientId: string;
  email: string;
  password: string;
  name: string;
  role: DashboardRole;
  salespersonId?: string | null;
  actorId: string;
}

export class DashboardUserService {
  constructor(private readonly audit = new AuditRepository()) {}

  async create(input: CreateUserInput): Promise<DashboardUserRecord> {
    const email = normalizeEmail(input.email);
    const salespersonId = input.salespersonId || null;
    if (input.role === 'salesperson' && !salespersonId) {
      throw badRequest('salesperson_id_required_for_salesperson_role');
    }
    if (input.role !== 'salesperson' && salespersonId) {
      throw badRequest('salesperson_id_only_valid_for_salesperson_role');
    }
    const passwordHash = await hashPassword(input.password);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertSalespersonInClient(client, input.clientId, salespersonId);
      const result = await client.query<UserRow>(
        `INSERT INTO app.users (client_id, salesperson_id, email, password_hash, role, name)
         VALUES ($1, $2::uuid, $3, $4, $5, $6)
         ON CONFLICT (client_id, email) DO NOTHING
         RETURNING ${RECORD_COLUMNS}`,
        [input.clientId, salespersonId, email, passwordHash, input.role, input.name.trim()],
      );
      const row = result.rows[0];
      if (!row) throw conflict('user_email_already_exists', { email });
      await this.audit.record(client, {
        eventType: 'dashboard.user_created',
        actorType: 'operator',
        actorId: input.actorId,
        aggregateType: 'user',
        aggregateId: row.user_id,
        payload: { clientId: input.clientId, role: input.role, email },
      });
      await client.query('COMMIT');
      return toRecord(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async list(clientId: string): Promise<DashboardUserRecord[]> {
    const result = await pool.query<UserRow>(
      `SELECT ${RECORD_COLUMNS}
       FROM app.users
       WHERE client_id = $1
       ORDER BY active DESC, name, user_id`,
      [clientId],
    );
    return result.rows.map(toRecord);
  }

  async update(input: {
    clientId: string;
    userId: string;
    actorId: string;
    name?: string;
    role?: DashboardRole;
    active?: boolean;
    salespersonId?: string | null;
    password?: string;
  }): Promise<DashboardUserRecord> {
    const passwordHash = input.password ? await hashPassword(input.password) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<UserRow>(
        `SELECT ${RECORD_COLUMNS} FROM app.users WHERE user_id = $1 AND client_id = $2 FOR UPDATE`,
        [input.userId, input.clientId],
      );
      const existing = current.rows[0];
      if (!existing) throw notFound('user_not_found');

      const role = input.role ?? existing.role;
      const salespersonId =
        input.salespersonId === undefined ? existing.salesperson_id : input.salespersonId || null;
      if (role === 'salesperson' && !salespersonId) {
        throw badRequest('salesperson_id_required_for_salesperson_role');
      }
      if (role !== 'salesperson' && salespersonId) {
        throw badRequest('salesperson_id_only_valid_for_salesperson_role');
      }
      await this.assertSalespersonInClient(client, input.clientId, salespersonId);

      const result = await client.query<UserRow>(
        `UPDATE app.users
         SET name = COALESCE($3, name),
             role = $4,
             active = COALESCE($5, active),
             salesperson_id = $6::uuid,
             password_hash = COALESCE($7, password_hash),
             updated_at = now()
         WHERE user_id = $1 AND client_id = $2
         RETURNING ${RECORD_COLUMNS}`,
        [
          input.userId,
          input.clientId,
          input.name === undefined ? null : input.name.trim(),
          role,
          input.active === undefined ? null : input.active,
          salespersonId,
          passwordHash,
        ],
      );
      const row = result.rows[0];
      if (!row) throw notFound('user_not_found');
      if (passwordHash || input.active === false) {
        await client.query('UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
          input.userId,
        ]);
      }
      await this.audit.record(client, {
        eventType: 'dashboard.user_updated',
        actorType: 'operator',
        actorId: input.actorId,
        aggregateType: 'user',
        aggregateId: row.user_id,
        payload: {
          clientId: input.clientId,
          passwordChanged: Boolean(passwordHash),
          role: row.role,
          active: row.active,
        },
      });
      await client.query('COMMIT');
      return toRecord(row);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async changeOwnPassword(input: {
    user: DashboardUser;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const stored = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM app.users WHERE user_id = $1 AND client_id = $2 AND active',
      [input.user.userId, input.user.clientId],
    );
    const passwordHash = stored.rows[0]?.password_hash;
    if (!passwordHash) throw notFound('user_not_found');
    if (!(await verifyPassword(passwordHash, input.currentPassword))) {
      throw unauthorized('current_password_incorrect');
    }
    const nextHash = await hashPassword(input.newPassword);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE app.users SET password_hash = $2, updated_at = now() WHERE user_id = $1', [
        input.user.userId,
        nextHash,
      ]);
      await client.query('UPDATE app.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
        input.user.userId,
      ]);
      await this.audit.record(client, {
        eventType: 'dashboard.password_changed',
        actorType: 'operator',
        actorId: input.user.userId,
        aggregateType: 'user',
        aggregateId: input.user.userId,
        payload: { clientId: input.user.clientId },
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertSalespersonInClient(
    client: Db,
    clientId: string,
    salespersonId: string | null,
  ): Promise<void> {
    if (!salespersonId) return;
    const result = await client.query<{ salesperson_id: string }>(
      'SELECT salesperson_id FROM app.salespeople WHERE salesperson_id = $1 AND client_id = $2',
      [salespersonId, clientId],
    );
    if (!result.rows[0]) throw badRequest('salesperson_not_in_client');
  }
}
