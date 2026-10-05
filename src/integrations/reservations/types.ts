import type { Db } from '../../db/pool.js';

/** One reservation request, already resolved to ids and a local date. */
export interface BookingRequest {
  clientId: string;
  projectId: string;
  contactId: string;
  leadId: string;
  conversationId: string | null;
  zoneId: string;
  shiftId: string;
  /** YYYY-MM-DD, the venue's calendar date. */
  serviceDate: string;
  timezone: string;
  partySize: number;
  /** Parties of this size or more are held for the venue's approval. */
  depositThreshold: number | null;
  language: string;
  channel: string;
  notes: string;
  idempotencyKey: string;
}

export type BookingResult =
  | { outcome: 'booked'; reservationId: string; status: 'confirmed' | 'requested'; depositRequired: boolean; replayed: boolean }
  | { outcome: 'unavailable'; remainingCovers: number };

/**
 * Where availability lives and where a booking is written.
 *
 * `book` runs on the caller's transaction: the check and the insert must be one
 * atomic step, or two guests can take the last table. A provider that talks to
 * an outside system must not do that I/O here (no external calls inside a
 * database transaction); it queues a `reservation.create` outbox command and
 * returns `requested` until the outside system confirms.
 */
export interface ReservationProvider {
  readonly name: 'kadensio' | 'covermanager';
  book(db: Db, request: BookingRequest): Promise<BookingResult>;
}
