# Owner Action: Airtable Export

Status: pending owner export.

## Required Tables

- Clients
- Projects
- Salespeople
- Questions
- Question Options
- Conversation Messages
- Leads
- Qualifications
- Messages
- FollowUps
- Appointments
- Scores
- Events

## Required Delivery

Provide either:

1. Complete per-table JSON/CSV exports with linked-record IDs preserved, or
2. A newly rotated least-privilege Airtable token supplied through ignored environment configuration for API export.

Do not commit exports or tokens. Place local export files under ignored `imports/airtable/`.

## Dry Run

1. Install dependencies with `npm ci`.
2. Run importer dry-run once tooling is available.
3. Review raw record count, valid count, rejected count, and linked-record coverage.
4. Fix Airtable records or approve documented rejects.
5. Run final delta/freeze immediately before authority cutover.

## Review Counts

Confirm row counts, active lead counts, opt-out count, open appointment count, pending follow-up count, message count, and provider ID uniqueness before PostgreSQL authority is enabled.
