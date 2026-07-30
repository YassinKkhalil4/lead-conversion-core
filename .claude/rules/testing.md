# Testing Rules

- Run the narrowest relevant tests after each material change, then broader tests before closing a mini-project.
- Keep unit tests for deterministic domain behavior and integration tests for PostgreSQL transaction/queue behavior.
- Use real disposable PostgreSQL for database integration tests.
- Do not suppress or weaken tests to obtain a green result.
- Record exact commands and results in `docs/transition/TEST_EVIDENCE.md`.
- Distinguish unit tested, locally integration tested, contract tested, staging verified, production canary, and externally blocked.
