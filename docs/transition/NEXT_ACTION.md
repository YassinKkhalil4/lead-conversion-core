# Next Action

Last updated: 2026-07-30

Current mini-project: MP-03 PostgreSQL core and Airtable migration foundation

Exact next implementation task: Continue MP-03 by adding remaining provisional per-table adapters and reconciliation checks for configuration records, messages, qualifications, scores, follow-ups, and appointments using only verified/inferred field mappings.

Files expected to change:

- `scripts/import-airtable.ts`
- `scripts/reconcile-airtable.ts`
- `docs/transition/AIRTABLE_FIELD_MAP.md`
- `docs/transition/DATA_MIGRATION.md`
- `docs/transition/DATA_RECONCILIATION.md`
- `docs/transition/TEST_EVIDENCE.md`
- `tests/fixtures/airtable-export*`
- `tests/import-airtable*.test.ts`

Required verification:

- `git status --short`
- `git log --oneline --decorate -10`
- `git show --stat 7ba47c2`
- `git show --stat df90f61`
- `git show --stat d0e751a`
- `npm ci`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm audit --audit-level=moderate`
- `npm run test:smoke`
- Disposable PostgreSQL migration/import/reconciliation checks

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated provider credentials are unavailable for live integrations.

Last verified commit: d0e751a plus uncommitted Codex conversion/audit slice verified by local gates

Git worktree clean when recorded: yes
