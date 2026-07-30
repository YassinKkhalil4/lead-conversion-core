import { z } from 'zod';
import type { ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import type { OutboxDispatchResult } from './runtime-worker.js';
import type { MessageProvider, SendMessageCommand } from '../integrations/messaging/types.js';

const optionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

const payloadSchema = z.discriminatedUnion('kind', [
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

const commandPayloadSchema = z.object({
  provider: z.literal('meta').default('meta'),
  phoneNumberId: z.string().default(''),
  toE164: z.string().min(5),
  message: payloadSchema,
});

const assignmentNotificationSchema = z.object({
  leadId: z.string().uuid(),
  routingRunId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  salespersonId: z.string().uuid(),
  clientId: z.string().uuid(),
  contactName: z.string().default(''),
  contactPhoneE164: z.string().min(5),
  projectName: z.string().default(''),
  leadScore: z.number().int().nullable().optional(),
  temperature: z.string().default(''),
  phoneNumberId: z.string().default(''),
});

const routingAlertSchema = z.object({
  leadId: z.string().uuid(),
  routingRunId: z.string().uuid(),
  clientId: z.string().uuid(),
  companyName: z.string().default(''),
  reason: z.string().min(1),
  phoneNumberId: z.string().default(''),
});

const slaAssignmentReminderSchema = z.object({
  slaJobId: z.string().uuid(),
  leadId: z.string().uuid(),
  assignmentId: z.string().uuid(),
  salespersonId: z.string().uuid(),
  contactName: z.string().default(''),
  contactPhoneE164: z.string().min(5),
  phoneNumberId: z.string().default(''),
});

const slaEscalationSchema = z.object({
  slaJobId: z.string().uuid(),
  slaType: z.enum(['assignment_ack_escalation', 'stale_qualified_escalation']),
  leadId: z.string().uuid(),
  assignmentId: z.string().default(''),
  salespersonId: z.string().default(''),
  contactName: z.string().default(''),
  contactPhoneE164: z.string().min(5),
  reason: z.string().min(1),
  phoneNumberId: z.string().default(''),
});

function textLine(label: string, value: string): string {
  return value ? `${label}: ${value}` : '';
}

function notificationPayload(command: ClaimedOutboxCommand): { phoneNumberId: string; message: SendMessageCommand['payload'] } | null {
  if (command.commandType === 'salesperson.lead_assignment_notification') {
    const parsed = assignmentNotificationSchema.safeParse(command.payload);
    if (!parsed.success) return null;
    const lines = [
      'New lead assigned.',
      textLine('Lead', parsed.data.contactName),
      textLine('Phone', parsed.data.contactPhoneE164),
      textLine('Project', parsed.data.projectName),
      textLine('Score', parsed.data.leadScore === undefined || parsed.data.leadScore === null ? '' : String(parsed.data.leadScore)),
      textLine('Temperature', parsed.data.temperature),
      `Assignment ID: ${parsed.data.assignmentId}`,
    ].filter(Boolean);
    return { phoneNumberId: parsed.data.phoneNumberId, message: { kind: 'text', text: lines.join('\n') } };
  }
  if (command.commandType === 'operator.routing_attention_required') {
    const parsed = routingAlertSchema.safeParse(command.payload);
    if (!parsed.success) return null;
    const lines = [
      'Routing attention required.',
      textLine('Company', parsed.data.companyName),
      `Reason: ${parsed.data.reason}`,
      `Lead ID: ${parsed.data.leadId}`,
      `Routing run ID: ${parsed.data.routingRunId}`,
    ].filter(Boolean);
    return { phoneNumberId: parsed.data.phoneNumberId, message: { kind: 'text', text: lines.join('\n') } };
  }
  if (command.commandType === 'salesperson.sla_assignment_reminder') {
    const parsed = slaAssignmentReminderSchema.safeParse(command.payload);
    if (!parsed.success) return null;
    const lines = [
      'Lead assignment still needs acknowledgement.',
      textLine('Lead', parsed.data.contactName),
      textLine('Phone', parsed.data.contactPhoneE164),
      `Assignment ID: ${parsed.data.assignmentId}`,
      `SLA ID: ${parsed.data.slaJobId}`,
    ].filter(Boolean);
    return { phoneNumberId: parsed.data.phoneNumberId, message: { kind: 'text', text: lines.join('\n') } };
  }
  if (command.commandType === 'operator.sla_escalation') {
    const parsed = slaEscalationSchema.safeParse(command.payload);
    if (!parsed.success) return null;
    const lines = [
      'SLA escalation.',
      `Reason: ${parsed.data.reason}`,
      textLine('Lead', parsed.data.contactName),
      textLine('Phone', parsed.data.contactPhoneE164),
      textLine('Salesperson ID', parsed.data.salespersonId),
      textLine('Assignment ID', parsed.data.assignmentId),
      `Lead ID: ${parsed.data.leadId}`,
      `SLA ID: ${parsed.data.slaJobId}`,
    ].filter(Boolean);
    return { phoneNumberId: parsed.data.phoneNumberId, message: { kind: 'text', text: lines.join('\n') } };
  }
  return null;
}

export class MessagingOutboxDispatcher {
  constructor(private readonly providers: { meta: MessageProvider }) {}

  async dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> {
    if (![
      'whatsapp.send_message',
      'salesperson.lead_assignment_notification',
      'operator.routing_attention_required',
      'salesperson.sla_assignment_reminder',
      'operator.sla_escalation',
    ].includes(command.commandType)) {
      return { outcome: 'permanently_failed', error: `unsupported_outbox_command:${command.commandType}` };
    }

    let sendCommand: SendMessageCommand;
    if (command.commandType === 'whatsapp.send_message') {
      const parsed = commandPayloadSchema.safeParse(command.payload);
      if (!parsed.success) {
        return { outcome: 'permanently_failed', error: `invalid_whatsapp_send_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
      }
      sendCommand = {
        destination: {
          channel: 'whatsapp',
          provider: parsed.data.provider,
          phoneNumberId: parsed.data.phoneNumberId,
          toE164: parsed.data.toE164 || command.destination,
        },
        payload: parsed.data.message,
        idempotencyKey: command.idempotencyKey,
      };
    } else {
      const mapped = notificationPayload(command);
      if (!mapped) {
        return { outcome: 'permanently_failed', error: `invalid_notification_payload:${command.commandType}` };
      }
      sendCommand = {
        destination: {
          channel: 'whatsapp',
          provider: 'meta',
          phoneNumberId: mapped.phoneNumberId,
          toE164: command.destination,
        },
        payload: mapped.message,
        idempotencyKey: command.idempotencyKey,
      };
    }

    const result = await this.providers.meta.send(sendCommand);
    if (result.outcome === 'accepted') {
      return { outcome: 'delivered', providerMessageId: result.providerMessageId };
    }
    if (result.outcome === 'retryable') {
      return result.retryAfterSeconds === undefined
        ? { outcome: 'retryable', error: result.error }
        : { outcome: 'retryable', error: result.error, retryAfterSeconds: result.retryAfterSeconds };
    }
    if (result.outcome === 'delivery_unknown') {
      return { outcome: 'delivery_unknown', error: result.error };
    }
    return { outcome: 'permanently_failed', error: result.error };
  }
}
