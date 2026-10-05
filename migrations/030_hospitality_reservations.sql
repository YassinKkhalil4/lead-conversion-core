-- Hospitality: venues, zones, shifts, capacity and reservations.
--
-- A venue is an app.projects row (it already has maps_url), a host is an
-- app.salespeople row and a guest is an app.contacts row, so routing, dashboard
-- directory and WhatsApp identity keep working unchanged. What a reservation
-- needs and a lead does not (party size, zone, shift, deposit, the floor-plan
-- booking it maps to) lives here.
--
-- Additive only. Real-estate tenants keep vertical = 'real_estate' and never
-- touch these tables.

ALTER TABLE app.clients
  ADD COLUMN IF NOT EXISTS vertical text NOT NULL DEFAULT 'real_estate'
    CHECK (vertical IN ('real_estate', 'hospitality')),
  -- Parties of this size or more are `requested` and need the venue's approval
  -- (and a deposit hold, which the venue collects). NULL: no group rule.
  ADD COLUMN IF NOT EXISTS deposit_threshold_party_size integer
    CHECK (deposit_threshold_party_size IS NULL OR deposit_threshold_party_size >= 1),
  -- Where availability lives. `kadensio`: the capacity tables below.
  ADD COLUMN IF NOT EXISTS floor_plan_provider text NOT NULL DEFAULT 'kadensio'
    CHECK (floor_plan_provider IN ('kadensio', 'covermanager'));

-- Areas of a venue the guest can ask for: "Sala Interior", "Terrace".
CREATE TABLE IF NOT EXISTS app.venue_zones (
  zone_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  project_id uuid NOT NULL REFERENCES app.projects(project_id) ON DELETE CASCADE,
  zone_key text NOT NULL,
  -- {"English": "Terrace", "Spanish": "Terraza", "Catalan": "Terrassa"}
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, zone_key)
);

-- Services a venue runs: lunch, dinner. Times are venue-local; the client's
-- timezone turns a date plus a shift into the instant stored on a reservation.
CREATE TABLE IF NOT EXISTS app.venue_shifts (
  shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  project_id uuid NOT NULL REFERENCES app.projects(project_id) ON DELETE CASCADE,
  shift_key text NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Local time a guest is expected, and the last time a table can be given.
  starts_at_local time NOT NULL,
  last_seating_local time NOT NULL,
  -- ISO weekdays the shift runs (1 = Monday .. 7 = Sunday).
  days_open smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,7]::smallint[],
  sort_order integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, shift_key),
  CHECK (last_seating_local >= starts_at_local)
);

-- Covers (seats) a zone can take in one shift.
CREATE TABLE IF NOT EXISTS app.venue_capacity (
  zone_id uuid NOT NULL REFERENCES app.venue_zones(zone_id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES app.venue_shifts(shift_id) ON DELETE CASCADE,
  covers integer NOT NULL CHECK (covers >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, shift_id)
);

-- One date that differs from the usual capacity: 0 covers closes the zone.
CREATE TABLE IF NOT EXISTS app.venue_capacity_overrides (
  zone_id uuid NOT NULL REFERENCES app.venue_zones(zone_id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES app.venue_shifts(shift_id) ON DELETE CASCADE,
  service_date date NOT NULL,
  covers integer NOT NULL CHECK (covers >= 0),
  reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, shift_id, service_date)
);

CREATE TABLE IF NOT EXISTS app.reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  project_id uuid NOT NULL REFERENCES app.projects(project_id),
  contact_id uuid NOT NULL REFERENCES app.contacts(contact_id),
  lead_id uuid REFERENCES app.leads(lead_id),
  conversation_id uuid REFERENCES app.conversations(conversation_id),
  party_size integer NOT NULL CHECK (party_size >= 1),
  service_date date NOT NULL,
  shift_id uuid NOT NULL REFERENCES app.venue_shifts(shift_id),
  zone_id uuid NOT NULL REFERENCES app.venue_zones(zone_id),
  -- service_date + the shift's start, in the client's timezone, as an instant.
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'confirmed', 'cancelled', 'no_show', 'seated', 'completed')),
  deposit_required boolean NOT NULL DEFAULT false,
  deposit_status text NOT NULL DEFAULT 'none'
    CHECK (deposit_status IN ('none', 'pending', 'paid', 'waived')),
  channel text NOT NULL DEFAULT 'whatsapp',
  language text NOT NULL DEFAULT '',
  -- Which floor plan holds the booking and its id there ('' until booked).
  provider text NOT NULL DEFAULT 'kadensio',
  external_ref text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  -- Deterministic per conversation and answers, so a retried turn books once.
  idempotency_key text NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);

-- Covers already taken in a (zone, shift, date): the availability query.
CREATE INDEX IF NOT EXISTS reservations_slot_idx
  ON app.reservations (zone_id, shift_id, service_date)
  WHERE status IN ('requested', 'confirmed', 'seated');

CREATE INDEX IF NOT EXISTS reservations_client_date_idx
  ON app.reservations (client_id, service_date, status);

CREATE INDEX IF NOT EXISTS reservations_contact_idx
  ON app.reservations (contact_id, service_date DESC);
