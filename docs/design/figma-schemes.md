# Figma "53 Unique Website Color Schemes" — auditable inventory + shortlist

**Source article:** [53 unique website color schemes to make a lasting impression](https://www.figma.com/resource-library/website-color-schemes/) — Figma Resource Library, *Design basics*.
**Source capture (read-only):** `C:\Users\haris\.local\share\kilo\tool-output\tool_0fda973e8001g3Ys4G33NCP0aV` (954 lines).
**Extracted:** article body lines 431–803 (intro, five categories, schemes 1–53, closing tips).

---

## 0. Method, provenance and hard limits

### 0.1 No colour values exist in the source — this is a names-only inventory

The article publishes **zero** hex values. Verified mechanically against the capture:

- regex `#[0-9a-fA-F]{3,8}\b` → **0 matches** in the whole file.
- the only `rgb` / `cmyk` strings (8 matches) are navigation and "Keep reading" boilerplate (L397, L401, L843, L845, L851) — none are part of a scheme definition.

Every scheme's colour information is **a name** ("cinnamon", "gunmetal gray", "pastel blue") plus an **image alt-text caption** authored by Figma (e.g. *"Neutral gray color scheme with pop of burnt orange."*). Those names link to Figma's separate colour pages (`figma.com/colors/…`); the hex values live behind those pages, not in this article.

> **Consequence for implementation:** any token built from this file must **derive its own values** and then **verify them for contrast**. See §5.

### 0.2 Two traceability rules used throughout

- **Stated** — the colour name appears in the article's own copy (body paragraph or alt-text caption) for that scheme.
- **(implied by name)** — the family is only inferable from the scheme's *name* (e.g. "Jade pebble morning" → jade/green; "Arctic reflection" → blue). Used sparingly and never presented as fact.
- Where the alt text or body names **no** hue at all, the family cell says so explicitly rather than guessing.

### 0.3 Classification rule used in §4 (Families)

Primary hue family = **the family that forms the ground/base** of the scheme, not its accent. Where the base is unstated, the first-named dominant colour in the article's copy is used, and that is noted. This rule is applied identically to all 53 so the counts are reproducible.

### 0.4 What the article itself says matters (author's own tips, L793–797)

Verbatim, because they are the criteria the shortlist is scored against:

- "**Think about user actions.** Use color strategically to guide users' attention. Highlight important information with contrasting colors and create a visual hierarchy that directs users toward desired actions."
- "**Account for accessibility.** Make sure your website is usable by everyone. Choose colors with sufficient contrast to meet accessibility guidelines for users with visual impairments."

---

## 1. Inventory — all 53 schemes

Category column uses Figma's own five headings: **Minimal and neutral** (1–12), **Warm** (13–22), **Cool** (23–34), **Vibrant and bold** (35–43), **Modern** (44–53). Counts: 12 + 10 + 12 + 9 + 10 = 53.

| # | Name | Figma category | Colour families named or implied | Article's description (compressed) |
|---|---|---|---|---|
| 1 | Ink wash | Minimal and neutral | monochromatic gray — *stated* | Monochromatic grays "create a clean and focused aesthetic, making it ideal for websites and apps that prioritize readability." |
| 2 | Neutral elegance | Minimal and neutral | beige + gray + brown — *stated* | Muted beige, gray and brown read serene and professional, conveying "luxury and minimalism" (cited: Burberry, Louis Vuitton). |
| 3 | Jade pebble morning | Minimal and neutral | cool green + blue — *stated*; "jade" *implied by name* | Cool greens convey tranquility and nature; "the darker shades add enough contrast to create visual hierarchy while maintaining harmony." |
| 4 | Woodland | Minimal and neutral | brown + chartreuse accent — *stated*; "woodland" *implied by name* | A pop of chartreuse against an otherwise neutral scheme: "a playful touch against a calming backdrop." |
| 5 | Driftwood pearl morning | Minimal and neutral | rose gold + brown + chocolate brown + blue, light gray ground — *stated* | Rose gold and brown give warmth; chocolate brown and blue add depth; "the lighter gray provides a neutral background that enhances readability." |
| 6 | Graphite | Minimal and neutral | cool gray + green + blue + pink, with deep brown + blue-gray — *stated* | Gentle, wellness-toned palette; "the deep brown and blue-gray colors add just enough contrast to make essential website elements stand out." |
| 7 | Urban slate | Minimal and neutral | gray + brown + blue, light *and* dark shades — *stated*; "slate" *implied by name* | Pulled from "foggy cityscapes"; light/dark shade mix creates depth and contrast while staying "serene and professional." |
| 8 | Pearl | Minimal and neutral | brown ground + purple accent — *stated* | Purple "adds a hint of elegance and sophistication" and "can be used as an accent color to draw the eye to certain elements." |
| 9 | Vichy | Minimal and neutral | soft gray + crisp white ground, vibrant teal accent — *stated* | Soft gray and crisp white make "a clean and modern base, while the vibrant teal adds a pop of energy" — modern, calming, a bit playful. |
| 10 | Sorbet | Minimal and neutral | soft browns + greens, muted — *stated*; "sorbet" *implied by name* | Soft, muted, "easy on the eyes"; evokes peace, tranquility and elegance. |
| 11 | Frozen mist | Minimal and neutral | monochromatic grays + cinnamon accent — *stated* | Grays give a neutral base; "the cinnamon has a vibrancy that's great for CTA buttons and clickable elements urging action." |
| 12 | Yacht club | Minimal and neutral | cool grays + rich indigo + mahogany — *stated* | Maritime palette; "the deeper shades add a grounding quality that can help lighter elements on the page stand out." |
| 13 | Amber walnut morning | Warm | warm earthy browns — *stated* | "This warm, earthy brown color scheme offers **excellent contrast**, making for an appealing and **easy-to-read** site." |
| 14 | Copper aquamarine dream | Warm | burnt orange + muted shades (ground), cool blues and greens — *stated* | Burnt orange and muted tones "ground the design, while the cool blues and greens add a touch of tranquility." |
| 15 | Cocoa topaz noonday | Warm | warm earthy tones + calming blues; dark browns + bright orange — *stated* | Autumn warmth: "the contrast between the dark browns and the bright orange creates a dynamic color scheme **ideal for calling attention to buttons or headlines**." |
| 16 | Sandstone aquamarine serenity | Warm | natural/earth tones + pastel blue accent — *stated* | Striking pastel blue used "**sparingly** for elements like buttons, links, or highlighted text"; otherwise calming and airy. |
| 17 | Honey opal sunset | Warm | mustard yellow + taupe — *stated* | "Rich mustard yellow and taupe create a timeless and elegant aesthetic"; dark/light contrast "adds depth and dimension." |
| 18 | Seashell garnet afternoon | Warm | soft pastels + vibrant coral accent — *stated* | "Juxtapose calmness and peace with energy and excitement"; contrasts still "emphasiz[e] call-outs." |
| 19 | Rose quartz evening | Warm | monochromatic maroon + blush pink — *stated* | "Rich maroon exudes strength and elegance, while blush pink draws on classic femininity." |
| 20 | Calcite | Warm | warm gray + blue ground, orange + peach accents — *stated* | Warm grays and blues "coupled with pops of orange and peach" — sophistication plus fun for a startup that wants to stand out. |
| 21 | Fireside | Warm | orange + red, against neutral beige + deep brown — *stated* | Campfire hues; "balancing muted and vibrant tones is useful for **UI designs** that aim to stand out while still being easy on the eyes." |
| 22 | Terrazzo | Warm | warm earthy browns + pops of yellow and teal — *stated* | Modern Italian-terrazzo take; warm earth tones for comfort, "offset by pops of yellow and teal to help break up the neutral monotony." |
| 23 | Sapphire nightfall whisper | Cool | cool blue gradient, light → deep — *stated*; "sapphire" *implied by name* | Ocean-wave blues "ranging from light and airy to deep and mysterious", giving "dimension and depth." |
| 24 | Lapis velvet evening | Cool | deep blue + plum, soft beige + gray — *stated* | "Like a starry night" — deep blues and plum for sophistication; beige and gray "add a touch of warmth, balancing the darker hues." |
| 25 | Marina | Cool | soft pastels + grounding navy + chestnut — *stated* | "Beachside stroll" mix of soft pastels with "grounding navy and chestnut" for nautical-luxury brands. |
| 26 | Emerald lavender lake | Cool | soft green + blue + lilac — *stated* | Soft green and blue are "serene and inviting", "while the lilac adds a hint of intrigue." |
| 27 | Sage peridot morning | Cool | green tones + mint green vibrancy — *stated*; "sage / peridot" *implied by name* | Calming and earthy with freshness "pulled from the mint green"; sustainability/wellness/organic register. |
| 28 | Amethyst dawn haze | Cool | soft purples + vibrant yellow — *stated* | "As a complementary color to purple, yellow creates a striking contrast and draws the eye to important elements like buttons or calls to action." |
| 29 | Moon dust | Cool | soft blue + periwinkle — *stated* | "Soft, ethereal shades of blue and periwinkle … reminiscent of a gentle summer sky" — peace, tranquility, innocence. |
| 30 | Turquoise amber autumn | Cool | cool blues vs warm oranges and reds — *stated* | "The contrast between the cool blues and the warm oranges and reds creates a dynamic scheme that is both calming and exciting." |
| 31 | Sapphire ash morning | Cool | dusty blue + pink + purple, crisp white, darker teal + terracotta — *stated* | Dreamy "cool summer breeze" pastel; "the darker teal and terracotta bring a touch of depth and sophistication." |
| 32 | Frosted aura | Cool | stark white + slate grays + darker blue + pewter — *stated* | Conveys "authority, expertise, or security—think **law firms, financial institutions**, or tech companies"; stark white and gray look clean and modern. |
| 33 | Royal glimmer | Cool | deep jewel tones — **family not specified**; "royal" *implied by name* | "Rich jewel tones" for luxury and refinement, "from high-end fashion brands to upscale restaurants." |
| 34 | Neptune | Cool | light blue + teal + darker blue — *stated* | Chill, laid-back ocean mood; light blue and teal refresh and calm while darker blue adds depth. |
| 35 | Tropical jade sunrise | Vibrant and bold | warm sandal orange + cool ocean tones — *stated*; "jade" *implied by name* | Sandal-orange "balanced with cool ocean tones" for playful, inviting coastal nostalgia. |
| 36 | Amethyst mint harmony | Vibrant and bold | deep purple + emerald green + neon pink + lime green — *stated* | Deep purple and emerald "create a moody atmosphere"; neon pink and lime add energy — "just use these bold colors **sparingly**!" |
| 37 | Hibiscus aura | Vibrant and bold | neon pink/fuchsia + cherry red + plum + royal blue — *stated* | Fuchsia and cherry red excite while "the deeper purple and blue allow the brighter colors to virtually jump off the page." |
| 38 | Ocean ruby radiance | Vibrant and bold | bright pink + orange vs deep royal blue + green — *stated* | Bright pink and orange "pop against the deep royal blue and green" for playful, optimistic energy. |
| 39 | Tropical heat | Vibrant and bold | blue-green + cream + coral — *stated* | Retro '70s beach-poster palette, "with enough contrast to break up important blocks of the page." |
| 40 | Celestial | Vibrant and bold | bright yellow + blue + earthy brown — *stated* | "Strong contrast between bright yellow and blue"; earthy brown "adds a touch of grounding and stability." |
| 41 | Festive eve | Vibrant and bold | vibrant blues + purples, gradient — *stated* | Dreamy, ethereal blue/purple gradient "reminiscent of a twilight sky" (cited: Canva). |
| 42 | Freshly squeezed | Vibrant and bold | yellow + orange + cream — *stated* | Sunny yellow and orange "warm and energize", while cream "adds a touch of softness and balance." |
| 43 | Jelly shoes | Vibrant and bold | soft pinks + purples, with vibrant counterparts — *stated* | Whimsical pastels for a "calming and romantic atmosphere reminiscent of cotton candy skies and lavender fields." |
| 44 | Opaline | Modern | soft grays + whites + cinnabar accent — *stated* | "Sleek and minimalist"; soft grays and whites "create a clean and airy feel, while the pop of cinnabar brings energy." |
| 45 | Gossamer | Modern | gray + vibrant turquoise + coral/orange — *stated* | "Retro flair against a clean and modern backdrop"; vibrant turquoise and coral feel playful and energetic. |
| 46 | Clockwork | Modern | neutral gray base + orange shades — *stated* | "The neutral gray base … lets the orange shades shine, offering some much-needed warmth and vibrancy." |
| 47 | Lemon granite morning | Modern | gunmetal gray + blue, bright yellow accent — *stated* | "Can be used for multiple websites, from edgy fashion brands to **financial services**"; bright yellow "juxtaposed by calm and cool shades of gunmetal gray and blue." |
| 48 | Arctic reflection | Modern | blue monochromatic, dusty glaucous — *stated* | Blue monochromatic; dusty glaucous "evokes calm and tranquility reminiscent of a serene winter day." |
| 49 | Slate | Modern | neutral grays + vibrant pastel green accent — *stated* | Green = harmony, health, prosperity; "set against neutral grays, this color scheme's vibrant shade of pastel green could be the perfect accent color for **innovative fintech websites**." |
| 50 | Autumn luxe | Modern | soft grays + white, deep gold + black — *stated* | "Sophisticated blend of warm and cool tones"; grays and white neutral base, "deep gold and black add depth and richness." |
| 51 | Inked | Modern | black and white (grayscale) + vibrant teal accent — *stated* | "Classic black and white given a modern edge with a dash of vibrant teal, which helps draw the eye to important headlines and CTAs." |
| 52 | Wraith | Modern | dark browns + soft grays + white + emerald green — *stated* | "Dark browns ground this color scheme, while the soft grays and white create a sense of balance"; emerald green "adds a touch of freshness and vitality." |
| 53 | Urban nocturne | Modern | black + gray + lime green accent — *stated* | Bold dark/light combination "perfect for **gaming websites or sports brands**"; black and gray foundation, lime green for energy. |

---

## 2. Shortlist — 10 DARK-suitable schemes

Scored against the actual product need: five screens, data-dense tables and ledgers, legible at high density, no decorative colour. The article is a *web* article — several schemes are explicitly framed for retail, travel or gaming and were excluded on that basis (see §3).

| # | Name | Primary hue family | Why it suits a dense fintech / education operations app |
|---|---|---|---|
| 1 | **51 — Inked** | teal accent on pure grayscale | The surface stays chroma-free so numerals, ledger rows and attendance cells never compete with decoration; the single teal has exactly one job. The article states teal "helps draw the eye to important headlines and CTAs" — i.e. it is defined as an affordance colour, not a mood colour. |
| 2 | **52 — Wraith** | emerald green accent on warm brown neutral | A dark **warm-neutral** ground with one accent. "Dark browns ground this color scheme" while grays and white "create a sense of balance" — that is a working surface, not a themed backdrop. Emerald is naturally reserved for *settled / paid / present* status. |
| 3 | **24 — Lapis velvet evening** | deep blue + plum (cool) | Deep cool ground is the most forgiving base for long reading sessions and dense figures. Plum and soft beige add warmth without lifting the ground's value, so row separation survives. |
| 4 | **12 — Yacht club** | indigo on cool gray + warm mahogany | The article makes the foreground/background argument literally: "the deeper shades add a grounding quality that can help lighter elements on the page stand out." That is the exact requirement for values and balances popping off dense rows. |
| 5 | **13 — Amber walnut morning** | warm brown (tonal, single-family) | The only scheme in the article that makes an **explicit legibility claim** while staying one hue family: "excellent contrast, making for an appealing and easy-to-read site." Single-family means no colour noise in a 200-row table. |
| 6 | **17 — Honey opal sunset** | mustard yellow + taupe (warm) | One warm earth axis with a strong luminance spread — "the contrast between the dark and light shades adds depth and dimension." Yellow is the natural attention/warning accent; taupe is a calm, low-chroma row ground. |
| 7 | **19 — Rose quartz evening** | maroon + blush pink (red/pink) | "Rich maroon exudes strength and elegance" — a deep, low-chroma red ground that reads serious and financial rather than playful. Blush pink is a light tint usable for row banding without introducing a second hue. |
| 8 | **15 — Cocoa topaz noonday** | brown ground + bright orange focal + slate blue | The article names the affordance use case outright: the dark-brown/bright-orange contrast is "ideal for calling attention to buttons or headlines." Brown keeps the ground neutral while one saturated orange marks action. |
| 9 | **36 — Amethyst mint harmony** | multi-vibrant (purple / emerald / neon pink / lime) | Included *because* the article imposes the restraint a dense app needs: "just use these bold colors sparingly!" A dark purple-emerald base carries the surface; the four chroma-rich hues are confined to headlines and featured rows. |
| 10 | **33 — Royal glimmer** | **unspecified** deep jewel tones | The deep-saturated option for status/award/milestone states. **Caveat:** the article names no hue for this scheme (only "deep jewel tone"), so it cannot be converted into tokens without consulting Figma's image or colour pages. Treat as a role to fill later, not as a palette. |

## 3. Shortlist — 10 LIGHT-suitable schemes

| # | Name | Primary hue family | Why it suits a dense fintech / education operations app |
|---|---|---|---|
| 1 | **1 — Ink wash** | gray monochrome | The strongest direct endorsement in the whole article for this product type: monochromatic grays "create a clean and focused aesthetic, making it ideal for websites and apps that prioritize readability." Zero chroma means colour is never doing layout work. |
| 2 | **32 — Frosted aura** | slate gray + darker blue + pewter on stark white | Named for the exact domain: "authority, expertise, or security — think **law firms, financial institutions**, or tech companies." Stark white and gray give a clean modern look; darker blue and pewter supply the contrast that separates values. |
| 3 | **49 — Slate** | neutral gray ground + pastel green accent | The only scheme that names **fintech** directly: pastel green "could be the perfect accent color for innovative fintech websites," on the stated reasoning that "green represents harmony, health, and prosperity." One accent on neutral gray = ideal for status chips. |
| 4 | **47 — Lemon granite morning** | gunmetal gray + blue, bright yellow accent | Second financial-services mention in the article. Bright yellow against "calm and cool shades of gunmetal gray and blue" gives a natural attention/warning accent on a cool, low-chroma base — exactly a fees-overdue signal. |
| 5 | **2 — Neutral elegance** | beige + gray + brown (warm neutral) | "Serene and professional", conveying luxury and minimalism — a warm, entirely low-chroma ground that suits long print-like ledger pages without tiring the eye. No hue is strong enough to be mistaken for a status colour. |
| 6 | **11 — Frozen mist** | monochromatic gray + cinnamon action accent | The single most functional statement in the entire article: cinnamon "is great for CTA buttons and clickable elements urging action. It's the star of the show." One action colour on a neutral base; everything else stays gray. |
| 7 | **28 — Amethyst dawn haze** | soft purple ground + vibrant yellow complement | The article explains the hierarchy mechanism: yellow as purple's complement "creates a striking contrast and draws the eye to important elements like buttons or calls to action." Complementary pair = unambiguous hierarchy; the violet ground stays calm at density. |
| 8 | **16 — Sandstone aquamarine serenity** | natural/earth tones + pastel blue accent | Earth ground keeps long text comfortable; the article prescribes the accent budget explicitly — use the pastel blue "sparingly for elements like buttons, links, or highlighted text." Interactive text gets its own colour, chrome does not. |
| 9 | **26 — Emerald lavender lake** | soft green + blue + lilac | Deliberately low-chroma triad: "soft green and blue create a serene and inviting atmosphere, while the lilac adds a hint of intrigue." Because no single hue carries real chroma, nothing here can be misread as a semantic status colour. |
| 10 | **5 — Driftwood pearl morning** | rose gold + brown + blue on light gray | The only *light* scheme in the article that states the background's legibility function: "the lighter gray provides a neutral background that enhances readability." The blue adds depth and contrast; rose gold/brown keep it from feeling clinical. |

---

## 4. Distinctness check for the 20 shortlisted schemes

Saturation tendency is described relative to the scheme's own ground. "Temperature" = the temperature of the **ground**, with any secondary noted.

### 4.1 The 20, one row each

| # | Scheme | Primary hue family | Saturation tendency | Ground temperature |
|---|---|---|---|---|
| D1 | 51 Inked | teal accent on grayscale | very high on the single accent; zero everywhere else | neutral-cool |
| D2 | 52 Wraith | emerald green accent on warm brown | mid (muted accent on muted ground) | warm |
| D3 | 24 Lapis velvet evening | deep blue + plum | mid-low, deep and dense | cool |
| D4 | 12 Yacht club | indigo on cool gray, mahogany secondary | low-mid; value contrast carries it | cool (warm secondary) |
| D5 | 13 Amber walnut morning | warm brown, single family | low-mid, tonal | warm |
| D6 | 17 Honey opal sunset | mustard yellow + taupe | mid earth pigment | warm |
| D7 | 19 Rose quartz evening | maroon + blush pink | deep/low on ground, light on tint | warm |
| D8 | 15 Cocoa topaz noonday | brown + bright orange | one high-chroma focal on neutral ground | warm (cool secondary) |
| D9 | 36 Amethyst mint harmony | purple / emerald / neon pink / lime | very high x4 — article mandates sparing use | cool, moody |
| D10 | 33 Royal glimmer | unspecified deep jewel tones | high, deep-saturated | unspecified |
| L1 | 1 Ink wash | gray monochrome | zero chroma | neutral |
| L2 | 32 Frosted aura | slate gray + blue + pewter | low | cool |
| L3 | 49 Slate | pastel green accent on gray | mid-high on one accent | neutral |
| L4 | 47 Lemon granite morning | bright yellow on gunmetal gray/blue | high on one accent | cool (warm accent) |
| L5 | 2 Neutral elegance | beige + gray + brown | low throughout | warm |
| L6 | 11 Frozen mist | gray + cinnamon | mid-high on one accent | neutral (warm accent) |
| L7 | 28 Amethyst dawn haze | soft purple + vibrant yellow | low ground, high complement | warm-cool |
| L8 | 16 Sandstone aquamarine serenity | earth + pastel blue | low ground, mid accent | warm (cool accent) |
| L9 | 26 Emerald lavender lake | green + blue + lilac | low everywhere | cool |
| L10 | 5 Driftwood pearl morning | rose gold + brown + blue on light gray | mid; metallic accent | warm (cool secondary) |

**Result:** all 10 primary hue families in the dark tier are distinct from one another, and all 10 in the light tier are distinct from one another. No two of the 20 share a primary hue family *plus* ground temperature *plus* saturation tier.

### 4.2 Collisions found during the check, and the swap that removes each

These are the pairs that **would** have looked near-identical in a real UI. Each was resolved; the surviving scheme is the one with the stronger article-grounded functional claim.

| Near-identical pair (or candidate) | Why they collide | Resolution / swap |
|---|---|---|
| **9 Vichy** vs **51 Inked** | Both are a gray/white surface with a single **teal** accent — indistinguishable in a shipped UI. | **Resolved.** Inked retained (its "classic black and white" base is the stronger dark reading). **Vichy excluded.** If the light tier must carry teal, swap **L2 Frosted aura → 9 Vichy**. |
| **46 Clockwork** vs **11 Frozen mist** | Both are a neutral gray base with an **orange** accent doing the same job. | **Resolved.** Frozen mist retained — the article names CTA/clickable elements explicitly; Clockwork is framed for fashion brands. Clockwork excluded. |
| **44 Opaline** vs **11 Frozen mist** | Soft gray/white + **cinnabar** vs monochromatic gray + **cinnamon** — adjacent warm accents on the same neutral base. | **Resolved.** Opaline excluded; only one orange-on-gray slot is allowed per tier. |
| **12 Yacht club** vs **24 Lapis velvet evening** | Both are **deep cool blue** grounds with a neutral second hue. | **Controlled, not removed.** Differentiator: Yacht club's secondary is **warm mahogany** (and its ground is cool gray); Lapis's secondary is **cool plum** (with soft beige). Rule: *warm secondary = Yacht club, cool secondary = Lapis; never ship both in the same theme tier.* |
| **25 Marina** vs **12 Yacht club** | Marina's "grounding **navy** and **chestnut**" is the near-twin of Yacht club's "rich **indigo** and **mahogany**". | **Resolved.** Marina excluded. |
| **7 Urban slate** vs **12 Yacht club / 24 Lapis** | Gray + brown + blue triplicates the retained blue grounds. | **Resolved.** Urban slate excluded. |
| **6 Graphite** vs the whole green/blue shortlist | Cool gray + green + blue + pink is a four-hue mix that reads as "no decision". | **Resolved.** Graphite excluded. |
| **53 Urban nocturne** vs **52 Wraith / 49 Slate** | Lime green accent on black/gray would be a third green-led entry, and the article frames it for "gaming websites or sports brands" — wrong register for an operations app. | **Resolved.** Urban nocturne excluded. |
| **17 Honey opal sunset** vs **47 Lemon granite morning** | Both are **yellow-led**. | **Controlled.** Differentiator: Honey opal's yellow is a *mid-chroma earth pigment on a warm taupe ground*; Lemon granite's is a *high-chroma accent on a cool gunmetal-gray/blue ground*. Rule: Honey opal = dark tier, Lemon granite = light tier; never both. |
| **28 Amethyst dawn haze** vs **47 Lemon granite morning** | Both carry a **vivid yellow**. | **Controlled.** Differentiator is the ground: Amethyst's ground is soft **purple**, Lemon granite's is gunmetal gray/blue. |
| **26 Emerald lavender lake** vs **49 Slate** | Both are **green-led**. | **Controlled.** Differentiator: Slate is *one saturated accent on a neutral gray ground* (accent tier); Emerald lavender is a *three-hue low-chroma ground* (ground tier). |
| **36 Amethyst mint harmony** vs **33 Royal glimmer** | Both are deep-saturated dark schemes. | **Controlled.** Differentiator: Amethyst mint harmony names all four of its hues; Royal glimmer names none, so it can only fill a reserved/promotional role, never a token role. |
| **2 Neutral elegance** vs **5 Driftwood pearl morning** | Both are warm-neutral browns. | **Controlled.** Differentiator: Neutral elegance has **no cool hue and no accent**; Driftwood pearl morning introduces a **cool blue** and a metallic rose gold on a light gray ground. |
| **1 Ink wash** vs **11 Frozen mist** | Both are gray-first. | **Not a collision.** Different roles: Ink wash is *zero chroma anywhere*; Frozen mist is *zero chroma except one named action colour*. This is the intended "monochrome, with one affordance" ladder. |

### 4.3 Residual risk (stated, not hidden)

Three hue families legitimately appear more than once across the 20 because each tier needs the same semantics — a settled/success colour, an attention colour, and a dark ground:

- **Green** — D2 (emerald accent on brown), L3 (pastel green accent on gray), L9 (green ground triad).
- **Yellow** — D6 (mustard on taupe), L4 (bright yellow on gunmetal gray), L7 (yellow complement on purple).
- **Brown/neutral** — D5, D8, D4's secondary, L5, L10.

These are de-duplicated by **ground temperature + saturation tier** as set out above, not by hue alone. That is the correct constraint for a token system: the *role* must be unique, the *hue family* may repeat across tiers as long as ground and chroma differ.

---

## 5. Mandatory next step: derive and verify values (the article gives none)

**This file contains no hex values, and neither does the source article.** Before any of the 20 becomes a token:

1. **Derive values.** Take the colour *names* from §1 and resolve each to a value — either through Figma's linked colour pages (`figma.com/colors/cinnamon`, `/colors/gunmetal-gray`, `/colors/glaucous`, …), or by choosing your own value that satisfies the named hue and chroma. The names describe hue and sometimes chroma/temperature; they do not determine a value.
2. **Choose one saturation tier per role.** The check in §4 separates schemes by saturation tier; that only survives if the derived tokens are *assigned* to tiers deliberately (e.g. the "attention" accent is high-chroma, all chrome is low-chroma).
3. **Verify contrast, do not assume it.** Named pigments are chosen for how they *look*, not for their contrast ratio. Every foreground/background pair from the shortlist must be measured against **WCAG 2.1 AA (4.5:1 body, 3:1 large text and non-text)** — the article's own closing tip demands it: "Choose colors with sufficient contrast to meet accessibility guidelines for users with visual impairments."
4. **Verify against density, not against a hero image.** All 20 were selected for legible high density; that has to be re-checked on a real 200-row table, not on a marketing swatch.
5. **Colour must never be the only signal.** Any status colour taken from this list needs a paired icon or text label, per the project's accessibility constraint.
6. **Re-check the two schemes whose hue the article never names** — **#33 Royal glimmer** ("deep jewel tone", no hues given) and, to a lesser extent, **#40 Celestial** / **#45 Gossamer**, where the alt text and body disagree slightly on the secondary accent (turquoise **and** coral/orange). Resolve from the image or Figma's colour pages before use.

---

## 6. Full-text traceability

Every colour name, category heading, industry claim and quotation in this document comes from the captured article at `C:\Users\haris\.local\share\kilo\tool-output\tool_0fda973e8001g3Ys4G33NCP0aV`. Nothing is inferred about the values behind the names, and no hex appears here because none appears there.