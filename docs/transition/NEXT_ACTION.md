# Next Action

Last updated: 2026-07-30

Current mini-project: MP-09 Scoring, routing, commands, and alerts

Exact next implementation task: Continue MP-09 by adding outbound dispatch handling for durable salesperson/operator notification command types. Implement a real adapter path that maps `salesperson.lead_assignment_notification` and `operator.routing_attention_required` to configured WhatsApp template/text sends without hardcoded success, keeps the provider disabled unless configured, preserves retry/permanent-failure classification, and adds unit/PostgreSQL worker tests proving unsupported or unconfigured sends fail safely without losing outbox history.

Files expected to change:

- `docs/transition/STATUS.md`
- `docs/transition/WORK_QUEUE.md`
- `docs/transition/NEXT_ACTION.md`
- `docs/transition/IMPLEMENTATION_LEDGER.md`
- `docs/transition/TEST_EVIDENCE.md`
- `migrations/00*_*.sql`
- `src/domain/**`
- `src/services/**`
- `src/routes/**`
- `scripts/**`
- `tests/**/*`

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
- Disposable PostgreSQL migration/import/reconciliation/runtime checks

Known blockers:

- Complete real Airtable export is unavailable for production reconciliation.
- Docker daemon is unavailable for image run and Docker-based dump metadata inspection.
- Rotated Meta credentials, approved templates, and staging webhook access are unavailable for live WhatsApp verification.
- Real website/Facebook lead source configuration is unavailable for live lead intake verification.

Last verified implementation commit: d0f7e36

Git worktree clean when recorded: yes
