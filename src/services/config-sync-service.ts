import { getEnv } from '../config/env.js';
import { compileConfig } from '../domain/compiler.js';
import type { CompiledConfig } from '../domain/types.js';
import { ConfigRepository } from '../repositories/config-repository.js';
import { AirtableClient } from './airtable-client.js';

export class ConfigSyncService {
  constructor(
    private readonly airtable = new AirtableClient(),
    private readonly configs = new ConfigRepository(),
  ) {}

  async sync(clientRecordId: string | null = null): Promise<CompiledConfig> {
    const env = getEnv();
    const [questions, options, messages] = await Promise.all([
      this.airtable.listAll(env.AIRTABLE_QUESTIONS_TABLE),
      this.airtable.listAll(env.AIRTABLE_OPTIONS_TABLE),
      this.airtable.listAll(env.AIRTABLE_MESSAGES_TABLE),
    ]);
    const config = compileConfig({
      clientRecordId,
      questions,
      options,
      messages,
      industry: 'real_estate',
    });
    await this.configs.save(config);
    return config;
  }
}
