import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';

export interface ClaimedOutboxRow {
  outbox_id: string;
  conversation_id: string;
  event_type: string;
  idempotency_key: string;
  payload_json: Record<string, unknown>;
  attempt_count: number;
  created_at: Date | string;
  event_sequence: string | number;
}

export class OutboxRepository {
  async enqueue(
    client: PoolClient,
    input: {
      conversationId: string;
      eventType: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
      parked: boolean;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO edge_outbox
        (conversation_id, event_type, idempotency_key, payload_json, status)
       VALUES ($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        input.conversationId,
        input.eventType,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        input.parked ? 'parked' : 'pending',
      ],
    );
  }

  async claimBatch(limit = 20): Promise<ClaimedOutboxRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<ClaimedOutboxRow>(
        `SELECT candidate.outbox_id, candidate.conversation_id, candidate.event_type,
                candidate.idempotency_key, candidate.payload_json, candidate.attempt_count,
                candidate.created_at, candidate.event_sequence
         FROM edge_outbox candidate
         WHERE candidate.status IN ('pending','failed')
           AND candidate.available_at <= now()
           AND NOT EXISTS (
             SELECT 1 FROM edge_outbox earlier
             WHERE earlier.conversation_id=candidate.conversation_id
               AND earlier.event_sequence < candidate.event_sequence
               AND earlier.status <> 'completed'
           )
         ORDER BY candidate.event_sequence
         FOR UPDATE OF candidate SKIP LOCKED
         LIMIT $1`,
        [limit],
      );
      const ids = result.rows.map((row: ClaimedOutboxRow) => row.outbox_id);
      if (ids.length > 0) {
        await client.query(
          `UPDATE edge_outbox
           SET status='processing', locked_at=now(), attempt_count=attempt_count+1
           WHERE outbox_id = ANY($1::uuid[])`,
          [ids],
        );
      }
      await client.query('COMMIT');
      return result.rows;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async complete(outboxId: string): Promise<void> {
    await pool.query(
      `UPDATE edge_outbox
       SET status='completed', completed_at=now(), locked_at=NULL, last_error=''
       WHERE outbox_id=$1`,
      [outboxId],
    );
  }

  async fail(outboxId: string, error: string, attemptCount: number): Promise<void> {
    const delaySeconds = Math.min(3600, Math.max(5, 2 ** Math.min(attemptCount, 10)));
    await pool.query(
      `UPDATE edge_outbox
       SET status='failed', locked_at=NULL, last_error=$2,
           available_at=now()+make_interval(secs => $3)
       WHERE outbox_id=$1`,
      [outboxId, error.slice(0, 4000), delaySeconds],
    );
  }
}
