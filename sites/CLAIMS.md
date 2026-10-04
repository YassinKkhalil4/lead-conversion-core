# Hospitality claims to confirm before launch

`src/` has no hospitality code: no voice pipeline, no CoverManager or floor-plan integration, no Catalan, no reservation flow. Everything on hospitality.kadensio.com comes from the owner's brief, not from the repo. Real estate is different: its numbers come from `landing/lead-scoring.html` and the live landing.

An indexable build (`SITES_INDEXABLE=1`) is refused until `claimsConfirmed` in `copy/hospitality.mjs` is set to `true`. Set it only after each row is true today, or the copy is changed to match.

| # | Claim on the page | Where | Confirm |
|---|---|---|---|
| 1 | Calls are answered live by a scripted voice | hero, mechanics, voice | Voice pipeline exists and is in production |
| 2 | Replies on a call begin in under a second | hero, voice note | Measured, and on which path (first word spoken?) |
| 3 | English, Spanish and Catalan | mechanics, FAQ | All three tested, speech and WhatsApp |
| 4 | Language is detected from speech on a call; the guest can switch at any point | mechanics | Detection method; whether WhatsApp threads detect or ask |
| 5 | Party size, date and shift, zone are collected, in that sequence | mechanics | Final question order |
| 6 | Large groups are screened for a deposit hold | mechanics, sample | The rule and its threshold. The sample says a party of 4 needs none |
| 7 | Availability is checked in real time and the booking is written into CoverManager | mechanics, sample, FAQ | Integration built and tested against a real CoverManager account |
| 8 | "Built for CoverManager"; other floor-plan tools on request | FAQ | Whether any other system is supported |
| 9 | A dropped call sends the details (and a map) to the guest's WhatsApp | mechanics, voice, FAQ | Built; how the guest's number is known |
| 10 | Every call is transcribed and kept with the reservation | voice, dashboard | Transcripts stored and shown in the dashboard |
| 11 | A call and a WhatsApp thread from the same guest are one conversation | dashboard | Identity matching by phone number |
| 12 | Host can take over in one tap | dashboard, FAQ | Same control as real estate, working for hospitality |
| 13 | The dashboard is the same one real estate uses, with different labels | dashboard | Tenant-profile re-label layer (step 4) built |
| 14 | Calls use a dedicated voice trunk | FAQ | Provider and number setup |
| 15 | Speech recognition and synthesis are the only models; no generative model writes anything | voice, FAQ | True for the whole voice path, including detection |

Not claimed anywhere, on purpose: customer names, venue counts, uptime, accuracy figures, prices, a live demo number, a dashboard screenshot.
