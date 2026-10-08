# Deno 2 (gateway runtime)

- **Docs:** https://docs.deno.com/runtime/ · config file: https://docs.deno.com/runtime/fundamentals/configuration/ · `deno lint`: https://docs.deno.com/runtime/reference/cli/lint/ · Node/npm compat: https://docs.deno.com/runtime/fundamentals/node/
- **Runtime on disk:** `deno 2.9.7` (stable, x86_64-pc-windows-msvc) — verified via `deno --version`
- **Config:** `apps/gateway/deno.json` — `"runtime": "deno2"`, `"entrypoint": "index.ts"`
- **Lockfile:** `deno.lock`
- **Dep resolution:** `npm:` specifiers in the `imports` map (`@libsql/client@^0.14.0`, `@supabase/supabase-js@^2`, `zod@3.24.2`) plus an `esm.sh` import map

`@apps/gateway` is the canonical backend for all three platforms. Nothing else runs a backend process.

## Project specifics

### There are exactly TWO runtime schema authorities, and they MUST agree

(AGENTS.md §3.4 — the audit found this rule contradicting itself elsewhere, so it is stated here as the operative version.)

1. `migrations/` + Prisma — web local/dev and every deploy. Provisioning-time `bootstrapSchema` runs the same idempotent migrations at sign-up, which is a **sign-up path, not a request-time path**.
2. `apps/gateway/lib/schema.ts` `ensureSelfRepairingSchema` — the single audited self-heal for gateway-managed tenant DBs: idempotent `CREATE TABLE IF NOT EXISTS` plus the append-only ledger triggers `trg_ledger_no_update` / `trg_ledger_no_delete`, memoised per tenant.

**These two, and no other module, may execute DDL.** When they disagree, the symptom is a column that exists for the web app and not for the gateway (or vice versa), and it presents as a runtime `no such column` deep inside a money path — the `0002` invoices/receipts rebuild was exactly this. `apps/gateway/lib/schema.ts` carries a `pragma_table_info` probe before applying any repair DDL.

### The gateway's `Map`s are safe because every operation is synchronous between `await` points

Audited and confirmed safe — do not "fix" them:

| State | File |
|---|---|
| `tursoCache` | `lib/db.ts` |
| `failedAuthMap`, `ipRateLimitMap`, `nonceCache` | `lib/security.ts` |
| `nodeMap` LRU | `lib/cache.ts` |
| `healedTenants` | `lib/schema.ts` — **capped at 10,000** (`HEALED_TENANTS_MAX`) |

Deno's cooperative concurrency makes a `Map.get`/`Map.set` pair with no intervening `await` atomic. `healedTenants` is the one that needed a bound, because a Set of tenant UUIDs grows without limit over a long-lived isolate.

### Gateway tests run under **Vitest with Deno shims**, not `deno test`

`apps/gateway/package.json` declares only `vitest` as a devDependency; its `lint` and `typecheck` scripts are `echo` stubs pointing at `deno lint` / `deno check`. `apps/gateway/__tests__/setup.ts` (loaded by the root `vitest.config.ts`) shims `stdout.writeSync`, `Deno.env.get`, and `Deno.serve`. There is no `deno test` in this repo, and the two timing-sensitive test files must be read serially — see [vitest.md](vitest.md).

### `deno lint` covers the tests

`apps/gateway/deno.json` `lint.exclude` is `["node_modules/", "dist/"]` only. Test files were previously excluded and accumulated lint errors; they are now linted to the same standard. `no-explicit-any` is the single excluded rule.

### `zod` is pinned in `deno.json`, not just `package.json`

`"zod": "npm:zod@3.24.2"` — matching the app's exact pin. A v3/v4 skew between edge and app surfaces as a validation failure that looks like bad user input. See [zod.md](zod.md).

## Related

- [libsql.md](libsql.md) — the two schema authorities, `pragma_table_info` probes, and the tenant-credential rule.
- [supabase.md](supabase.md) — the auth and provisioning path the gateway sits behind.