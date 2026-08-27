import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex } from '../infrastructure/runtime.js';

/** Identifies where a signup came from, stored on the row. */
export const WAITLIST_SOURCE = 'kadensio_landing';

export const WAITLIST_NOTIFICATION_COMMAND_TYPE = 'waitlist.signup_notification';

const MARKETS = ['dubai_uae', 'egypt', 'other'] as const;

/**
 * The honeypot. A real browser never fills it because it is hidden; a bot that
 * fills every input it finds does. Named to look worth filling in.
 */
export const HONEYPOT_FIELD = 'website';

export function waitlistSchema(messageMaxLength: number) {
  return z.object({
    email: z.string().trim().min(3).max(320).email(),
    companyName: z.string().trim().max(200).optional(),
    market: z.enum(MARKETS).optional(),
    message: z.string().trim().max(messageMaxLength).optional(),
    [HONEYPOT_FIELD]: z.string().max(200).optional(),
  }).strict();
}

export type WaitlistSubmission = z.infer<ReturnType<typeof waitlistSchema>>;

export type WaitlistResult =
  | { outcome: 'accepted'; signupId: string; repeat: boolean }
  | { outcome: 'discarded'; reason: string }
  | { outcome: 'rate_limited'; subject: 'ip' | 'email'; retryAfterSeconds: number };

/**
 * Lower-cased and trimmed. Deliberately not doing anything cleverer: stripping
 * gmail dots or plus-tags would silently merge addresses their owner considers
 * distinct, and this table is a contact list, not an identity system.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class WaitlistService {
  constructor(
    private readonly audit = new AuditRepository(),
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly env = getEnv(),
  ) {}

  async submit(input: {
    submission: WaitlistSubmission;
    ipAddress: string;
    requestHeaders: Record<string, unknown>;
    correlationId: string;
  }): Promise<WaitlistResult> {
    // A filled honeypot is accepted at the edge and dropped here: the caller
    // returns the same ok response it returns for a real signup, so a bot
    // cannot tell the difference and learn to stop filling it.
    const honeypot = String(input.submission[HONEYPOT_FIELD] || '').trim();
    if (honeypot.length > 0) {
      return { outcome: 'discarded', reason: 'honeypot_filled' };
    }

    const email = input.submission.email.trim();
    const emailNormalized = normalizeEmail(email);

    // Checked before the transaction opens, on its own connection, so the
    // counter survives a rollback. Same reasoning as
    // InboundLeadCaptureService.rateLimited.
    const limited = await this.rateLimited(input.ipAddress, emailNormalized);
    if (limited) return limited;

    const companyName = (input.submission.companyName || '').trim();
    const market = input.submission.market || '';
    const message = (input.submission.message || '').trim();

    return withTransaction(async (client) => {
      const upserted = await client.query<{
        waitlist_signup_id: string;
        submission_count: number;
      }>(
        `INSERT INTO app.waitlist_signups
          (email, email_normalized, company_name, market, message, source, request_headers)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (email_normalized) DO UPDATE SET
           email = EXCLUDED.email,
           company_name = CASE
             WHEN EXCLUDED.company_name <> '' THEN EXCLUDED.company_name
             ELSE app.waitlist_signups.company_name END,
           market = CASE
             WHEN EXCLUDED.market <> '' THEN EXCLUDED.market
             ELSE app.waitlist_signups.market END,
           message = CASE
             WHEN EXCLUDED.message <> '' THEN EXCLUDED.message
             ELSE app.waitlist_signups.message END,
           source = EXCLUDED.source,
           request_headers = EXCLUDED.request_headers,
           submission_count = app.waitlist_signups.submission_count + 1,
           updated_at = now()
         RETURNING waitlist_signup_id, submission_count`,
        [
          email,
          emailNormalized,
          companyName,
          market,
          message,
          WAITLIST_SOURCE,
          JSON.stringify(input.requestHeaders),
        ],
      );
      const row = upserted.rows[0];
      if (!row) throw new Error('waitlist_signup_not_recorded');

      const repeat = row.submission_count > 1;

      await this.audit.record(client, {
        eventType: 'waitlist.signup_received',
        actorType: 'external_user',
        actorId: sha256Hex(emailNormalized),
        aggregateType: 'waitlist_signup',
        aggregateId: row.waitlist_signup_id,
        correlationId: input.correlationId,
        payload: {
          source: WAITLIST_SOURCE,
          repeat,
          submissionCount: row.submission_count,
          market,
          hasCompanyName: companyName.length > 0,
          messageLength: message.length,
        },
      });

      // Enqueued in the same transaction as the row, never sent from inside it.
      // The idempotency key is per submission rather than per email, so a
      // genuine repeat submission notifies again instead of colliding.
      await this.outbox.enqueue(client, {
        commandType: WAITLIST_NOTIFICATION_COMMAND_TYPE,
        destination: 'operator',
        idempotencyKey: `waitlist:${row.waitlist_signup_id}:${row.submission_count}`,
        aggregateKey: row.waitlist_signup_id,
        payload: {
          waitlistSignupId: row.waitlist_signup_id,
          source: WAITLIST_SOURCE,
          repeat,
          submissionCount: row.submission_count,
          market,
          hasCompanyName: companyName.length > 0,
          messageLength: message.length,
        },
      });

      return { outcome: 'accepted', signupId: row.waitlist_signup_id, repeat };
    });
  }

  /**
   * Fixed-window counters in PostgreSQL, same statement shape as
   * app.lead_capture_attempts. Runs on the pool rather than the caller's
   * transaction so a rejected submission cannot roll back its own counter.
   *
   * The email key is hashed so the raw address never lands in a table that is
   * read for operational debugging.
   */
  private async rateLimited(
    ipAddress: string,
    emailNormalized: string,
  ): Promise<{ outcome: 'rate_limited'; subject: 'ip' | 'email'; retryAfterSeconds: number } | null> {
    const subjects: Array<{
      key: string;
      limit: number;
      windowSeconds: number;
      subject: 'ip' | 'email';
    }> = [
      {
        key: `waitlist:ip:${ipAddress}`,
        limit: this.env.WAITLIST_SIGNUP_IP_LIMIT,
        windowSeconds: Math.ceil(this.env.WAITLIST_SIGNUP_IP_WINDOW_MS / 1000),
        subject: 'ip',
      },
      {
        key: `waitlist:email:${sha256Hex(emailNormalized)}`,
        limit: this.env.WAITLIST_SIGNUP_EMAIL_LIMIT,
        windowSeconds: Math.ceil(this.env.WAITLIST_SIGNUP_EMAIL_WINDOW_MS / 1000),
        subject: 'email',
      },
    ];

    for (const subject of subjects) {
      const result = await pool.query<{ attempt_count: number; retry_after_seconds: number }>(
        `INSERT INTO app.waitlist_attempts (attempt_key, window_started_at, attempt_count)
         VALUES ($1, now(), 1)
         ON CONFLICT (attempt_key) DO UPDATE SET
           window_started_at = CASE
             WHEN app.waitlist_attempts.window_started_at <= now() - make_interval(secs => $2)
             THEN now() ELSE app.waitlist_attempts.window_started_at END,
           attempt_count = CASE
             WHEN app.waitlist_attempts.window_started_at <= now() - make_interval(secs => $2)
             THEN 1 ELSE app.waitlist_attempts.attempt_count + 1 END,
           updated_at = now()
         RETURNING attempt_count,
                   GREATEST(0, ceil(extract(epoch FROM (window_started_at + make_interval(secs => $2)) - now())))::int
                     AS retry_after_seconds`,
        [subject.key, subject.windowSeconds],
      );
      const row = result.rows[0];
      if (!row) throw new Error('waitlist_attempt_not_recorded');
      if (row.attempt_count > subject.limit) {
        return {
          outcome: 'rate_limited',
          subject: subject.subject,
          retryAfterSeconds: row.retry_after_seconds,
        };
      }
    }
    return null;
  }
}
