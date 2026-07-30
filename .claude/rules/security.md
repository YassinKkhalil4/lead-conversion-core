# Security Rules

- Never print, copy, document, or commit credential values.
- Public inputs must authenticate or fail closed.
- Verify raw-body HMAC signatures for provider webhooks.
- Do not log provider tokens, customer PII, raw credential-bearing payloads, or full environment maps.
- Redact or hash PII in general logs and metrics.
- Keep provider integrations disabled when credentials or owner verification are absent.
- Maintain owner-action documents for rotation, revocation, and verification.
