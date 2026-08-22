import type { PoolClient } from 'pg';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import { AuditRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import type { ConversationState } from '../domain/types.js';
import { ConversationActivationService } from './conversation-activation-service.js';

/** Marks a lead that arrived by messaging the business number directly. */
export const WHATSAPP_INBOUND_SOURCE = 'whatsapp_direct_inbound';
export const WHATSAPP_INBOUND_PROVIDER = 'whatsapp';

const PHONE_PATTERN = /^\+\d{8,15}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InboundLeadCaptureResult =
  | { outcome: 'captured'; state: ConversationState; leadId: string; openingMessage: string }
  | { outcome: 'ignored'; reason: string };

interface ResolvedClient {
  clientId: string;
  companyName: string;
}

export class InboundLeadCaptureService {
  constructor(
    private readonly activation = new ConversationActivationService(),
    private readonly audit = new AuditRepository(),
    private readonly env = getEnv(),
  ) {}

  async capture(client: PoolClient, input: {
    clientRecordId: string;
    channelClientId: string;
    phoneNumberId: string;
    from: string;
    profileName: string;
    messageText: string;
    receivedAt: string;
    metaMessageId: string;
    inboxEventId: string;
    dedupeKey: string;
  }): Promise<InboundLeadCaptureResult> {
    if (!this.env.INBOUND_LEAD_CAPTURE_ENABLED) {
      return { outcome: 'ignored', reason: 'inbound_lead_capture_disabled' };
    }
    const phoneE164 = input.from.trim();
    if (!PHONE_PATTERN.test(phoneE164)) {
      return { outcome: 'ignored', reason: 'inbound_lead_capture_invalid_phone' };
    }

    const resolved = await this.resolveClient(client, input.clientRecordId, input.channelClientId);
    if (!resolved) {
      return { outcome: 'ignored', reason: 'inbound_lead_capture_client_not_resolved' };
    }

    // A salesperson or the manager replying on the business number is staff
    // traffic, not a lead. Scoped to this client so the same number may still
    // be a lead for a different client.
    const internal = await client.query<{ kind: string }>(
      `SELECT 'manager' AS kind
         FROM app.clients c
        WHERE c.client_id=$1 AND c.manager_phone_e164=$2 AND c.manager_phone_e164 <> ''
        UNION ALL
       SELECT 'salesperson' AS kind
         FROM app.salespeople s
        WHERE s.client_id=$1 AND s.phone_e164=$2
        LIMIT 1`,
      [resolved.clientId, phoneE164],
    );
    if (internal.rows[0]) {
      return { outcome: 'ignored', reason: `inbound_lead_capture_internal_number:${internal.rows[0].kind}` };
    }

    const limited = await this.rateLimited(phoneE164, resolved.clientId);
    if (limited) {
      return { outcome: 'ignored', reason: `inbound_lead_capture_rate_limited:${limited}` };
    }

    const openingMessage = input.messageText.trim().slice(0, 4000);

    const contact = await client.query<{ contact_id: string; opted_out: boolean }>(
      `INSERT INTO app.contacts
        (client_id, name, phone_raw, phone_e164, consent_status)
       VALUES ($1, $2, $3, $3, 'whatsapp_inbound')
       ON CONFLICT (client_id, phone_e164) DO UPDATE SET
         name=COALESCE(NULLIF(EXCLUDED.name, ''), app.contacts.name),
         updated_at=now()
       RETURNING contact_id, opted_out`,
      [resolved.clientId, input.profileName.slice(0, 200), phoneE164],
    );
    const contactRow = contact.rows[0];
    if (!contactRow) throw new Error('inbound_capture_contact_not_created');

    const payloadHash = sha256Hex(stableJson({
      provider: WHATSAPP_INBOUND_PROVIDER,
      phoneE164,
      openingMessage,
      profileName: input.profileName,
    }));
    const lead = await client.query<{ lead_id: string; legacy_airtable_id: string | null }>(
      `INSERT INTO app.leads
        (client_id, contact_id, provider, provider_external_id, source, source_payload_hash,
         status, current_stage, first_received_at, first_reply_at, last_message_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'new', '', $7::timestamptz, $7::timestamptz, $7::timestamptz)
       ON CONFLICT (client_id, provider, provider_external_id) DO UPDATE SET
         contact_id=EXCLUDED.contact_id,
         last_message_at=EXCLUDED.last_message_at,
         updated_at=now()
       RETURNING lead_id, legacy_airtable_id`,
      [
        resolved.clientId,
        contactRow.contact_id,
        WHATSAPP_INBOUND_PROVIDER,
        phoneE164,
        WHATSAPP_INBOUND_SOURCE,
        payloadHash,
        input.receivedAt,
      ],
    );
    const leadRow = lead.rows[0];
    if (!leadRow) throw new Error('inbound_capture_lead_not_created');

    // The opening text lives on the intake event, matching how the form and
    // lead-ad paths record their raw payload. It is never parsed into answers.
    await this.recordIntakeEvent(client, {
      clientId: resolved.clientId,
      contactId: contactRow.contact_id,
      leadId: leadRow.lead_id,
      phoneE164,
      metaMessageId: input.metaMessageId,
      receivedAt: input.receivedAt,
      openingMessage,
      profileName: input.profileName,
      phoneNumberId: input.phoneNumberId,
      payloadHash,
    });

    const activated = await this.activation.activate(client, {
      clientId: resolved.clientId,
      clientRecordId: input.clientRecordId,
      phoneE164,
      leadId: leadRow.lead_id,
      leadRecordId: leadRow.legacy_airtable_id || leadRow.lead_id,
      leadName: input.profileName,
      companyName: resolved.companyName,
      receivedAt: input.receivedAt,
      actorId: 'inbound-lead-capture-service',
      correlationId: input.dedupeKey,
      causationId: input.inboxEventId,
    });
    if (!activated.state) {
      return { outcome: 'ignored', reason: `inbound_lead_capture_not_activated:${activated.skippedReason}` };
    }

    await this.audit.record(client, {
      eventType: 'lead.captured_from_inbound',
      actorType: 'external_user',
      actorId: phoneE164,
      aggregateType: 'lead',
      aggregateId: leadRow.lead_id,
      correlationId: input.dedupeKey,
      causationId: input.inboxEventId,
      payload: {
        provider: WHATSAPP_INBOUND_PROVIDER,
        source: WHATSAPP_INBOUND_SOURCE,
        clientRecordId: input.clientRecordId,
        openingMessageLength: openingMessage.length,
        reengagedOptedOutContact: contactRow.opted_out,
      },
      after: {
        leadId: leadRow.lead_id,
        contactId: contactRow.contact_id,
        conversationId: activated.state.conversationId || '',
      },
    });

    // They messaged first, so an earlier opt-out is treated as re-engagement
    // rather than a reason to stay silent. Recorded so it is never implicit.
    if (contactRow.opted_out) {
      await this.audit.record(client, {
        eventType: 'contact.reengaged_after_opt_out',
        actorType: 'external_user',
        actorId: phoneE164,
        aggregateType: 'lead',
        aggregateId: leadRow.lead_id,
        correlationId: input.dedupeKey,
        causationId: input.inboxEventId,
        payload: { contactId: contactRow.contact_id, channel: 'whatsapp' },
      });
    }

    return {
      outcome: 'captured',
      state: activated.state,
      leadId: leadRow.lead_id,
      openingMessage,
    };
  }

  private async resolveClient(
    client: PoolClient,
    clientRecordId: string,
    channelClientId: string,
  ): Promise<ResolvedClient | null> {
    // `edge_client_channels.client_id` is plain text and may be blank or stale,
    // so the legacy_airtable_id join is authoritative and the column is only a
    // fallback when it holds a usable uuid.
    const byRecord = await client.query<{ client_id: string; company_name: string }>(
      `SELECT client_id, company_name
       FROM app.clients
       WHERE legacy_airtable_id=$1
         AND active=true
       LIMIT 1`,
      [clientRecordId],
    );
    const row = byRecord.rows[0];
    if (row) return { clientId: row.client_id, companyName: row.company_name };

    if (!UUID_PATTERN.test(channelClientId)) return null;
    const byId = await client.query<{ client_id: string; company_name: string }>(
      `SELECT client_id, company_name
       FROM app.clients
       WHERE client_id=$1
         AND active=true
       LIMIT 1`,
      [channelClientId],
    );
    const fallback = byId.rows[0];
    return fallback ? { clientId: fallback.client_id, companyName: fallback.company_name } : null;
  }

  /**
   * Fixed-window counters held in PostgreSQL, same shape as the dashboard login
   * throttle. Deliberately on its own connection so the count survives the
   * caller's transaction rolling back when the cap rejects the message.
   */
  private async rateLimited(phoneE164: string, clientId: string): Promise<string> {
    const windowSeconds = Math.ceil(this.env.INBOUND_LEAD_CAPTURE_WINDOW_MS / 1000);
    const subjects: Array<{ key: string; limit: number; label: string }> = [
      { key: `inbound_lead:phone:${phoneE164}`, limit: this.env.INBOUND_LEAD_CAPTURE_PHONE_LIMIT, label: 'phone' },
      { key: `inbound_lead:client:${clientId}`, limit: this.env.INBOUND_LEAD_CAPTURE_CLIENT_LIMIT, label: 'client' },
    ];
    for (const subject of subjects) {
      const result = await pool.query<{ attempt_count: number }>(
        `INSERT INTO app.lead_capture_attempts (attempt_key, window_started_at, attempt_count)
         VALUES ($1, now(), 1)
         ON CONFLICT (attempt_key) DO UPDATE SET
           window_started_at = CASE
             WHEN app.lead_capture_attempts.window_started_at <= now() - make_interval(secs => $2)
             THEN now() ELSE app.lead_capture_attempts.window_started_at END,
           attempt_count = CASE
             WHEN app.lead_capture_attempts.window_started_at <= now() - make_interval(secs => $2)
             THEN 1 ELSE app.lead_capture_attempts.attempt_count + 1 END,
           updated_at = now()
         RETURNING attempt_count`,
        [subject.key, windowSeconds],
      );
      const row = result.rows[0];
      if (!row) throw new Error('lead_capture_attempt_not_recorded');
      if (row.attempt_count > subject.limit) return subject.label;
    }
    return '';
  }

  private async recordIntakeEvent(client: PoolClient, input: {
    clientId: string;
    contactId: string;
    leadId: string;
    phoneE164: string;
    metaMessageId: string;
    receivedAt: string;
    openingMessage: string;
    profileName: string;
    phoneNumberId: string;
    payloadHash: string;
  }): Promise<void> {
    const idempotencyKey = `whatsapp_inbound:${input.clientId}:${input.metaMessageId}`;
    const payload = {
      openingMessage: input.openingMessage,
      profileName: input.profileName,
      phoneNumberId: input.phoneNumberId,
      metaMessageId: input.metaMessageId,
      payloadHash: input.payloadHash,
    };
    const inserted = await client.query<{ intake_event_id: string }>(
      `INSERT INTO app.lead_intake_events
        (lead_id, client_id, contact_id, provider, provider_external_id, idempotency_key, received_at, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)
       ON CONFLICT (client_id, provider, idempotency_key) DO NOTHING
       RETURNING intake_event_id`,
      [
        input.leadId,
        input.clientId,
        input.contactId,
        WHATSAPP_INBOUND_PROVIDER,
        input.phoneE164,
        idempotencyKey,
        input.receivedAt,
        JSON.stringify(payload),
      ],
    );
    if (inserted.rows[0]) return;

    const existing = await client.query<{ same_semantics: boolean }>(
      `SELECT lead_id=$4
          AND contact_id=$5
          AND provider_external_id=$6
          AND payload_json->>'payloadHash'=$7 AS same_semantics
       FROM app.lead_intake_events
       WHERE client_id=$1 AND provider=$2 AND idempotency_key=$3`,
      [
        input.clientId,
        WHATSAPP_INBOUND_PROVIDER,
        idempotencyKey,
        input.leadId,
        input.contactId,
        input.phoneE164,
        input.payloadHash,
      ],
    );
    const row = existing.rows[0];
    if (row && !row.same_semantics) {
      throw new Error(`inbound_lead_capture_idempotency_collision:${idempotencyKey}`);
    }
  }
}
