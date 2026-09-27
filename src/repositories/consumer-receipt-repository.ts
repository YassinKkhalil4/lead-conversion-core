import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';

export type ConsumerClaimResult =
  | { acquired: true; alreadyCompleted: false; busy: false; reclaimed?: true }
  | { acquired: false; alreadyCompleted: true; busy: false; result: unknown }
  | { acquired: false; alreadyCompleted: false; busy: true; leaseUntil: Date };

/**
 * Idempotency receipts for external consumers (the n8n projection) that
 * process each key at most once at a time. Lease expiry is always decided by
 * PostgreSQL's clock, the same clock that wrote `lease_until`, so skew on the
 * app host cannot hand one key to two consumers.
 */
export class ConsumerReceiptRepository {
  async claim(input: { consumerName: string; idempotencyKey: string; leaseSeconds: number }): Promise<ConsumerClaimResult> {
    return withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO edge_consumer_receipts
          (consumer_name,idempotency_key,status,lease_until)
         VALUES ($1,$2,'processing',now()+make_interval(secs => $3))
         ON CONFLICT DO NOTHING
         RETURNING status`,
        [input.consumerName, input.idempotencyKey, input.leaseSeconds],
      );
      if (inserted.rows[0]) return { acquired: true, alreadyCompleted: false, busy: false };

      const existing = await client.query<{
        status: string;
        lease_until: Date;
        lease_active: boolean;
        result_json: unknown;
      }>(
        `SELECT status, lease_until, lease_until > now() AS lease_active, result_json
         FROM edge_consumer_receipts
         WHERE consumer_name=$1 AND idempotency_key=$2
         FOR UPDATE`,
        [input.consumerName, input.idempotencyKey],
      );
      const row = existing.rows[0];
      if (!row) throw new Error('consumer_receipt_missing_after_conflict');
      if (row.status === 'completed') {
        return { acquired: false, alreadyCompleted: true, busy: false, result: row.result_json };
      }
      if (row.status === 'processing' && row.lease_active) {
        return { acquired: false, alreadyCompleted: false, busy: true, leaseUntil: row.lease_until };
      }
      await client.query(
        `UPDATE edge_consumer_receipts
         SET status='processing',lease_until=now()+make_interval(secs => $3),last_error='',updated_at=now()
         WHERE consumer_name=$1 AND idempotency_key=$2`,
        [input.consumerName, input.idempotencyKey, input.leaseSeconds],
      );
      return { acquired: true, alreadyCompleted: false, busy: false, reclaimed: true };
    });
  }

  async complete(input: { consumerName: string; idempotencyKey: string; result: Record<string, unknown> }) {
    const result = await pool.query<{ status: string; result_json: unknown }>(
      `UPDATE edge_consumer_receipts
       SET status='completed',result_json=$3::jsonb,last_error='',lease_until=now(),updated_at=now()
       WHERE consumer_name=$1 AND idempotency_key=$2
       RETURNING status,result_json`,
      [input.consumerName, input.idempotencyKey, JSON.stringify(input.result)],
    );
    return result.rows[0] ?? null;
  }

  async fail(input: { consumerName: string; idempotencyKey: string; error: string }) {
    const result = await pool.query<{ status: string; last_error: string }>(
      `UPDATE edge_consumer_receipts
       SET status='failed',last_error=$3,lease_until=now(),updated_at=now()
       WHERE consumer_name=$1 AND idempotency_key=$2
       RETURNING status,last_error`,
      [input.consumerName, input.idempotencyKey, input.error],
    );
    return result.rows[0] ?? null;
  }
}
