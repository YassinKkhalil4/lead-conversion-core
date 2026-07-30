import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { CompiledConfig } from '../domain/types.js';

export class ConfigRepository {
  async save(config: CompiledConfig, client: PoolClient | null = null): Promise<void> {
    const db = client ?? pool;
    await db.query(
      `UPDATE edge_config_snapshots
       SET active = false
       WHERE active = true
         AND COALESCE(client_record_id, '') = COALESCE($1, '')
         AND config_version <> $2`,
      [config.clientRecordId, config.version],
    );
    await db.query(
      `INSERT INTO edge_config_snapshots
        (config_version, client_record_id, industry, config_json, active, created_at)
       VALUES ($1, $2, $3, $4::jsonb, true, $5)
       ON CONFLICT (config_version)
       DO UPDATE SET active = true, config_json = EXCLUDED.config_json`,
      [config.version, config.clientRecordId, config.industry, JSON.stringify(config), config.createdAt],
    );
  }

  async getActive(clientRecordId: string, client: PoolClient | null = null): Promise<CompiledConfig> {
    const db = client ?? pool;
    const specific = await db.query<{ config_json: CompiledConfig }>(
      `SELECT config_json FROM edge_config_snapshots
       WHERE active = true AND client_record_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [clientRecordId],
    );
    if (specific.rows[0]) return specific.rows[0].config_json;

    const fallback = await db.query<{ config_json: CompiledConfig }>(
      `SELECT config_json FROM edge_config_snapshots
       WHERE active = true AND client_record_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    );
    const config = fallback.rows[0]?.config_json;
    if (!config) throw new Error('No active configuration snapshot');
    return config;
  }

  async getByVersion(version: string, client: PoolClient | null = null): Promise<CompiledConfig> {
    const db = client ?? pool;
    const result = await db.query<{ config_json: CompiledConfig }>(
      `SELECT config_json FROM edge_config_snapshots WHERE config_version=$1 LIMIT 1`,
      [version],
    );
    const config = result.rows[0]?.config_json;
    if (!config) throw new Error(`Configuration snapshot not found: ${version}`);
    return config;
  }
}
