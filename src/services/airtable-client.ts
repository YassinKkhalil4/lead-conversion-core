import { getEnv } from '../config/env.js';
import type { AirtableRecord } from '../domain/compiler.js';

interface AirtableResponse {
  records: Array<{ id: string; fields: Record<string, unknown> }>;
  offset?: string;
}

export class AirtableClient {
  private readonly env = getEnv();

  async listAll(table: string): Promise<AirtableRecord[]> {
    if (!this.env.AIRTABLE_TOKEN) throw new Error('AIRTABLE_TOKEN is not configured');
    const records: AirtableRecord[] = [];
    let offset = '';

    do {
      const url = new URL(
        `https://api.airtable.com/v0/${this.env.AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`,
      );
      url.searchParams.set('pageSize', '100');
      if (offset) url.searchParams.set('offset', offset);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.env.AIRTABLE_TOKEN}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Airtable ${table} returned ${response.status}: ${await response.text()}`);
      }
      const body = (await response.json()) as AirtableResponse;
      if (!Array.isArray(body.records)) throw new Error(`Airtable ${table} response has no records`);
      records.push(...body.records);
      offset = body.offset || '';
    } while (offset);

    return records;
  }
}
