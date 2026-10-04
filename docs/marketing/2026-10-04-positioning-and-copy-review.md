# Positioning and copy review, 4 October 2026

Scope: public copy (landing, scoring page, two new articles), the early-access
form's messages and the dashboard's first-run text. No backend logic and no
visual styling changed. All claims follow `brand/index.html`: no "AI", no "bot",
no invented customers or figures, caveats ship with the claim.

## Positioning, as found

Kadensio sells one thing to one buyer: brokerage owners and sales managers who
get property leads on WhatsApp and reply slowly. The strongest assets are a
number (30 seconds, measured) and a phone line anyone can message. The structure
is already right: problem, mechanism, what the team sees, try it, objection
(official route), configuration, FAQ, one conversion.

## What was costing conversions

| # | Problem | Fix |
|---|---|---|
| 1 | The H1 promised "booked a viewing" 30 seconds later. 30 seconds is the fastest verified run, not the typical one, and the caveat sat three sections down. A sceptical reader finds the gap and stops trusting the page. | H1 now claims only what is always true: it answers in seconds and hands the team a scored lead. The 30-second figure stays where its caveat sits. |
| 2 | Two competing hero actions with different weight and vague labels ("Message the live number", "Request early access"). | "Try it on WhatsApp" is the low-commitment first action. "Get early access" is the commitment. The same two labels are used on every page, the form button and the confirmation. |
| 3 | The form's confirmation ended the conversation: "Thanks. I will reply." | It now gives the next step: test the live number while waiting. A signup that tries the product is more likely to answer the founder's reply. |
| 4 | No answer to the first question a buyer asks: what does it cost? | New FAQ entry, taken from the Terms of Service: no published price, any subscription fee agreed in writing, Meta fees at cost with no markup. |
| 5 | Three claims with no source: "most property leads arrive as cold WhatsApp messages", "main source", "most WhatsApp automation is unofficial". | Removed or reworded. The compliance section now says what WhatsApp says: it can restrict or ban. |
| 6 | The compliance heading used the word the brand guide reserves for the thing being criticised ("bot") and led with fear. | "Unofficial WhatsApp automation can get your number banned." States the risk and matches the query people type. |
| 7 | First-run dashboard text described the problem ("nobody to go to") without the consequence; the empty queue gave no way to see a lead arrive. | Checklist now says every qualified lead escalates to the manager. The empty queue tells an admin to message their own number, and tells a salesperson how leads reach them. |
| 8 | Meta description and share previews led with the mechanism, not the outcome. | Both lead with the outcome and the action. |

## Voice pass

Every new or changed sentence was edited for: an actor in each sentence, no
"not X, Y" contrasts, no hedging openers, no filler vocabulary, no em dashes, no
exclamation marks, no lists of three for rhythm. `tests/landing-copy.test.ts`
now enforces the checkable part of that on every public page: the banned-word
list, no "AI" or "bot", no em dashes, exclamation marks or emoji, one h1, title
at most 60 characters, description at most 160, one label per action, FAQ
structured data identical to the visible FAQ, sitemap and canonical correctness,
and internal links that resolve.

## Left alone, with reasons

- The nine-question mechanism, the ten-factor score and the timeline sample.
  They are specific and checkable, which is what the page is selling.
- The brand rule against testimonials and logos. A market is not a customer.
- Pricing. There is none to publish. The FAQ says so plainly.
- Retention beyond the checklist and empty states needs usage data (which setup
  step people stall on). The dashboard records no analytics by design.
