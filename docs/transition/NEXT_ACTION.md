# Next Action

Last updated: 2026-08-15

Current mini-project: Big-bang production owner verification.

Exact next implementation task: push the verified cleanup branch, then wait for owner-controlled live verification inputs. No gradual cutover or in-app compatibility path remains in this plan.

Files expected to change next:

- None for local implementation unless a live verification defect is found.
- If live verification exposes a defect, change only the affected source, migration, test, script, or transition document files.

Required verification before production traffic switch:

- Confirm the pushed branch matches the locally verified commit.
- Run live Meta webhook verification with owner-supplied rotated credentials and the approved production/staging webhook target.
- Run live Google Calendar verification with owner-supplied OAuth refresh credentials and target calendar IDs.
- Confirm a restorable PostgreSQL backup exists for rollback.
- Obtain owner approval for the production webhook/DNS routing change.

Known blockers:

- Live Meta verification requires owner-supplied rotated credentials and webhook control.
- Live Google Calendar verification requires owner-supplied OAuth refresh credentials and calendar IDs.
- Production traffic switch requires owner approval and Meta webhook/DNS routing control.

Rollback model: restore the last approved PostgreSQL backup and repoint Meta webhook/DNS routing back to the previous production stack. The application no longer carries n8n, Typebot, Airtable, shadow, active-turn, or legacy outbox compatibility routes as rollback machinery.

Last locally verified base commit before this cleanup: `698570a` (`Reject inbound message provider ID collisions with changed semantics`).

Git worktree clean when recorded: pending commit/push of the verified big-bang cleanup slice.
