# Direct Ingress Plan

Status: draft, not approved for production execution.

## Current Local Contract

Direct provider ingress is present in the modular monolith but disabled by default.

- Meta WhatsApp callback: `GET /webhooks/meta/whatsapp` and `POST /webhooks/meta/whatsapp`
- Website lead callback: `POST /webhooks/leads/website`
- Facebook lead callback: `POST /webhooks/leads/facebook`
- n8n compatibility fallback: `/compat/n8n/**`

Required flags:

- `DIRECT_META_WEBHOOK_ENABLED=true` enables direct Meta challenge and signed webhook receipt. It requires `RUNTIME_WORKER_ENABLED=true` and `META_STATUS_PROCESSOR_ENABLED=true`.
- `DIRECT_LEAD_INGRESS_ENABLED=true` enables direct website/Facebook lead ingress. It requires `RUNTIME_WORKER_ENABLED=true`.
- `ACTIVE_TURN_COMPAT_ENABLED=true` enables the legacy synchronous `/v1/turn` compatibility route; leave it false for normal durable direct-ingress cutover.
- `N8N_COMPAT_ROUTES_ENABLED=true` keeps n8n fallback routes available.

Default state keeps all direct provider ingress disabled even when provider secrets are present.

## Staging Route Plan

1. Keep production Caddy routes pointed at the current legacy target.
2. Route a staging-only hostname or path to the Edge app.
3. Enable only the direct route under test:
   - Meta test: `DIRECT_META_WEBHOOK_ENABLED=true`, `RUNTIME_WORKER_ENABLED=true`, `META_STATUS_PROCESSOR_ENABLED=true`
   - Lead-source test: `DIRECT_LEAD_INGRESS_ENABLED=true`, `RUNTIME_WORKER_ENABLED=true`
4. Keep `N8N_COMPAT_ROUTES_ENABLED=true` during staging.
5. Run `npm run cutover:readiness -- --max-pending-inbox=0 --max-pending-outbox=0 --max-pending-scheduled-jobs=0 --max-queue-age-seconds=300`.
6. Verify `/health`, `/ready`, webhook challenge, signed webhook receipt, invalid signature rejection, and fallback route availability.
7. Use `scripts/verify-deployment.sh --base-url=<staging-url> --check-direct-meta --check-direct-lead` with explicit `--expect-direct-meta=<enabled|disabled>` and `--expect-direct-lead=<enabled|disabled>` to prove the intended direct-ingress state before changing external routes. The enabled direct-Meta check verifies the challenge route, sends a signed non-customer webhook probe that should be durably acknowledged through the ignored-webhook path, and sends an unsigned POST that must be rejected. The enabled direct-lead check probes both website and Facebook routes with deliberately incomplete payloads and expects durable receipt acknowledgement; it must not create an authoritative lead or outbound command inside the webhook request.

## Production Canary Route Plan

Production route changes require explicit owner approval.

1. Confirm all owner-action preflight items are complete.
2. Enable the relevant direct-ingress flag and required runtime worker flag in production configuration.
3. Route only the approved callback path or canary source to Edge.
4. Keep n8n and Typebot fallback infrastructure unchanged.
5. Monitor `npm run cutover:readiness` output, provider callbacks, inbox/outbox age, delivery-unknown counts, dead letters, and runtime worker heartbeat.
6. Stop expanding canary traffic if any rollback threshold in `docs/owner-actions/07-production-cutover.md` is met.
7. Use `npm run decommission:readiness` only after the canary window has produced enough direct-ingress evidence; do not treat a passing report as removal approval.

## Rollback

1. Restore the prior Caddy path route or disable the direct-ingress flag.
2. Do not delete Edge state.
3. Preserve inbox/outbox/dead-letter rows for audit.
4. Reconcile delivery-unknown side effects before replay.
5. Keep n8n/Typebot fallback infrastructure available until exit criteria are met.

## Decommission Hold

No legacy infrastructure removal is authorized by this plan. n8n, Typebot, Airtable projection, MinIO, databases, volumes, and production artifacts stay in place until the owner approves decommission after the documented exit criteria and `npm run decommission:readiness` checks are satisfied.
