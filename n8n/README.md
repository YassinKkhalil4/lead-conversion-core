# n8n Integration Status

No live gateway patch is included in the first deployment step.

Reason: the existing gateway is the production front door and has received several narrow reliability and latency patches. The shadow service must first pass standalone and replay parity tests.

The later integration will:

1. Export the fresh live `05-GW Typebot Gateway`.
2. Add a post-send, non-awaited call to a dedicated shadow relay workflow.
3. Forward the inbound message, current legacy stage and the actual visible Typebot reply.
4. Keep all existing gateway branches unchanged.
5. Treat shadow failures as isolated telemetry failures, never customer-flow failures.

Payload contract: `docs/API.md`.
