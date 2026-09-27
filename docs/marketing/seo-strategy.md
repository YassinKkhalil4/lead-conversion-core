# SEO strategy: kadensio.com

Last reviewed 27 September 2026.

## Goal

Organic search should bring brokerage owners and sales managers who are already looking for a way to answer WhatsApp leads faster, and send them to the two conversions that matter: messaging the live number, and requesting early access.

The site is small on purpose: one commercial page, one explainer, three legal pages. Growth comes from a few pages that answer real buying questions well, not from volume.

## Who searches, and for what

| Intent | Who | Example queries (validate volumes before committing) | Page |
|---|---|---|---|
| Looking for a tool | Owner, sales manager | whatsapp lead qualification real estate; real estate whatsapp automation dubai; whatsapp business api real estate | Home |
| Evaluating risk | Owner, ops | whatsapp business api vs whatsapp web automation; will my whatsapp number get banned automation | Planned: official vs unofficial |
| Understanding the method | Sales manager | real estate lead scoring model; how to score property leads | lead-scoring.html |
| Diagnosing the problem | Sales manager | real estate lead response time; speed to lead property | Planned: speed to lead |

No keyword tool data was available when this was written. Every query above is a hypothesis: check it in Google Search Console once the site has impressions, or in Ahrefs or Semrush, before writing a page for it.

## Done in this pass

Technical
- `robots.txt` allowing everything and pointing to the sitemap.
- `sitemap.xml` with all five indexable URLs.
- JSON-LD on the home page: Organization, WebSite, SoftwareApplication and FAQPage, in one `@graph`. The FAQ entries are generated from the visible FAQ, so the two cannot drift. Google shows FAQ rich results only for a few authoritative sites, so the FAQPage markup is for entity understanding and other engines, not a SERP feature.
- `llms.txt` at the root: a plain summary for AI answer engines, restricted to verified claims.

On-page
- Home title cut to 54 characters with the category first: "WhatsApp Lead Qualification for Real Estate | Kadensio". The old one was 66 and truncated.
- Home description cut from over 250 characters to 151.
- The H1 stays a scenario ("A buyer messages your number at 2am...") because it converts; the keyword sits in the eyebrow and the first sentence of the body.
- Internal links: the home page's scoring step and every footer link to the scoring page; legal pages point their header action at early access instead of a mailto.

Content
- `lead-scoring.html`: all ten scoring factors with their points, the hot, warm and cold bands, a worked example, and what the score does not do. It is first-party and specific, which is what gets a page cited: nobody else can publish this model.

## Next, in order

1. **Verify and measure.** Add the site to Google Search Console and Bing Webmaster Tools (both need no on-page script, which keeps the no-analytics promise in the privacy policy), submit the sitemap, and record a baseline for impressions and clicks per page.
2. **Official vs unofficial automation.** The compliance section of the home page is the strongest objection-handler on the site and is compressed into three paragraphs. A standalone page on what the WhatsApp Business Platform is, what unofficial automation risks, and how to tell which one a vendor uses would answer a question owners search before they buy. Cite Meta's own documentation for every claim about the platform or its terms.
3. **Speed to lead for property brokerages.** Expand the cost section into a page that states the research honestly, with its caveats, and shows what a reply in seconds looks like in practice. Only publish new figures that are measured.
4. **Arabic.** Most target buyers and many owners search in Arabic. An Arabic version of the home page with its own URL (`/ar/`), self-referencing canonicals and reciprocal hreflang would open that search space. It needs a native writer, not a translation pass, and the brand rule on neutral international identity still applies to visuals. Do not publish a thin or machine-translated version: a weak locale drags down the site's overall quality.
5. **Comparisons.** Once the competitive set is researched, "alternatives" pages for the tools brokerages already use. Only with verified, dated facts about each competitor.

## Rules for any new page

- Same voice rules as the brand guide: arithmetic, not adjectives. Never call it AI or a bot. No invented customers, figures or testimonials.
- Every claim about what the product does must be checked against the code; this pass caught two that would have been false (automated follow-ups, and the score influencing routing).
- One primary query per page, reflected in the title, H1 or first paragraph, and URL.
- Each page ends with the two conversions: the live number and early access.
- Add it to `sitemap.xml` and `llms.txt` when it ships.

## Measuring it

- Search Console: impressions and clicks per page, and the queries each page is actually shown for. Rewrite titles for pages with impressions but a low click-through rate.
- Conversions: early-access submissions are stored with the request headers, and the live number's conversations are in the system. Asking "How did you hear about us?" in the early-access form would attribute organic without adding a tracker.
