import { z } from 'zod';
import type { MessagingPayload } from './types.js';

const optionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

/**
 * One WhatsApp message body, as accepted by the internal send API and as
 * re-validated by the outbox dispatcher before it reaches Meta. Option counts
 * are WhatsApp's own limits: three reply buttons, ten list rows.
 */
export const messagingPayloadSchema: z.ZodType<MessagingPayload, z.ZodTypeDef, unknown> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('buttons'),
    text: z.string().min(1),
    options: z.array(optionSchema).min(1).max(3),
  }),
  z.object({
    kind: z.literal('list'),
    text: z.string().min(1),
    buttonText: z.string().min(1),
    options: z.array(optionSchema).min(1).max(10),
  }),
  z.object({
    kind: z.literal('template'),
    templateName: z.string().min(1),
    languageCode: z.string().min(2),
    components: z.array(z.record(z.unknown())).default([]),
  }),
]);
