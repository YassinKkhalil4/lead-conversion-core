import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { InboxRepository, stableJson } from '../infrastructure/runtime.js';
import { LeadIntakeService, type LeadIntakeInput } from '../services/lead-intake-service.js';
import { requireSharedSecret } from './auth.js';

const templatePayloadSchema = z.object({
  kind: z.literal('template'),
  templateName: z.string().min(1),
  languageCode: z.string().min(2),
  components: z.array(z.record(z.unknown())).optional().default([]),
});

const firstContactSchema = z.object({
  phoneNumberId: z.string().optional().default(''),
  requestKey: z.string().min(1).optional(),
  payload: templatePayloadSchema,
}).optional();

const websiteLeadSchema = z.object({
  eventId: z.string().min(1).optional(),
  clientId: z.string().uuid().optional(),
  clientKey: z.string().min(1).optional(),
  name: z.string().optional().default(''),
  phone: z.string().min(5),
  email: z.string().optional().default(''),
  projectName: z.string().optional(),
  projectLegacyId: z.string().optional(),
  campaign: z.string().optional().default(''),
  firstContact: firstContactSchema,
}).passthrough();

const facebookFieldSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string()).default([]),
});

const facebookLeadSchema = z.object({
  clientId: z.string().uuid().optional(),
  clientKey: z.string().min(1).optional(),
  leadgen_id: z.string().min(1),
  form_id: z.string().optional().default(''),
  page_id: z.string().optional().default(''),
  ad_id: z.string().optional().default(''),
  campaign_id: z.string().optional().default(''),
  field_data: z.array(facebookFieldSchema).min(1),
  firstContact: firstContactSchema,
}).passthrough();

function publicHeaders(request: FastifyRequest): Record<string, unknown> {
  return {
    'content-type': request.headers['content-type'] || '',
    'user-agent': request.headers['user-agent'] || '',
  };
}

function fieldData(fields: Array<z.output<typeof facebookFieldSchema>>): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.values[0] || '']));
}

function statusCode(error: unknown): number {
  return Number((error as { statusCode?: number }).statusCode || 500);
}

export async function leadIngressRoutes(app: FastifyInstance): Promise<void> {
  const inbox = new InboxRepository();
  const intake = new LeadIntakeService();

  async function receiveAndProcess(input: {
    request: FastifyRequest;
    reply: FastifyReply;
    provider: 'website' | 'facebook';
    eventType: string;
    externalEventId?: string;
    parse: (payload: Record<string, unknown>) => LeadIntakeInput;
  }): Promise<Record<string, unknown>> {
    requireSharedSecret(input.request);
    const payload = (input.request.body || {}) as Record<string, unknown>;
    const receiptInput = {
      provider: input.provider,
      eventType: input.eventType,
      rawBody: Buffer.from(stableJson(payload)),
      headers: publicHeaders(input.request),
      payload,
      signatureValid: true,
      aggregateKey: input.externalEventId || '',
    };
    const receipt = await inbox.receive(input.externalEventId
      ? { ...receiptInput, externalEventId: input.externalEventId }
      : receiptInput);

    let command: LeadIntakeInput;
    try {
      command = input.parse(payload);
    } catch (error) {
      await inbox.ignore(receipt.inboxEventId, error instanceof Error ? error.message : String(error));
      input.reply.code(400);
      return { ok: false, inboxEventId: receipt.inboxEventId, duplicate: receipt.duplicate, error: 'invalid_lead_payload' };
    }

    try {
      const result = await intake.intake(command);
      await inbox.complete(receipt.inboxEventId);
      return { ok: true, inboxEventId: receipt.inboxEventId, inboxDuplicate: receipt.duplicate, intake: result };
    } catch (error) {
      if (statusCode(error) < 500) {
        await inbox.ignore(receipt.inboxEventId, error instanceof Error ? error.message : String(error));
        input.reply.code(statusCode(error));
        return { ok: false, inboxEventId: receipt.inboxEventId, duplicate: receipt.duplicate, error: error instanceof Error ? error.message : String(error) };
      }
      await inbox.retry(receipt.inboxEventId, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  app.post('/webhooks/leads/website', async (request: FastifyRequest, reply: FastifyReply) => {
    const externalEventId = String((request.body as Record<string, unknown> | null)?.eventId || '');
    return receiveAndProcess({
      request,
      reply,
      provider: 'website',
      eventType: 'lead.created',
      externalEventId,
      parse: (payload) => {
        const parsed = websiteLeadSchema.parse(payload);
        return {
          clientId: parsed.clientId,
          clientKey: parsed.clientKey,
          provider: 'website',
          providerExternalId: parsed.eventId,
          source: parsed.campaign || 'website_form',
          contact: {
            name: parsed.name,
            phoneRaw: parsed.phone,
            email: parsed.email,
            consentStatus: 'website_form',
          },
          project: {
            legacyAirtableId: parsed.projectLegacyId,
            projectName: parsed.projectName,
            projectInterest: parsed.projectName || '',
          },
          rawPayload: payload,
          firstContact: parsed.firstContact,
        };
      },
    });
  });

  app.post('/webhooks/leads/facebook', async (request: FastifyRequest, reply: FastifyReply) => {
    const externalEventId = String((request.body as Record<string, unknown> | null)?.leadgen_id || '');
    return receiveAndProcess({
      request,
      reply,
      provider: 'facebook',
      eventType: 'leadgen.created',
      externalEventId,
      parse: (payload) => {
        const parsed = facebookLeadSchema.parse(payload);
        const fields = fieldData(parsed.field_data);
        return {
          clientId: parsed.clientId,
          clientKey: parsed.clientKey,
          provider: 'facebook',
          providerExternalId: parsed.leadgen_id,
          source: 'facebook_lead_ads',
          contact: {
            name: fields.full_name || fields.name || '',
            phoneRaw: fields.phone_number || fields.phone || '',
            email: fields.email || '',
            consentStatus: 'facebook_lead_form',
          },
          project: {
            projectName: fields.project_name || fields.project || '',
            projectInterest: fields.project_name || fields.project || '',
          },
          rawPayload: {
            ...payload,
            page_id: parsed.page_id,
            form_id: parsed.form_id,
            ad_id: parsed.ad_id,
            campaign_id: parsed.campaign_id,
          },
          firstContact: parsed.firstContact,
        };
      },
    });
  });
}
