import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { AuditRepository } from '../infrastructure/runtime.js';

const calendarPayloadSchema = z.object({
  appointmentId: z.string().uuid(),
}).passthrough();

interface LockedCalendarCommand {
  outboxCommandId: string;
  commandType: string;
  state: string;
  providerMessageId: string;
  lastError: string;
  attemptCount: number;
  payload: Record<string, unknown>;
}

interface LockedAppointment {
  appointmentId: string;
  leadId: string;
  status: string;
  calendarEventId: string;
}

export interface AmbiguousCalendarCreate {
  outboxCommandId: string;
  appointmentId: string;
  leadId: string;
  appointmentStatus: string;
  calendarEventId: string;
  attemptCount: number;
  lastError: string;
  createdAt: string;
  startsAt: string;
  endsAt: string;
}

export type CalendarReconciliationResult = {
  outcome: 'confirmed' | 'failed' | 'already_reconciled';
  outboxCommandId: string;
  appointmentId: string;
  previousOutboxState: string;
  appointmentStatus: string;
  providerEventId?: string;
};

export class CalendarReconciliationService {
  constructor(private readonly audit = new AuditRepository()) {}

  async listAmbiguous(limit = 50): Promise<AmbiguousCalendarCreate[]> {
    const result = await pool.query<{
      outbox_command_id: string;
      appointment_id: string | null;
      lead_id: string | null;
      appointment_status: string | null;
      calendar_event_id: string | null;
      attempt_count: number;
      last_error: string;
      created_at: Date;
      starts_at: Date | null;
      ends_at: Date | null;
    }>(
      `SELECT
         oc.outbox_command_id,
         oc.payload_json->>'appointmentId' AS appointment_id,
         a.lead_id,
         a.status AS appointment_status,
         a.calendar_event_id,
         oc.attempt_count,
         oc.last_error,
         oc.created_at,
         a.starts_at,
         a.ends_at
       FROM runtime.outbox_commands oc
       LEFT JOIN app.appointments a ON a.appointment_id::text = oc.payload_json->>'appointmentId'
       WHERE oc.command_type='calendar.create_event'
         AND oc.state='delivery_unknown'
       ORDER BY oc.created_at, oc.outbox_command_id
       LIMIT $1`,
      [Math.max(1, Math.min(limit, 500))],
    );
    return result.rows.map((row) => ({
      outboxCommandId: row.outbox_command_id,
      appointmentId: row.appointment_id || '',
      leadId: row.lead_id || '',
      appointmentStatus: row.appointment_status || '',
      calendarEventId: row.calendar_event_id || '',
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      createdAt: row.created_at.toISOString(),
      startsAt: row.starts_at?.toISOString() || '',
      endsAt: row.ends_at?.toISOString() || '',
    }));
  }

  async confirmCreated(input: {
    outboxCommandId: string;
    providerEventId: string;
    operatorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<CalendarReconciliationResult> {
    const providerEventId = input.providerEventId.trim();
    if (!providerEventId) throw new Error('calendar_reconciliation_provider_event_id_required');
    return withTransaction(async (client) => {
      const { command, appointment } = await this.loadCalendarCreateForUpdate(client, input.outboxCommandId);
      if (command.state === 'delivered') {
        if (command.providerMessageId === providerEventId && appointment.calendarEventId === providerEventId) {
          return {
            outcome: 'already_reconciled',
            outboxCommandId: command.outboxCommandId,
            appointmentId: appointment.appointmentId,
            previousOutboxState: command.state,
            appointmentStatus: appointment.status,
            providerEventId,
          };
        }
        throw new Error(`calendar_reconciliation_already_delivered_with_different_provider_id:${command.outboxCommandId}`);
      }
      if (command.state !== 'delivery_unknown') {
        throw new Error(`calendar_reconciliation_requires_delivery_unknown:${command.state}`);
      }
      if (appointment.calendarEventId && appointment.calendarEventId !== providerEventId) {
        throw new Error(`calendar_reconciliation_appointment_provider_id_collision:${appointment.appointmentId}`);
      }

      await client.query(
        `UPDATE runtime.outbox_commands
         SET state='delivered',
             provider_message_id=$2,
             completed_at=now(),
             last_error='',
             lock_owner='',
             locked_at=NULL,
             lock_expires_at=NULL
         WHERE outbox_command_id=$1`,
        [command.outboxCommandId, providerEventId],
      );
      await client.query(
        `UPDATE app.appointments
         SET calendar_event_id=$2,
             status='confirmed',
             updated_at=now()
         WHERE appointment_id=$1`,
        [appointment.appointmentId, providerEventId],
      );
      await this.audit.record(client, {
        eventType: 'calendar.create_reconciled',
        actorType: 'operator',
        actorId: input.operatorId || 'calendar-reconcile',
        aggregateType: 'lead',
        aggregateId: appointment.leadId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        before: {
          outboxState: command.state,
          appointmentStatus: appointment.status,
          calendarEventId: appointment.calendarEventId,
        },
        after: {
          outboxState: 'delivered',
          appointmentStatus: 'confirmed',
          calendarEventId: providerEventId,
        },
        payload: {
          outboxCommandId: command.outboxCommandId,
          appointmentId: appointment.appointmentId,
          action: 'confirm_created',
        },
      });
      return {
        outcome: 'confirmed',
        outboxCommandId: command.outboxCommandId,
        appointmentId: appointment.appointmentId,
        previousOutboxState: command.state,
        appointmentStatus: 'confirmed',
        providerEventId,
      };
    });
  }

  async markCreateFailed(input: {
    outboxCommandId: string;
    reason: string;
    operatorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<CalendarReconciliationResult> {
    const reason = input.reason.trim().slice(0, 4000);
    if (!reason) throw new Error('calendar_reconciliation_failure_reason_required');
    return withTransaction(async (client) => {
      const { command, appointment } = await this.loadCalendarCreateForUpdate(client, input.outboxCommandId);
      if (command.state === 'permanently_failed') {
        return {
          outcome: 'already_reconciled',
          outboxCommandId: command.outboxCommandId,
          appointmentId: appointment.appointmentId,
          previousOutboxState: command.state,
          appointmentStatus: appointment.status,
        };
      }
      if (command.state !== 'delivery_unknown') {
        throw new Error(`calendar_reconciliation_requires_delivery_unknown:${command.state}`);
      }

      await client.query(
        `UPDATE runtime.outbox_commands
         SET state='permanently_failed',
             last_error=$2,
             completed_at=now(),
             lock_owner='',
             locked_at=NULL,
             lock_expires_at=NULL
         WHERE outbox_command_id=$1`,
        [command.outboxCommandId, reason],
      );
      await client.query(
        `UPDATE app.appointments
         SET updated_at=now()
         WHERE appointment_id=$1`,
        [appointment.appointmentId],
      );
      await client.query(
        `INSERT INTO runtime.dead_letters (source_table, source_id, reason, payload_json)
         VALUES ('runtime.outbox_commands', $1, $2, $3::jsonb)
         ON CONFLICT DO NOTHING`,
        [command.outboxCommandId, reason, JSON.stringify(command.payload)],
      );
      await this.audit.record(client, {
        eventType: 'calendar.create_reconciliation_failed',
        actorType: 'operator',
        actorId: input.operatorId || 'calendar-reconcile',
        aggregateType: 'lead',
        aggregateId: appointment.leadId,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        before: {
          outboxState: command.state,
          appointmentStatus: appointment.status,
          calendarEventId: appointment.calendarEventId,
        },
        after: {
          outboxState: 'permanently_failed',
          appointmentStatus: appointment.status,
          calendarEventId: appointment.calendarEventId,
        },
        payload: {
          outboxCommandId: command.outboxCommandId,
          appointmentId: appointment.appointmentId,
          action: 'mark_failed',
          reason,
        },
      });
      return {
        outcome: 'failed',
        outboxCommandId: command.outboxCommandId,
        appointmentId: appointment.appointmentId,
        previousOutboxState: command.state,
        appointmentStatus: appointment.status,
      };
    });
  }

  private async loadCalendarCreateForUpdate(client: PoolClient, outboxCommandId: string): Promise<{
    command: LockedCalendarCommand;
    appointment: LockedAppointment;
  }> {
    const commandResult = await client.query<{
      outbox_command_id: string;
      command_type: string;
      state: string;
      provider_message_id: string;
      last_error: string;
      attempt_count: number;
      payload_json: Record<string, unknown>;
    }>(
      `SELECT outbox_command_id, command_type, state, provider_message_id, last_error, attempt_count, payload_json
       FROM runtime.outbox_commands
       WHERE outbox_command_id=$1
       FOR UPDATE`,
      [outboxCommandId],
    );
    const row = commandResult.rows[0];
    if (!row) throw new Error(`calendar_reconciliation_outbox_not_found:${outboxCommandId}`);
    if (row.command_type !== 'calendar.create_event') {
      throw new Error(`calendar_reconciliation_unsupported_command:${row.command_type}`);
    }
    const payload = calendarPayloadSchema.parse(row.payload_json);
    const appointmentResult = await client.query<{
      appointment_id: string;
      lead_id: string;
      status: string;
      calendar_event_id: string;
    }>(
      `SELECT appointment_id, lead_id, status, calendar_event_id
       FROM app.appointments
       WHERE appointment_id=$1
       FOR UPDATE`,
      [payload.appointmentId],
    );
    const appointment = appointmentResult.rows[0];
    if (!appointment) throw new Error(`calendar_reconciliation_appointment_not_found:${payload.appointmentId}`);
    return {
      command: {
        outboxCommandId: row.outbox_command_id,
        commandType: row.command_type,
        state: row.state,
        providerMessageId: row.provider_message_id,
        lastError: row.last_error,
        attemptCount: row.attempt_count,
        payload: row.payload_json,
      },
      appointment: {
        appointmentId: appointment.appointment_id,
        leadId: appointment.lead_id,
        status: appointment.status,
        calendarEventId: appointment.calendar_event_id,
      },
    };
  }
}
