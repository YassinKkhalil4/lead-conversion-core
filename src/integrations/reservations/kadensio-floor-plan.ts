import type { Db } from '../../db/pool.js';
import type { BookingRequest, BookingResult, ReservationProvider } from './types.js';

/**
 * Availability held in Postgres: covers per zone and shift (venue_capacity),
 * with per-date overrides, minus the covers already promised.
 *
 * Two guests asking for the last table at once are serialised by a transaction
 * advisory lock on (zone, shift, date): the second one sees the first one's
 * row and is told the table is gone. Requested reservations hold their covers
 * too, so a large group waiting for approval is not double-sold.
 */
export class KadensioFloorPlanProvider implements ReservationProvider {
  readonly name = 'kadensio' as const;

  async book(db: Db, request: BookingRequest): Promise<BookingResult> {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `reservation:${request.zoneId}:${request.shiftId}:${request.serviceDate}`,
    ]);

    // A retried turn books once: the same key returns the reservation it made.
    const existing = await db.query<{ reservation_id: string; status: string; deposit_required: boolean }>(
      `SELECT reservation_id, status, deposit_required
       FROM app.reservations WHERE client_id=$1 AND idempotency_key=$2`,
      [request.clientId, request.idempotencyKey],
    );
    const replay = existing.rows[0];
    if (replay) {
      return {
        outcome: 'booked',
        reservationId: replay.reservation_id,
        status: replay.status === 'requested' ? 'requested' : 'confirmed',
        depositRequired: replay.deposit_required,
        replayed: true,
      };
    }

    const capacity = await db.query<{ covers: number }>(
      `SELECT COALESCE(
         (SELECT o.covers FROM app.venue_capacity_overrides o
           WHERE o.zone_id=$1 AND o.shift_id=$2 AND o.service_date=$3::date),
         (SELECT c.covers FROM app.venue_capacity c WHERE c.zone_id=$1 AND c.shift_id=$2),
         0
       ) AS covers`,
      [request.zoneId, request.shiftId, request.serviceDate],
    );
    const total = Number(capacity.rows[0]?.covers ?? 0);

    const taken = await db.query<{ covers: string }>(
      `SELECT COALESCE(SUM(party_size), 0)::text AS covers
       FROM app.reservations
       WHERE zone_id=$1 AND shift_id=$2 AND service_date=$3::date
         AND status IN ('requested', 'confirmed', 'seated')`,
      [request.zoneId, request.shiftId, request.serviceDate],
    );
    const remaining = total - Number(taken.rows[0]?.covers ?? 0);
    if (request.partySize > remaining) return { outcome: 'unavailable', remainingCovers: Math.max(0, remaining) };

    const large = request.depositThreshold !== null && request.partySize >= request.depositThreshold;
    const status = large ? 'requested' : 'confirmed';
    const inserted = await db.query<{ reservation_id: string }>(
      `INSERT INTO app.reservations
        (client_id, project_id, contact_id, lead_id, conversation_id, party_size, service_date,
         shift_id, zone_id, starts_at, status, deposit_required, deposit_status, channel, language,
         provider, notes, idempotency_key, confirmed_at)
       SELECT $1, $2, $3, $4, $5, $6, $7::date, s.shift_id, $9,
              (($7::date + s.starts_at_local)::timestamp AT TIME ZONE $10),
              $11, $12, $13, $14, $15, 'kadensio', $16, $17,
              CASE WHEN $11 = 'confirmed' THEN now() END
       FROM app.venue_shifts s WHERE s.shift_id=$8
       RETURNING reservation_id`,
      [
        request.clientId, request.projectId, request.contactId, request.leadId, request.conversationId,
        request.partySize, request.serviceDate, request.shiftId, request.zoneId, request.timezone,
        status, large, large ? 'pending' : 'none', request.channel, request.language,
        request.notes, request.idempotencyKey,
      ],
    );
    const reservationId = inserted.rows[0]?.reservation_id;
    if (!reservationId) throw new Error('reservation_not_created');
    return { outcome: 'booked', reservationId, status, depositRequired: large, replayed: false };
  }
}
