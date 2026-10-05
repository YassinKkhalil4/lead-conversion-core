# Owner Action: Hospitality venue onboarding

Status: backend built and tested locally (WhatsApp reservations). Nothing below has been done against a real venue, a real Meta number or a real floor plan.

## What the backend does today (Phase 1)

- A guest messages the venue's WhatsApp number and books by chat in Spanish, Catalan or English: language, party size, day and shift, zone.
- Availability is the capacity the venue gives Kadensio (covers per zone and shift, with per-date overrides). Two guests cannot take the last table.
- Parties at or above the venue's threshold are held as `requested` for the venue to approve; the venue collects any deposit itself.
- The guest can cancel by writing "cancelar" / "cancel·lar" / "cancel". A returning guest starts a new booking by writing again.
- Hosts see reservations in the dashboard (Reservations: today / tomorrow / upcoming, a "Needs your approval" list for held groups) and confirm, decline, or mark seated / completed / no-show. The same actions exist in `/api/reservations`.
- A confirmed booking gets a reminder `reminder_lead_hours` (default 24) before the table: text inside WhatsApp's 24-hour window, otherwise the approved `reservation_reminder` template with a cancel button. Cancelling by any route (guest text, the button, the venue) removes it, and nothing is sent for a table that was cancelled, moved or has started.

## What it does not do yet

- **Phone calls, voice and speech.** Not built. No telephony, speech-to-text or text-to-speech.
- **CoverManager.** Not built. A venue set to `floor_plan_provider = 'covermanager'` is handed to a person, never guessed at.
- **Payments.** Deposits are the venue's to collect; the reservation records `pending / paid / waived`.

## Owner steps for a venue

1. **Meta number.** Register a WhatsApp Business number for the venue and note its phone number id (see `03-meta-whatsapp.md`).
2. **Spec.** Copy `docs/examples/hospitality-tenant.example.json`, fill in the venue, zones (max 3: WhatsApp buttons), shifts, capacity per zone and shift, hosts, deposit threshold, and the phone number id. Check it: `npm run tenant:hospitality -- --spec tenant.json --validate-only`.
3. **Provision.** `npm run tenant:hospitality -- --spec tenant.json` (production: `npm run tenant:hospitality:prod`). Safe to re-run after editing the spec; a zone or shift dropped from the spec is switched off, never deleted.
4. **Hosts' logins.** `npm run user:create -- --client-key <key> --email ... --name ... --role salesperson --salesperson-phone +34...` for each host, and a manager.
5. **Go live.** The spec's `directSendEnabled` is `false` by default. Set it to `true` only after a staging conversation has been read end to end by a person who speaks the venue's languages.

## Templates to submit to Meta (Spanish, Catalan, English)

Free-form messages only work inside the 24 hours after the guest's last message. The reminder is normally sent outside it, so it needs an approved template. Not submitted yet:

- **`reservation_reminder`**, one per language (`es`, `ca`, `en`). Body with exactly four variables, in this order: `{{1}}` party size, `{{2}}` venue name, `{{3}}` date (e.g. "viernes, 9 de octubre"), `{{4}}` shift ("cena"). Example body: "Recordatorio: tu mesa para {{1}} en {{2}} es {{3}} ({{4}}). ¿Vienes?". One **quick-reply button** labelled Cancelar / Cancel·lar / Cancel (the backend fills its payload with the reservation id).
- `reservation_confirmed_by_venue` and `reservation_declined_by_venue`: used when a host approves or declines a held request after the guest's window has closed. The dashboard currently tells the host the guest could not be messaged in that case; these two templates are not wired to send yet.

Add each approved name with its language code to `META_APPROVED_TEMPLATE_NAMES` (`reservation_reminder:es,reservation_reminder:ca,reservation_reminder:en`). Until the template is approved, a reminder due outside the window retries and ends in the dead-letter list.

## WhatsApp numbers

A venue on its own WhatsApp number sends from that number: it must be registered through `npm run tenant:hospitality` (an active `edge_client_channels` row with direct send on) and be on the same Meta app and access token as the default number. A number on a different Meta app needs its own credentials, which the sender does not support yet.

## Compliance to settle before a real guest is served

- The guest's name and phone number are stored. The privacy notice for the venue must say so, how long (retention), and who to ask to erase it.
- Opt-out words in Spanish and Catalan are recognised ("baja", "parar", "no me interesa", "donar de baixa", ...). A bare "para" is deliberately not one.
- Call recording and its consent are out of scope until voice exists.
