CREATE TABLE IF NOT EXISTS app.notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_outbox_command_id uuid UNIQUE NOT NULL REFERENCES runtime.outbox_commands(outbox_command_id),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  recipient_type text NOT NULL,
  recipient_id uuid,
  notification_type text NOT NULL,
  payload_json jsonb NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  delivered_channels text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE INDEX IF NOT EXISTS notifications_client_created_idx
  ON app.notifications (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON app.notifications (recipient_type, recipient_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS app.device_tokens (
  device_token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salesperson_id uuid NOT NULL REFERENCES app.salespeople(salesperson_id),
  platform text NOT NULL,
  token text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  registered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_tokens_salesperson_active_idx
  ON app.device_tokens (salesperson_id, active);

CREATE UNIQUE INDEX IF NOT EXISTS device_tokens_platform_token_idx
  ON app.device_tokens (platform, token);
