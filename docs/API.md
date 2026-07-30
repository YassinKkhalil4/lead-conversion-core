# API Contract

## `POST /v1/shadow/evaluate`

Header:

```text
X-Edge-Secret: <EDGE_SHARED_SECRET>
```

Required:

```json
{
  "eventId": "gateway-shadow:wamid...",
  "metaMessageId": "wamid...",
  "clientRecordId": "rec...",
  "phoneNormalized": "+2010...",
  "leadRecordId": "rec..."
}
```

The Meta message ID, not `eventId`, prevents duplicate state advancement.

Shadow callers should send:

```json
{
  "stateAuthority": "legacy",
  "currentStage": "asking_budget",
  "preferredLanguage": "Arabic",
  "status": "in_qualification",
  "stopFollowUp": false,
  "humanTakeover": false,
  "closedStatus": "",
  "appointmentStatus": ""
}
```

`legacyExpected` may include any subset of:

```text
text
messageKind
interactiveOptionIds
interactiveOptionLabels
replyKey
stageAfter
parsedValue
action
```

Only supplied keys are compared.

## `POST /internal/conversations/bootstrap`

Creates or rebases a conversation. Existing conversations remain pinned to their current config unless `migrateConfig=true`.

## `POST /internal/conversations/control`

Upserts compliance and business controls. It succeeds even if the conversation has not started yet.

## `POST /internal/conversations/ownership`

Changes the per-conversation engine and authority with an audit row.

## `GET /internal/outbox/summary`

Shows parked, pending, failed and completed event counts.

## Health

```text
GET /health
GET /ready
GET /metrics
```
