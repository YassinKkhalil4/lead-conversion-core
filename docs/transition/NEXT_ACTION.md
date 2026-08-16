# Next Action

Last updated: 2026-08-16

Current mini-project: Lead management dashboard. The backend `/api/*` surface is complete and locally verified; the Expo client is the next slice.

Exact next implementation task: build the Expo app (web, iOS, Android) against the documented `/api/*` surface, starting with login and the lead inbox, then lead detail. The backend is a deliberate review checkpoint and should be reviewed before UI work begins.

Files expected to change next:

- New Expo application files outside this repository's `src/`, plus the top-level README covering per-platform builds.
- Backend files change again only if UI integration exposes a defect in the `/api/*` surface.

Still owner-controlled from the earlier cutover mini-project:

- Live Meta and Google Calendar verification, production DNS/webhook authority, and the production traffic switch remain external-owner actions. They do not block dashboard implementation.

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
