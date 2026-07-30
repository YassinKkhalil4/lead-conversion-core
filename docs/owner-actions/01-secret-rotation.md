# Owner Action: Secret Rotation

Status: pending owner execution. Do not place credential values in this file.

## Credential Categories To Rotate

- Conversation Edge database password
- Conversation Edge internal/shared secrets
- n8n database password
- n8n encryption key and credentials
- Typebot database password
- Typebot application secrets
- MinIO/S3 access keys
- Meta WhatsApp access token
- Meta app secret and webhook verification token
- Airtable personal access token
- Google OAuth client secret and refresh tokens
- Facebook app secret, page token, and verification token

## Rotation Process

1. Create new credentials in the owning provider console or secret manager.
2. Store new values only in the deployment secret store or local ignored `.env`.
3. Restart only the affected staging service first.
4. Verify health, provider auth, and a minimal non-production action.
5. Schedule production rotation during a maintenance window.
6. Revoke old credentials after the new values are verified.
7. Record rotation timestamp and operator in an external secure change log.

## Verification

- Edge `/ready` returns database ready.
- Internal auth rejects old secrets and accepts new secret from secure environment.
- Meta test send returns provider message ID in staging.
- Airtable dry-run export/import can read expected tables.
- Google Calendar test can query availability and create/delete a test event.
- n8n and Typebot remain available only as transition runtimes until decommission.
