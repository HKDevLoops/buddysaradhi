# RFC: Single Package Manager + Shared `@buddysaradhi/db` Package

**Status:** Proposed (user-approved to proceed as tech-debt cleanup)
**Date:** 2026-07-14
**Author:** agent (core refactor)
**Spec refs:** AGENTS.md §0.1 (spec-before-code), §8 (stop-and-ask structural change)

---

## Context / Problem

The repo currently builds and tests **green** under `bun` (bun 1.3.14):

- `bun run typecheck` (tsc --noEmit) → 0 errors
- `bun run test src` (vitest) → 6/6 pass
- `bun run db:test` → genesis-hash contract passes

However the setup carries two pieces of structural fragility that this RFC retires:

1. **No `pnpm-workspace.yaml`.** Root `package.json` declares an npm-style `workspaces` array plus a `pnpm` field and several `pnpm --filter` scripts, but there is no `pnpm-workspace.yaml`. pnpm rejects the npm `workspaces` field, so the repo cannot be installed/resolved with pnpm as the scripts assume.
2. **`packages/core` resolves Prisma via a tsconfig `paths` alias** (`@prisma/client` → `../../apps/gateway/src/prisma`) instead of a real dependency. This is a band-aid: core reaches into `apps/gateway`'s *generated* client. It works today only because gateway's Prisma client happens to be the same version. Any version skew between `packages/core/@prisma/client` (devDep `5.22.0`) and gateway's generated client would surface as a TS2345 "two Prisma clients" type clash — the exact failure this cleanup makes impossible.

> Note: the dual-client TS2345 is **not currently reproducible** (verified: no `.bun`/`.pnpm` on disk, only one `@prisma/client` present). This RFC is therefore tech-debt hardening, not a live-bug fix. User explicitly approved proceeding anyway.

## Proposed Changes

### A — Single package manager (pnpm)

- Add `pnpm-workspace.yaml` mirroring the existing npm `workspaces` globs (`packages/*`, `apps/*`, plus any others already covered).
- Run `pnpm install` to produce a single, authoritative dependency graph (one `@prisma/client` at `5.22.0` / root `^5.14.0`).
- Keep `bun.lock` + `bun` scripts working (bun reads `node_modules`); add a note that pnpm is the canonical install.
- Remove the stale `pnpm-lock.yaml` if it predates the new workspace file, regenerate via `pnpm install`.

### B — Shared `@buddysaradhi/db` package

Create `packages/db` (sits **below** both `packages/core` and `apps/gateway` — core is depended-on *by* gateway, so the shared pkg must not live inside core):

- Move Prisma schema generation target out of `apps/gateway/src/prisma` into `packages/db/src/prisma` (or equivalent generated output).
- Move `getPrismaClient(dbUrl, dbToken)` (libsql `PrismaLibSQL` adapter) out of `apps/gateway/src/db.ts` into the new package, re-exported as `@buddysaradhi/db`.
- `packages/core` depends on `@buddysaradhi/db`; `ledger.ts` / `ledger.test.ts` import `PrismaClient` + `getPrismaClient` from the package.
- `apps/gateway` depends on `@buddysaradhi/db` instead of generating its own client; its `db.ts` imports from the package.
- **Delete** the `paths` alias from `packages/core/tsconfig.json`.
- Dedupe schema: consolidate `apps/gateway/prisma/schema.prisma` and the stray root `prisma/schema.prisma` / `apps/prisma_tmp/schema.prisma` copies into the single `packages/db` schema source.

## Risk / Blast Radius

- **B is a structural refactor with breakage risk** on a currently-green build. Mitigation: incremental execution with a verification gate after every sub-step (typecheck + vitest 6/6). If any step breaks green and cannot be restored quickly, stop and report.
- **A** changes the install graph; pnpm's `node_modules` layout may differ from bun's. Mitigation: verify `bun run test src` still green after install.

## Test Plan

- [ ] `pnpm install` succeeds; `pnpm -r list` shows one `@prisma/client`.
- [ ] `bun run typecheck` → 0 errors **with no `paths` alias**.
- [ ] `bun run test src` → 6/6 pass.
- [ ] `bun run db:test` → genesis-hash contract passes.
- [ ] `packages/core/dist` stale artifacts removed/regenerated.

## Reviewer

- Structural/infra change → requires RFC (this doc) + human sign-off per AGENTS §8. User approved A+B via direct instruction.
