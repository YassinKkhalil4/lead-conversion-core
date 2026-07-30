import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { compileConfig, type CompileInput } from '../domain/compiler.js';
import type { CompiledConfig } from '../domain/types.js';
import { sha256Hex, stableJson } from '../infrastructure/runtime.js';
import { ConfigRepository } from '../repositories/config-repository.js';

type Db = typeof pool | PoolClient;

export interface ConfigValidationResult {
  ok: boolean;
  version: string;
  checksum: string;
  questions: number;
  messages: number;
}

export interface ConfigDiff {
  fromVersion: string;
  toVersion: string;
  addedQuestions: string[];
  removedQuestions: string[];
  addedMessages: string[];
  removedMessages: string[];
  questionCountDelta: number;
  messageCountDelta: number;
}

export interface PublishConfigInput {
  sourcePath: string;
  clientRecordId?: string | null;
  publishedBy: string;
  sourceKind?: string;
}

export interface PublishConfigResult {
  configurationVersionId: string;
  versionKey: string;
  checksum: string;
  activeScopeKey: string;
}

function scopeKey(clientRecordId: string | null): string {
  return clientRecordId ? `client_record:${clientRecordId}` : 'default';
}

function keySet(values: string[]): Set<string> {
  return new Set(values.filter(Boolean));
}

export function diffCompiledConfigs(from: CompiledConfig | null, to: CompiledConfig): ConfigDiff {
  const fromQuestions = keySet((from?.questions || []).map((question) => question.questionKey));
  const toQuestions = keySet(to.questions.map((question) => question.questionKey));
  const fromMessages = keySet(Object.keys(from?.messages || {}));
  const toMessages = keySet(Object.keys(to.messages));
  return {
    fromVersion: from?.version || '',
    toVersion: to.version,
    addedQuestions: [...toQuestions].filter((key) => !fromQuestions.has(key)).sort(),
    removedQuestions: [...fromQuestions].filter((key) => !toQuestions.has(key)).sort(),
    addedMessages: [...toMessages].filter((key) => !fromMessages.has(key)).sort(),
    removedMessages: [...fromMessages].filter((key) => !toMessages.has(key)).sort(),
    questionCountDelta: toQuestions.size - fromQuestions.size,
    messageCountDelta: toMessages.size - fromMessages.size,
  };
}

export class VersionedConfigService {
  constructor(private readonly legacyRepository = new ConfigRepository()) {}

  async loadAndCompile(sourcePath: string, clientRecordId?: string | null): Promise<CompiledConfig> {
    const raw = JSON.parse(await readFile(sourcePath, 'utf8')) as CompileInput;
    return compileConfig({
      ...raw,
      clientRecordId: clientRecordId ?? raw.clientRecordId ?? null,
    });
  }

  validate(config: CompiledConfig): ConfigValidationResult {
    return {
      ok: true,
      version: config.version,
      checksum: sha256Hex(stableJson(config)),
      questions: config.questions.length,
      messages: Object.keys(config.messages).length,
    };
  }

  async getActive(scope: string): Promise<CompiledConfig | null> {
    const result = await pool.query<{ config_json: CompiledConfig }>(
      `SELECT v.config_json
       FROM configuration.active_versions a
       JOIN configuration.versions v USING (configuration_version_id)
       WHERE a.scope_key=$1
       LIMIT 1`,
      [scope],
    );
    return result.rows[0]?.config_json || null;
  }

  async publish(input: PublishConfigInput): Promise<PublishConfigResult> {
    const config = await this.loadAndCompile(input.sourcePath, input.clientRecordId);
    const validation = this.validate(config);
    const scope = scopeKey(config.clientRecordId);
    const previous = await this.getActive(scope);
    const diff = diffCompiledConfigs(previous, config);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ configuration_version_id: string }>(
        `INSERT INTO configuration.versions
          (client_record_id, version_key, status, config_json, checksum_sha256,
           schema_version, source_kind, source_ref, validation_json, diff_json,
           created_by, published_by, published_at)
         VALUES ($1, $2, 'published', $3::jsonb, $4,
           'compiled_config.v1', $5, $6, $7::jsonb, $8::jsonb,
           $9, $9, now())
         ON CONFLICT (version_key) DO NOTHING
         RETURNING configuration_version_id`,
        [
          config.clientRecordId || '',
          config.version,
          JSON.stringify(config),
          validation.checksum,
          input.sourceKind || 'seed_json',
          input.sourcePath,
          JSON.stringify(validation),
          JSON.stringify(diff),
          input.publishedBy,
        ],
      );
      const versionId = inserted.rows[0]?.configuration_version_id || (await client.query<{ configuration_version_id: string }>(
        'SELECT configuration_version_id FROM configuration.versions WHERE version_key=$1 AND status=$2',
        [config.version, 'published'],
      )).rows[0]?.configuration_version_id;
      if (!versionId) throw new Error('configuration_version_not_created');
      await client.query(
        `INSERT INTO configuration.active_versions
          (scope_key, client_record_id, configuration_version_id, activated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scope_key) DO UPDATE SET
          configuration_version_id=EXCLUDED.configuration_version_id,
          client_record_id=EXCLUDED.client_record_id,
          activated_by=EXCLUDED.activated_by,
          activated_at=now()`,
        [scope, config.clientRecordId || '', versionId, input.publishedBy],
      );
      await this.legacyRepository.save(config, client);
      await client.query('COMMIT');
      return {
        configurationVersionId: versionId,
        versionKey: config.version,
        checksum: validation.checksum,
        activeScopeKey: scope,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async diff(sourcePath: string, clientRecordId?: string | null): Promise<ConfigDiff> {
    const config = await this.loadAndCompile(sourcePath, clientRecordId);
    return diffCompiledConfigs(await this.getActive(scopeKey(config.clientRecordId)), config);
  }
}
