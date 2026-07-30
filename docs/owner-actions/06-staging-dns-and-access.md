# Owner Action: Staging DNS And Access

Status: pending owner infrastructure setup.

## Required Staging Resources

- Separate staging database
- Separate staging secrets
- Staging callback URL
- Test phone numbers
- Test Calendar
- Network access for Meta callbacks
- Caddy route for staging edge ingress
- Encrypted backup target
- Named operators authorized to run live commands

## Verification

1. `/health` and `/ready` return healthy.
2. Webhook challenge succeeds.
3. Signed test webhook is accepted.
4. Unsigned invalid webhook is rejected.
5. Test backup completes.
6. Restore verification succeeds.
