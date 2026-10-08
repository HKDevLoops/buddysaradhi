# UI primitives and dates

A grab-bag of the smaller UI-layer dependencies, each verified present in `apps/web` with a real import site. Pinned versions all from `apps/web/package.json`.

| Package | Pinned | Resolved | Docs | Sites |
|---|---|---|---|---|
| `@base-ui/react` | `^1.6.0` | 1.6.0 | https://base-ui.com/react/overview/ | 2 |
| `@radix-ui/react-popover` | `^1.1.19` | 1.1.19 | https://www.radix-ui.com/primitives/docs/overview/introduction | 1 |
| `@radix-ui/react-dialog` | `^1.1.17` | 1.1.19 | https://www.radix-ui.com/primitives/docs/overview/introduction | — |
| `@radix-ui/react-accordion` | `^1.2.14` | 1.2.16 | https://www.radix-ui.com/primitives/docs/overview/introduction | — |
| `shadcn` | `^4.12.0` | 4.13.0 | https://ui.shadcn.com/docs | 4 (CSS import + CLI) |
| `lucide-react` | `^1.21.0` | 1.24.0 | https://lucide.dev/guide/packages/lucide-react | 53 |
| `class-variance-authority` | `^0.7.1` | 0.7.1 | — | 1 |
| `tailwind-merge` | `^3.6.0` | 3.6.0 | — | 1 |
| `date-fns` | `^4.4.0` | 4.4.0 | https://date-fns.org/docs/Getting-Started | 7 |
| `@hookform/resolvers` | `^3.9.1` | 3.10.0 | see [react-hook-form.md](react-hook-form.md) | 3 |

## Project specifics

### `date-fns` STAYS. Hand-rolling `addMonths` is *less* precise.

This is the native-first verdict that most looks like a violation and is not. TABS-HARDEN-01 Phase 3's rule is **precision, not purity**: `date-fns` is kept because AGENTS.md §2 Rule 6 makes date arithmetic a **money path** (due dates, invoice periods), and a hand-rolled month arithmetic is less precise than the library. `lodash.debounce`, `idb-keyval`, and `clsx` were removed in the same phase because their native replacements are *exact*.

Full verdicts table: `docs/mindmap.md` §8 and `docs/plans/TABS-HARDEN-01.md` §3. **When you swap a dependency, write the precision verdict next to it.** A vibe is not a justification.

### Composed inputs need `Controller`, not `register`

`@base-ui/react` and Radix primitives render inputs that do not forward a raw DOM ref the way a native `<input>` does. Those fields must go through `Controller` / `useController`. The rule: native element → `register`, anything composed → `Controller`. See [react-hook-form.md](react-hook-form.md).

### Two primitive libraries coexist — do not consolidate casually

`@base-ui/react` (2 sites) and three `@radix-ui/*` packages coexist. This is measured state, not an accident of an abandoned migration. Consolidating is a design-system decision with an accessibility review attached (AGENTS.md §2 Rule 10: WCAG 2.1 AA, 44×44px targets, keyboard parity), not a drive-by refactor.

### `cn()` was rebuilt natively — audit before reusing a class helper

Phase 3 removed `clsx` after auditing all 39 `cn()` call sites for the array/object forms the native implementation does not handle. `apps/web/src/lib/utils.ts` now builds the string itself. If you add a `cn()` call with an array or conditional-object shape, check `utils.ts` handles it — the naive `filter(Boolean).join(" ")` is exact only for the shapes it was audited against.

### The `<input type="date">` swap has a UTC/local trap — the regression test exists

`react-day-picker` was replaced with a native `<input type="date">`, which is the right call for a single-date field, but the two converters at the bottom of `components/ui/date-picker.tsx` must read **LOCAL** calendar fields:

- `localDateToInputValue` uses `Date -> "yyyy-mm-dd"`. `toISOString()` converts to UTC **first**, so local midnight in IST (UTC+5:30) serialises as the **previous** day — 1 Jan becomes 31 Dec.
- `inputValueToLocalDate` builds **local** midnight. `new Date(str)` parses as UTC, so in a negative-offset zone the parsed instant lands on the previous **local** day: `"2026-01-01"` → `getDate()` returns 31.

A date that drifts by a day is a **money** bug the moment it reaches admission date, DOB, or an invoice period (AGENTS.md §2 Rule 6). `components/ui/date-picker.test.tsx` exists to catch exactly this; it was added in the phase-5 lane because the original swap shipped with no test.

### `shadcn` is a CLI + CSS import, not a component runtime dependency

`globals.css` does `@import "shadcn/tailwind.css"`. There is no `components.json` runtime coupling to note; the components themselves are local files under `apps/web/src/components/ui/`. They are **owned code** — edit them, do not treat them as vendored read-only.

### Icons are a single dependency, not per-icon packages

`lucide-react` at 53 sites is the whole icon system. Importing an icon from any other source breaks the visual consistency the design system enforces.

## Related

- [tailwindcss.md](tailwindcss.md) — where these primitives' classes actually resolve, and the `--accent-cyan` silent failure.
- [react-hook-form.md](react-hook-form.md) — the `Controller` vs `register` rule in context.