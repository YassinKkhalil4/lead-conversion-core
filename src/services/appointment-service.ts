import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import { AuditRepository, RuntimeOutboxRepository, sha256Hex, stableJson } from '../infrastructure/runtime.js';

type Db = typeof pool | PoolClient;

interface AppointmentOfferResult {
  appointmentOfferId: string;
  semanticKey: string;
  slotIds: string[];
  inserted: boolean;
}

interface AppointmentBookingResult {
  outcome: 'booked' | 'duplicate' | 'already_booked' | 'expired' | 'cancelled';
  appointmentId: string;
  outboxCommandId: string;
}

function addMinutes(value: string, minutes: number): string {
  return new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
}

function sortedIsoDates(values: string[]): string[] {
  return values.map((value) => new Date(value).toISOString()).sort();
}

export class AppointmentService {
  constructor(
    private readonly outbox = new RuntimeOutboxRepository(),
    private readonly audit = new AuditRepository(),
  ) {}

  async createOffer(client: Db, input: {
    leadId: string;
    startsAt: string[];
    durationMinutes?: number;
    expiresAt?: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<AppointmentOfferResult> {
    if (input.startsAt.length === 0) throw new Error('appointment_offer_requires_slots');
    const durationMinutes = input.durationMinutes || 60;
    const startsAt = sortedIsoDates(input.startsAt);
    const lead = await client.query<{
      lead_id: string;
      client_id: string;
      timezone: string;
      stop_follow_up: boolean;
      status: string;
    }>(
      `SELECT l.lead_id, l.client_id, c.timezone, l.stop_follow_up, l.status
       FROM app.leads l
       JOIN app.clients c USING (client_id)
       WHERE l.lead_id=$1
       FOR UPDATE OF l`,
      [input.leadId],
    );
    const row = lead.rows[0];
    if (!row) throw new Error(`lead_not_found_for_appointment_offer:${input.leadId}`);
    if (row.stop_follow_up || ['lost', 'not_interested'].includes(row.status.toLocaleLowerCase())) {
      return { appointmentOfferId: '', semanticKey: '', slotIds: [], inserted: false };
    }

    const semanticKey = `appointment_offer:${row.lead_id}:${sha256Hex(stableJson({ startsAt, durationMinutes })).slice(0, 32)}`;
    const existing = await client.query<{ appointment_offer_id: string }>(
      `SELECT appointment_offer_id
       FROM app.appointment_offers
       WHERE semantic_key=$1
       FOR UPDATE`,
      [semanticKey],
    );
    const existingId = existing.rows[0]?.appointment_offer_id || '';
    if (existingId) {
      const slots = await client.query<{ appointment_slot_id: string }>(
        `SELECT appointment_slot_id
         FROM app.appointment_slots
         WHERE appointment_offer_id=$1
         ORDER BY starts_at, appointment_slot_id`,
        [existingId],
      );
      return {
        appointmentOfferId: existingId,
        semanticKey,
        slotIds: slots.rows.map((slot) => slot.appointment_slot_id),
        inserted: false,
      };
    }

    const expiresAt = input.expiresAt || addMinutes(new Date().toISOString(), 24 * 60);
    const offer = await client.query<{ appointment_offer_id: string }>(
      `INSERT INTO app.appointment_offers
        (lead_id, status, expires_at, semantic_key, timezone)
       VALUES ($1, 'offered', $2::timestamptz, $3, $4)
       RETURNING appointment_offer_id`,
      [row.lead_id, expiresAt, semanticKey, row.timezone],
    );
    const appointmentOfferId = offer.rows[0]?.appointment_offer_id || '';
    if (!appointmentOfferId) throw new Error('appointment_offer_not_created');

    const slotIds: string[] = [];
    for (const start of startsAt) {
      const slotKey = `appointment_slot:${appointmentOfferId}:${start}`;
      const slot = await client.query<{ appointment_slot_id: string }>(
        `INSERT INTO app.appointment_slots
          (appointment_offer_id, starts_at, ends_at, timezone, status, semantic_key)
         VALUES ($1, $2::timestamptz, $3::timestamptz, $4, 'offered', $5)
         RETURNING appointment_slot_id`,
        [appointmentOfferId, start, addMinutes(start, durationMinutes), row.timezone, slotKey],
      );
      const slotId = slot.rows[0]?.appointment_slot_id || '';
      if (!slotId) throw new Error('appointment_slot_not_created');
      slotIds.push(slotId);
    }

    await this.audit.record(client, {
      eventType: 'appointment.offer_created',
      actorType: 'worker',
      actorId: input.actorId || 'appointment-service',
      aggregateType: 'lead',
      aggregateId: row.lead_id,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.causationId ? { causationId: input.causationId } : {}),
      payload: {
        appointmentOfferId,
        semanticKey,
        slotCount: slotIds.length,
        timezone: row.timezone,
      },
    });
    return { appointmentOfferId, semanticKey, slotIds, inserted: true };
  }

  async cancelOffer(input: {
    appointmentOfferId: string;
    reason: string;
    actorId?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const offer = await client.query<{ appointment_offer_id: string; lead_id: string }>(
        `UPDATE app.appointment_offers
         SET status='cancelled',
             cancelled_reason=$2,
             updated_at=now()
         WHERE appointment_offer_id=$1
           AND status='offered'
         RETURNING appointment_offer_id, lead_id`,
        [input.appointmentOfferId, input.reason.slice(0, 4000)],
      );
      const row = offer.rows[0];
      if (!row) {
        await client.query('COMMIT');
        return false;
      }
      await client.query(
        `UPDATE app.appointment_slots
         SET status='cancelled',
             cancelled_reason=$2
         WHERE appointment_offer_id=$1
           AND status='offered'`,
        [row.appointment_offer_id, input.reason.slice(0, 4000)],
      );
      await this.audit.record(client, {
        eventType: 'appointment.offer_cancelled',
        actorType: 'worker',
        actorId: input.actorId || 'appointment-service',
        aggregateType: 'lead',
        aggregateId: row.lead_id,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        payload: {
          appointmentOfferId: row.appointment_offer_id,
          reason: input.reason,
        },
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async bookSlot(input: {
    appointmentOfferId: string;
    appointmentSlotId: string;
    sourceEventId: string;
    bookedBy?: string;
    correlationId?: string;
    causationId?: string;
  }): Promise<AppointmentBookingResult> {
    const idempotencyKey = `appointment.book:${input.appointmentOfferId}:${input.sourceEventId}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bookedBy = input.bookedBy || 'external_user';
      const duplicate = await client.query<{
        appointment_id: string;
        outbox_command_id: string | null;
        appointment_slot_id: string;
        booked_by: string;
      }>(
        `SELECT appointment_id, outbox_command_id, appointment_slot_id, booked_by
         FROM app.appointments
         WHERE idempotency_key=$1
         LIMIT 1`,
        [idempotencyKey],
      );
      if (duplicate.rows[0]) {
        if (
          duplicate.rows[0].appointment_slot_id !== input.appointmentSlotId
          || duplicate.rows[0].booked_by !== bookedBy
        ) {
          throw new Error(`appointment_booking_idempotency_collision:${idempotencyKey}`);
        }
        await client.query('COMMIT');
        return {
          outcome: 'duplicate',
          appointmentId: duplicate.rows[0].appointment_id,
          outboxCommandId: duplicate.rows[0].outbox_command_id || '',
        };
      }

      const target = await client.query<{
        appointment_offer_id: string;
        offer_status: string;
        expires_at: Date;
        appointment_slot_id: string;
        slot_status: string;
        starts_at: Date;
        ends_at: Date;
        timezone: string;
        lead_id: string;
        client_id: string;
        contact_id: string;
        contact_name: string;
        contact_phone: string;
        company_name: string;
        calendar_id: string;
      }>(
        `SELECT
           ao.appointment_offer_id,
           ao.status AS offer_status,
           ao.expires_at,
           aps.appointment_slot_id,
           aps.status AS slot_status,
           aps.starts_at,
           aps.ends_at,
           aps.timezone,
           l.lead_id,
           l.client_id,
           l.contact_id,
           ct.name AS contact_name,
           ct.phone_e164 AS contact_phone,
           c.company_name,
           c.calendar_id
         FROM app.appointment_offers ao
         JOIN app.appointment_slots aps ON aps.appointment_offer_id=ao.appointment_offer_id
         JOIN app.leads l ON l.lead_id=ao.lead_id
         JOIN app.contacts ct ON ct.contact_id=l.contact_id
         JOIN app.clients c ON c.client_id=l.client_id
         WHERE ao.appointment_offer_id=$1
           AND aps.appointment_slot_id=$2
         FOR UPDATE OF ao, aps, l`,
        [input.appointmentOfferId, input.appointmentSlotId],
      );
      const row = target.rows[0];
      if (!row) throw new Error(`appointment_slot_not_found:${input.appointmentOfferId}:${input.appointmentSlotId}`);
      if (row.offer_status === 'cancelled' || row.slot_status === 'cancelled') {
        await client.query('COMMIT');
        return { outcome: 'cancelled', appointmentId: '', outboxCommandId: '' };
      }
      if (row.offer_status !== 'offered' || row.slot_status !== 'offered') {
        await client.query('COMMIT');
        return { outcome: 'already_booked', appointmentId: '', outboxCommandId: '' };
      }
      if (row.expires_at.getTime() <= Date.now()) {
        await client.query(
          `UPDATE app.appointment_offers
           SET status='expired', updated_at=now()
           WHERE appointment_offer_id=$1`,
          [row.appointment_offer_id],
        );
        await client.query('COMMIT');
        return { outcome: 'expired', appointmentId: '', outboxCommandId: '' };
      }

      const appointment = await client.query<{ appointment_id: string }>(
        `INSERT INTO app.appointments
          (lead_id, appointment_offer_id, appointment_slot_id, status, starts_at, ends_at,
           timezone, idempotency_key, booked_by, source_event_id)
         VALUES ($1, $2, $3, 'booked', $4, $5, $6, $7, $8, $9)
         RETURNING appointment_id`,
        [
          row.lead_id,
          row.appointment_offer_id,
          row.appointment_slot_id,
          row.starts_at,
          row.ends_at,
          row.timezone,
          idempotencyKey,
          bookedBy,
          input.sourceEventId,
        ],
      );
      const appointmentId = appointment.rows[0]?.appointment_id || '';
      if (!appointmentId) throw new Error('appointment_not_created');

      await client.query(
        `UPDATE app.appointment_slots
         SET status='booked',
             booked_at=now()
         WHERE appointment_slot_id=$1`,
        [row.appointment_slot_id],
      );
      await client.query(
        `UPDATE app.appointment_offers
         SET status='booked',
             updated_at=now()
         WHERE appointment_offer_id=$1`,
        [row.appointment_offer_id],
      );
      await client.query(
        `UPDATE app.leads
         SET current_stage='appointment_booked',
             updated_at=now()
         WHERE lead_id=$1`,
        [row.lead_id],
      );

      const outboxCommandId = row.calendar_id
        ? await this.outbox.enqueue(client, {
            commandType: 'calendar.create_event',
            destination: row.calendar_id,
            idempotencyKey: `calendar.create_event:${appointmentId}`,
            aggregateKey: row.lead_id,
            payload: {
              appointmentId,
              leadId: row.lead_id,
              clientId: row.client_id,
              calendarId: row.calendar_id,
              summary: `Appointment with ${row.contact_name || row.contact_phone}`,
              description: `Lead phone: ${row.contact_phone}`,
              startsAt: row.starts_at.toISOString(),
              endsAt: row.ends_at.toISOString(),
              timezone: row.timezone,
            },
          })
        : '';
      if (outboxCommandId) {
        await client.query(
          'UPDATE app.appointments SET outbox_command_id=$2 WHERE appointment_id=$1',
          [appointmentId, outboxCommandId],
        );
      }

      await this.audit.record(client, {
        eventType: 'appointment.booked',
        actorType: 'external_user',
        actorId: input.bookedBy || '',
        aggregateType: 'lead',
        aggregateId: row.lead_id,
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        ...(input.causationId ? { causationId: input.causationId } : {}),
        payload: {
          appointmentId,
          appointmentOfferId: row.appointment_offer_id,
          appointmentSlotId: row.appointment_slot_id,
          outboxCommandId,
        },
      });
      await client.query('COMMIT');
      return { outcome: 'booked', appointmentId, outboxCommandId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
