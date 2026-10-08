# Vitest 4

- **Docs (v4, the version we pin):** https://v4.vitest.dev/guide/ · config reference: https://v4.vitest.dev/config/
- **Pinned:** `vitest@^4.1.10` → **4.1.10** (root, `apps/web`, `apps/gateway`). `packages/core` pins **exactly** `vitest@4.1.9` and `@vitest/coverage-v8@^4.1.9` (resolves 4.1.10). `packages/design-system` is on `vitest@^3.2.4` → 3.2.7.
- **v4 docs host:** `vitest.dev` now serves **v5** as its default. `/v4/guide/` 404s. Use the `v4.vitest.dev` host for anything version-specific — the unversioned docs will describe APIs that do not exist in 4.

## Project specifics

### `low-latency.test.ts` and `performance.test.ts` assert wall-clock budgets — read them SERIALLY or not at all

Both live in `apps/gateway/__tests__/`. They pass in isolation and **fail whenever a `next build` is running concurrently**, because they measure the machine, not the code: a `Map.get` and a regex over a 1 KB body are descheduled by a concurrent build often enough to blow a p95 budget on work that takes ~200 ns.

The file's own header records the history: it used to time ONE operation per `performance.now()` pair, and a single 900 µs outlier among 500 samples reddened the pipeline for weeks while green locally. It was rewritten to batch its measurements. The residual failure mode is CPU contention, not logic.

**Rule:** do not run these two files in parallel with a build, and do not "fix" them by loosening a threshold. The gateway suite result is read as **546/548 with 2 known timing failures** under contention; **29/29** clean when run serially. That is the contract.

### Three separate vitest configs, three separate runs — do not merge them

| Config | Covers | Command |
|---|---|---|
| `apps/web/vitest.config.ts` | jsdom, `@vitejs/plugin-react`, `@` alias, `GATEWAY_SHARED_SECRET` env stub | `pnpm --filter web exec vitest run` |
| root `vitest.config.ts` | gateway + packages, **excludes `apps/web/**`**, loads `apps/gateway/__tests__/setup.ts` for Deno shims | `pnpm exec vitest run` |
| root `vitest.integration.config.ts` | `apps/gateway/__tests__/**` | `pnpm run test:integration` |

The root config's `exclude` of `apps/web/**` is intentional — the web suite needs a different environment and setup file. Running the root config and expecting web tests in it will show zero and look like a coverage hole.

### The web suite needs a stubbed `GATEWAY_SHARED_SECRET` because `lib/crypto.ts` fails closed at module load

`apps/web/vitest.config.ts` sets a test-only value:

```ts
env: { GATEWAY_SHARED_SECRET: 'vitest-only-shared-secret-not-for-production-0000' }
```

`lib/crypto.ts` throws at import when the secret is absent (AGENTS.md §15 BACKUP-1). The comment in the config states it is never used at runtime. Removing it makes every test that transitively imports `crypto.ts` fail at collection, not at assertion.

### The gateway suite runs under vitest with Deno shims, not `deno test`

`apps/gateway/__tests__/setup.ts` shims `stdout.writeSync`, `Deno.env.get`, and `Deno.serve`. `apps/gateway/package.json` therefore declares only `vitest` as a devDependency and its `lint`/`typecheck` scripts are `echo` stubs pointing at `deno lint` / `deno check`. There is no `deno test` in this repo.

### `packages/design-system` is three majors behind on both TS and Vitest

`typescript@^5.9.3` (resolves 5.9.3) and `vitest@^3.2.4` (resolves 3.2.7), while everything else is on TS 7 / Vitest 4. It is an independently versioned token generator and was not migrated. **A `satisfies` or TS-7-only type in a token script will not compile there**, and its tests do not run under the root config. Treat it as a separate island until someone says otherwise.

## Related

- [playwright.md](playwright.md) — the browser suite is the only gate that sees what no other gate sees.
- [deno.md](deno.md) — the gateway's own lint/typecheck runtime.