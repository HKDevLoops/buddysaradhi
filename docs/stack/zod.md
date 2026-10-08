# Zod 3

- **Docs:** https://zod.dev/ · basics: https://zod.dev/basics · API: https://zod.dev/api
- **Pinned:** `zod@3.24.2` — **exact** pin in `apps/web/package.json` and in `apps/gateway/deno.json`. `^3.24.2` in the root `package.json`, `packages/core`, `packages/shared`.
- **Sites:** ~30 `from "zod"` imports outside tests

> **We are on Zod 3. zod.dev now documents Zod 4 as the current line (the banner says "Zod 4 is stable"), and its docs have moved to the v4 shape.** Read the v3-compatible API, not the landing page's examples. Do not "upgrade" opportunistically — the exact pin is deliberate across the web app and the gateway, and the gateway's `deno.json` pins the same version so the edge and the app validate identically.

## Project specifics

### Zod is the single source of truth for types — AGENTS.md §6.1

- Every server action, API route, import row and form submission parses with Zod **before** anything else.
- Types are **inferred** (`z.infer<typeof Schema>`). Hand-writing a type that mirrors a schema is AP-18.
- Money is integer paise and the schema is where that is enforced at the boundary (AGENTS.md §2 Rule 6, BR-M-01).

### The gateway must parse with the same version as the app

`apps/gateway/deno.json` pins `"zod": "npm:zod@3.24.2"` explicitly. A v3/v4 skew between the edge function and the app surfaces as a validation failure that looks like bad user input.

### Where the schemas live

- `packages/shared/src/` — the cross-platform schemas (`schemas.ts`, `types.ts`) plus `feeCalc.ts`, `fuzzy.ts`, `pin.ts`, `outboxPayload.ts`. `@buddysaradhi/shared` is consumed by web, core, and eventually mobile/desktop, so a schema change here is a cross-platform change.
- `apps/web/src/server/actions/*` — request-shape schemas for each action.
- The gateway validates independently at its own boundary (`apps/gateway/routes/*`).

### Zod + react-hook-form pairing

Forms use `zodResolver` from `@hookform/resolvers`. The version pairing and the `moduleResolution` requirement are recorded in [react-hook-form.md](react-hook-form.md) — that is where a Zod-version bump will bite first.

### `zod-prisma-types` is declared but barely used

`zod-prisma-types@^3.3.11` is a root devDependency. It is not a runtime path. Do not assume generated Zod-from-Prisma schemas exist; `packages/shared` owns the schema of record.