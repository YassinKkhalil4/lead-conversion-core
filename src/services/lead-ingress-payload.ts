import { z } from 'zod';
import type { LeadIntakeInput } from './lead-intake-service.js';

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

function fieldData(fields: Array<z.output<typeof facebookFieldSchema>>): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.name, field.values[0] || '']));
}

export function websiteLeadIntakeInput(payload: Record<string, unknown>): LeadIntakeInput {
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
}

export function facebookLeadIntakeInput(payload: Record<string, unknown>): LeadIntakeInput {
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
}
