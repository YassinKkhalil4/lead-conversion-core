# Owner Action: Facebook Leads

Status: disabled until owner configuration and tests pass.

## Required Setup

- Rotate app secret.
- Configure verification token.
- Create or rotate page access token.
- Grant required permissions for lead retrieval.
- Configure callback path.
- Supply credentials only through secret storage.

## Verification

1. Verify callback challenge.
2. Verify signed payload handling.
3. Retrieve a known test lead through Graph API.
4. Confirm idempotent processing by leadgen ID.
5. Enable feature flag only after staging verification.
6. Disable feature flag to roll back.

Facebook lead ingestion must remain disabled until every check passes.
