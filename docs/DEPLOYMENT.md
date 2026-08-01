# Lead Conversion Core Deployment

Production deployment is owner controlled. Local/container deployment uses this repository's Compose file and a generated environment template:

```bash
./scripts/generate-env.sh
EDGE_POSTGRES_PASSWORD=<same-value-as-.env> docker-compose -f docker-compose.yml config
docker-compose -f docker-compose.yml up -d lead-core-postgres lead-core-migrate lead-core-api lead-core-worker lead-core-runtime-worker
```

The Compose topology is still one TypeScript modular monolith image:

- `lead-core-api` serves Fastify routes and does not run migrations.
- `lead-core-migrate` is the one-shot migrator.
- `lead-core-worker` runs the legacy `edge_outbox` compatibility worker with `WORKER_KIND=outbox`.
- `lead-core-runtime-worker` runs durable inbox, runtime outbox, and scheduled jobs with `WORKER_KIND=runtime`.
- `lead-core-backup` is an opt-in ops profile job.

Keep these defaults until the matching owner action is approved:

```text
EDGE_MODE=shadow
OUTBOX_WORKER_ENABLED=false
RUNTIME_WORKER_ENABLED=false
N8N_COMPAT_ROUTES_ENABLED=false
DIRECT_META_WEBHOOK_ENABLED=false
DIRECT_LEAD_INGRESS_ENABLED=false
DIRECT_META_SEND_ENABLED=false
ACTIVE_TURN_COMPAT_ENABLED=false
GOOGLE_CALENDAR_ENABLED=false
META_STATUS_PROCESSOR_ENABLED=false
DEFAULT_CONVERSATION_ENGINE=legacy
SHADOW_STATE_AUTHORITY=legacy
```

Direct provider routes, real message sends, Google Calendar dispatch, runtime processing, and legacy active-turn compatibility are explicit cutover flags. Do not enable them only because credentials are present.

`/ready` must be reviewed after enabling a worker flag. It reports `workerHeartbeats`; an enabled worker kind without a fresh heartbeat makes readiness fail.
