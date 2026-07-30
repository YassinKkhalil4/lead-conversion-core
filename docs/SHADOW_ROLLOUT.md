# Shadow Rollout

Conversation Edge receives a side copy only after Typebot has produced the live reply. The n8n call is fire-and-forget and is not on the send path.

## Metrics to monitor

- `conversation_edge_evaluations_total`
- `conversation_edge_evaluation_duration_ms`
- `conversation_edge_duplicate_messages_total`
- `conversation_edge_outbox_pending`

## Required observations

- Duplicate Meta message IDs never advance twice.
- Edge p95 decision time stays below 250 ms.
- Stop and control state matches Airtable.
- No Edge outbox row leaves `parked` in Phase 1.
- The live reply continues to come from Typebot through workflow `04`.
