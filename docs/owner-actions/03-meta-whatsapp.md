# Owner Action: Meta WhatsApp

Status: pending owner configuration and provider verification.

## Required Setup

- Rotate Meta app secret.
- Rotate WhatsApp access token.
- Configure webhook verification token in secret storage.
- Set callback URL for staging and production.
- Subscribe to messages and message status updates.
- Configure test recipients.
- Verify approved template inventory.

## Required Initial Templates

- `lead_permission_v1`
- `no_response_followup_v1`
- `warm_followup_v1`
- `hot_followup_v1`
- `reactivation_v1`
- `salesperson_new_lead_v1`
- `salesperson_sla_reminder_v1`
- `manager_sla_escalation_v1`
- `manager_daily_report_v1`
- `appointment_offer_v1`
- `appointment_confirmation_v1`

## Verification

1. Verify webhook challenge.
2. Verify signed webhook payload with raw-body HMAC.
3. Send staging template message to test recipient.
4. Record provider message ID externally.
5. Confirm status webhook receipt.
6. Confirm missing template fails before send.
7. Confirm rollback by disabling the route or rollout flag.

Do not invent or assume template approval status.
