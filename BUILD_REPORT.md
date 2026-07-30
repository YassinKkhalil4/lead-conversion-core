# Build Report — Integration-Safe v1.1

## Implemented

- Meta-message ID idempotency
- Per-phone PostgreSQL locking
- Pinned configuration snapshots
- Legacy-authoritative shadow rebasing
- Explicit conversation ownership
- Full current `00E` suppression parity
- Durable control state before conversation creation
- Expanded bootstrap/control APIs
- Structural parity comparison
- Raw fallback notes parity
- Versioned `edge.event.v1` outbox envelope
- Shared Docker network with n8n

## Validation completed

- 9 questions, 22 options, 7 messages: pass
- Full English cash sequence: pass
- Final stage `qualified`: pass
- Purpose `Primary Residence`: pass
- 12 suppression cases: pass
- Raw fallback notes: pass
- Structural option-array comparison: pass
- n8n workflow JSON validation: pass
- Live-export patch scripts against supplied workflows: pass
- Shell syntax validation: pass

## Deliberately disabled

- Meta sending from Edge
- Outbox delivery
- Active conversation ownership
- `00I` event adapter

## Environment limitation

The local package registry did not contain all declared npm packages, so a complete dependency-backed Docker build could not run in this environment. Domain code executed successfully with the available TypeScript runtime. The VPS deployment script performs the real Docker build.
