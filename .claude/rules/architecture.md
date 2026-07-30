# Architecture Rules

- Build one modular monolith, not microservices.
- Keep domain modules explicit and local: clients, contacts, leads, intake, messaging, conversations, qualification, scoring, routing, followups, appointments, reporting, configuration.
- Use Fastify routes as transport adapters only; business state changes belong in services and repositories.
- Use PostgreSQL as the canonical state authority for migrated capabilities.
- Use append-only audit/integration events for traceability, not full event sourcing.
- Keep Airtable as read-only migration input and temporary projection target only.
- Keep n8n and Typebot only as compatibility/fallback runtimes during drain.
- Do not introduce Kafka, RabbitMQ, Redis, Temporal, or another orchestrator without documented evidence and owner approval.
