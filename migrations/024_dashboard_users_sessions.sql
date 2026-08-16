CREATE TABLE IF NOT EXISTS app.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES app.clients(client_id),
  salesperson_id uuid REFERENCES app.salespeople(salesperson_id),
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','manager','salesperson')),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_salesperson_link_check
    CHECK ((role = 'salesperson') = (salesperson_id IS NOT NULL)),
  UNIQUE (client_id, email)
);

CREATE INDEX IF NOT EXISTS users_email_active_idx
  ON app.users (email)
  WHERE active;

CREATE INDEX IF NOT EXISTS users_client_role_idx
  ON app.users (client_id, role);

CREATE INDEX IF NOT EXISTS users_salesperson_idx
  ON app.users (salesperson_id)
  WHERE salesperson_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS app.sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text NOT NULL DEFAULT '',
  ip_address text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_user_live_idx
  ON app.sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sessions_expiry_idx
  ON app.sessions (expires_at)
  WHERE revoked_at IS NULL;

-- Durable login throttling. One row per throttle subject ('ip:<addr>' or
-- 'email:<sha256>'), so the limit survives restarts and is shared by every
-- API instance rather than living in per-process memory.
CREATE TABLE IF NOT EXISTS app.login_attempts (
  login_attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_key text NOT NULL UNIQUE,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_attempts_window_idx
  ON app.login_attempts (window_started_at);
