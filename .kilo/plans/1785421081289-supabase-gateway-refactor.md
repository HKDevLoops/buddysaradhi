# Plan: Whole `supabase/` → `apps/gateway/` Cut-and-Paste + Custom Supabase Deploy Script

## 1. Goal
Move the **entire** `supabase/` directory into `apps/gateway/`. There will be no `supabase/` directory at the repo root after this refactor. Replace the `supabase functions deploy` CLI command with a custom deploy script (`apps/gateway/scripts/deploy.ts`) that uses the Supabase Management API directly, so we don't depend on the CLI's `supabase/functions/<name>/` layout. Fix Next.js 16 build/hydration root causes and GitHub Actions CI gates so Vercel + Supabase deploys execute strictly when CI passes.

## 2. Final Directory Layout
```
buddysaradhi/
├── apps/
│   ├── gateway/                              # ★ EVERYTHING LIVES HERE ★
│   │   ├── index.ts                          # REST gateway entrypoint
│   │   ├── graphql/index.ts                  # GraphQL gateway entrypoint
│   │   ├── provision/index.ts                # provision-db entrypoint
│   │   ├── deno.json                         # Deno runtime + lint config
│   │   ├── package.json                      # @buddysaradhi/gateway workspace metadata
│   │   ├── scripts/
│   │   │   └── deploy.ts                     # Custom Supabase Management API deploy script
│   │   ├── lib/                              # auth, crypto, db, errors, log, schema, security, cache
│   │   ├── routes/                           # REST sub-handlers
│   │   ├── migrations/                       # SQL migrations (moved from supabase/migrations)
│   │   └── __tests__/                        # 134+ tests
│   ├── web/                                  # Next.js 16 frontend
│   ├── mobile/                               # Expo client
│   └── desktop/                              # Tauri desktop
└── packages/
    ├── core/
    ├── shared/
    └── security/

# supabase/ directory DELETED. No config.toml, no functions/, no migrations/ at root.
```

## 3. Refactor Steps

### Step 1 — Remove Legacy `apps/gateway/` Scaffold
1. Delete legacy Bun/Hono artifacts:
   - `apps/gateway/src/`, `apps/gateway/prisma/`, `apps/gateway/scripts/` (rebuild below), `apps/gateway/verify-erase.ts`, `apps/gateway/eslint.config.mjs`, `apps/gateway/tsconfig.json`, all `*.log`, `*.err`.
2. Grep workspace for stale references to `@buddysaradhi/gateway/dist`, `scripts/verify-ledger.ts`, `verify-erase.ts`. Remove or update.

### Step 2 — Cut-and-Paste `supabase/` → `apps/gateway/`
1. Move `supabase/functions/gateway/*` → `apps/gateway/`:
   - `index.ts`, `deno.json`, `lib/`, `routes/`, `__tests__/`.
   - The existing `apps/gateway/graphql/` from the source move.
2. Move `supabase/functions/gateway-graphql/` → `apps/gateway/graphql/`:
   - Merge with existing; `apps/gateway/graphql/index.ts` is the merged entrypoint.
3. Move `supabase/functions/provision-db/index.ts` → `apps/gateway/provision/index.ts`.
4. Move `supabase/migrations/*.sql` → `apps/gateway/migrations/`.
5. Delete `supabase/` directory entirely.

### Step 3 — Mount All Three Endpoints Inside `apps/gateway/index.ts`
1. In `apps/gateway/index.ts`, dispatch:
   - `POST /api/v1/provision` → `./provision/index.ts`
   - `POST /api/v1/graphql`, `GET /api/v1/graphql` → `./graphql/index.ts`
   - All REST routes → existing `./routes/*` handlers.
2. Verify env contract: `SUPABASE_URL`/`SUPABASE_ANON_KEY` for `gateway`; `SUPABASE_SERVICE_ROLE_KEY` only for `provision-db`.
3. `apps/gateway/graphql/index.ts` and `apps/gateway/provision/index.ts` each expose a default `Deno.serve` so they can run standalone.

### Step 4 — Write Custom Deploy Script (`apps/gateway/scripts/deploy.ts`)
This replaces `supabase functions deploy` entirely. Runs in Deno (already a workspace dep).

```ts
// apps/gateway/scripts/deploy.ts
// Custom Supabase Edge Function deploy using the Supabase Management API.
// Usage: deno run -A apps/gateway/scripts/deploy.ts <function-name> [<function-name>...]
// Env: SUPABASE_PROJECT_REF, SUPABASE_ACCESS_TOKEN

const FUNCTIONS: Array<{ name: string; entry: string }> = [
  { name: "gateway", entry: "./index.ts" },
  { name: "gateway-graphql", entry: "./graphql/index.ts" },
  { name: "provision-db", entry: "./provision/index.ts" },
];

const ref = Deno.env.get("SUPABASE_PROJECT_REF");
const token = Deno.env.get("SUPABASE_ACCESS_TOKEN");
if (!ref || !token) {
  console.error("Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN");
  Deno.exit(1);
}

const requested = Deno.args.length ? Deno.args : FUNCTIONS.map((f) => f.name);
const tasks = FUNCTIONS.filter((f) => requested.includes(f.name));

for (const { name, entry } of tasks) {
  console.log(`→ Deploying ${name} from ${entry}`);
  // Bundle the Deno entrypoint into a tar.gz
  const tarball = await bundle(name, entry);
  // POST to Supabase Management API
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/functions/${name}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: tarball,
    },
  );
  if (!res.ok) {
    console.error(`✗ ${name} deploy failed: ${res.status} ${await res.text()}`);
    Deno.exit(1);
  }
  console.log(`✓ ${name} deployed`);
}

async function bundle(name: string, entry: string): Promise<BodyInit> {
  // Run `deno bundle` to produce a single-file ESM, then tar with deno.json.
  // Implementation uses `Deno.Command` to invoke `deno bundle`.
  const bundle = await new Deno.Command("deno", {
    args: ["bundle", "--config", "apps/gateway/deno.json", `apps/gateway/${entry}`],
  }).output();
  if (!bundle.success) throw new Error(`deno bundle failed for ${name}`);
  return bundle.stdout;
}
```

> **Implementation note**: The exact API call shape should be verified against the current Supabase Management API docs. If the API has changed, the script must be adapted. The CLI previously used `POST /v1/projects/{ref}/functions/deploy` with a multipart body; the equivalent endpoint should be confirmed.

### Step 5 — Update Workspace Tooling
1. `apps/gateway/package.json`:
   - `"lint": "deno lint"`, `"test": "vitest run"`, `"typecheck": "deno check index.ts"`, `"deploy": "deno run -A scripts/deploy.ts"`.
2. `vitest.integration.config.ts`: include pattern → `'apps/gateway/__tests__/**/*.test.ts'`.
3. `.vscode/launch.json`: Deno debug task → working dir `apps/gateway`, entry `apps/gateway/index.ts` (no more `supabase/functions/...`).
4. Root `package.json` workspaces: confirm `apps/gateway` is included.

### Step 6 — Fix CI/CD Workflows
1. `.github/workflows/supabase-ci.yml`:
   - Remove `paths: supabase/**` triggers. Add `paths: apps/gateway/**`.
   - Lint step: `deno lint apps/gateway/`.
   - Replace each `supabase functions deploy <name> ...` with:
     ```
     pnpm --filter @buddysaradhi/gateway deploy
     # or with specific functions:
     deno run -A apps/gateway/scripts/deploy.ts gateway
     ```
   - Add `SUPABASE_PROJECT_REF` and `SUPABASE_ACCESS_TOKEN` env injection.
2. `.github/workflows/web-prod-gate.yml`:
   - Add `apps/gateway/**` to `paths:` triggers.
   - Replace legacy ledger-verify Prisma steps (lines 98–106) with:
     ```
     pnpm --filter @buddysaradhi/gateway test
     ```
3. Next.js 16 Build Fixes (`apps/web`):
   - Confirm dynamic imports (`await import("next/headers")`) in:
     - `apps/web/src/lib/supabase/server.ts`
     - `apps/web/src/server/get-db.ts`
   - Wrap `resolveSharedSecret()` in lazy runtime evaluation (`NEXT_RUNTIME` checks) so `pnpm --filter web build` succeeds without build-time env vars.

### Step 7 — Update Documentation
1. `README.md`: directory tree reflects new layout (no `supabase/` at root).
2. `AGENTS.md` §1.2, §2.4, §3.1: clarify `apps/gateway/` is the single canonical home for all Supabase Edge Functions and migrations. Reference `apps/gateway/scripts/deploy.ts` as the deploy command.
3. `worklog.md`: append the refactor entry.

## 4. Failure Modes & Risks
- **Risk**: `apps/gateway/index.ts` may import paths that broke when moved. *Mitigation*: verify all relative imports after move.
- **Risk**: Custom deploy script's API call shape may differ from what `supabase functions deploy` did under the hood. *Mitigation*: Test deploy against staging project before first prod deploy. If API mismatch, fallback to `supabase init` in an empty `apps/gateway/_supabase_cli/` temp dir (a one-time hack).
- **Risk**: Supabase Management API requires a specific body format (multipart vs raw ESM). *Mitigation*: Read the actual `supabase/cli` source for the API call it makes, then replicate.
- **Risk**: Mixed env-var exposure between gateway and provision-db. *Mitigation*: provision route uses service role; REST routes do not. Audit on Step 3.
- **Risk**: Vercel deploys `apps/web` (production gate). If CI fails, deployment must be blocked. *Mitigation*: confirm `web-prod-gate.yml` is the only path to Vercel production.

## 5. Verification Plan
1. `pnpm run lint` → 0 errors across all 16 workspaces.
2. `deno lint apps/gateway/` → 0 errors.
3. `deno check apps/gateway/index.ts` → typecheck passes.
4. `pnpm test:unit` + `pnpm test:integration` → all 134+ gateway tests pass.
5. `pnpm --filter web build` → 0 build/hydration/`next/headers` errors.
6. Test custom deploy script locally against staging project.
7. Commit: `refactor(gateway): cut-and-paste supabase into apps/gateway and replace CLI with custom deploy script`.
8. Push to `main`. Confirm on GitHub Actions:
   - `Supabase CI/CD` green (custom deploy script deploys all 3 functions)
   - `Production Gate (P1)` green (deploys `apps/web` to Vercel)
