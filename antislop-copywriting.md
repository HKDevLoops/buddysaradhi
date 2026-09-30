# antislop-copywriting.md — copy & text

Load with `antislop.md` (core) for any writing task: UI strings, empty
states, error messages, landing-page copy (`product/`), pricing, FAQ.

**Source.** Distilled from `git show 91d7a7f:antislop-copywriting.md`
(anti-slop v2.4.0, rules R-02/R-15..R-18/R-36..R-38) and
`01_Product_Principles.md` §Marketing (line "any marketing copy that cannot
trace back to a principle in this file is a bug").

## Hard Gate (copy) — any FAIL blocks delivery

1. **Never invent facts.** A rewrite adds no number, name, date, quote, or
   claim absent from the source text or supplied by the user (R-17, R-36,
   R-38). No data → show no data.
2. **No fabricated proof.** No fake testimonials, logos, "trusted by
   thousands", "SOC 2 compliant", "300% faster" (R-18, R-36). Evidence, or
   silence.
3. **Trace to a principle.** Every sentence of marketing copy names the
   principle it serves via the Decision Protocol (Q1–Q5);
   `01_Product_Principles.md` §Marketing.
4. **Address the tutor.** "Your students, your ledger, your receipts" —
   never the student or the parent (P1, The Tutor Is the User).
5. **Honest states and errors.** Empty states say why they are empty and
   what happens next (P15); errors say what happened and what to do —
   never a swallowed "Something went wrong" with no path forward
   (AGENTS Rule 9, AP-9).
6. **Money wording is exact.** Amounts render as ₹ with 2 decimals from
   integer paise via `formatINR(paise)` (Rule 6, BR-M-01); prose never
   rounds or approximates money.
7. **No dark patterns.** No fake urgency, no pre-checked upsells, no
   guilt-screen cancellation, no "export is premium" (AP-1; `01` P10 —
   backups are the user's property).

## Purpose-Gate (copy) — write the reason (core §6)

- **Specific CTAs.** "Get Started", "Learn More", "Try Now", "Explore" are
  defaults; write the actual action ("Record today's attendance", "Create
  free account") (R-15).
- **Voice is kept.** When a user supplies a voice, a rewrite preserves it.
  Copy with no voice is as much slop as copy full of AI tells (R-37); the
  reason for any tonal shift is written down.

## Quality Locks (copy)

- [ ] **No buzzwords:** unlock, elevate, empower, delve, showcase,
      testament, seamless, revolutionary, next-generation, cutting-edge,
      robust, game-changer, effortless, powerful, intelligent (R-16).
- [ ] **No significance inflation:** "the future of X", "a testament to",
      "marking a pivotal moment", "a new era of" (R-36).
- [ ] **No weasel attributions:** "experts say", "industry observers",
      "leading analysts believe" with nobody named (R-36, C-5).
- [ ] **Em-dash discipline (R-02, scoped).** In UI strings and marketing
      copy prefer comma, period, colon, or parentheses over the em dash.
      The ban does NOT apply to repository spec/docs prose (`AGENTS.md`,
      `00_*`–`23_*`), which keeps its existing style.
- [ ] **Placeholders are honest:** `[REAL DATA]`, "Coming soon" — never
      realistic-looking filler (R-23, R-38).
- [ ] **The generic-sentence test:** if a sentence could sit unchanged on
      any SaaS landing page, it is slop — add specificity from the source
      or cut it (C-1, R-31).

## Verify (copy)

Run core Delivery Gate blocks 1 and 4 (core §5, §8); `pnpm run lint`
(prettier formats the markdown); confirm every claim carries a source; then
attach the `## Spec ref` block required by AGENTS §5.3.
