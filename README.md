# Conversation Edge — Integration-Safe v1.1

Conversation Edge is the future low-latency conversation runtime inside the Lead Conversion OS.

The supplied deployment defaults to **legacy-authoritative shadow mode**:

```text
EDGE_MODE=shadow
OUTBOX_WORKER_ENABLED=false
DEFAULT_CONVERSATION_ENGINE=legacy
SHADOW_STATE_AUTHORITY=legacy
```

In this mode it cannot send WhatsApp messages, cannot project outbox events, and cannot replace Typebot. It receives non-blocking mirrored turns from n8n workflow `00G` and control-state updates from `00H`.

## Integration safeguards

- Meta-message ID is the inbound idempotency key.
- Existing conversations remain pinned to their configuration version.
- Legacy shadow calls rebase from current n8n/Airtable state.
- Opt-out, takeover, won/lost, stopped, invalid-number and booked states suppress replies.
- Control state can be stored before a conversation exists.
- Conversation ownership is explicit: `legacy` or `edge`.
- Outbox worker uses the versioned `edge.event.v1` envelope.
- The n8n event adapter remains inactive until side-effect idempotency is complete.

## Local domain verification

```bash
npm install
npm run test
npm run test:smoke
npm run test:integration
npm run simulate
```

The VPS Docker build installs dependencies from the public registry available to the server.
