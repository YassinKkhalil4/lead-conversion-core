# Owner Action: Google Calendar

Status: pending owner configuration and provider verification.

## Required Setup

- Create or select OAuth client.
- Configure redirect URI for the operator authorization flow.
- Authorize least-privilege Calendar access.
- Store refresh token only in secret storage.
- Provide runtime secret material through secret storage only; current local adapter expects `GOOGLE_CALENDAR_ENABLED=true` and `GOOGLE_CALENDAR_ACCESS_TOKEN` when live dispatch is intentionally enabled.
- Select staging test calendar.
- Select production calendar per client.

## Verification

1. Query availability on the staging test calendar.
2. Create a test event.
3. Delete the test event.
4. Confirm duplicate booking request creates only one event.
5. Force or simulate a lost provider response and confirm `npm run calendar:reconcile -- list` shows the ambiguous create; then verify operator-confirm and operator-fail paths against a staging-only event.
6. Rotate/revoke credentials and confirm old credentials fail.

Do not store refresh tokens in docs or ordinary database tables.
