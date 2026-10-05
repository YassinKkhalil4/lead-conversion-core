-- Reservation reminders.
--
-- A scheduled job per confirmed reservation (runtime.scheduled_jobs, type
-- 'reservation.reminder') asks the guest to come or cancel. These two columns
-- are all the schema it needs: how long before the table to remind, and
-- whether a reminder already went out (so a retried job never sends twice).
ALTER TABLE app.clients
  ADD COLUMN IF NOT EXISTS reminder_lead_hours integer NOT NULL DEFAULT 24
    CHECK (reminder_lead_hours BETWEEN 1 AND 168);

ALTER TABLE app.reservations
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
