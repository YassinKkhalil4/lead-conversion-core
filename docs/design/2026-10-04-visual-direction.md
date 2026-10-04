# Visual direction: the ledger

Written with the Taste skill (`leonxlnx/taste-skill`, design-taste-frontend) and
its redesign protocol. Mode: **redesign, preserve brand**. The mark, the green,
Geist and the copy voice stay. Layout, type scale, spacing and surface treatment
are new.

## Design read

Reading this as: B2B product site for brokerage owners and sales managers in the
UAE and Egypt, with a quiet, editorial language (a private bank's statement, not
a SaaS dashboard), on native CSS with Geist and Geist Mono and one green accent.

Dials: `DESIGN_VARIANCE 6`, `MOTION_INTENSITY 2`, `VISUAL_DENSITY 3`. The product
sells a number and a timestamped record, so the page is built like one: ruled
columns, tabular figures, generous margins. Motion is out of scope for this pass,
so the only movement left is the pressed state on buttons and colour changes.

## What the audit found

| Pattern | Verdict |
|---|---|
| Three-line headline with the second half in green | Hero must fit in two lines. Retired. |
| Bezel panel with shadow around the timeline | Card chrome with no hierarchy reason. Retired. |
| Icon column in the timeline | Decoration. Retired. |
| Stat tiles, a six-cell bento of cards, a compare card with a tinted fill | Cards where a rule would do. Replaced with ruled columns. |
| Split headers (headline left, paragraph floating right) on three sections | Banned pattern. Headline and lead now stack. |
| Step numerals 01 to 04 | Generic step labels. The verb in each step is the label. |
| The closing block flips to a dark panel in light mode | Theme lock broken. The page keeps one theme. |
| Mono used for most figures | Mono now only carries timestamps and document metadata. |
| Four radii (6, 10, 12, 20) | One rule: interactive elements 6px, everything else square. |

Kept: Geist, the brand green, the mark, all copy, every anchor id, every form
field name, the early-access script.

## System

**Type.** Geist throughout, weight 500 for display (not 700: weight is the cheap
way to shout), tracking -0.045em at display sizes. Body 17px at 1.65. Figures are
tabular. Scale: 13, 14, 15, 17, 20, 24, 32, 44, 76 (hero), 208 (one numeral).

**Space.** Base 4px. Steps: 8, 12, 16, 24, 32, 48, 64, 96, 144. Sections are
80 to 152px apart. Text blocks cap at 36 to 42rem; nothing runs wider.

**Colour.** One accent, `#007A47`. Ink `#0C1F1A`. Neutrals are green-tinted
greys, not beige. Accent appears on the primary button, links, the hot band and
the winning column of the comparison. Nothing else.

**Shape.** Buttons and inputs 6px. Everything else is square and separated by
hairlines. No shadows, no tinted panels except one section background.

**Layout families on the home page** (no family used twice): headline over an
asymmetric split (hero), ruled four-column facts, oversized numeral beside two
stacked figures, sticky title beside a ruled list, specimen beside a ruled list,
one giant number, two-column comparison, two ruled lists, term and definition
rows (FAQ), form beside a sign-off.

**Eyebrows.** None above section headings. The hot label on the score specimen
is the only small-caps label on the page.

## Out of scope in the skill

The skill states that dashboards and dense product UI are not its target. The
app screens therefore take only what transfers (type scale, spacing, hierarchy
and one corner rule through the existing token file) and keep their structure.
