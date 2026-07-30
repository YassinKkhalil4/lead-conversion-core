# Conversation Edge Deployment

Use the package-level script:

```bash
cd /opt/lead-conversion-os-supreme-v1
./scripts/deploy_edge_phase1.sh
```

The script:

1. Detects the Docker network used by n8n.
2. Preserves an existing Edge `.env`.
3. Installs the integration-safe source at `/opt/conversation-edge`.
4. Forces shadow mode and disables the outbox worker.
5. Attaches the API and worker containers to the n8n network.
6. Builds, migrates, seeds and health-checks the service.

Do not change these values during Phase 1:

```text
EDGE_MODE=shadow
OUTBOX_WORKER_ENABLED=false
DEFAULT_CONVERSATION_ENGINE=legacy
SHADOW_STATE_AUTHORITY=legacy
```
