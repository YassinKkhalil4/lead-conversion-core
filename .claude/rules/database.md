# Database Rules

- Prefer explicit SQL and typed repositories. Do not add an ORM during this transition.
- Public webhook receipt must be committed before acknowledgement.
- External side effects must be represented by durable outbox commands before worker execution.
- Queue claims require `FOR UPDATE SKIP LOCKED`, deterministic ordering, leases, bounded attempts, and dead-letter state.
- Do not perform external HTTP calls inside database transactions.
- Migrations must be additive until legacy runtimes are drained.
- Applied migrations require an advisory lock and checksum verification.
- Every mutation must have a transactional guarantee or verified postcondition.
