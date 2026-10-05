# Owner Action: Hospitality venue onboarding

Status: backend built and tested locally (WhatsApp reservations). Nothing below has been done against a real venue, a real Meta number or a real floor plan.

## What the backend does today (Phase 1)

- A guest messages the venue's WhatsApp number and books by chat in Spanish, Catalan or English: language, party size, day and shift, zone.
- Availability is the capacity the venue gives Kadensio (covers per zone and shift, with per-date overrides). Two guests cannot take the last table.
- Parties at or above the venue's threshold are held as `requested` for the venue to approve; the venue collects any deposit itself.
- The guest can cancel by writing "cancelar" / "cancel·lar" / "cancel". A returning guest starts a new booking by writing again.
- Hosts see reservations in `GET /api/reservations` and confirm, decline, or mark seated / completed / no-show.

## What it does not do yet

- **Phone calls, voice and speech.** Not built. No telephony, speech-to-text or text-to-speech.
- **CoverManager.** Not built. A venue set to `floor_plan_provider = 'covermanager'` is handed to a person, never guessed at.
- **24-hour reminder.** Not built: it needs approved templates (below) and a scheduled job.
- **Payments.** Deposits are the venue's to collect; the reservation records `pending / paid / waived`.
- **Host dashboard screen.** The API exists; the Expo dashboard has no reservations view yet.

## Owner steps for a venue

1. **Meta number.** Register a WhatsApp Business number for the venue and note its phone number id (see `03-meta-whatsapp.md`).
2. **Spec.** Copy `docs/examples/hospitality-tenant.example.json`, fill in the venue, zones (max 3: WhatsApp buttons), shifts, capacity per zone and shift, hosts, deposit threshold, and the phone number id. Check it: `npm run tenant:hospitality -- --spec tenant.json --validate-only`.
3. **Provision.** `npm run tenant:hospitality -- --spec tenant.json` (production: `npm run tenant:hospitality:prod`). Safe to re-run after editing the spec; a zone or shift dropped from the spec is switched off, never deleted.
4. **Hosts' logins.** `npm run user:create -- --client-key <key> --email ... --name ... --role salesperson --salesperson-phone +34...` for each host, and a manager.
5. **Go live.** The spec's `directSendEnabled` is `false` by default. Set it to `true` only after a staging conversation has been read end to end by a person who speaks the venue's languages.

## Templates to submit to Meta (Spanish, Catalan, English)

Free-form messages only work inside the 24 hours after the guest's last message. Anything outside it must be an approved template, and templates for these are not submitted yet:

- `reservation_reminder` (24 h before): party size, venue, shift, "reply CANCEL".
- `reservation_confirmed_by_venue` (when a held request is approved after the window has closed).
- `reservation_declined_by_venue`.

Add each approved name to `META_APPROVED_TEMPLATE_NAMES` with its language code (`name:es`, `name:ca`, `name:en`).

## Compliance to settle before a real guest is served

- The guest's name and phone number are stored. The privacy notice for the venue must say so, how long (retention), and who to ask to erase it.
- Opt-out words in Spanish and Catalan are recognised ("baja", "parar", "no me interesa", "donar de baixa", ...). A bare "para" is deliberately not one.
- Call recording and its consent are out of scope until voice exists.
