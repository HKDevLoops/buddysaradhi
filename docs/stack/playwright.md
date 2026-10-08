# Playwright

- **Docs:** https://playwright.dev/docs/intro · locators: https://playwright.dev/docs/locators · accessibility: https://playwright.dev/docs/accessibility-testing
- **Pinned:** `@playwright/test@^1.61.1` and `playwright@^1.61.1` → **1.61.1** (`apps/web/package.json`), with `1.61.1` additionally pinned exactly in root `overrides`. The lockfile also contains `1.62.1` as a transitive resolution — **1.61.1 is what the app uses.**
- **Config:** `apps/web/playwright.config.ts`
- **Specs:** `apps/web/tests/e2e/` — `harness.ts` (shared), `a11y.spec.ts`, plus the five tab specs and the `zz-tmp-*` audit specs

## Project specifics

### Switch screens by NAV. `page.goto('/fees')` would be testing a 404.

Before the five-route change there was one route and five screens behind query state, so `goto` was meaningless. Now `/dashboard`, `/students`, `/attendance`, `/fees`, `/settings` are real routes and the nav is the honest way to move between them — it exercises the App Router transition the tutor actually performs.

### The nav renders TWICE. A role-based query matches two elements.

`GlassShell` renders the five-screen nav in **both** a sidebar and a mobile bottom nav (`apps/web/src/components/buddysaradhi/glass-shell.tsx:413` and `:774`). `page.getByRole('link', { name: 'Fees' })` therefore resolves to two nodes and every action on it throws a strict-mode violation.

**Every nav selector must be anchored:**

```ts
page.locator('nav[aria-label="Screens"] ...')
```

This is not optional polish — it is the difference between a passing spec and a strict-mode error. It is enforced in `tests/e2e/harness.ts` (lines 166, 205), `a11y.spec.ts:51`, `zz-tmp-ssr.spec.ts:75`, and `zz-tmp-dashboard-audit.spec.ts:227`.

### `.first()` on DOM order is not a fix, it is a second bug

`.first()` was used to dodge the duplicate-nav problem, and it selected the wrong element once — voiding an already-voided receipt. The app was **correct** to refuse (BR-LED-05); the selector was wrong. **The selector must name the payment, not rely on DOM order.** Recorded in `docs/mindmap.md` §6.

### `aria-current="page"` only became true when the screens became pages

The shell sets `aria-current="page"` honestly now that each screen is a route. It said `true` for years before this change precisely because the nav items were **not** pages — the attribute was hardcoded, so it carried no information and the a11y suite could not have caught the lie.

### The harness had a dead error gate

`harness.captureErrors` never assigned `settled`, so the whole 4xx/5xx gate was inert and every lane could report "zero errors" truthfully while the gate observed nothing. Fixed with `markSettled()`. **Before trusting a zero-error browser result, confirm the harness actually settled.** Recorded in `docs/mindmap.md` §6.

### Project and runner configuration

- `workers: 1`, `fullyParallel: false` — the specs share one seeded tenant.
- Firefox is **disabled** (commented out in the config): local headless SWGL framebuffer mapping driver crash on Windows. Do not re-enable it without a reason.
- `webServer` only spawns when `baseURL` is localhost; with `PLAYWRIGHT_TEST_BASE_URL` set to a deployed URL it hits that URL directly and spawns nothing.
- a11y is `@axe-core/playwright@^4.12.1`, run via `pnpm run test:a11y`.

### Known open: `zz-tmp-settings-audit.spec.ts` was 9/13 at commit `5974e6a`

Recorded, not hidden. The **app** defect it was chasing is fixed and the page probes clean (no error state, nav present, zero console errors). The residual was the **spec**: it hardcoded expected counts (2 invoices, 3 ledger rows) while the QA tenant had accumulated 14 and 32 across every audit run.

The correct fix is **re-base the spec against the state the app actually produces** — relative `rowsBefore` counts, self-repairing residue rows, `en-IN`-parsed counters. Not weakening an assertion.

One spec decision worth not undoing: `ledger_entries` is append-only (AGENTS.md §2 Rule 1), so **"reset the tenant by deleting ledger rows" is not available as a test fixture.** A spec that needs a clean ledger needs a clean *tenant*, not a deleted ledger.

## Related

- [next.md](next.md) — five SSR routes and what the browser suite can now see that it could not before.
- [libsql.md](libsql.md) — the shared seeded tenant the specs assert against.