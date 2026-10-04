# Browser QA, 4 October 2026

Run with Vercel's agent-browser (`vercel-labs/agent-browser`) driving Chrome against
a local stack: Postgres, the API from the merged code, the Expo dev server, and the
landing pages behind a Caddy that routes `/api/waitlist` the way production does.
Seed data: one brokerage, three salespeople, three projects, eight leads in
different states, twelve messages in English and Arabic, a manager login and a
salesperson login.

## Flows exercised

| Flow | Result |
|---|---|
| Sign in with a wrong password | Clear inline message. No console error |
| Sign in as manager | Lands on Overview with real figures that match the database |
| Primary navigation: Overview, Leads, Salespeople, Projects, Users, Notifications | Every page loads its data. No console errors |
| Open a lead, expand the conversation | Five messages with times and the 23-hour reply window |
| Acknowledge a lead | `acknowledged_at` set, button replaced, queue refetched |
| Add a salesperson (empty, bad phone, valid) | Inline validation; valid submit created the row |
| Sign out, then open a manager URL directly | Redirected to the login screen |
| Sign in as a salesperson, open a manager URL | Lands on the queue; manager URLs redirect back |
| Phone width (390px): every dashboard screen | No horizontal overflow; drawer opens as a modal dialog; end of page clear of the tab bar |
| Landing: header links, anchors, scoring page, contents list | Every anchor lands clear of the sticky header; current page marked |
| Landing at 390px: all seven pages | No overflow, no console errors |
| Early-access form: empty, malformed, network failure, real submission | See bugs 1 and 2 |

## Bugs found and fixed

| # | Severity | Bug | Cause | Fix |
|---|---|---|---|---|
| 1 | High | The early-access form fails for anyone on `www.kadensio.com`: "Could not reach the server" | The script posted to the absolute URL `https://kadensio.com/api/waitlist`. From `www` that is cross-origin, the API sends no CORS headers and its preflight returns 404, so the browser blocks it. `www` serves the full site with a 200 and no redirect. The same hard-coded URL also made any local or preview copy post to production | Relative `/api/waitlist`. Confirmed end to end: request stays on the page's origin, API returns 200, row stored with source `kadensio_landing` |
| 2 | Low | A malformed email such as `not-an-email` was only caught after a round trip to the server | The script checked only that the field was not empty | One-line format check in the browser, with its own message. Zero requests sent |
| 3 | Low | Overview subtitle read "updated now ago", and "updated Fri 04:22 ago" after a day | Built from `queueClock`, which returns `now` and absolute dates | New `updatedLabel` on `ageAgo`: "updated just now", "updated 5m ago", "updated 3 Oct, 04:22" |
| 4 | Low | "1 events", "1 projects", "1 accounts", "1 candidates considered", "1 messages" | No plural handling | `nounCount` helper in `desk/safe.ts`, used at all five sites |

New tests: `tests/dashboard-copy-format.test.ts` (plurals and the updated label) and
two contract tests in `tests/landing-copy.test.ts` (the form posts to a relative
path; the email format check exists). Full suite: 449 passing in 38 files.

## Checked and not bugs

- **Console:** no errors on any page in either app. The only network error ever
  logged is the 401 from the session check when signed out, which is expected.
- **Salesperson queue missing a lead:** my seed wrote the assignment status
  `acknowledged`, which the app never writes (it sets `acknowledged_at` and keeps
  `assigned`). The database confirmed it; the seed was wrong.
- **Empty Budget, Unit, Location on a lead:** the seed has no qualification answers.
- **Times shown in UTC:** the browser container runs in UTC and the app formats in
  the device's zone. Worth a look on a real phone.
- **Drawer links missing from the accessibility snapshot:** they are present in the
  DOM inside `role=dialog aria-modal=true`; the tool's snapshot skipped them.

## Left alone, for your call

- **Duplicate brand on the phone queue.** The header carries the mark and the
  brokerage name, and the queue then draws a "kadensio" lockup directly under it.
  Redundant rather than broken.
- **Phone hint uses an Egyptian number.** The salesperson form says "for example
  +201001234567" while the first market is Dubai. A +971 example would match.
- **Timezone label.** New brokerages default to `Africa/Cairo`. Correct per the
  data model, but a Dubai brokerage would want its own.

## Tool notes

agent-browser 0.27.0 from npm. `find role … click --name` did not act on
elements in this version; plain selectors and `@eN` refs did. Clicks inside a
scrolling modal were unreliable by ref; a real mouse click at the button's
coordinates always worked.
