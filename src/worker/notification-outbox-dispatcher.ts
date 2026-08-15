import { z } from 'zod';
import { pool } from '../db/pool.js';
import type { ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import type { OutboxDispatchResult } from './runtime-worker.js';

const notificationCommandTypes = [
  'salesperson.lead_assignment_notification',
  'salesperson.sla_assignment_reminder',
  'operator.sla_escalation',
  'operator.daily_report',
  'operator.routing_attention_required',
] as const;

type NotificationCommandType = typeof notificationCommandTypes[number];

const optionalUuid = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.string().uuid().optional(),
);

const notificationPayloadSchema = z.object({
  clientId: optionalUuid,
  leadId: optionalUuid,
  assignmentId: optionalUuid,
  salespersonId: optionalUuid,
}).passthrough();

export function isNotificationCommandType(commandType: string): commandType is NotificationCommandType {
  return (notificationCommandTypes as readonly string[]).includes(commandType);
}

function recipientType(commandType: NotificationCommandType): string {
  return commandType.startsWith('salesperson.') ? 'salesperson' : 'operator';
}

function priority(commandType: NotificationCommandType): string {
  return commandType === 'operator.sla_escalation' || commandType === 'operator.routing_attention_required'
    ? 'high'
    : 'normal';
}

async function resolveClientId(input: {
  clientId?: string;
  leadId?: string;
  assignmentId?: string;
}): Promise<string> {
  if (input.clientId) return input.clientId;
  if (input.leadId) {
    const result = await pool.query<{ client_id: string }>(
      'SELECT client_id FROM app.leads WHERE lead_id=$1',
      [input.leadId],
    );
    const clientId = result.rows[0]?.client_id;
    if (clientId) return clientId;
  }
  if (input.assignmentId) {
    const result = await pool.query<{ client_id: string }>(
      `SELECT l.client_id
       FROM app.lead_assignments a
       JOIN app.leads l ON l.lead_id=a.lead_id
       WHERE a.lead_assignment_id=$1`,
      [input.assignmentId],
    );
    const clientId = result.rows[0]?.client_id;
    if (clientId) return clientId;
  }
  throw new Error('notification_client_id_unresolved');
}

export class NotificationOutboxDispatcher {
  async dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> {
    if (!isNotificationCommandType(command.commandType)) {
      return { outcome: 'permanently_failed', error: `unsupported_notification_outbox_command:${command.commandType}` };
    }

    const parsed = notificationPayloadSchema.safeParse(command.payload);
    if (!parsed.success) {
      return { outcome: 'permanently_failed', error: `invalid_notification_payload:${parsed.error.issues[0]?.message || 'unknown'}` };
    }

    let clientId: string;
    try {
      clientId = await resolveClientId({
        ...(parsed.data.clientId ? { clientId: parsed.data.clientId } : {}),
        ...(parsed.data.leadId ? { leadId: parsed.data.leadId } : {}),
        ...(parsed.data.assignmentId ? { assignmentId: parsed.data.assignmentId } : {}),
      });
    } catch (error) {
      return { outcome: 'permanently_failed', error: String(error instanceof Error ? error.message : error) };
    }

    const recipient = recipientType(command.commandType);
    if (recipient === 'salesperson' && !parsed.data.salespersonId) {
      return { outcome: 'permanently_failed', error: 'notification_salesperson_id_required' };
    }
    const result = await pool.query<{ notification_id: string }>(
      `INSERT INTO app.notifications
        (source_outbox_command_id, client_id, recipient_type, recipient_id, notification_type, payload_json, priority)
       VALUES ($1, $2, $3, NULLIF($4, '')::uuid, $5, $6::jsonb, $7)
       ON CONFLICT (source_outbox_command_id) DO UPDATE SET source_outbox_command_id=EXCLUDED.source_outbox_command_id
       RETURNING notification_id`,
      [
        command.outboxCommandId,
        clientId,
        recipient,
        recipient === 'salesperson' ? parsed.data.salespersonId || '' : '',
        command.commandType,
        JSON.stringify(command.payload),
        priority(command.commandType),
      ],
    );
    const notificationId = result.rows[0]?.notification_id;
    if (!notificationId) return { outcome: 'delivery_unknown', error: 'notification_not_persisted' };
    return { outcome: 'delivered', providerMessageId: notificationId };
  }
}

export const notificationOutboxCommandTypes = [...notificationCommandTypes];
