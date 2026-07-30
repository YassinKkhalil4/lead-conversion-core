# Assumptions

- Egyptian phone normalization remains a first-class domain rule.
- Initial client timezone is `Africa/Cairo`.
- Contact uniqueness initially uses `(client_id, phone_e164)`.
- A lead is a project/source lifecycle for a contact, not the contact itself.
- Legacy Airtable record IDs are migration/audit identifiers only.
- External provider credentials will be supplied through environment/secret management, not committed files.
- Airtable migration will run from a complete owner-provided export or a rotated least-privilege API token.
- Production cutover, credential rotation, and old runtime decommission require explicit owner approval.
