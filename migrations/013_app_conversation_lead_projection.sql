CREATE UNIQUE INDEX IF NOT EXISTS app_conversations_lead_id_uidx
  ON app.conversations (lead_id)
  WHERE lead_id IS NOT NULL;
