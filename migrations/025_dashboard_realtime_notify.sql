-- Realtime fan-out for the dashboard SSE stream.
--
-- Every payload carries identifiers only: pg_notify payloads are capped at
-- 8000 bytes and must never carry message bodies or PII. The stream service
-- re-reads the row under the caller's client scope before emitting.

CREATE OR REPLACE FUNCTION app.dashboard_notify_lead()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('dashboard_events', json_build_object(
    'kind', CASE WHEN TG_OP = 'INSERT' THEN 'lead.created' ELSE 'lead.updated' END,
    'clientId', NEW.client_id,
    'leadId', NEW.lead_id
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_notify_lead_insert ON app.leads;
CREATE TRIGGER dashboard_notify_lead_insert
AFTER INSERT ON app.leads
FOR EACH ROW EXECUTE FUNCTION app.dashboard_notify_lead();

DROP TRIGGER IF EXISTS dashboard_notify_lead_update ON app.leads;
CREATE TRIGGER dashboard_notify_lead_update
AFTER UPDATE ON app.leads
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.temperature IS DISTINCT FROM NEW.temperature
  OR OLD.lead_score IS DISTINCT FROM NEW.lead_score
  OR OLD.current_stage IS DISTINCT FROM NEW.current_stage
  OR OLD.last_message_at IS DISTINCT FROM NEW.last_message_at
  OR OLD.stop_follow_up IS DISTINCT FROM NEW.stop_follow_up
  OR OLD.closed_status IS DISTINCT FROM NEW.closed_status
)
EXECUTE FUNCTION app.dashboard_notify_lead();

CREATE OR REPLACE FUNCTION app.dashboard_notify_message()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('dashboard_events', json_build_object(
    'kind', 'message.created',
    'clientId', NEW.client_id,
    'leadId', NEW.lead_id,
    'messageId', NEW.message_id,
    'direction', NEW.direction
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_notify_message_insert ON app.messages;
CREATE TRIGGER dashboard_notify_message_insert
AFTER INSERT ON app.messages
FOR EACH ROW EXECUTE FUNCTION app.dashboard_notify_message();

CREATE OR REPLACE FUNCTION app.dashboard_notify_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_client_id uuid;
BEGIN
  SELECT client_id INTO resolved_client_id FROM app.leads WHERE lead_id = NEW.lead_id;
  IF resolved_client_id IS NULL THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify('dashboard_events', json_build_object(
    'kind', CASE WHEN TG_OP = 'INSERT' THEN 'assignment.created' ELSE 'assignment.updated' END,
    'clientId', resolved_client_id,
    'leadId', NEW.lead_id,
    'assignmentId', NEW.lead_assignment_id,
    'salespersonId', NEW.salesperson_id,
    'status', NEW.status
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_notify_assignment_insert ON app.lead_assignments;
CREATE TRIGGER dashboard_notify_assignment_insert
AFTER INSERT ON app.lead_assignments
FOR EACH ROW EXECUTE FUNCTION app.dashboard_notify_assignment();

DROP TRIGGER IF EXISTS dashboard_notify_assignment_update ON app.lead_assignments;
CREATE TRIGGER dashboard_notify_assignment_update
AFTER UPDATE ON app.lead_assignments
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.acknowledged_at IS DISTINCT FROM NEW.acknowledged_at
)
EXECUTE FUNCTION app.dashboard_notify_assignment();

CREATE OR REPLACE FUNCTION app.dashboard_notify_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('dashboard_events', json_build_object(
    'kind', 'notification.created',
    'clientId', NEW.client_id,
    'notificationId', NEW.notification_id,
    'recipientType', NEW.recipient_type,
    'recipientId', NEW.recipient_id,
    'notificationType', NEW.notification_type,
    'priority', NEW.priority
  )::text);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_notify_notification_insert ON app.notifications;
CREATE TRIGGER dashboard_notify_notification_insert
AFTER INSERT ON app.notifications
FOR EACH ROW EXECUTE FUNCTION app.dashboard_notify_notification();
