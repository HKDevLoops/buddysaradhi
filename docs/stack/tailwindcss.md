# Tailwind CSS 4

- **Docs:** https://tailwindcss.com/docs
- **Pinned:** `tailwindcss@^4` (resolves to **4.3.2**), `@tailwindcss/postcss@^4` (4.3.2) — `apps/web/package.json`
- **PostCSS wiring:** `apps/web/postcss.config.ts`
- **Entry:** `apps/web/src/app/globals.css`

## Project specifics

### CSS-first config, no `tailwind.config.js`

There is no `tailwind.config.js`/`ts`. Configuration lives in CSS in `globals.css`, in this order — the order is load-bearing:

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@buddysaradhi/design-system/tokens.css";  /* line 18 */
@plugin "tailwindcss-animate";                       /* line 20 */
@theme inline { ... }                               /* line 28 */
```

`@theme inline` is what wires `@buddysaradhi/design-system`'s generated tokens into Tailwind's utility namespace. Removing or reordering that import disconnects the entire palette — see the next item.

### `--accent-cyan` does not exist. It was a silent WCAG 2.4.7 failure.

Phase 3 of TABS-HARDEN-01 removed `--accent-cyan` from `globals.css` because **none of the 20 generated palettes define it**. Every focus ring using `var(--accent-cyan)` was resolving to an invalid colour, so the browser rendered **no focus ring at all** — and it looked fine in review because nothing errored visibly.

**Rule:** never reference a token by name on the assumption it exists. `packages/design-system` owns the token set (20 schemes × 3 material modes); a token not emitted there does not exist, and using it fails *silently*, not loudly.

### Duplicate CSS blocks hide dead rules

Phase 3 also removed a duplicated `neumo` block where the first copy rendered nothing (superseded by the second). Duplicated selector blocks in this file are not always harmless redundancy — one of the two was unreachable and nobody noticed. Keep blocks unique.

### No Tailwind 3 idioms

`@tailwind base/components/utilities`, `tailwind.config.js` `theme.extend`, and the `@apply`-heavy patterns of shadcn's Tailwind-3 templates are all absent. This project uses `@import "tailwindcss"` + `@theme inline` + generated tokens.

## Related

- Rule 5 (colour comes from the palette, or it does not ship) and the contrast gate: AGENTS.md §2. `packages/design-system`'s `verify` script is what enforces it.
- `prettier-plugin-tailwindcss@0.8.0` sorts class order — formatting only, no behaviour.