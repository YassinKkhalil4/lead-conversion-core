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
- Explicit staging flags for direct ingress: `DIRECT_META_WEBHOOK_ENABLED=true` only for Meta callback tests and `DIRECT_LEAD_INGRESS_ENABLED=true` only for direct website/Facebook callback tests
- Encrypted backup target
- Named operators authorized to run live commands

## Verification

1. `/health` and `/ready` return healthy.
2. Webhook challenge succeeds.
3. Signed test webhook is accepted.
4. Unsigned invalid webhook is rejected.
5. Test backup completes.
6. Restore verification succeeds.
