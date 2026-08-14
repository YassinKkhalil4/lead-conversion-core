import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { CompiledConfig } from '../domain/types.js';

type Db = typeof pool | PoolClient;

export interface ConfigSnapshot {
  config: CompiledConfig;
  versionKey: string;
  configurationVersionId: string;
  source: 'versioned';
}

export class ConfigRepository {
  async getActiveSnapshot(clientRecordId: string, client: PoolClient | null = null): Promise<ConfigSnapshot> {
    const db = client ?? pool;
    const scopeKey = clientRecordId ? `client_record:${clientRecordId}` : 'default';
    const activeVersion = await this.getActiveVersionedSnapshot(db, scopeKey);
    if (activeVersion) return activeVersion;
    if (scopeKey !== 'default') {
      const defaultActiveVersion = await this.getActiveVersionedSnapshot(db, 'default');
      if (defaultActiveVersion) return defaultActiveVersion;
    }
    throw new Error('No active configuration version');
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
    const row = activeVersion.rows[0];
    if (!row) throw new Error(`Configuration version not found: ${version}`);
    return {
      config: row.config_json,
      versionKey: row.version_key,
      configurationVersionId: row.configuration_version_id,
      source: 'versioned',
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
