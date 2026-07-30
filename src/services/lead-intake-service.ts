import type { PoolClient } from 'pg';
import { z } from 'zod';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';
import { messageText } from './message-request-service.js';

type Db = typeof pool | PoolClient;

const templatePayloadSchema = z.object({
  kind: z.literal('template'),
  templateName: z.string().min(1),
  languageCode: z.string().min(2),
  components: z.array(z.record(z.unknown())).optional().default([]),
});

export const leadIntakeSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientKey: z.string().min(1).optional(),
  provider: z.string().min(1).default('internal'),
  providerExternalId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  source: z.string().min(1).default('lead_intake'),
  status: z.string().min(1).default('new'),
  currentStage: z.string().optional().default(''),
  receivedAt: z.string().datetime().optional(),
  contact: z.object({
    name: z.string().optional().default(''),
    phoneRaw: z.string().optional().default(''),
    phoneE164: z.string().optional().default(''),
    email: z.string().optional().default(''),
    consentStatus: z.string().optional().default('unknown'),
  }),
  project: z.object({
    projectId: z.string().uuid().optional(),
    legacyAirtableId: z.string().min(1).optional(),
    projectName: z.string().min(1).optional(),
    projectInterest: z.string().optional().default(''),
  }).optional().default({}),
  rawPayload: z.record(z.unknown()).optional().default({}),
  firstContact: z.object({
    phoneNumberId: z.string().optional().default(''),
    requestKey: z.string().min(1).optional(),
    payload: templatePayloadSchema,
  }).optional(),
  actorId: z.string().optional().default('system'),
});

export type LeadIntakeInput = z.input<typeof leadIntakeSchema>;

export interface LeadIntakeResult {
  clientId: string;
  contactId: string;
  leadId: string;
  intakeEventId: string;
  duplicate: boolean;
  idempotencyKey: string;
  firstContact: {
    suppressed: boolean;
    suppressionReason: string;
    messageId: string;
    outboxCommandId: string;
    idempotencyKey: string;
  } | null;
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('20')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+20${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `+20${digits}`;
  return trimmed;
}

export function leadIntakeIdempotencyKey(input: {
  clientId: string;
  provider: string;
  providerExternalId: string;
}): string {
  return `lead_intake:${input.clientId}:${input.provider}:${input.providerExternalId}`;
}

export class LeadIntakeService {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
    private readonly policy = {
      approvedTemplateNames: getEnv().META_APPROVED_TEMPLATE_NAMES
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    },
  ) {}

  async intake(input: LeadIntakeInput): Promise<LeadIntakeResult> {
    const parsed = leadIntakeSchema.parse(input);
    if (!parsed.clientId && !parsed.clientKey) throw Object.assign(new Error('client_identity_required'), { statusCode: 400 });
    const phoneE164 = normalizePhone(parsed.contact.phoneE164 || parsed.contact.phoneRaw);
    if (!/^\+\d{8,15}$/.test(phoneE164)) throw Object.assign(new Error('valid_contact_phone_required'), { statusCode: 400 });
    if (parsed.firstContact && !this.policy.approvedTemplateNames.includes(parsed.firstContact.payload.templateName)) {
      throw Object.assign(new Error(`whatsapp_template_not_approved:${parsed.firstContact.payload.templateName}`), { statusCode: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const clientId = await this.resolveClientId(client, parsed);
      const payloadHash = sha256Hex(stableJson({
        provider: parsed.provider,
        providerExternalId: parsed.providerExternalId || '',
        source: parsed.source,
        contact: parsed.contact,
        project: parsed.project,
        rawPayload: parsed.rawPayload,
      }));
      const providerExternalId = parsed.providerExternalId || `sha256:${payloadHash}`;
      const idempotencyKey = parsed.idempotencyKey || leadIntakeIdempotencyKey({
        clientId,
        provider: parsed.provider,
        providerExternalId,
      });

      const contact = await client.query<{ contact_id: string; opted_out: boolean }>(
        `INSERT INTO app.contacts
          (client_id, name, phone_raw, phone_e164, email, consent_status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (client_id, phone_e164) DO UPDATE SET
          name=COALESCE(NULLIF(EXCLUDED.name, ''), app.contacts.name),
          phone_raw=COALESCE(NULLIF(EXCLUDED.phone_raw, ''), app.contacts.phone_raw),
          email=COALESCE(NULLIF(EXCLUDED.email, ''), app.contacts.email),
          consent_status=COALESCE(NULLIF(EXCLUDED.consent_status, ''), app.contacts.consent_status),
          updated_at=now()
         RETURNING contact_id, opted_out`,
        [
          clientId,
          parsed.contact.name,
          parsed.contact.phoneRaw || phoneE164,
          phoneE164,
          parsed.contact.email,
          parsed.contact.consentStatus,
        ],
      );
      const contactRow = contact.rows[0];
      if (!contactRow) throw new Error('contact_not_created');

      const projectId = await this.resolveProjectId(client, clientId, parsed.project);
      const lead = await client.query<{ lead_id: string }>(
        `INSERT INTO app.leads
          (client_id, contact_id, project_id, provider, provider_external_id,
           source, source_payload_hash, status, current_stage, first_received_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, now()))
         ON CONFLICT (client_id, provider, provider_external_id) DO UPDATE SET
          contact_id=EXCLUDED.contact_id,
          project_id=COALESCE(EXCLUDED.project_id, app.leads.project_id),
          source=EXCLUDED.source,
          source_payload_hash=EXCLUDED.source_payload_hash,
          status=COALESCE(NULLIF(EXCLUDED.status, ''), app.leads.status),
          current_stage=COALESCE(NULLIF(EXCLUDED.current_stage, ''), app.leads.current_stage),
          updated_at=now()
         RETURNING lead_id`,
        [
          clientId,
          contactRow.contact_id,
          projectId,
          parsed.provider,
          providerExternalId,
          parsed.source || parsed.project.projectInterest,
          payloadHash,
          parsed.status,
          parsed.currentStage,
          parsed.receivedAt || null,
        ],
      );
      const leadId = lead.rows[0]?.lead_id;
      if (!leadId) throw new Error('lead_not_created');

      const intakeEvent = await client.query<{ intake_event_id: string; inserted: boolean }>(
        `INSERT INTO app.lead_intake_events
          (lead_id, client_id, contact_id, provider, provider_external_id, idempotency_key, received_at, payload_json)
         VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8::jsonb)
         ON CONFLICT (client_id, provider, idempotency_key) DO UPDATE SET
          lead_id=EXCLUDED.lead_id,
          contact_id=EXCLUDED.contact_id
         RETURNING intake_event_id, (xmax = 0) AS inserted`,
        [
          leadId,
          clientId,
          contactRow.contact_id,
          parsed.provider,
          providerExternalId,
          idempotencyKey,
          parsed.receivedAt || null,
          JSON.stringify({
            contact: parsed.contact,
            project: parsed.project,
            rawPayload: parsed.rawPayload,
            payloadHash,
          }),
        ],
      );
      const intakeRow = intakeEvent.rows[0];
      if (!intakeRow) throw new Error('lead_intake_event_not_created');

      let firstContact: LeadIntakeResult['firstContact'] = null;
      if (parsed.firstContact) {
        if (contactRow.opted_out) {
          firstContact = {
            suppressed: true,
            suppressionReason: 'contact_opted_out',
            messageId: '',
            outboxCommandId: '',
            idempotencyKey: '',
          };
        } else {
          const requestKey = parsed.firstContact.requestKey || `lead_intake:${leadId}`;
          const messageIdempotencyKey = `whatsapp.send:${clientId}:${requestKey}:${sha256Hex(stableJson(parsed.firstContact.payload)).slice(0, 24)}`;
          const message = await client.query<{ message_id: string }>(
            `INSERT INTO app.messages
              (lead_id, client_id, contact_id, direction, channel, to_address,
               message_text, message_type, state, raw_payload, idempotency_key)
             VALUES ($1, $2, $3, 'outbound', 'whatsapp', $4, $5, 'template', 'queued', $6::jsonb, $7)
             ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key <> ''
             DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
             RETURNING message_id`,
            [
              leadId,
              clientId,
              contactRow.contact_id,
              phoneE164,
              messageText(parsed.firstContact.payload),
              JSON.stringify({
                provider: 'meta',
                phoneNumberId: parsed.firstContact.phoneNumberId,
                toE164: phoneE164,
                message: parsed.firstContact.payload,
                idempotencyKey: messageIdempotencyKey,
                source: 'lead_intake',
              }),
              messageIdempotencyKey,
            ],
          );
          const messageId = message.rows[0]?.message_id;
          if (!messageId) throw new Error('first_contact_message_not_created');
          const outboxCommandId = await this.outbox.enqueue(client, {
            commandType: 'whatsapp.send_message',
            destination: phoneE164,
            idempotencyKey: messageIdempotencyKey,
            aggregateKey: leadId,
            payload: {
              provider: 'meta',
              phoneNumberId: parsed.firstContact.phoneNumberId,
              toE164: phoneE164,
              message: parsed.firstContact.payload,
              messageId,
              leadId,
            },
          });
          await client.query(
            `UPDATE app.leads
             SET first_contacted_at=COALESCE(first_contacted_at, now()),
                 last_outbound_at=now(),
                 updated_at=now()
             WHERE lead_id=$1`,
            [leadId],
          );
          firstContact = {
            suppressed: false,
            suppressionReason: '',
            messageId,
            outboxCommandId,
            idempotencyKey: messageIdempotencyKey,
          };
        }
      }

      if (intakeRow.inserted) {
        await this.audit.record(client, {
          eventType: 'lead.intake_received',
          actorType: 'system',
          actorId: parsed.actorId,
          aggregateType: 'lead',
          aggregateId: leadId,
          correlationId: idempotencyKey,
          payload: {
            provider: parsed.provider,
            source: parsed.source,
            firstContactSuppressed: firstContact?.suppressed || false,
          },
          after: {
            leadId,
            contactId: contactRow.contact_id,
            status: parsed.status,
          },
        });
      }

      await client.query('COMMIT');
      return {
        clientId,
        contactId: contactRow.contact_id,
        leadId,
        intakeEventId: intakeRow.intake_event_id,
        duplicate: !intakeRow.inserted,
        idempotencyKey,
        firstContact,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async resolveClientId(client: Db, input: z.output<typeof leadIntakeSchema>): Promise<string> {
    if (input.clientId) return input.clientId;
    const result = await client.query<{ client_id: string }>(
      `SELECT client_id
       FROM app.clients
       WHERE client_key=$1 OR legacy_airtable_id=$1
       LIMIT 1`,
      [input.clientKey || ''],
    );
    const clientId = result.rows[0]?.client_id;
    if (!clientId) throw Object.assign(new Error('client_not_found'), { statusCode: 404 });
    return clientId;
  }

  private async resolveProjectId(
    client: Db,
    clientId: string,
    project: z.output<typeof leadIntakeSchema>['project'],
  ): Promise<string | null> {
    if (project.projectId) {
      const result = await client.query<{ project_id: string }>(
        'SELECT project_id FROM app.projects WHERE project_id=$1 AND client_id=$2',
        [project.projectId, clientId],
      );
      if (!result.rows[0]) throw Object.assign(new Error('project_not_found'), { statusCode: 404 });
      return result.rows[0].project_id;
    }
    if (project.legacyAirtableId) {
      const result = await client.query<{ project_id: string }>(
        'SELECT project_id FROM app.projects WHERE legacy_airtable_id=$1 AND (client_id=$2 OR client_id IS NULL) LIMIT 1',
        [project.legacyAirtableId, clientId],
      );
      if (!result.rows[0]) throw Object.assign(new Error('project_not_found'), { statusCode: 404 });
      return result.rows[0].project_id;
    }
    if (project.projectName) {
      const result = await client.query<{ project_id: string }>(
        `SELECT project_id
         FROM app.projects
         WHERE lower(project_name)=lower($1)
           AND active=true
           AND (client_id=$2 OR client_id IS NULL)
         ORDER BY client_id NULLS LAST, created_at DESC
         LIMIT 1`,
        [project.projectName, clientId],
      );
      return result.rows[0]?.project_id || null;
    }
    return null;
  }
}
