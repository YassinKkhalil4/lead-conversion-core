import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import { withTransaction } from '../../db/transaction.js';
import { AuditRepository } from '../../infrastructure/runtime.js';
import { describeDate } from '../reservation-service.js';
import { parseCalendarDate } from '../../domain/hospitality-normalization.js';
import type { Language } from '../../domain/types.js';
import { isLanguage } from '../../domain/language.js';
import type { DashboardLeadActionService } from './lead-action-service.js';
import { leadVisibilitySql, QueryParams } from './sql.js';
import { conflict, DashboardHttpError, notFound, type DashboardScope, type DashboardUser } from './types.js';

export const RESERVATION_STATUSES = ['requested', 'confirmed', 'cancelled', 'no_show', 'seated', 'completed'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface ReservationListFilters {
  status?: string[];
  from?: string; // YYYY-MM-DD, inclusive
  to?: string;
  limit: number;
  offset: number;
}

export interface ReservationItem {
  reservationId: string;
  leadId: string | null;
  guestName: string;
  guestPhone: string;
  venueId: string;
  venueName: string;
  partySize: number;
  serviceDate: string;
  shift: string;
  zone: string;
  startsAt: string;
  status: ReservationStatus;
  depositRequired: boolean;
  depositStatus: string;
  provider: string;
  language: string;
  notes: string;
  hostId: string | null;
  hostName: string;
  createdAt: string;
}

interface Row {
  reservation_id: string;
  lead_id: string | null;
  guest_name: string;
  guest_phone: string;
  venue_id: string;
  venue_name: string;
  party_size: number;
  service_date: string;
  shift_key: string;
  shift_labels: Record<string, string>;
  zone_key: string;
  zone_labels: Record<string, string>;
  starts_at: Date;
  status: ReservationStatus;
  deposit_required: boolean;
  deposit_status: string;
  provider: string;
  language: string;
  notes: string;
  host_id: string | null;
  host_name: string | null;
  created_at: Date;
  total_count?: string;
}

const SELECT = `
  r.reservation_id, r.lead_id, ct.name AS guest_name, ct.phone_e164 AS guest_phone,
  r.project_id AS venue_id, p.project_name AS venue_name, r.party_size,
  to_char(r.service_date, 'YYYY-MM-DD') AS service_date,
  s.shift_key, s.labels AS shift_labels, z.zone_key, z.labels AS zone_labels,
  r.starts_at, r.status, r.deposit_required, r.deposit_status, r.provider, r.language, r.notes,
  la.salesperson_id AS host_id, sp.name AS host_name, r.created_at
`;

const FROM = `
  FROM app.reservations r
  JOIN app.leads l ON l.lead_id = r.lead_id
  JOIN app.contacts ct ON ct.contact_id = r.contact_id
  JOIN app.projects p ON p.project_id = r.project_id
  JOIN app.venue_shifts s ON s.shift_id = r.shift_id
  JOIN app.venue_zones z ON z.zone_id = r.zone_id
  LEFT JOIN app.lead_assignments la ON la.lead_id = r.lead_id AND la.status = 'assigned'
  LEFT JOIN app.salespeople sp ON sp.salesperson_id = la.salesperson_id
`;

function toItem(row: Row): ReservationItem {
  const label = (labels: Record<string, string>, fallback: string) => labels?.English || fallback;
  return {
    reservationId: row.reservation_id,
    leadId: row.lead_id,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    venueId: row.venue_id,
    venueName: row.venue_name,
    partySize: row.party_size,
    serviceDate: row.service_date,
    shift: label(row.shift_labels, row.shift_key),
    zone: label(row.zone_labels, row.zone_key),
    startsAt: row.starts_at.toISOString(),
    status: row.status,
    depositRequired: row.deposit_required,
    depositStatus: row.deposit_status,
    provider: row.provider,
    language: row.language,
    notes: row.notes,
    hostId: row.host_id,
    hostName: row.host_name ?? '',
    createdAt: row.created_at.toISOString(),
  };
}

/** What the venue says to a guest when it acts on their reservation. Per language, no config needed. */
const NOTICE: Record<'confirmed' | 'declined', Record<Language, string>> = {
  confirmed: {
    English: 'Good news ✅ {{venue}} has confirmed your table for {{party_size}}: {{date}}, {{shift}}, {{zone}}.',
    Spanish: 'Buenas noticias ✅ {{venue}} ha confirmado tu mesa para {{party_size}}: {{date}}, {{shift}}, {{zone}}.',
    Catalan: 'Bones notícies ✅ {{venue}} ha confirmat la teva taula per a {{party_size}}: {{date}}, {{shift}}, {{zone}}.',
    Arabic: 'Good news ✅ {{venue}} has confirmed your table for {{party_size}}: {{date}}, {{shift}}, {{zone}}.',
  },
  declined: {
    English: 'Sorry, {{venue}} cannot take your reservation for {{party_size}} on {{date}} ({{shift}}). Write to us to try another day.',
    Spanish: 'Lo sentimos, {{venue}} no puede atender tu reserva para {{party_size}} el {{date}} ({{shift}}). Escríbenos para probar otro día.',
    Catalan: 'Ho sentim, {{venue}} no pot atendre la teva reserva per a {{party_size}} el {{date}} ({{shift}}). Escriu-nos per provar un altre dia.',
    Arabic: 'Sorry, {{venue}} cannot take your reservation for {{party_size}} on {{date}} ({{shift}}). Write to us to try another day.',
  },
};

export class DashboardReservationService {
  constructor(private readonly audit = new AuditRepository()) {}

  async list(scope: DashboardScope, filters: ReservationListFilters): Promise<{ reservations: ReservationItem[]; total: number; limit: number; offset: number }> {
    const params = new QueryParams();
    const where = [`(${leadVisibilitySql('l', scope, params)})`];
    if (filters.status?.length) where.push(`r.status = ANY(${params.bind(filters.status)}::text[])`);
    if (filters.from) where.push(`r.service_date >= ${params.bind(filters.from)}::date`);
    if (filters.to) where.push(`r.service_date <= ${params.bind(filters.to)}::date`);
    const limit = params.bind(filters.limit);
    const offset = params.bind(filters.offset);
    const result = await pool.query<Row>(
      `SELECT ${SELECT}, count(*) OVER ()::text AS total_count ${FROM} WHERE ${where.join(' AND ')}
       ORDER BY r.starts_at, r.created_at LIMIT ${limit} OFFSET ${offset}`,
      params.list(),
    );
    return {
      reservations: result.rows.map(toItem),
      total: Number(result.rows[0]?.total_count ?? 0),
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async get(scope: DashboardScope, reservationId: string): Promise<ReservationItem> {
    const found = await this.find(pool, scope, reservationId, false);
    if (!found) throw notFound('reservation_not_found');
    return found;
  }

  private async find(db: Pick<PoolClient, 'query'>, scope: DashboardScope, reservationId: string, lock: boolean): Promise<ReservationItem | null> {
    const params = new QueryParams();
    const visibility = leadVisibilitySql('l', scope, params);
    const id = params.bind(reservationId);
    const result = await db.query<Row>(
      `SELECT ${SELECT} ${FROM} WHERE (${visibility}) AND r.reservation_id = ${id}::uuid ${lock ? 'FOR UPDATE OF r' : ''}`,
      params.list(),
    );
    return result.rows[0] ? toItem(result.rows[0]) : null;
  }

  /** The venue approves a held reservation (a large group). Optionally records what happened to the deposit. */
  async confirm(
    user: DashboardUser,
    scope: DashboardScope,
    reservationId: string,
    input: { depositStatus?: 'pending' | 'paid' | 'waived' },
    actions: DashboardLeadActionService,
  ): Promise<{ reservation: ReservationItem; guestNotified: boolean }> {
    const reservation = await withTransaction(async (client) => {
      const current = await this.find(client, scope, reservationId, true);
      if (!current) throw notFound('reservation_not_found');
      if (current.status !== 'requested') throw conflict('reservation_not_awaiting_confirmation', { status: current.status });
      await client.query(
        `UPDATE app.reservations
         SET status='confirmed', confirmed_at=now(), updated_at=now(),
             deposit_status=CASE WHEN deposit_required THEN COALESCE($2, deposit_status) ELSE deposit_status END
         WHERE reservation_id=$1`,
        [reservationId, input.depositStatus ?? null],
      );
      if (current.leadId) {
        await client.query(`UPDATE app.leads SET pipeline_stage='site_visit_scheduled', updated_at=now() WHERE lead_id=$1`, [current.leadId]);
      }
      await this.audit.record(client, {
        eventType: 'reservation.confirmed',
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        ...(current.leadId ? { aggregateId: current.leadId } : {}),
        payload: { reservationId, depositStatus: input.depositStatus ?? '' },
      });
      return (await this.find(client, scope, reservationId, false))!;
    });
    return { reservation, guestNotified: await this.notifyGuest(user, scope, reservation, 'confirmed', actions) };
  }

  /** The venue declines a held reservation, or a host cancels a confirmed one. Frees the covers. */
  async cancel(
    user: DashboardUser,
    scope: DashboardScope,
    reservationId: string,
    actions: DashboardLeadActionService,
  ): Promise<{ reservation: ReservationItem; guestNotified: boolean }> {
    const reservation = await withTransaction(async (client) => {
      const current = await this.find(client, scope, reservationId, true);
      if (!current) throw notFound('reservation_not_found');
      if (!['requested', 'confirmed'].includes(current.status)) throw conflict('reservation_not_cancellable', { status: current.status });
      await client.query(
        `UPDATE app.reservations SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE reservation_id=$1`,
        [reservationId],
      );
      if (current.leadId) {
        await client.query(
          `UPDATE app.leads l SET pipeline_stage='closed_lost', updated_at=now()
           WHERE l.lead_id=$1 AND NOT EXISTS (
             SELECT 1 FROM app.reservations r WHERE r.contact_id=l.contact_id AND r.client_id=l.client_id
               AND r.reservation_id<>$2 AND r.status IN ('requested','confirmed') AND r.starts_at > now())`,
          [current.leadId, reservationId],
        );
      }
      await this.audit.record(client, {
        eventType: 'reservation.cancelled',
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        ...(current.leadId ? { aggregateId: current.leadId } : {}),
        payload: { reservationId, by: 'venue' },
      });
      return (await this.find(client, scope, reservationId, false))!;
    });
    return { reservation, guestNotified: await this.notifyGuest(user, scope, reservation, 'declined', actions) };
  }

  /** Door-side bookkeeping: the party arrived, left, or never came. */
  async setStatus(
    user: DashboardUser,
    scope: DashboardScope,
    reservationId: string,
    status: 'seated' | 'completed' | 'no_show',
  ): Promise<ReservationItem> {
    const allowedFrom: Record<typeof status, ReservationStatus[]> = {
      seated: ['confirmed'],
      completed: ['seated', 'confirmed'],
      no_show: ['confirmed'],
    };
    return withTransaction(async (client) => {
      const current = await this.find(client, scope, reservationId, true);
      if (!current) throw notFound('reservation_not_found');
      if (!allowedFrom[status].includes(current.status)) throw conflict('reservation_status_transition_not_allowed', { from: current.status, to: status });
      await client.query(`UPDATE app.reservations SET status=$2, updated_at=now() WHERE reservation_id=$1`, [reservationId, status]);
      if (current.leadId && status !== 'no_show') {
        await client.query(`UPDATE app.leads SET pipeline_stage='closed_won', updated_at=now() WHERE lead_id=$1`, [current.leadId]);
      }
      await this.audit.record(client, {
        eventType: `reservation.${status}`,
        actorType: 'operator',
        actorId: user.userId,
        aggregateType: 'lead',
        ...(current.leadId ? { aggregateId: current.leadId } : {}),
        payload: { reservationId },
      });
      return (await this.find(client, scope, reservationId, false))!;
    });
  }

  /**
   * Tells the guest what the venue decided. Free text only works inside
   * WhatsApp's 24-hour window; outside it the guest is simply not messaged
   * here (the venue can send an approved template from the lead), and the
   * caller is told.
   */
  private async notifyGuest(
    user: DashboardUser,
    scope: DashboardScope,
    reservation: ReservationItem,
    kind: 'confirmed' | 'declined',
    actions: DashboardLeadActionService,
  ): Promise<boolean> {
    if (!reservation.leadId) return false;
    const language: Language = isLanguage(reservation.language) ? reservation.language : 'Spanish';
    const date = parseCalendarDate(reservation.serviceDate);
    const text = NOTICE[kind][language]
      .replaceAll('{{venue}}', reservation.venueName)
      .replaceAll('{{party_size}}', String(reservation.partySize))
      .replaceAll('{{date}}', date ? describeDate(date, language) : reservation.serviceDate)
      .replaceAll('{{shift}}', reservation.shift)
      .replaceAll('{{zone}}', reservation.zone);
    try {
      await actions.reply(user, scope, {
        leadId: reservation.leadId,
        requestKey: `reservation-${kind}-${reservation.reservationId}`,
        payload: { kind: 'text', text },
      });
      return true;
    } catch (error) {
      if (error instanceof DashboardHttpError && error.statusCode === 409) return false;
      throw error;
    }
  }
}
