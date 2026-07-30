import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { CompiledConfig } from '../domain/types.js';

type Db = typeof pool | PoolClient;

export interface ConfigSnapshot {
  config: CompiledConfig;
  versionKey: string;
  configurationVersionId: string | null;
  source: 'versioned' | 'legacy';
}

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

  async getActiveSnapshot(clientRecordId: string, client: PoolClient | null = null): Promise<ConfigSnapshot> {
    const db = client ?? pool;
    const scopeKey = clientRecordId ? `client_record:${clientRecordId}` : 'default';
    const activeVersion = await this.getActiveVersionedSnapshot(db, scopeKey);
    if (activeVersion) return activeVersion;

    const specific = await db.query<{ config_json: CompiledConfig; config_version: string }>(
      `SELECT config_json, config_version FROM edge_config_snapshots
       WHERE active = true AND client_record_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [clientRecordId],
    );
    if (specific.rows[0]) {
      return {
        config: specific.rows[0].config_json,
        versionKey: specific.rows[0].config_version,
        configurationVersionId: null,
        source: 'legacy',
      };
    }

    if (scopeKey !== 'default') {
      const defaultActiveVersion = await this.getActiveVersionedSnapshot(db, 'default');
      if (defaultActiveVersion) return defaultActiveVersion;
    }

    const fallback = await db.query<{ config_json: CompiledConfig; config_version: string }>(
      `SELECT config_json, config_version FROM edge_config_snapshots
       WHERE active = true AND client_record_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    );
    const fallbackRow = fallback.rows[0];
    const config = fallbackRow?.config_json;
    if (!fallbackRow || !config) throw new Error('No active configuration snapshot');
    return {
      config,
      versionKey: fallbackRow.config_version,
      configurationVersionId: null,
      source: 'legacy',
    };
  }

  async getActive(clientRecordId: string, client: PoolClient | null = null): Promise<CompiledConfig> {
    return (await this.getActiveSnapshot(clientRecordId, client)).config;
  }

  async getByVersionSnapshot(version: string, client: PoolClient | null = null): Promise<ConfigSnapshot> {
    const db = client ?? pool;
    const activeVersion = await db.query<{ config_json: CompiledConfig; configuration_version_id: string; version_key: string }>(
      `SELECT config_json, configuration_version_id, version_key FROM configuration.versions WHERE version_key=$1 LIMIT 1`,
      [version],
    );
    if (activeVersion.rows[0]) {
      return {
        config: activeVersion.rows[0].config_json,
        versionKey: activeVersion.rows[0].version_key,
        configurationVersionId: activeVersion.rows[0].configuration_version_id,
        source: 'versioned',
      };
    }

    const result = await db.query<{ config_json: CompiledConfig; config_version: string }>(
      `SELECT config_json, config_version FROM edge_config_snapshots WHERE config_version=$1 LIMIT 1`,
      [version],
    );
    const legacyRow = result.rows[0];
    const config = legacyRow?.config_json;
    if (!legacyRow || !config) throw new Error(`Configuration snapshot not found: ${version}`);
    return {
      config,
      versionKey: legacyRow.config_version,
      configurationVersionId: null,
      source: 'legacy',
    };
  }

  async getByVersion(version: string, client: PoolClient | null = null): Promise<CompiledConfig> {
    return (await this.getByVersionSnapshot(version, client)).config;
  }

  private async getActiveVersionedSnapshot(db: Db, scopeKey: string): Promise<ConfigSnapshot | null> {
    const activeVersion = await db.query<{ config_json: CompiledConfig; configuration_version_id: string; version_key: string }>(
      `SELECT v.config_json
            , v.configuration_version_id
            , v.version_key
       FROM configuration.active_versions a
       JOIN configuration.versions v USING (configuration_version_id)
       WHERE a.scope_key=$1
       LIMIT 1`,
      [scopeKey],
    );
    const row = activeVersion.rows[0];
    if (!row) return null;
    return {
      config: row.config_json,
      versionKey: row.version_key,
      configurationVersionId: row.configuration_version_id,
      source: 'versioned',
    };
  }
}
