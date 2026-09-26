# Production Rollback Runbook — Buddysaradhi

> **Task:** S1-C3 (production-audit remediation, `reviews/overhaul-audit-report-2026-09-26.md`).
> **Created:** 2026-09-26 at commit `8488b43` (`HEAD == origin/main`, clean tree).
> **Status:** draft for orchestrator review — not committed by the agent.
> **Scope:** deployed surfaces that exist today: `apps/web`, `apps/product-page`,
> `apps/gateway` (Supabase Edge Functions), and the data layer (Turso + Supabase auth).
> Mobile/desktop are LOCKED and not deployed (`worklog.md:3-7`) — see §6.8.

**Evidence rules for this document (this project treats unverifiable claims as tech debt):**

- Every command below is traceable to (a) a repo file cited as `path:line`, or
  (b) an official vendor doc URL, or (c) the locally installed CLI's own
  `--help` output (versions in §8.3).
- Anything that could not be verified from those three sources is marked
  **`[UNVERIFIED — operator must confirm]`**. The full register is §9.
- No secret values are printed anywhere in this file. Env var **names** only.

---

## 0. Before you touch anything

### 0.1 Known-good commit to roll back TO

```
8488b43  fix(security): PIN-gate account delete, contract-align erase, close settings allowlist [S1-C1]
2056c1a  test(gateway): drop needless async in 405 test — deno lint require-await clean
c5032bf  chore(deps): lockfile refresh — react 19.2.4 pin, gsap, @react-three/fiber 9.8.0
a694f07  docs(worklog): commit audit worklog entries + memory file; ignore nested .next
e618ab3  docs(agents): AGENTS.md rewrite — full operating manual, spec-ref, rules, audit trail
```

- `8488b43` is `HEAD` **and** `origin/main` at runbook-writing time (`git rev-parse`).
- Treat it as the *candidate* rollback target. Before acting, confirm what is
  **actually live**: `vercel list` from the repo root (links project
  `buddysaradhi`, see §2) — the live deployment may be older than `8488b43`
  if a deploy failed (`web-deploy.yml:94-97` marks failed deploys ERROR).

### 0.2 Decide which surface is broken — in this order

```
1. Is DATA wrong (bad rows, bad ledger, deleted account)?
     → §5 Database. Note: most data damage is NOT rollback-able (§6).
2. Is only the WEB frontend broken?
     → §2. Instant Rollback, <60s, no rebuild.
3. Is only the MARKETING/product page broken?
     → §3. Same Vercel lever, separate project.
4. Is the GAPI/API (auth, provision, gateway) broken?
     → §4. Redeploy previous source; there is no one-click function rollback.
5. Unknown / everything broken?
     → Roll back §2 first (largest user impact, fastest, safest), then §4,
       then §5 only if data is provably corrupt.
```

### 0.3 Non-negotiables while rolling back (AGENTS.md §2, `deployment/01_Vercel_Hosting.md:421-427`)

1. **Never** `UPDATE`/`DELETE` `ledger_entries` to "undo" a bad deploy — post a
   reversing entry instead (AGENTS.md Rule 1).
2. **Never** roll back without appending a `---`-delimited `worklog.md` entry
   (bad deployment URL → rolled-back-to deployment URL → reason → next step)
   (`deployment/01_Vercel_Hosting.md:221,425`, `deployment/04_Release_Pipeline.md:493`).
3. **Always** verify after clicking (§2.4/§3.4/§4.4/§5.4) — "I clicked rollback"
   is not verification (`deployment/04_Release_Pipeline.md:495`).
4. Do not print or paste `TURSO_AUTH_TOKEN`, `TURSO_API_TOKEN`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `VERCEL_TOKEN` into
   tickets/chat/logs.

---

## 1. Surface inventory

| # | Surface | Source path | Deploy target (one per directory — AGENTS Rule 11) | Live URL(s) | Rollback lever |
|---|---------|-------------|-----------------------------------------------------|-------------|----------------|
| A | Web app | `apps/web` | Vercel project **`buddysaradhi`** (`projectId prj_PclVy7Bh9l3aFbZTUME8fhz0sZmb`, `.vercel/project.json:1`, `apps/web/.vercel/project.json:4`) | `https://buddysaradhi.vercel.app` (`web-deploy.yml:107`), `https://buddysaradhi.app` (`release.yml:139`) | Vercel Instant Rollback (dashboard) or `vercel rollback` (CLI) |
| B | Product page | `apps/product-page` | Vercel project **`product-page`** (`projectId prj_KMewUhBy9JJZET1E9gkGlhoniEVc`, `apps/product-page/.vercel/project.json:1`) — **different project from A ⇒ Rule 11 satisfied** | `https://buddysaradhi-product.vercel.app`, `https://buddysaradhi-store.vercel.app`, `product-page-hdkevs.vercel.app` (`worklog.md:673`) | Same Vercel lever, run **from `apps/product-page`** |
| C | Gateway | `apps/gateway` | Supabase Edge Functions, project ref `gmqwdnvbfnwpzpctwvho` (`supabase/.temp/project-ref:1`, `README.md:95`), functions `gateway` / `provision-db` / `gateway-graphql` (`supabase-ci.yml:76-99`) | `https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway` (`apps/web/src/server/get-db.ts:232`, `tests/security/owasp_scan.py:11`) | Re-deploy previous source (git). **No one-click rollback exists** (§4.3) |
| D | Database | data layer (no app dir) | Turso per-tenant DBs + Supabase auth users | n/a | Turso Point-in-Time Recovery only (§5.3) — **code rollback never rolls back data** (§6.1) |

Two other Vercel-project files exist but are *not* separate surfaces: root
`vercel.json:4-6` and `apps/web/vercel.json:4-6` both describe the web app with
**different** build commands (bun vs pnpm) — see §2.1 caveat.

---

## 2. Surface A — Web app (`apps/web` → Vercel project `buddysaradhi`)

### 2.1 Identify

1. **Project link:** repo root `.vercel/project.json` and
   `apps/web/.vercel/project.json` both carry `projectId prj_PclVy7Bh9l3aFbZTUME8fhz0sZmb`
   (project name `buddysaradhi`). Running Vercel CLI from **either** directory
   targets the same project.
2. **How it deploys:**
   - Auto on push to `main` — the CI waits for Vercel to pick up the push
     (`web-deploy.yml:73-101`) and `release.yml:139` states "Web: Vercel
     auto-deployed to https://buddysaradhi.app".
   - Manual fallback: `vercel deploy --prod --yes` from repo root
     (`README.md:94`).
   - Recent history has used the manual path when Vercel's git build failed
     (`worklog.md:1325`: "Retry `vercel --prod` later or from dashboard").
3. **Build config — two conflicting `vercel.json` files, same project:**
   - Root `vercel.json:4-6`: `bun x prisma generate && bun --filter … build`,
     output `apps/web/.next`.
   - `apps/web/vercel.json:4-6`: `npx prisma generate --schema=../../prisma/schema.prisma && next build`
     with `pnpm install`, output `.next`.
   - Which one applies depends on the Vercel project's **Root Directory**
     setting. **[UNVERIFIED — operator must confirm]** via dashboard
     Project → Settings → General.
   - This only matters when *re-deploying a fix*; Instant Rollback re-serves a
     previously built artifact and does not rebuild.
4. **Environment variables (names only; values never printed):** the checked-in
   dumps `.env.vercel.production` / `.env.vercel.production2` contain —
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `TURSO_API_TOKEN`, `TURSO_ORGANISATION_SLUG`,
   `TURSO_ORGANISATION_NAME`, `IS_PRODUCT_PAGE`, `VERCEL*`, `NX_*`, `TURBO_*`.
   **Not present** in those dumps (grep): `TURSO_DATABASE_URL`,
   `TURSO_AUTH_TOKEN`, `DATABASE_URL`. Whether the live Vercel project carries
   them is **[UNVERIFIED — operator must confirm with `vercel env ls`]**.
   `setup-env.ps1:3-18` is the repo's env-bootstrap script (names + placeholders).

### 2.2 Rollback steps

**Option A — Dashboard Instant Rollback (primary; fastest, no rebuild).**
Source: `deployment/01_Vercel_Hosting.md:212-223`, `deployment/04_Release_Pipeline.md:278-291`,
vendor doc <https://vercel.com/docs/instant-rollback>.

1. Open Vercel dashboard → project **`buddysaradhi`** → **Deployments**
   (filter by `main` to see only production-eligible deployments).
2. Identify the last **stable** deployment (the one before the bad merge).
3. Click **`⋮`** on that row → **Instant Rollback** (also reachable from the
   Production Deployment tile on the project overview page).
4. Select the deployment to roll back to → **Continue** → verify the domain list
   → **Confirm Rollback**.
5. Go to §2.3 (verify), then §2.5 (record).

**Option B — CLI rollback.** Verified against docs
<https://vercel.com/docs/cli/rollback> and locally installed CLI 60.1.3
(`vercel rollback --help`, §8.3).

```powershell
# 1. Run from the repo root so .vercel/project.json links project "buddysaradhi"
cd Z:\Projects\buddysaradhi\buddysaradhi

# 2. Authenticate (once) — vercel login  [or pass -t <VERCEL_TOKEN>]
vercel login

# 3. List deployments and pick the last READY one before the bad deploy
vercel list --limit 20

# 4. Roll back (accepts a deployment id or a deployment URL)
vercel rollback <deployment-id-or-url>

# 5. Optional: watch it finish / confirm no rollback is stuck
vercel rollback status
```

- Flags `-y/--yes`, `--timeout <TIME>` (default 3m), and global `--cwd <DIR>`
  are printed by the local CLI help — do not invent others.
- **Plan limit:** on the Vercel **Hobby** plan you can only roll back to the
  *immediately previous* production deployment; deeper rollbacks need Pro/Enterprise
  (<https://vercel.com/docs/cli/rollback>, <https://vercel.com/docs/instant-rollback>).
  Current plan is **[UNVERIFIED — operator must confirm]**.
- To go **forward** again after a rollback (and re-enable auto-deploys):
  `vercel promote <deployment-id-or-url>` (<https://vercel.com/docs/cli/rollback>).

**Option C — Rebuild-equivalent (last resort):** `git revert <bad-sha>` and push
`main`; the push auto-deploys (§2.1.2) and CI re-runs smoke
(`web-deploy.yml:63-142`). Slower than A/B and it redeploys *every* surface
triggered by `main`.

### 2.3 Verify (after any option)

```powershell
# 1. Root responds 2xx/3xx — mirrors CI smoke (web-deploy.yml:103-115)
curl.exe -s -o NUL -w "%{http_code}`n" --max-time 30 https://buddysaradhi.vercel.app/

# 2. /login returns 200 — mirrors CI smoke (web-deploy.yml:117-126)
curl.exe -s -o NUL -w "%{http_code}`n" --max-time 30 -L https://buddysaradhi.vercel.app/login

# 3. Provision endpoint rejects unauthenticated callers with 401 (not 500)
#    Route source: apps/web/src/app/api/v1/[...slug]/route.ts:149-161
curl.exe -s -o NUL -w "%{http_code}`n" --max-time 30 -X POST https://buddysaradhi.vercel.app/api/v1/provision
```

Expected: `200`/`302` for (1), `200` for (2), `401` for (3).

> **Known drift in the CI smoke probe:** `web-deploy.yml:128-142` probes
> `POST /api/provision` expecting `401`, but no `app/api/provision/route.ts`
> exists in this repo (only `app/api/v1/[...slug]/route.ts` and
> `app/api/auth/signout/route.ts`); the workflow itself treats any non-401/500
> as "non-fatal" (`web-deploy.yml:140-141`). Use `/api/v1/provision` (step 3)
> instead — that path really exists (`route.ts:149`).

Then: open the site in the Agent Browser, confirm the previous version renders
and the sticky footer behaves (AGENTS.md §16 step 4;
`deployment/01_Vercel_Hosting.md:220`).

### 2.4 Who / when

| | |
|---|---|
| **Trigger** | 5xx rate >1% for 5 min, LCP regression, or "this is broken" from a tutor (`deployment/04_Release_Pipeline.md:265-266,280`) |
| **Who executes** | Anyone with Vercel dashboard access holding rollback rights: Owners/Members/Developers (Pro/Enterprise), or a Project Administrator / holder of the *Full Production Deployment* permission (<https://vercel.com/docs/instant-rollback>) |
| **Approval** | If the root cause is unclear or the change touched money/ledger/security, stop and escalate per AGENTS.md §8 instead of rolling back blind |
| **Afterwards** | `worklog.md` entry (§0.3.2), then open a revert PR or hotfix (`deployment/04_Release_Pipeline.md:289`) |

### 2.5 Post-rollback state warning (easy to miss)

After an Instant Rollback, **Vercel turns off auto-assignment of production
domains**: new pushes to `main` will *not* go live until you undo the rollback
(dashboard **Undo Rollback** button, or `vercel promote …`)
(<https://vercel.com/docs/instant-rollback>). Also note the rolled-back
deployment does **not** include custom aliases that were not on the previous
production deployment (same doc). If production looks "stuck on an old
version" hours later, this is why.

---

## 3. Surface B — Product page (`apps/product-page` → Vercel project `product-page`)

### 3.1 Identify

1. **Separate Vercel project** — `apps/product-page/.vercel/project.json:1`
   carries `projectId prj_KMewUhBy9JJZET1E9gkGlhoniEVc`, `projectName "product-page"`.
   That is a **different project** from `buddysaradhi`, i.e. one directory → one
   deployment target (AGENTS.md Rule 11) holds for the product page.
2. **Deploy mechanism: CLI-driven only.** No workflow in `.github/workflows/`
   deploys it (`test.yml:61` and `web-prod-gate.yml:82` only *build* it).
   Documented command: `vercel --prod` **run from `apps/product-page`**
   (`worklog.md:671`, `MEMORY.md:27-28`).
3. **Aliases (public surface):** `buddysaradhi-product.vercel.app`,
   `buddysaradhi-store.vercel.app`, `product-page-hdkevs.vercel.app`
   (`worklog.md:673`). The web app's store CTA points at
   `https://buddysaradhi-product.vercel.app` (`apps/web/src/proxy.ts:18`) and the
   gateway allowlists that origin (`apps/gateway/index.ts:34`); the page itself
   declares "standalone deployment (buddysaradhi-product target…)"
   (`apps/product-page/next.config.ts:3`).
4. **Build config:** there is **no `apps/product-page/vercel.json` at HEAD** —
   it was deleted as dead code in commit `6402592` (it had
   `installCommand: "bun install"`, `buildCommand: "next build"`). Build settings
   are expected to live in the Vercel project settings (`bun install` +
   `next build`, `MEMORY.md:27-28`). **[UNVERIFIED — operator must confirm
   Install/Build/Output settings and Root Directory = `apps/product-page`;
   `worklog.md:1308` still lists "Root Directory = apps/product-page" as an open
   resume point.]**
5. **Project display name:** repo evidence disagrees — `.vercel/project.json`
   says `product-page`, `setup-env.ps1:14` links `buddysaradhi-product-page`,
   `worklog.md:693,1331` mention a pending rename. The CLI acts on the
   **projectId**, so CLI rollback is unaffected; confirm the dashboard name
   before clicking. **[UNVERIFIED — current display name]**

### 3.2 Rollback steps

**Option A — Dashboard.** Vercel dashboard → project `product-page` (see §3.1.5)
→ Deployments → `⋮` → **Instant Rollback** → confirm. Same doc:
<https://vercel.com/docs/instant-rollback>.

**Option B — CLI (must target the product-page project).** Verified:
<https://vercel.com/docs/cli/rollback> + local CLI 60.1.3.

```powershell
# Run from apps/product-page so .vercel/project.json links the product-page project
cd Z:\Projects\buddysaradhi\buddysaradhi\apps\product-page

vercel list --limit 20                       # find last good deployment
vercel rollback <deployment-id-or-url>       # add -y to skip the prompt
vercel rollback status                       # confirm it finished
```

Equivalent one-liner from the repo root (the `--cwd` flag is printed by the
local CLI help: "Sets the current working directory for a single run of a
command"):

```powershell
vercel rollback <deployment-id-or-url> --cwd apps\product-page
```

**Option C — Deploy previous source (product page has no CI, so this is the
rebuild path):**

```powershell
cd Z:\Projects\buddysaradhi\buddysaradhi
git checkout <last-good-sha> -- apps/product-page    # or git worktree/git revert
cd apps\product-page
vercel --prod                                         # worklog.md:671
```

> Do **not** commit a rollback-by-checkout to `main` without an orchestrator
> review — prefer `git revert` so history stays forward-only.

### 3.3 Verify

1. `curl.exe -s -o NUL -w "%{http_code}`n" https://buddysaradhi-product.vercel.app/`
   → `200`.
2. Repeat for `https://buddysaradhi-store.vercel.app/`.
3. Browser check (the bar used when this page was last shipped,
   `worklog.md:675-677`): page title matches `/BuddySaradhi/`, the 3D **canvas is
   visible**, and no `**next_error**` ("This page couldn't load") is rendered.
4. From the web app, click a store/CTA link and confirm it lands on the rolled-back
   page (`apps/web/src/proxy.ts:18`).

### 3.4 Who / when

| | |
|---|---|
| **Trigger** | Visual/functional breakage reported (product page has **no** monitoring workflow in this repo — there is no `product-page-deploy` CI, §3.1.2); console/webDevReview report |
| **Who executes** | Whoever holds Vercel access to the `product-page` project (same permission model as §2.4) |
| **Note** | Production deployment URLs for this project may be SSO-gated by "Vercel Authentication for Production deployments"; the **aliases are the public surface** (`worklog.md:681-685`). Verify against aliases, not the raw deployment URL |
| **Afterwards** | `worklog.md` entry (§0.3.2) |

---

## 4. Surface C — Gateway (`apps/gateway` → Supabase Edge Functions)

### 4.1 Identify

1. **Three functions, one project.** CI deploys from `apps/gateway/*`
   (`.github/workflows/supabase-ci.yml:73-101`):
   - `gateway` ← `apps/gateway/*` (`supabase-ci.yml:76-79`)
   - `provision-db` ← `apps/gateway/provision/*` (`supabase-ci.yml:86-89`)
   - `gateway-graphql` ← `apps/gateway/graphql/*` (`supabase-ci.yml:96-99`)
   Each with `--project-ref <ref> --no-verify-jwt`; `<ref>` comes from the
   `SUPABASE_PROJECT_REF` secret; the repo-local copy is
   `supabase/.temp/project-ref:1` = `gmqwdnvbfnwpzpctwvho` (also printed in
   `README.md:95-96`).
2. **Deploy trigger:** push to `main` when `SUPABASE_ACCESS_TOKEN` is set
   (`supabase-ci.yml:4-8`, gate at `supabase-ci.yml:46-55`); lint/typecheck run
   first (`supabase-ci.yml:20-37`). Manual equivalent in `README.md:95`.
3. **Live endpoint:** `https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway`
   (`apps/web/src/server/get-db.ts:232`, `tests/security/owasp_scan.py:11`).
4. **⚠️ Two copies of the gateway source exist.** CI deploys **`apps/gateway/*`**
   (`supabase-ci.yml:76-79`). `supabase/functions/gateway/` is a legacy copy that
   is *not* identical at `8488b43` (`index.ts`: 324 lines vs 302 lines; SHA-256
   differs; last deliberate sync `59a5ee6 fix(gateway): sync supabase legacy with
   apps/gateway …`). A comment in `apps/web/src/app/api/v1/[...slug]/route.ts:3`
   calls the legacy copy "canonical" — that comment is stale relative to CI.
   **Deploying the wrong directory is a rollback-in-the-wrong-direction bug.**

### 4.2 Rollback steps

**There is no `supabase functions rollback` command** — see §4.3. Rollback =
redeploy previous source.

**Option A — Revert the bad commit (simplest, but redeploys everything on `main`):**

```powershell
git revert <bad-sha>          # or: git revert <bad-sha>~..<good-sha>
git push origin main          # supabase-ci deploy job runs (supabase-ci.yml:39-101)
```

Caveat: the same push also triggers `web-deploy` (`.github/workflows/web-deploy.yml:5-7`),
so the web surface redeploys too. Acceptable when both were broken together;
otherwise use Option B.

**Option B — Gateway-only redeploy of a known-good source (mirrors CI exactly):**

```powershell
# 0. Authenticate the Supabase CLI once.
#    CI uses the SUPABASE_ACCESS_TOKEN secret name (supabase-ci.yml:55);
#    locally: `supabase login`, or set $env:SUPABASE_ACCESS_TOKEN yourself.
supabase login

# 1. Materialise the last good gateway source (pick the sha from §4.2 note)
git worktree add "$env:TEMP\gw-good" <good-sha>
cd "$env:TEMP\gw-good"

# 2. Replicate the CI staging layout (supabase-ci.yml:76-79 / 86-89 / 96-99)
New-Item -ItemType Directory -Force .temp-deploy\supabase\functions\gateway | Out-Null
Copy-Item -Recurse apps\gateway\* .temp-deploy\supabase\functions\gateway\
New-Item -ItemType Directory -Force .temp-deploy\supabase\functions\provision-db | Out-Null
Copy-Item -Recurse apps\gateway\provision\* .temp-deploy\supabase\functions\provision-db\
New-Item -ItemType Directory -Force .temp-deploy\supabase\functions\gateway-graphql | Out-Null
Copy-Item -Recurse apps\gateway\graphql\* .temp-deploy\supabase\functions\gateway-graphql\

# 3. Deploy the three functions (command text = supabase-ci.yml:79 / :89 / :99)
cd .temp-deploy
supabase functions deploy gateway          --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt
supabase functions deploy provision-db     --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt
supabase functions deploy gateway-graphql  --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt

# 4. Clean up
cd "$env:TEMP"
git -C Z:\Projects\buddysaradhi\buddysaradhi worktree remove "$env:TEMP\gw-good"
```

**Finding `<good-sha>`:**

```powershell
git log --oneline -15 -- apps/gateway          # last commits touching gateway
git log --oneline -5  -- .github/workflows/supabase-ci.yml
```

Pick the newest commit whose message is known-good (e.g. `2056c1a`, a test-only
change), then re-run §4.4.

### 4.3 Why there is no one-click function rollback (verified negative)

- `supabase functions --help` on the installed CLI (**2.118.0**) lists exactly:
  `list, delete, download, deploy, new, serve` — **no `rollback`** (§8.3).
- The official CLI reference lists the same Edge Function subcommands and no
  rollback page: <https://supabase.com/docs/reference/cli/functions-deploy>.
- Therefore the spec claim in `deployment/06_Edge_Function_Hosting.md:952`
  (`supabase functions rollback provision-db --version <id>`) is
  **[UNVERIFIED — operator must confirm against their installed CLI; it is
  absent from CLI 2.118.0 and from the docs as of 2026-09-26]**. Do not put it in
  an incident bridge as a working command.
- The Cloudflare Workers path in the same spec (`bunx wrangler deployments list`,
  `bunx wrangler rollback`, `deployment/06_Edge_Function_Hosting.md:934-950`) is
  **not a live surface**: there is no `.github/workflows/edge-deploy.yml`, no
  `wrangler.toml` anywhere in the repo, and `wrangler` is not installed in this
  environment. **[NOT APPLICABLE to current production — do not run.]**
- Supabase *dashboard* function version history (if enabled on the project) is
  **[UNVERIFIED — operator must check the dashboard; nothing in this repo
  documents it]**.

### 4.4 Verify

```powershell
# 1. Unauthenticated health probe — index.ts:141-146 returns {"ok":true},
#    and the function is deployed with --no-verify-jwt so no token is needed.
curl.exe -s --max-time 30 https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/health
#    expect: {"ok":true}

# 2. All three functions present
supabase functions list --project-ref gmqwdnvbfnwpzpctwvho

# 3. Auth path still rejects (not 500) — apps/gateway/lib/auth.ts:34
curl.exe -s -o NUL -w "%{http_code}`n" --max-time 30 https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway/api/v1/students
#    expect: 401 (a 500 here means the rollback did not fix the crash)

# 4. End-to-end through the web BFF (route.ts:149-161 → 401 without JWT)
curl.exe -s -o NUL -w "%{http_code}`n" --max-time 30 -X POST https://buddysaradhi.vercel.app/api/v1/provision
```

> **Pre-existing failure, not a rollback regression:** the GraphQL function has
> been returning HTTP 500 even for `{ health }`
> (`reviews/gateway-test-report.md:15,54`). If `gateway-graphql` is still 500
> after your rollback, that is the known defect — compare against the test
> report before assuming your rollback failed.

### 4.5 Who / when

| | |
|---|---|
| **Trigger** | Auth failures, provision failures, 5xx on `/functions/v1/gateway` — gateway serves auth + money paths, so treat as AGENTS §8-sensitive |
| **Who executes** | Someone with `SUPABASE_ACCESS_TOKEN` (CI) or Supabase dashboard/project access (manual) |
| **Gate** | `deno lint` + `deno check` must pass before deploying (`supabase-ci.yml:33-37`) — deploying a `main` that fails lint is a §8 stop-and-ask |
| **Afterwards** | `worklog.md` entry (§0.3.2) + the four verify probes above |

---

## 5. Surface D — Database (Turso per-tenant + Supabase auth)

### 5.1 Identify (what actually exists)

1. **Per-tenant Turso databases.** Provisioning
   (`apps/web/src/app/api/v1/[...slug]/route.ts:149-257`):
   - DB name `buddysaradhi-<first 16 chars of user id>` (`route.ts:185`), group
     `buddysaradhi` (`route.ts:195`), created via Turso Platform API
     `POST https://api.turso.tech/v1/organizations/{slug}/databases`
     (`route.ts:187-196`) using `TURSO_API_TOKEN` + `TURSO_ORGANISATION_SLUG`
     (`route.ts:150-151`).
   - A long-lived token is minted (`route.ts:206-216`) and both are written to
     the user's Supabase `user_metadata` as `db_url` / `db_token`
     (`route.ts:243-251`).
   - **Fallback:** shared `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` when the
     Turso API path fails (`route.ts:231-237`); the gateway has the same env
     fallback (`apps/gateway/index.ts:172-183`).
2. **How the web reads credentials:** `user_metadata.db_url/db_token` first,
   else `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` env, else it throws
   `DB_NOT_PROVISIONED` (`apps/web/src/lib/db.ts:90-109`).
3. **App-level backup:** Settings → Backup produces an encrypted **`.bsb`**
   download (`apps/web/src/server/actions/settings.ts:9,38`); backups are never
   uploaded to any server (`09_Backup_and_Import_Export.md:620`).

### 5.2 Rollback posture — stated honestly

| Situation | What actually works |
|---|---|
| Bad code deployed, data fine | Roll back code (§2–§4). **Data written during the bad window stays written** — same principle as `deployment/06_Edge_Function_Hosting.md:948` ("the Worker code reverts, but … Turso per-tutor DBs are NOT reverted … by design") |
| Schema migration applied, app can't read it | **Forward-only migrations, no down-migrations** — "A rollback is a restore from the last `.buddysaradhi` backup" (`11_Data_Model.md:911`). In practice: restore via PITR (§5.3) or ship a fix-forward migration (`deployment/06_Edge_Function_Hosting.md:948` documents `prisma migrate resolve` + new migration as the pattern) |
| Rows corrupted / wrong writes | **Turso Point-in-Time Recovery** (§5.3) — the only DB-level undo |
| Restore from the `.bsb` file you exported | **NOT POSSIBLE TODAY** — see §6.3 |

### 5.3 Turso Point-in-Time Recovery (the only DB rollback lever)

Source: <https://docs.turso.tech/features/point-in-time-recovery> (official).

```bash
# Creates a NEW database seeded from the old one at an exact timestamp.
turso db create <new-db-name> --from-db <existing-db-name> --timestamp 2026-09-26T12:00:00Z
```

Vendor-stated facts you must plan around (same URL):

1. PITR **creates a new database**; you then point the app at the new connection
   string and delete the old DB when done.
2. You **cannot** restore *into* an existing database; you need a new auth token
   (or group token) for the new DB; restores consume plan quota.
3. Retention window by plan: **Free = 24h (1 day)**, Developer = 10 days,
   Scaler = 30 days, Pro = 90 days (<https://turso.tech/pricing.md>).

**Buddysaradhi-specific consequences (repo-sourced):**

4. For each affected tenant, "point the app at the new database" means updating
   Supabase `user_metadata.db_url` / `db_token` — the same fields written at
   provision time (`route.ts:243-251`) and read on every request
   (`apps/web/src/lib/db.ts:90-109`). **There is no script in this repo that
   does this update in bulk.** The manual path is Supabase Auth admin
   (`auth.admin.updateUserById` — used only inside `route.ts:243`). The exact
   operator procedure is **[UNVERIFIED — operator must confirm]**.
5. If tenants are on the **shared** DB (§5.1.1 fallback), the PITR target is
   `TURSO_DATABASE_URL`'s database instead — confirm which tenants are shared
   vs per-tenant **before** restoring. **[UNVERIFIED — live state]**
6. Credentials/tokens: names are `TURSO_API_TOKEN`, `TURSO_ORGANISATION_SLUG`
   (`route.ts:150-151`, `.env.vercel.production` key names). Whether the
   `turso` CLI is installed and authenticated in your environment is
   **[UNVERIFIED — operator must confirm; not verified in this sandbox]**.
7. Your current Turso plan (which decides the retention window) is
   **[UNVERIFIED — operator must confirm in the Turso dashboard]**.

### 5.4 Verify (after any DB action)

1. Provision a throwaway/known test user (or use an existing test tenant) and
   confirm the app loads data: `GET https://buddysaradhi.vercel.app/` → login →
   Students screen renders rows.
2. Confirm credentials resolve: no `DB_NOT_PROVISIONED` / 503 in the browser
   console or server logs (`apps/web/src/lib/db.ts:105`,
   `route.ts:21`).
3. Confirm `sync_outbox` is draining after the change (rows queue then clear —
   BR-SYN-01); a stuck outbox means the new DB URL/token is wrong.
4. Record tenant DB name(s), old and new connection strings (names only in the
   worklog — never the token), and the PITR timestamp used.

### 5.5 Who / when

| | |
|---|---|
| **Trigger** | Data corruption, accidental mass delete, migration failure the app cannot recover from (`11_Data_Model.md:911`, EC-M-02/M-03) |
| **Who executes** | Turso account owner + Supabase admin access; **stop-and-ask per AGENTS.md §8 before touching data** (money + ledger + crypto are in play) |
| **Afterwards** | `worklog.md` entry with timestamp used, DBs created, tenants repointed; announce that tenants must re-sync |

---

## 6. What CANNOT be rolled back

1. **Ledger rows already posted.** `ledger_entries` is append-only; a rollback
   runbook can never "undo" a posting by editing it (AGENTS.md Rule 1,
   `12_Business_Rules.md` BR-LED-01). The correct undo is a **reversing entry**
   (void) posted after the code is healthy. CI and SQLite triggers reject
   UPDATE/DELETE on that table (AGENTS.md §2 Rule 1 enforcement).
2. **Writes made during a bad-code window.** Code rollback ≠ data rollback
   (`deployment/06_Edge_Function_Hosting.md:948`). Anything the bad build wrote
   (bad ledger rows, wrong balances, wrong attendance) must be corrected
   forward — via voids/reversing entries for money, and via audit-logged edits
   elsewhere.
3. **Account erase is one-way.** `deleteAccountAction`
   (`apps/web/src/server/actions/settings.ts:234`) physically `DELETE`s
   `ledger_entries` (the single audited LEDGER-4 exception, `settings.ts:285`)
   plus every tenant table, then deletes the Supabase auth user
   (`settings.ts:314`). No app-level undo exists; the only recovery would be a
   Turso PITR for the rows (§5.3) **plus** some Supabase-side user recovery that
   this repo does not document **[UNVERIFIED]**. (Soft variant:
   `deleteTenantDataAction` at `settings.ts:49` only *archives* students
   `settings.ts:70` — that one is reversible by un-archiving.)
4. **Restoring a `.bsb` backup.** Backup *create* is implemented
   (`settings.ts:9`); backup *restore* is **not**. The Settings →
   Import/Export "import" path only validates the filename and reports success
   after a simulated 1.5s delay — it never writes data
   (`apps/web/src/components/settings/import-export-section.tsx:60,69-82`,
   comment "// Simulate import and validation delay"). The full restore pipeline
   exists only as spec (`09_Backup_and_Import_Export.md:129-205`). **Treat every
   `.bsb` file as write-off until a real restore ships.**
5. **Environment variable changes.** Instant Rollback does not revert env vars:
   "Vercel won't update environment variables … and will roll back to a
   previous build"; env vars stay in their current state
   (<https://vercel.com/docs/instant-rollback>). A bad env var must be fixed
   forward in Project → Settings → Environment Variables (names in
   `setup-env.ps1:3-18`).
6. **Receipt / invoice number gaps.** Voids never decrement
   `next_receipt_seq`/`next_invoice_seq` (BR-RC-01) — the gap is intentional
   and is *not* a rollback defect. Do not "fix" it during an incident.
7. **Auto-deploy after a rollback.** Until the rollback is undone
   (`vercel promote`, §2.5), pushes to `main` do not go live. Silent, easy to
   forget, and it looks like "deploys stopped working".
8. **Mobile and desktop.** Not deployed; gates LOCKED (`worklog.md:3-7`). Their
   workflows fire only on `v*` tags (`eas-build.yml:5-8`,
   `desktop-build.yml:5-8`), so no production rollback path exists — or is
   needed — today. Desktop/mobile rollback plays live in
   `deployment/04_Release_Pipeline.md` §6.2/§6.3/§6.4 for when those platforms
   unlock; **do not execute them now** (AGENTS.md §9.3).
9. **Supabase auth users / audit rows.** `audit_log` rows survive erases by
   design (`settings.ts:282,319-325`) and are not rolled back; deleting an auth
   user is §6.3.

---

## 7. Post-rollback checklist (all surfaces)

- [ ] Verify probes for the surface (§2.3 / §3.3 / §4.4 / §5.4) all pass.
- [ ] Append a `---`-delimited `worklog.md` entry: bad deployment URL →
      rolled-back-to URL/sha → reason → next step (hotfix or revert PR)
      (`deployment/01_Vercel_Hosting.md:221,425`).
- [ ] If you used Vercel Instant Rollback: note that auto-deploy is now **off**
      (§2.5) and set a reminder to `vercel promote` / Undo Rollback once the fix
      ships.
- [ ] Open the revert PR or hotfix (`deployment/04_Release_Pipeline.md:289`);
      every PR needs its `## Spec ref` block (AGENTS.md §5.3).
- [ ] Confirm the rollback reason is not a §8 stop-and-ask trigger that still
      needs human review (AGENTS.md §8.1).
- [ ] Re-run the web smoke (`web-deploy.yml:63-142`) or the equivalent probes
      after the forward fix, not just after the rollback.

---

## 8. Evidence appendix

### 8.1 Repo file:line

| Ref | What it proves |
|---|---|
| `vercel.json:4-6` | Root web build config (bun, output `apps/web/.next`) |
| `apps/web/vercel.json:4-6` | Alternate web build config (pnpm) — conflicts with root |
| `.vercel/project.json:1` | Repo-root Vercel link → project `buddysaradhi`, `projectId prj_PclVy7Bh9l3aFbZTUME8fhz0sZmb` |
| `apps/web/.vercel/project.json:4` | Same project id for `apps/web` |
| `apps/product-page/.vercel/project.json:1` | Separate project `product-page`, `projectId prj_KMewUhBy9JJZET1E9gkGlhoniEVc` (Rule 11) |
| `.github/workflows/web-deploy.yml:5-8` | web-deploy triggers on push to `main` |
| `web-deploy.yml:73-101` | CI waits for Vercel deployment (proves git-integration auto-deploy path) |
| `web-deploy.yml:103-115` | Smoke: root URL must be 2xx/3xx |
| `web-deploy.yml:117-126` | Smoke: `/login` must be 200 |
| `web-deploy.yml:128-142` | Smoke: `/api/provision` expects 401; non-401/500 treated non-fatal |
| `web-deploy.yml:76-87` | `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` secret names + Vercel API status polling |
| `.github/workflows/supabase-ci.yml:4-8` | Gateway CI on push to `main` for `apps/gateway/**` |
| `supabase-ci.yml:33-37` | `deno lint` / `deno check` gate before deploy |
| `supabase-ci.yml:46-55` | `SUPABASE_ACCESS_TOKEN` secret gate |
| `supabase-ci.yml:76-79` | Deploy `gateway` from `apps/gateway/*` |
| `supabase-ci.yml:86-89` | Deploy `provision-db` from `apps/gateway/provision/*` |
| `supabase-ci.yml:96-99` | Deploy `gateway-graphql` from `apps/gateway/graphql/*` |
| `README.md:94` | `vercel deploy --prod --yes`, trigger "Push to main" |
| `README.md:95-96` | `supabase functions deploy gateway/provision-db --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt` |
| `setup-env.ps1:3-18` | Vercel env var **names** bootstrapped for production |
| `.env.vercel.production` / `.env.vercel.production2` | Env key names present/absent (§2.1.4) |
| `supabase/.temp/project-ref:1` | Supabase project ref `gmqwdnvbfnwpzpctwvho` |
| `worklog.md:671-673` | `vercel --prod` from `apps/product-page`; 3 aliases |
| `worklog.md:681-685` | Product-page deployment URLs SSO-gated; aliases are public |
| `worklog.md:693` | Product page is "CLI-driven deploys only" |
| `worklog.md:1325` | Web prod deploy fell back to manual `vercel --prod` |
| `worklog.md:1308` | Open item: Vercel project Root Directory = `apps/product-page` |
| `MEMORY.md:26-30` | Root `vercel.json` pins output; product-page uses dashboard build settings; gateway deploy command |
| `apps/product-page/next.config.ts:3` | Product page = standalone `buddysaradhi-product` target |
| `apps/web/src/proxy.ts:18` | Web store CTA → `buddysaradhi-product.vercel.app` |
| `apps/gateway/index.ts:34` | Gateway CORS allowlist contains the product-page alias |
| `apps/gateway/index.ts:141-146` | Unauthenticated `/health` → `{"ok":true}` (verify probe) |
| `apps/gateway/index.ts:172-183` | Gateway DB cred resolution (header → env) |
| `apps/gateway/lib/auth.ts:34` | Missing auth header → 401 (verify probe) |
| `apps/web/src/server/get-db.ts:232` | Live gateway URL constant |
| `apps/web/src/app/api/v1/[...slug]/route.ts:149-161` | `/api/v1/provision` → 401 without JWT |
| `route.ts:185,195` | Per-tenant Turso DB name + group |
| `route.ts:206-216,243-251` | Token mint + `db_url`/`db_token` written to `user_metadata` |
| `route.ts:231-237` | Shared-DB fallback |
| `apps/web/src/lib/db.ts:90-109` | Credential resolution + `DB_NOT_PROVISIONED` |
| `apps/web/src/server/actions/settings.ts:9,38` | Backup create → `.bsb` download |
| `settings.ts:49,70` | "Delete data" = archive (reversible) |
| `settings.ts:234,285,314` | Account erase: LEDGER-4 physical delete + auth user delete (one-way) |
| `apps/web/src/components/settings/import-export-section.tsx:60,69-82` | Import is a **simulated** stub — no restore happens |
| `09_Backup_and_Import_Export.md:129-205` | Spec'd restore pipeline (not implemented) |
| `09_Backup_and_Import_Export.md:620` | Backups are never uploaded |
| `11_Data_Model.md:911` | Forward-only migrations; rollback = restore from backup |
| `deployment/01_Vercel_Hosting.md:190-194` | Instant Rollback = primary web lever |
| `deployment/01_Vercel_Hosting.md:212-223` | 6-step web rollback procedure + re-roll-forward |
| `deployment/01_Vercel_Hosting.md:421-427` | Never roll back without a worklog entry |
| `deployment/04_Release_Pipeline.md:276-291` | §6.1 web rollback playbook, <60s |
| `deployment/04_Release_Pipeline.md:493,495` | Worklog + verify obligations |
| `deployment/04_Release_Pipeline.md:339-351` | §6.5 MAJOR rollback = restore from backup (heaviest) |
| `deployment/06_Edge_Function_Hosting.md:934-950` | Spec'd `wrangler rollback` (not deployed, §4.3) |
| `deployment/06_Edge_Function_Hosting.md:952` | Spec'd `supabase functions rollback … --version` (absent from CLI, §4.3) |
| `deployment/06_Edge_Function_Hosting.md:948` | Code rollback never reverts DB state |
| `worklog.md:1-7` | Platform state: WEB in-flight, MOBILE/DESKTOP LOCKED |
| `.github/workflows/eas-build.yml:5-8`, `desktop-build.yml:5-8` | Mobile/desktop build only on `v*` tags |
| `reviews/gateway-test-report.md:15,54` | GraphQL 500 is a pre-existing defect |
| `git log --oneline -5` at `8488b43` | Known-good candidate list (§0.1) |
| SHA-256 of `apps/gateway/index.ts` vs `supabase/functions/gateway/index.ts` at `8488b43` | Two gateway copies differ (324 vs 302 lines) — §4.1.4 |

### 8.2 Official docs fetched

| URL | Used for |
|---|---|
| <https://vercel.com/docs/cli/rollback> | `vercel rollback [deployment-id or url]`, `vercel rollback status`, `--timeout`, hobby-plan one-step limit, `vercel promote` to undo |
| <https://vercel.com/docs/instant-rollback> | Dashboard Instant Rollback steps, eligibility rules, auto-deploy disabled after rollback + Undo Rollback, env-var non-revert, who can roll back (RBAC) |
| <https://supabase.com/docs/reference/cli/functions-deploy> | `supabase functions deploy` flags (`--project-ref`, `--no-verify-jwt`); the Edge Functions command list contains **no rollback subcommand** |
| <https://docs.turso.tech/features/point-in-time-recovery> | `turso db create … --from-db … --timestamp`, PITR semantics (new DB, new token, quota) |
| <https://turso.tech/pricing.md> | PITR retention by plan (Free 24h / Dev 10d / Scaler 30d / Pro 90d) |

### 8.3 Local CLI verification (this sandbox, 2026-09-26)

| Command run | Result |
|---|---|
| `vercel --version` | `Vercel CLI 60.1.3` |
| `vercel rollback --help` | `vercel rollback url\|deploymentId`, subcommand `status`, options `--timeout`, `-y/--yes`, globals incl. `--cwd`, `--token` |
| `vercel promote --help` | `vercel promote url\|deploymentId`, subcommand `status`, `--timeout` |
| `vercel login --help` | `vercel login [email or team id]` exists |
| `vercel list --help` | `vercel list [app]`, `--limit`, `--environment`, `--json` |
| `vercel deployments` | **Rejected**: `Unknown command "deployments"` (accepted list includes `rollback`, `promote`, `list`, `redeploy`, `inspect`) |
| `supabase --version` | `2.118.0` |
| `supabase functions --help` | SUBCOMMANDS: `list, delete, download, deploy, new, serve` — **no `rollback`** |
| `supabase functions deploy --help` | `--project-ref`, `--no-verify-jwt`, `--use-api`, `--import-map`, `--prune`, `--jobs` |
| `wrangler --version` | not installed (and no `wrangler.toml` in repo) |

### 8.4 Known spec/repo discrepancies found while writing this runbook

1. `deployment/06_Edge_Function_Hosting.md:952` documents
   `supabase functions rollback <fn> --version <id>` — subcommand does not exist
   in CLI 2.118.0 nor in the official CLI docs (§4.3).
2. `deployment/06_Edge_Function_Hosting.md` §10/§11 (Cloudflare Workers
   `edge-deploy.yml`, `wrangler deploy/rollback`) — no such workflow, no
   `wrangler.toml`, no wrangler CLI; Supabase Edge Functions is the live path
   (§4.3).
3. `apps/web/src/app/api/v1/[...slug]/route.ts:3` calls
   `supabase/functions/gateway` the canonical gateway, while CI deploys
   `apps/gateway/*` and the two trees differ (§4.1.4).
4. `web-deploy.yml:133` probes `/api/provision`, a route that does not exist in
   this repo (§2.3).
5. Two conflicting `vercel.json` files for the same web project (§2.1.3).
6. `09_Backup_and_Import_Export.md` §6.2 specifies restore; the implemented UI
   import is a stub (§6.4).

> Per AGENTS.md §0.1, items 1–6 are **spec-drift candidates**: fix the spec (or
> the code) in a follow-up task, not inside this incident runbook.

---

## 9. `[UNVERIFIED]` register

| # | Claim / step | Why unverified | Operator action |
|---|---|---|---|
| 1 | Vercel plan tier (Hobby = rollback only one step back) | No repo file states the plan; `.vercel/project.json` shows a team but not the tier | Check Vercel dashboard → Team → Billing before relying on deep rollback |
| 2 | Which `vercel.json` (root bun vs `apps/web` pnpm) the project uses | Depends on the project's Root Directory setting, not in repo | Dashboard → Project → Settings → General → Root Directory; confirm with a preview build |
| 3 | Live Vercel env vars for `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Absent from checked-in `.env.vercel.production*` dumps; live state unknown | `vercel env ls production` (names only) |
| 4 | Product-page project display name (`product-page` vs `buddysaradhi-product-page`) | `.vercel/project.json:1` vs `setup-env.ps1:14` vs `worklog.md:693,1331` disagree | Confirm in dashboard before clicking Instant Rollback; CLI uses projectId so is unaffected |
| 5 | Product-page Root Directory / Install / Build settings after `vercel.json` deletion (`6402592`) | Settings live only in Vercel; `worklog.md:1308` still lists it as open | Dashboard → product-page → Settings before any *redeploy* |
| 6 | `supabase functions rollback` | Absent from CLI 2.118.0 and from official docs | Do not use; redeploy previous source (§4.2) |
| 7 | Supabase dashboard Edge Function version history | Not documented anywhere in this repo; not reachable from CLI | Check Dashboard → Edge Functions before assuming it is available |
| 8 | Cloudflare `wrangler` rollback path | Spec-only; no workflow, no config, CLI not installed | Not applicable today |
| 9 | Turso plan / PITR retention window for this org | Repo has org slug + API token names, not the plan | Turso dashboard → plan; size the incident window accordingly |
| 10 | `turso` CLI availability/authentication in the operator's environment | Not verified in this sandbox | `turso --version` / `turso auth whoami` before the incident |
| 11 | Bulk-repoint of tenants to a PITR-restored DB (updating `user_metadata.db_url/db_token`) | No script exists; only the provision-time write (`route.ts:243`) is in repo | Confirm Supabase admin procedure; test on a non-production tenant first |
| 12 | Which tenants are on shared vs per-tenant Turso DB | Live state, not in repo | Query `user_metadata.provision_method` (`route.ts:249`) before restoring |
| 13 | Recoverability of a deleted Supabase auth user after account erase | Not documented in repo; outside Turso PITR | Supabase dashboard/support; treat as irreversible until confirmed |
| 14 | Git-integration auto-deploy currently enabled for the web project | Inferred from `web-deploy.yml:73-101` + `release.yml:139` + `README.md:94`; not directly observable from repo | Dashboard → Settings → Git; if disabled, `vercel deploy --prod --yes` is the only path |

---

*End of runbook. Next recommended follow-ups (separate tasks): reconcile the six
spec-drift items in §8.4, implement a real `.bsb` restore (§6.4), and add a
`product-page` deploy/rollback workflow or document its dashboard-only flow
(§3.1.2).*
