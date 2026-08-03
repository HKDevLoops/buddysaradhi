# 01 — Vercel Hosting (Cross-Cutting Account + Project View)

> The cross-cutting Vercel account/project specification for Buddysaradhi: Omni-Core. The web-only `vercel.json` knobs and Next.js build configuration are owned by `web/05_Deployment_Vercel.md`; this file owns the **account-level** concerns that span Web hosting, Vercel Blob storage (see `02_Vercel_Blob_Build_Storage.md`), and the cross-platform status/analytics posture. If you are configuring a single Next.js project, read `web/05_Deployment_Vercel.md` first. If you are setting up the Vercel org, the env-var matrix, the domain strategy, or the upgrade triggers, read this file first.

---

## 1. Why Vercel, and what this file owns

Buddysaradhi is a three-surface product (web now, mobile + desktop in v1.x per `15_Future_Roadmap.md`). The web surface is the **only** one that ships a server-rendered Next.js 16 app today; mobile and desktop are static / native shells around the same `packages/core` ledger engine. That web surface is hosted on Vercel because:

1. **Zero-config Next.js.** Next.js 16 App Router + `output: "standalone"` (see `next.config.ts`) is Vercel's first-class build target. No reverse-proxy, no PM2, no Dockerfile.
2. **Same account as Vercel Blob.** The Desktop installer artifacts (and the APK mirror) live on Vercel Blob (`02_Vercel_Blob_Build_Storage.md`). One account, one billing surface, one CDN.
3. **Preview deployments per PR.** Every PR gets `buddysaradhi-pr-123.vercel.app`, which the 15-min `webDevReview` cron uses for agent-browser QA (see `AGENTS.md` §9.1 — Agent Operating Loop, and the worklog CRON-R1..R5 entries for the cron's history).
4. **Free tier is enough for v1.** Solo tutors are not traffic-heavy. The Hobby plan covers v1; the upgrade trigger is documented in §8.
5. **DDoS protection built in.** Vercel's Edge network absorbs volumetric attacks. No Cloudflare needed (see §10).

This file owns the **account-level** configuration: project setup, domains, environment variables matrix, preview vs. production promotion, free-tier limits + upgrade triggers, Speed Insights + Web Analytics, DDoS posture, and the status page. It does **not** own the `vercel.json` rewrite/headers/redirect rules — those are in `web/05_Deployment_Vercel.md`.

---

## 2. Vercel project setup

### 2.1 Project creation

The Vercel project is created once, by the orchestrator or the first release-engineering agent, and never recreated. Steps:

1. **Connect the GitHub repo.** In Vercel dashboard → "Add New Project" → select the `buddysaradhi` GitHub repository. Authorise Vercel to read the repo.
2. **Configure the project:**
   - **Framework Preset:** `Next.js`
   - **Root Directory:** `/` (the monorepo root; the Next.js app lives in `apps/web/` and is selected via the `buildCommand` and `outputDirectory` — see below)
   - **Build Command:** `bun run build` (the workspace-aware build script; see `package.json` in `apps/web/`)
   - **Output Directory:** `.next` (Vercel auto-detects this for Next.js, but explicit is safer)
   - **Install Command:** `bun install` (Bun 1.3+, matching `bun-types` in `apps/web/devDependencies`)
   - **Node.js Version:** `20.x` (set via Project Settings → General → "Node.js Version"; pinned, not "latest")
   - **Install Bun:** enabled (Project Settings → General → "Install Bun")
3. **Connect the team.** The project lives under the `buddysaradhi` Vercel team (Hobby tier for v1). Team members: the orchestrator GitHub account + any release-engineering agent accounts.
4. **Production branch:** `main`. Preview branches: every other branch. The promotion model is "merge PR → main auto-deploys → production live in ~90s" (see §6).

### 2.2 The build command contract

The `bun run build` script in `apps/web/package.json` runs `next build` plus a `cp` step to assemble the standalone server output (see `next.config.ts` — `output: "standalone"`). On Vercel, the standalone server output is **not used** — Vercel's Next.js builder handles the serverless function wrapping itself. The `cp` step is a no-op on Vercel but is required for the Docker / Tauri static-export builds (`desktop/05_Updater.md` references the same `apps/web` build). This is intentional: one `build` script, three platforms.

### 2.3 The `vercel.json` minimal contract

The `vercel.json` at the monorepo root (governed by `web/05_Deployment_Vercel.md`, not this file) must declare at minimum:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "bun run build",
  "outputDirectory": ".next",
  "installCommand": "bun install",
  "regions": ["bom1"]
}
```

The `regions` field is set to `bom1` (Mumbai) because Buddysaradhi's v1 audience is Indian tutors (`00_Vision.md` §4.1 — Riya in Nagpur, Kabir in Indore). Mumbai-region Edge functions give the lowest p50 latency for the primary user base. When international tutors arrive in v2.x, add `sin1` (Singapore) for SEA and `fra1` (Frankfurt) for EU — keep the list short, every region is a separate serverless function invocation cost.

---

## 3. Domains

### 3.1 The auto-assigned domain

Every Vercel project gets an auto-assigned `*.vercel.app` domain. For Buddysaradhi this is `buddysaradhi.vercel.app`. It is **permanent** — even if the custom domain is removed, this URL keeps working. It is the **canonical** URL for:

- The 15-min `webDevReview` cron's agent-browser QA target (when there is no PR preview to review).
- Internal status checks (Vercel's built-in uptime monitoring).
- The fallback if `buddysaradhi.app` ever has a DNS issue.

### 3.2 The custom domain `buddysaradhi.app`

Vercel offers a free `.vercel.app` domain, but the brand domain is `buddysaradhi.app`. Two paths:

1. **Vercel-domain purchase.** Vercel resells `.app` domains at cost (~$20/yr). Buy `buddysaradhi.app` directly through Vercel Project Settings → Domains → "Buy a domain". Auto-renews, auto-DNS, auto-SSL.
2. **External registrar + DNS.** If `buddysaradhi.app` is already owned (Namecheap, Cloudflare Registrar, etc.), point the apex `A` record to Vercel's anycast IP `76.76.21.21` and the `www` CNAME to `cname.vercel-dns.com`. Add the domain in Vercel Project Settings → Domains → "Add". Vercel issues a Let's Encrypt cert automatically within ~60s.

**Recommendation:** path 1 (Vercel-domain purchase) for v1. One less vendor, automatic DNS validation, no `CNAME`-flattening games.

### 3.3 The `www` redirect

`www.buddysaradhi.app` is configured as a **redirect** to `buddysaradhi.app` (not an alias). Vercel Project Settings → Domains → add `www.buddysaradhi.app` → set "Redirect to `buddysaradhi.app` (Permanent 308)". This is the SEO-friendly default — the apex domain is canonical.

### 3.4 Preview deployment domains

Every PR gets a unique preview URL: `buddysaradhi-pr-123.vercel.app`. These are:

- **Public but unguessable.** The PR number is in the URL, but the URL is not indexed. Set `X-Robots-Tag: noindex` via `vercel.json` headers (owned by `web/05_Deployment_Vercel.md`).
- **Auto-deleted 30 days after the PR closes.** Configurable in Project Settings → Domains → "Preview Deployment Expiration".
- **Used by the 15-min `webDevReview` cron.** The cron lists open PRs via the GitHub API, picks the most recently updated, and runs agent-browser smoke against `buddysaradhi-pr-<n>.vercel.app`. The cron's history is in `worklog.md` (CRON-R1..R5 entries).

### 3.5 The status page subdomain

`status.buddysaradhi.app` is reserved. Two options:

1. **Vercel's built-in status page.** Vercel does not offer a customer-facing status page directly, but the team owner can see status at `vercel.com/dashboard/team/buddysaradhi/status`. This is **internal only** — not a public-facing status page.
2. **Atlassian Statuspage (free tier).** Recommended. `status.buddysaradhi.app` is a CNAME to `hosted.statuspage.io`. The free tier supports unlimited subscribers, manual + automated incidents, and component-level status. Wire Vercel webhook → Statuspage incident on deploy failure. See §11.

---

## 4. Environment variables matrix

The Vercel project's environment variables are the **single most sensitive** configuration surface. A mis-scoped secret (e.g., `SUPABASE_SERVICE_ROLE_KEY` exposed to the browser) is a P0 security incident per `10_Security.md` §2.2.

### 4.1 The four environments

Vercel supports four environment scopes per variable:

| Scope | When it is available | Who can see the value |
|---|---|---|
| **Production** | `main` branch deployments | Team members with project access |
| **Preview** | PR preview deployments | Team members with project access |
| **Development** | `vercel dev` local | The developer running `vercel dev` |
| **Encrypted** | All of the above, encrypted at rest with a Vercel-managed key | Team members + Vercel infra |

For Buddysaradhi, every variable is set in **all three of Production/Preview/Development** unless explicitly noted. The values differ per environment (e.g., `SUPABASE_URL` points to a staging Supabase project in Preview/Development and the prod project in Production).

### 4.2 The full matrix

| Variable | Scope | Exposed to browser? | Purpose | Rotated how often | If leaked, do this |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | All | ✅ yes (intended) | The canonical base URL for absolute links + OAuth redirects (`AGENTS.md` FM-06). Production: `https://buddysaradhi.app`. Preview: `https://buddysaradhi-pr-<n>.vercel.app`. Development: `http://localhost:3000`. | On domain change. | Non-sensitive. |
| `NEXT_PUBLIC_SUPABASE_URL` | All | ✅ yes (intended) | Supabase project URL. Used by the browser-side Supabase client for auth. | On Supabase project migration. | Non-sensitive (it is a URL). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All | ✅ yes (intended) | Supabase anon key — designed to be public, scoped by Row-Level-Security. | Quarterly or on Supabase incident. | Non-sensitive by design; rotate as routine hygiene. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Production + Preview only** (NEVER Development, NEVER in client bundle) | ❌ **never** | Server-only Supabase key, bypasses RLS. Lives only in `/app/api/*` routes and Edge Functions. | Quarterly. | **P0 incident.** Rotate in Supabase dashboard immediately, audit access logs, notify security reviewer. |
| `TURSO_API_TOKEN` | Production + Preview only | ❌ never | Turso platform API token — used by the `provision-db` Edge Function to create per-user DBs (`10_Security.md` §2.1). | Quarterly. | P0. Rotate via Turso dashboard, audit DB creation logs. |
| `TURSO_ORG` | All | ✅ yes (it is an org name, not a secret) | Turso org slug used in DB naming: `buddysaradhi-{user_uuid}` lives under this org. | On org rename. | Non-sensitive. |
| `BLOB_READ_WRITE_TOKEN` | Production + Preview only | ❌ never | Vercel Blob token — used by the upload workflow in `02_Vercel_Blob_Build_Storage.md` and by the `/app/api/releases/*` routes that serve the download hub. | Quarterly. | P0. Rotate via Vercel dashboard, audit Blob access logs. |
| `ENCRYPTION_KEY` | Production + Preview only | ❌ never | The server-side AES-256-GCM key used for non-passphrase-derived encryption (e.g., short-lived signed URLs). **Not** the user's backup key — that is Argon2id-derived per `10_Security.md` §15. | Quarterly (rotate + re-encrypt affected ciphertexts; document the rotation in `audit_log`). | P0. Rotate, audit, re-encrypt, notify. |
| `NEXT_PUBLIC_POSTHOG_KEY` | **NOT SET in v1** | n/a | Placeholder for a privacy-respecting analytics SDK if/when ratified. v1 ships **no telemetry** (`10_Security.md` §17, TELE-1). | n/a | n/a |
| `SENTRY_DSN` | **NOT SET in v1** | n/a | Placeholder for opt-in crash reporting in v2. v1 has no Sentry. | n/a | n/a |

### 4.3 The "never expose" lint gate

The CI lint `no-service-role-in-client.test.ts` (`10_Security.md` §2.2) fails the build if any variable prefixed with the server-only marker (no `NEXT_PUBLIC_` prefix) appears in a client-bound bundle. This is enforced by:

1. ESLint `no-restricted-syntax` blocking any `process.env.SUPABASE_SERVICE_ROLE_KEY` access outside `apps/web/server/**` and `/app/api/**`.
2. A Next.js build-time check that scans the client bundle for the literal service-role key string.
3. A code-review gate on any PR that adds a new env var (see `05_CI_CD_GitHub_Actions.md` §7 — Stop-and-Ask triggers).

### 4.4 The `.env.example` discipline

The `.env.example` file at the monorepo root (and a per-app one in `apps/web/`) documents every variable **name** with a placeholder value and a comment explaining scope. The actual `.env.local` files are git-ignored. The discipline (`AGENTS.md` §9.3): if you accidentally commit a secret, rotate it — do not just delete the line.

---

## 5. Preview deployments

### 5.1 What they are

Every PR opened against `main` triggers a Vercel preview deployment. The deployment gets a unique URL: `buddysaradhi-pr-<number>-<commit-sha>.vercel.app` (Vercel also assigns a stable per-PR alias `buddysaradhi-pr-<number>.vercel.app` that points to the latest commit's deployment).

### 5.2 How they are used

1. **The PR author** manually opens the preview URL in their browser to verify the change renders.
2. **The 15-min `webDevReview` cron** (see `worklog.md` CRON-R1..R5) pulls the list of open PRs from the GitHub API, picks the most recently updated, and runs agent-browser smoke against the preview URL. The cron's QA report is appended to `worklog.md` and posted as a PR comment.
3. **The reviewer** opens the preview URL alongside the diff to verify the visual + interaction matches the spec.
4. **The release-engineering agent** opens the preview URL to verify a fix during a hotfix cycle, without needing to deploy to production.

### 5.3 Preview env-var scoping

Preview deployments use the **Preview** scope of every env var. This means:

- `NEXT_PUBLIC_APP_URL` is `https://buddysaradhi-pr-<n>.vercel.app` (Vercel injects this automatically via the `VERCEL_URL` env var — see `web/05_Deployment_Vercel.md` for the runtime resolution code).
- `NEXT_PUBLIC_SUPABASE_URL` points to the **staging** Supabase project (a separate project, `buddysaradhi-staging`, with the same schema but scrubbed test data).
- `SUPABASE_SERVICE_ROLE_KEY` is the **staging** project's service-role key (rotated independently of production).

This means a PR can be QA'd end-to-end (auth, provisioning, ledger writes) against staging infrastructure, with **zero risk** to production data.

### 5.4 Preview deployment expiration

Preview deployments auto-expire 30 days after the PR closes (Project Settings → Domains → "Preview Deployment Expiration"). This prevents the Blob storage of stale preview builds from accumulating. The 30-day window is generous: hotfix branches that take longer than 30 days are a process smell, not a deployment concern.

---

## 6. Production deployments

### 6.1 The promotion model

Vercel's promotion model is **merge = deploy**. There is no separate "promote to production" button. When a PR merges into `main`:

1. Vercel detects the push via the GitHub integration.
2. Vercel runs `bun install` → `bun run build` on a Vercel-managed builder.
3. Vercel atomically swaps the production alias `buddysaradhi.app` to point at the new deployment.
4. The old deployment remains accessible at its unique `*.vercel.app` URL for instant rollback (see §7).

The whole flow takes ~90 seconds from merge to "production is live." This is the fastest deploy model of any platform — Vercel's incremental build cache + Edge network make it so.

### 6.2 The "instant rollback" lever

In Vercel Project Settings → Deployments, every production deployment has a "..." menu with "Instant Rollback." Clicking it re-points the production alias to the previous deployment. The rollback is **atomic** — there is no downtime window. Users with the page open see the next navigation land on the previous version; users with a stale JS chunk get a `chunk-load-error` and reload to the rolled-back version.

This is the **primary rollback mechanism for the web surface** (see `04_Release_Pipeline.md` §6.1). It is the fastest, safest rollback of any platform — no CI re-run, no manifest edit, no store review.

### 6.3 The promotion contract

A merge to `main` is a **release event** for the web surface. The CI gate (`AGENTS.md` §7.4) ensures:

1. `bun run lint` passes (0 errors, 0 warnings — including `no-indigo-accent`, `no-float-money`, `no-empty-catch`, `no-color-only-status`).
2. `bun run typecheck` passes (`tsc --noEmit` across `apps/web`, `packages/*`).
3. `bun run test:unit` passes (≥70% line coverage on `packages/core` and `packages/shared`).
4. `bun run test:integration` passes (in-memory SQLite, every flow in `AGENTS.md` §7.2).
5. `bun run test:a11y` passes (`axe-core` on every screen).

Only when all five pass does the merge button unblock. Vercel then takes the merge and deploys. There is no "manual approve to deploy" step in v1 — the CI gate IS the approval.

> **Note for v2.** When the team grows beyond 2 people, consider enabling Vercel's "Promote to Production" promotion gate (Project Settings → Deployment Protection → "Promotion"). This adds an explicit "Promote" click between build success and production-live. For v1's solo-or-two-person team, the merge-equals-deploy model is correct.

---

## 7. Rollback (web surface, expanded)

The web-surface rollback is **Vercel Instant Rollback** (§6.2). It is the only rollback that does not require a code change, a CI re-run, or a store review. The procedure:

1. In Vercel dashboard → Buddysaradhi project → Deployments.
2. Find the most recent **stable** deployment (the one before the bad merge).
3. Click "..." → "Instant Rollback".
4. Confirm. Vercel re-points `buddysaradhi.app` to that deployment atomically.
5. Verify in agent-browser: open `buddysaradhi.app`, confirm the previous version is live.
6. Append a `---`-delimited entry to `worklog.md` noting the rollback, the reason, the deployment URLs (before and after), and the next step (hotfix or revert PR).

If the rollback itself is wrong (rare), Vercel allows re-rolling-forward to the deployment that was just rolled back from. There is no "double-rollback" danger — every deployment is preserved with its unique URL.

---

## 8. Free-tier limits and upgrade triggers

### 8.1 The Hobby plan limits (v1)

Vercel's Hobby plan (free) provides:

| Resource | Hobby limit | Buddysaradhi v1 expected usage | Headroom |
|---|---|---|---|
| Bandwidth | 100 GB / month | ~10 GB / month (500 tutors × 20 MB each per month of Next.js + Edge assets) | 10× |
| Serverless Function Execution | 1000 GB-h / month | ~5 GB-h / month (light API usage; most reads are cached at Edge) | 200× |
| Edge Function Execution | 100 GB-h / month | ~1 GB-h / month (auth middleware only) | 100× |
| Build Execution | 6000 min / month | ~200 min / month (one build per PR + main push) | 30× |
| Blob Storage | 1 GB | ~150 MB (10 versions × 3 platforms × ~5 MB each — see `02_Vercel_Blob_Build_Storage.md` §7) | 6× |
| Blob Bandwidth (egress) | 10 GB / month | ~6 GB / month (500 downloads × 12 MB) | 1.6× |
| Web Analytics | Free, unlimited page views | n/a | n/a |
| Speed Insights | Free, unlimited | n/a | n/a |
| Team members | 1 (Hobby is solo-only) | n/a — see §8.3 | — |

### 8.2 The 80% alert rule

For every resource above, set a Vercel usage alert at 80% of the limit. Vercel Project Settings → Usage → "Usage Alerts" → add an alert for "Bandwidth" at 80 GB, "Serverless Execution" at 800 GB-h, "Blob Storage" at 800 MB, "Blob Bandwidth" at 8 GB. The alert emails the team owner and posts to the `#buddysaradhi-alerts` Slack/Discord webhook.

The 80% rule (not 100%) gives a one-month buffer to upgrade before the resource hard-caps and breaks the pipeline.

### 8.3 The upgrade triggers

Upgrade to Vercel **Pro** ($20/month per team member) when **any** of the following is true:

1. **Bandwidth > 80 GB for 2 consecutive months.** Indicates the user base has grown past the solo/Hobby ceiling. Pro raises the limit to 1 TB. **This is the §1.6 T1 trigger** in `product/05_Pricing_and_Plans.md §1.6.2` — when it fires for 3 consecutive months, the "Free for everyone, for now" public messaging ends, the 60-day notice period begins, the public pricing page migrates from the single Free card to the 3-tier layout (Appendix A), and the Pro/Institute paid tiers launch.
2. **Team members > 1.** Hobby is solo-only. Adding a second release-engineering agent requires Pro.
3. **Blob Storage > 800 MB.** Indicates we are keeping too many old installers; either upgrade or prune the retention policy (see `02_Vercel_Blob_Build_Storage.md` §8 — retention is 10 versions per platform; reduce to 5 if Blob fills).
4. **Preview deployments > 1000/month.** Indicates the team is opening >30 PRs/day — process smell, but Pro raises the preview limit.
5. **A commercial launch.** Vercel Hobby's Terms of Service prohibit commercial use. The moment Buddysaradhi charges a tutor (i.e., the day the §1.6 trigger fires and the Pro tier goes live per `product/05_Pricing_and_Plans.md §1.6.4`), upgrade to Pro. This is **non-negotiable** — a Hobby-tier TOS violation can suspend the project. The `pricing-trigger-monitor` GitHub Action (BR-PRC-08) is the source of truth for when this trigger fires; the upgrade must happen within the 60-day notice window so paid-tier checkout routes work on launch day.

### 8.4 The Pro plan limits (post-upgrade)

Pro raises:

- Bandwidth: 100 GB → 1 TB (10×)
- Serverless Execution: 1000 → 6000 GB-h (6×)
- Edge Function Execution: 100 → 1000 GB-h (10×)
- Blob Storage: 1 GB → 100 GB (100×) — also enables Blob versioning, which is useful for the manifest atomic-update pattern in `02_Vercel_Blob_Build_Storage.md` §5
- Team members: 1 → unlimited (priced per seat)
- Adds: deployment protection (password-protected previews), SSO, DDoS mitigation Pro, longer build logs

Pro is the right tier for v2.x. Hobby is correct for v1.

---

## 9. Speed Insights + Web Analytics

### 9.1 Web Analytics

Vercel Web Analytics is enabled in Project Settings → Analytics → "Enabled". It is **privacy-respecting**:

- No cookies set.
- No cross-site tracking.
- Aggregate-only (page views, unique visitors, top pages, referrers, countries).
- No PII collected.
- Compliant with GDPR, CCPA, and PECR out of the box; for India, it also aligns with the DPDP Act 2023's aggregate-only, no-PII posture.

This is the **only** analytics tool that runs in Buddysaradhi v1. It respects `AGENTS.md` Rule 3 (no telemetry SDK) because:

- It is server-side aggregated (not a client SDK beacon per event).
- It does not collect PII.
- It does not set cookies.
- It is opt-out-able via the browser's Do Not Track header (Vercel respects DNT).

The **governance** for what is measured, how it is interpreted, and which page-view events count toward the conversion funnel lives in `product/09_SEO_and_Analytics.md` — that spec owns the keyword map, the JSON-LD schema, the sitemap, and the analytics-interpretation playbook. This file owns only the Vercel Project Settings toggle that turns Web Analytics on. When the two files diverge, `product/09_SEO_and_Analytics.md` wins on **what** to measure; this file wins on **how** the Vercel platform is configured to measure it.

> **Caveat.** If a future security review determines that even aggregate Vercel Web Analytics violates the spirit of TELE-1 (`10_Security.md` §17), it must be disabled and replaced with a self-hosted, opt-in, PII-stripped counter. Until that review, Web Analytics stays on.

### 9.2 Speed Insights

Vercel Speed Insights is enabled in Project Settings → Speed Insights → "Enabled". It collects Core Web Vitals (LCP, FID, CLS, INP, TTFB) from real users, aggregated by country and route. It is the same privacy posture as Web Analytics — no cookies, no PII, aggregate-only.

Speed Insights is the **operational** signal for performance regressions. If a merge to `main` raises the median LCP by > 200 ms, Speed Insights shows it within 24 hours of real-user traffic. The release-engineering agent monitors Speed Insights for 1 hour after every production deploy (see `04_Release_Pipeline.md` §5 — release checklist item 11).

### 9.3 What we do NOT enable

- **Vercel Edge Config.** Not needed in v1 — no per-region config to ship.
- **Vercel Postgres.** Not used — Turso (libSQL) is the per-user DB (`11_Data_Model.md` §1).
- **Vercel KV / Redis.** Not used — no server-side cache in v1; the browser cache + Turso's embedded replica cover the read path.
- **Vercel Edge Functions for A/B testing.** Not used — no experiments in v1.

---

## 10. DDoS protection + Edge network

### 10.1 Vercel's built-in DDoS protection

Vercel's Edge network (powered by Cloudflare's backbone under the hood) absorbs volumetric DDoS attacks at the edge. The protection is:

- **Always-on.** No configuration needed.
- **Layer 3/4 (volumetric).** SYN floods, UDP floods, ICMP floods — absorbed at the edge.
- **Layer 7 (application).** Rate-limiting per IP + per route; bot detection; challenge pages for suspicious traffic.

For Buddysaradhi v1 (small attack surface, modest traffic), Vercel's built-in protection is sufficient. There is **no need** to put Cloudflare in front of Vercel — doing so would:

1. Break Vercel's Edge caching (Cloudflare would cache Vercel's responses, defeating Vercel's incremental static regeneration).
2. Add latency (an extra hop).
3. Double the cost (Cloudflare Pro is $20/mo on top of Vercel Pro).

If, in v2.x, a targeted L7 attack exceeds Vercel's rate limits, the response is to enable Vercel's "Advanced DDoS Protection" (Pro add-on) and add `vercel.json` route-specific rate limits — not to add Cloudflare.

### 10.2 The Edge network as the CDN

Vercel's Edge network has 100+ POPs globally. For Buddysaradhi:

- **Static assets** (`/_next/static/*`, `/public/*`) are cached at the Edge for 1 year (immutable, content-hashed).
- **HTML** is cached at the Edge for 0 seconds (always revalidated) — Next.js 16 App Router uses ISR / on-demand revalidation, so HTML is fresh.
- **API routes** (`/api/*`) are not Edge-cached; they hit the serverless function in the `bom1` region (Mumbai) for every request.

The Edge network is the **only** CDN Buddysaradhi uses. There is no CloudFront, Fastly, or Akamai in front. One CDN, one cache invalidation model, one bill.

---

## 11. Status page

### 11.1 The public status page

`status.buddysaradhi.app` is hosted on Atlassian Statuspage (free tier). It tracks four components:

| Component | What it represents |
|---|---|
| **Web App** | `buddysaradhi.app` uptime, measured by an external uptime monitor (UptimeRobot or BetterStack free tier, polling every 1 min). |
| **API** | `/api/*` uptime, measured by a `/api/health` endpoint returning `200 OK`. |
| **Desktop Update Server** | The Vercel Blob manifest URL — measured by a `HEAD` request to `manifests/desktop-stable.json`. |
| **Mobile OTA** | The EAS Update endpoint — measured by the EAS Update health check. |

Each component has four states mapped onto the **canonical bioluminescent palette** (AGENTS.md §3.3, Rule 5, AP-6 — no off-palette reds allowed): **Operational** (emerald `#00FF9D`, icon `✓`), **Degraded Performance** (amber `#FFB300`, icon `◐`), **Partial Outage** (flare `#FF5E00`, icon `▲`), **Major Outage** (flare `#FF5E00` at full opacity, icon `●` filled). Partial vs. Major is **never** communicated by colour alone — the icon + the label change too (WCAG §1.4.1, `13_UI_Guidelines.md` §10.6, AP-14 dual-signal rule). The status page color scheme must use the bioluminescent palette per `AGENTS.md` Rule 5 — no green/yellow/red defaults that would conflict with brand.

### 11.2 The incident workflow

When a Vercel deploy fails, the workflow is:

1. Vercel's deploy-failure webhook fires → posts to the Statuspage webhook → creates an incident with status "Investigating" on the Web App component.
2. The release-engineering agent acknowledges in the Statuspage UI → status becomes "Identified".
3. The agent rolls back via Vercel Instant Rollback (§6.2) → status becomes "Monitoring".
4. After 30 min of clean traffic, the agent resolves → status becomes "Operational".
5. A post-mortem is appended to `worklog.md` within 24 hours.

For Blob storage outages (rare; Vercel Blob has a strong SLA), the same workflow applies to the Desktop Update Server component.

### 11.3 Subscriber notifications

Statuspage subscribers (anyone who signs up at `status.buddysaradhi.app`) get an email on incident open, incident update, and incident resolve. The free tier supports unlimited subscribers. Twitter/X integration is also wired — incident opens auto-tweet from the `@buddysaradhi` account.

---

## 12. The "Vercel account setup" first-time checklist

For the first release-engineering agent to set up the Vercel account from scratch:

1. **Create the Vercel team** `buddysaradhi` (Hobby tier; upgrade to Pro per §8.3).
2. **Connect the GitHub repo** → create the project per §2.1.
3. **Set the framework preset, build command, output dir, install command** per §2.1.
4. **Pin Node.js 20.x and Bun 1.3+** in Project Settings → General.
5. **Set the region to `bom1`** in `vercel.json` (per §2.3).
6. **Add the env vars** per §4.2, in all three scopes (Production / Preview / Development).
7. **Buy / connect `buddysaradhi.app`** per §3.2.
8. **Configure `www.buddysaradhi.app` redirect** per §3.3.
9. **Enable Web Analytics + Speed Insights** per §9.
10. **Set the 80% usage alerts** per §8.2.
11. **Set up `status.buddysaradhi.app`** on Atlassian Statuspage per §11.
12. **Trigger the first production deploy** by merging a no-op PR to `main` (e.g., `chore(deploy): verify vercel pipeline`). Verify the deployment is live in <90s.
13. **Run the agent-browser smoke** against `buddysaradhi.app` — render, primary interaction, sticky footer (per `AGENTS.md` §9.1).
14. **Append a `---`-delimited entry to `worklog.md`** documenting the first deploy, the URL, and any snags.

Once these 14 steps are complete, the Vercel account is "live as a specification." Every subsequent release relies on this foundation.

---

## 13. What this file does NOT cover (and where to look)

| Topic | Where it lives |
|---|---|
| `vercel.json` rewrites, headers, redirects | `web/05_Deployment_Vercel.md` |
| Next.js build configuration (`next.config.ts`) | `apps/web/next.config.ts` (current sandbox) + `web/05_Deployment_Vercel.md` |
| Vercel Blob bucket layout + manifest schema | `02_Vercel_Blob_Build_Storage.md` (this directory) |
| EAS mobile builds + OTA channels | `03_EAS_Build_and_Update_Channels.md` (this directory) |
| GitHub Actions workflows | `05_CI_CD_GitHub_Actions.md` (this directory) |
| Release checklist + rollback playbook | `04_Release_Pipeline.md` (this directory) |
| Turso per-user DB provisioning | `10_Security.md` §2.1 |
| Supabase auth + service-role isolation | `10_Security.md` §2.2 |
| SEO + analytics configuration (keyword map, sitemap, robots, canonicals, JSON-LD, Vercel Web Analytics governance) | `product/09_SEO_and_Analytics.md` (the commercial SEO + analytics spec — the canonical source of truth for what gets measured on the Vercel-hosted site) |
| Pricing page (`/pricing` route, ₹0 / ₹299 / ₹999 tiers, annual vs. monthly toggle, GST invoice CTA) | `product/05_Pricing_and_Plans.md` (the commercial pricing-page spec that renders on the Vercel-hosted marketing surface) |
| Commercial landing page implementation (Hero, Features, Download Hub, Pricing, FAQ, CTA, Testimonials sections) | `web/07_Landing_Page.md` (the implementation contract; the marketing-content WHAT lives in `product/`) |
| The 15-min `webDevReview` cron | `worklog.md` CRON-R1..R5 entries + `AGENTS.md` §9.1 |

---

## 14. The contract this file makes

Every release-engineering agent working on the Vercel account agrees to:

1. **Never commit a server-only secret to the client bundle.** The lint gate catches it; the review gate re-checks it; the build scan triple-checks it. (Rule 9, `10_Security.md` §2.2.)
2. **Never disable a usage alert.** If an alert fires, upgrade or fix — do not silence the alarm.
3. **Never roll back without a worklog entry.** A rollback without a documented reason is an unaccountable mutation of production.
4. **Never promote a deploy that fails CI.** The CI gate is the promotion gate; bypassing it requires a §8 stop-and-ask.
5. **Never change the region from `bom1`** without a written rationale and a measurement of the new region's p50 latency for the v1 user base.
6. **Never add a third-party CDN** (Cloudflare, Fastly, Akamai) in front of Vercel. Vercel's Edge is the CDN.
7. **Never enable Sentry, PostHog, Mixpanel, or any analytics SDK** in v1. TELE-1 forbids it. v2's opt-in crash reporting requires a ratified amendment first.
8. **Always pin Node + Bun versions.** "Latest" is not a version; it is a future bug.
9. **Always document an env-var rotation in `worklog.md`** with the variable name, the date, and the audit-log reference.
10. **Always run the agent-browser smoke** against a new production deploy before declaring the deploy "live."

These ten rules are the contract. Violating any of them is a §8 stop-and-ask.

---

## 15. ASCII Art Mockup Suite (§20 Compliance)

> Every mockup below follows `13_UI_Guidelines.md §20` (ASCII Art Conventions): fenced code block, §20.2 character set, `↑ ←` annotations, accent colours named (emerald / cyan / amber / flare / violet — never hexed in the notes per §20.3 rule 6), cross-references canonical (`§*`, `BR-*`, `EC-*`, `AP-*`, `P*`, `TELE-1`, `BACKUP-1`, `LEDGER-1`). Box widths honour §20.3 rule 2 (80–120 for architecture / pipeline diagrams). The three mockups below visualise the *operational architecture* this file owns — the request path (Edge → Lambda → Turso), the bom1 primary region map, and the 15-min `webDevReview` cron schedule. A fourth mini-mockup annotates the only true UI surface this file references (the Vercel dashboard deployment card) so the glass / neumorphic contract is visible where it applies.

### 15.1 Design System Reference (§5.5 + §6.6 single rule)

This file is the **account / project view**, not a screen spec. Most of its artefacts are architecture diagrams (request path, region map, cron schedule) — these are concept diagrams per §20.4, governed by §20.1 + §20.6, and do **not** carry glass-tier or neumo-recipe annotations because they are not rendered UI surfaces. The single §6.6 rule — *glass for surfaces, neumo for controls, never invert* — applies to the one live UI surface this file references: the **Vercel dashboard deployment card** (`vercel.com/dashboard/buddysaradhi`), where the agent reads deployment status + clicks "Instant Rollback". That card is glass (it is a content surface the agent reads); the "Instant Rollback" button is neumorphic-raised (it is a control the agent clicks). The Statuspage (`status.buddysaradhi.app`) is third-party-hosted (Atlassian) and inherits Atlassian's component chrome — the only design-system contract it carries is the **bioluminescent palette** for its four state colours (§11.1, fixed in this task: emerald / amber / flare / flare-with-icon).

| Artefact (this file) | Type | Glass / neumo tier (if live UI) |
|---|---|---|
| §15.2 Vercel project architecture (request path) | Concept diagram | (none — architecture) |
| §15.3 bom1 primary region map | Concept diagram | (none — geography) |
| §15.4 15-min `webDevReview` cron schedule | Concept diagram | (none — temporal) |
| §15.5 Vercel dashboard deployment card | Live UI surface (third-party) | `.glass` card + `.neumo-raised` "Instant Rollback" button (per §6.6 single rule — surface = glass, control = neumo) |

### 15.2 Vercel Project Architecture (Request Path)

The end-to-end path a tutor's request takes from browser to Turso per-user DB. The `bom1` Mumbai region is the primary; the Edge network is the global CDN layer; the Supabase `provision-db` Edge Function creates per-user Turso DBs on first sign-in (`10_Security.md` §2.1, BR-ONBOARD-1 — the 90s onboarding budget).

```
  VERCEL PROJECT ARCHITECTURE  (§2 + §4 + §9 + §10, request path)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │   TUTOR'S BROWSER  (Nagpur, BSNL/Jio 4G)                                     │
  │   ┌────────────────────────┐                                                 │
  │   │  Next.js 16 App Router  │ ← cosmic canvas, glass shell, neumo controls   │
  │   │  (apps/web, standalone) │   (§5.5 + §6.6 — surface = glass, control =    │
  │   │                         │    neumo, never invert)                        │
  │   └────────────┬───────────┘                                                 │
  │                │ HTTPS (TLS 1.3, HSTS, auto-renewed Let's Encrypt)            │
  │                ▼                                                              │
  │   ┌────────────────────────────────────────────────────────────────────┐    │
  │   │  VERCEL EDGE NETWORK  (100+ POPs globally, §10.2)                   │    │
  │   │  ┌──────────────────────────────────────────────────────────────┐  │    │
  │   │  │  Static assets  (/_next/static/*, /public/*)                  │  │    │
  │   │  │  ↑ cached 1 year, immutable, content-hashed (emerald ✓)       │  │    │
  │   │  ├──────────────────────────────────────────────────────────────┤  │    │
  │   │  │  HTML  (ISR / on-demand revalidation, 0s edge TTL)            │  │    │
  │   │  │  ↑ always revalidated, fresh per Next.js 16 App Router (cyan) │  │    │
  │   │  ├──────────────────────────────────────────────────────────────┤  │    │
  │   │  │  Auth middleware  (Edge Function, /_middleware.ts)            │  │    │
  │   │  │  ↑ Supabase JWT check, redirect to /login if unauth (cyan)    │  │    │
  │   │  └──────────────────────────────────────────────────────────────┘  │    │
  │   └────────────────┬───────────────────────────────────────────────────┘    │
  │                    │  (cache miss → /api/* → serverless function)             │
  │                    ▼                                                           │
  │   ┌────────────────────────────────────────────────────────────────────┐    │
  │   │  VERCEL SERVERLESS  (region: bom1, Mumbai, §2.3)                    │    │
  │   │  ┌──────────────────────────────────────────────────────────────┐  │    │
  │   │  │  /app/api/releases/latest  →  reads Vercel Blob manifest      │  │    │
  │   │  │  /app/api/changelog/:v      →  streams Blob changelog        │  │    │
  │   │  │  /app/api/admin/blob        →  admin (Supabase admin-role)    │  │    │
  │   │  │  /app/api/health            →  200 OK (Statuspage probe)      │  │    │
  │   │  └──────────────────────────────────────────────────────────────┘  │    │
  │   │  ↑ secrets scope: Production + Preview only (§4.2)                  │    │
  │   │  ↑ SUPABASE_SERVICE_ROLE_KEY never in client bundle (lint gate)     │    │
  │   └────────────────┬───────────────────────────────────────────────────┘    │
  │                    │  (per-user DB calls — libSQL HTTP client)                │
  │                    ▼                                                           │
  │   ┌────────────────────────────────────────────────────────────────────┐    │
  │   │  TURSO  (libSQL, per-user DB: buddysaradhi-{user_uuid})                  │    │
  │   │  ┌──────────────────────────────────────────────────────────────┐  │    │
  │   │  │  schema_version, ledger_entries (append-only, BR-LED-01),     │  │    │
  │   │  │  sync_outbox (INSERT-only, BR-SYN-02 — local-only stub v1)    │  │    │
  │   │  └──────────────────────────────────────────────────────────────┘  │    │
  │   │  ↑ provisioned by Supabase provision-db Edge Function (≤15s)        │    │
  │   │  ↑ BR-ONBOARD-1 (90s onboarding budget — P15 honest empty state)   │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │                                                                              │
  │  PARALLEL SERVICES  (separate from request path, but on the same Vercel      │
  │  account + billing surface):                                                 │
  │   • Vercel Blob (buddysaradhi-releases/, installer registry, 02_Vercel_Blob)      │
  │   • Vercel Web Analytics (aggregate-only, no cookies, TELE-1 compliant)       │
  │   • Vercel Speed Insights (Core Web Vitals, §9.2)                            │
  │   • Atlassian Statuspage (status.buddysaradhi.app, §11)                           │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ The diagram is a concept diagram (architecture), not a rendered UI
     surface — no glass-tier annotation per §6.6 single rule.
   ↑ Accent colours: emerald = cached / verified (Edge hits), cyan = fresh /
     in-progress (HTML revalidation, auth middleware), violet = parallel
     services (the v2 Sentry placeholder, the opt-in tier).
   ↑ Cross-refs: §2.3 (bom1 region), §4.2 (env-var matrix), §9 (analytics),
     §10 (Edge network), 10_Security.md §2.1 (provision-db), BR-ONBOARD-1
     (90s budget), BR-SYN-02 (sync_outbox INSERT-only), BR-LED-01 (ledger
     immutability).
```

### 15.3 `bom1` Primary Region Map

Why Mumbai is the primary region for v1, and what gets added when international tutors arrive in v2.x. The region choice is the single biggest p50 latency lever — a wrong region is a 200ms regression (stop-and-ask trigger #6 in `AGENTS.md` §6).

```
  BOM1 PRIMARY REGION MAP  (§2.3, why Mumbai for v1)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │   ┌─ v1 (now) ────────────────────────────────────────────────────────┐    │
  │   │                                                                    │    │
  │   │     ● bom1 (Mumbai)  ← PRIMARY (emerald, p50 ~30ms for IN users)   │    │
  │   │       │                                                            │    │
  │   │       │  serves: Riya (Nagpur), Kabir (Indore), + v1 IN tutors     │    │
  │   │       │  rule: 00_Vision.md §4.1 (India-first audience)            │    │
  │   │       │  cost: 1× serverless invocation (cheapest)                  │    │
  │   │       │                                                            │    │
  │   │       └─ NEVER change without stop-and-ask (AGENTS §6 trigger #6)   │    │
  │   │                                                                    │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │                                                                              │
  │   ┌─ v2.x (when international tutors arrive) ─────────────────────────┐    │
  │   │                                                                    │    │
  │   │     ● bom1 (Mumbai)        ← still primary for IN                  │    │
  │   │     ● sin1 (Singapore)     ← add for SEA (amber, planned, v2.x)   │    │
  │   │     ● fra1 (Frankfurt)     ← add for EU  (amber, planned, v2.x)   │    │
  │   │                                                                    │    │
  │   │     rule: keep the region list SHORT — every region is a separate │    │
  │   │     serverless function invocation cost (§2.3 caveat)              │    │
  │   │                                                                    │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │                                                                              │
  │   ┌─ Fallback (theoretical, never used in v1) ────────────────────────┐    │
  │   │                                                                    │    │
  │   │     ✕ iad1 (Washington)   ← NOT added (US-east latency too high   │    │
  │   │                              for IN tutors; flare — rejected)      │    │
  │   │     ✕ sfo1 (San Francisco) ← NOT added (same reason; flare)       │    │
  │   │                                                                    │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ The map is a concept diagram (geography), not a rendered UI surface.
   ↑ Accent colours: emerald = primary (live), amber = planned (v2.x),
     flare = rejected (never configured).
   ↑ Cross-refs: §2.3 (vercel.json regions field), 00_Vision.md §4.1
     (India-first audience), AGENTS.md §6 trigger #6 (region change =
     stop-and-ask), 15_Future_Roadmap.md v2.x (international expansion).
```

### 15.4 The 15-min `webDevReview` Cron Schedule

The temporal choreography of the cron that keeps the PR-preview feedback loop tight. Every 15 minutes, the cron picks the most-recently-updated open PR, runs agent-browser smoke against its Vercel preview, and posts the QA report as a PR comment + `worklog.md` entry. The cron's history lives in `worklog.md` (CRON-R1..R5 entries).

```
  15-MIN webDevReview CRON SCHEDULE  (§5.2 + AGENTS.md §9.1, PR-preview QA loop)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │   TIMELINE (every 15 min, 24×7, runs on Vercel's cron runner):              │
  │                                                                              │
  │   :00 ─┬─► cron wakes, GETs GitHub API: /repos/buddysaradhi/pulls?state=open     │
  │        │   sorts by updated_at DESC, picks [0]                               │
  │        │                                                                     │
  │   :01 ─┼─► if no open PRs → fall back to buddysaradhi.vercel.app (the permanent   │
  │        │   auto-assigned domain, §3.1) for a "is production up?" smoke       │
  │        │                                                                     │
  │   :02 ─┼─► if open PR exists → target = buddysaradhi-pr-<n>.vercel.app            │
  │        │   (the stable per-PR alias, §3.4)                                   │
  │        │                                                                     │
  │   :03 ─┼─► agent-browser navigate <target>                                   │
  │        │   screenshot /tmp/pr-<n>.png                                        │
  │        │   title contains "Buddysaradhi"?  →  (emerald ✓ pass)                    │
  │        │   console-errors empty?      →  (emerald ✓ pass)                    │
  │        │   sticky footer present?     →  (emerald ✓ pass)                    │
  │        │                                                                     │
  │   :08 ─┼─► if any check fails: post PR comment with screenshot + failing     │
  │        │   assertion (amber — needs author's attention)                      │
  │        │                                                                     │
  │   :09 ─┼─► append `---`-delimited entry to worklog.md:                      │
  │        │   Task ID: CRON-R<n>                                                │
  │        │   Agent: webDevReview-cron                                          │
  │        │   Target: <PR URL or production URL>                                │
  │        │   Result: PASS / FAIL <assertion>                                   │
  │        │                                                                     │
  │   :10 ─┘  cron sleeps until :15                                              │
  │                                                                              │
  │   :15 ──► (repeat)                                                           │
  │   :30 ──► (repeat)                                                           │
  │   :45 ──► (repeat)                                                           │
  │                                                                              │
  │   ESCALATION (only on 3 consecutive fails = 45 min of red):                  │
  │   ┌────────────────────────────────────────────────────────────────────┐    │
  │   │  POST /webhooks/discord  →  #buddysaradhi-alerts                         │    │
  │   │  @oncall release-eng agent  (flare — page immediately)              │    │
  │   └────────────────────────────────────────────────────────────────────┘    │
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ The schedule is a concept diagram (temporal), not a rendered UI surface.
   ↑ Accent colours: emerald = pass / verified, amber = single fail (needs
     attention but not a page), flare = 3-consecutive-fail escalation (page).
   ↑ Cross-refs: §3.1 (buddysaradhi.vercel.app fallback), §3.4 (per-PR preview
     alias), §5.2 (how previews are used), AGENTS.md §9.1 (agent operating
     loop), worklog.md CRON-R1..R5 entries (the cron's history), Rule 9
     (no silent failures — the escalation is the contract).
```

### 15.5 Vercel Dashboard Deployment Card (the one live UI surface this file references)

The only screen a release-engineering agent opens from this file's contract is the Vercel dashboard's Deployments tab — to read the latest deployment status and, when needed, click "Instant Rollback" (§6.2). The dashboard is third-party chrome (Vercel's own UI), but the contract this file makes about how the agent reads it (the card is glass-equivalent content; the rollback button is a control) follows §6.6's single rule.

```
  VERCEL DASHBOARD — DEPLOYMENTS TAB  (§6 + §7, the rollback lever)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  vercel.com/dashboard/buddysaradhi/Buddysaradhi/deployments                            │
  │                                                                              │
  │  ┌─ Deployment card (Vercel chrome, glass-equivalent content surface) ───┐  │
  │  │  ● Ready  ·  main · abc1234  ·  2 min ago  ·  buddysaradhi.app             │  │
  │  │     ▲ status dot (emerald = Ready, amber = Building, flare = Error)   │  │
  │  │  ┌──────────────────────────────────────────────────────────────────┐ │  │
  │  │  │  Build logs  ·  Runtime logs  ·  Analytics  ·  Speed Insights     │ │  │
  │  │  └──────────────────────────────────────────────────────────────────┘ │  │
  │  │  [ Visit ]   [ ... → Instant Rollback ]   ← control (.neumo-raised)   │  │
  │  └──────────────────────────────────────────────────────────────────────┘  │
  │     ↑ content surface = glass-equivalent (§5.5 coverage map: "card" tier)   │
  │     ↑ "Instant Rollback" button = control = .neumo-raised per §6.6          │
  │     ↑ on :active → .neumo-pressed (§6.3) + 1px translate                    │
  │     ↑ WCAG §1.4.1 (Use of Color): the status dot is NEVER the only signal   │
  │       — the text label "Ready / Building / Error" accompanies the dot.      │
  │                                                                              │
  │  ROLLBACK FLOW (§7, the procedure this card enables):                       │
  │   1. Agent finds the most recent READY deployment BEFORE the bad merge.     │
  │   2. Clicks "..." → "Instant Rollback" (the .neumo-raised control above).   │
  │   3. Confirms in the modal that opens (modal = glass-strong per §5.5,       │
  │      backdrop = bg-black/60 + backdrop-blur-sm per §8.7).                   │
  │   4. Vercel re-points buddysaradhi.app atomically — <60s, no downtime.           │
  │   5. Agent verifies in agent-browser: buddysaradhi.app renders the prior version │
  │   6. Agent appends `---` worklog entry (the rollback audit trail, §7 step 6)│
  │                                                                              │
  └────────────────────────────────────────────────────────────────────────────┘
   ↑ This is a live UI surface — the §6.6 single rule applies: card =
     glass-equivalent (content), "Instant Rollback" = neumo-raised (control).
   ↑ Accent colours: emerald = Ready (live), amber = Building (in-progress),
     flare = Error (rollback triggered).
   ↑ Cross-refs: §6 (production deployments), §6.2 (instant rollback),
     §7 (rollback procedure, 6 steps), 13_UI_Guidelines.md §5.5 (card tier),
     §6.6 (control = neumo), §8.7 (modal = glass-strong), §10.6 (WCAG
     §1.4.1 Use of Color), BR-SEC-08 (audit_log — the worklog entry is the
     ops-side audit equivalent).
```

### 15.6 References (External Design Authorities)

The mockups and the operational contract in this file synthesise practices from the following public bodies of work. Cite them when a contributor challenges the region choice, the cron schedule, or the dashboard-card glass / neumo split.

- **Vercel docs** — *Edge Network, Functions, Cron Jobs, Web Analytics, Speed Insights*. The §15.2 architecture diagram follows Vercel's Edge-to-Origin request-path documentation; the §15.4 cron schedule follows Vercel's cron-jobs documentation.
- **Atlassian Statuspage** — *Component states, incident workflow, subscriber notifications*. The §15.1 design-system reference and the four-state mapping (Operational / Degraded / Partial / Major) follow Statuspage's component-state model, re-mapped onto the bioluminescent palette per AGENTS.md Rule 5.
- **Smashing Magazine** — *Design Systems With Sketches And Wireframes*. The §15.5 dashboard-card mockup follows Smashing's case for ASCII-over-pixels for spec-grade contracts (the dashboard is third-party chrome, but the contract about how the agent reads it is first-party).
- **CSS-Tricks** — *Cloud-region latency for India-first apps*. The §15.3 bom1 region map follows CSS-Tricks's cloud-region-latency primer (Mumbai p50 for IN users vs. US-east p50 penalty).
- **Nielsen Norman Group** — *WCAG §1.4.1 Use of Color*. The §15.5 dual-signal note (status dot + text label, never colour alone) follows NN/g's colour-only-signal research and `13_UI_Guidelines.md` §10.6.
- **Vercel Changelog** — *Instant Rollback feature*. The §15.5 rollback flow follows Vercel's Instant Rollback announcement (atomic alias re-point, <60s, no downtime).

---

*This file is the operational spec for the Vercel account that hosts Buddysaradhi's web surface. It is read by every release-engineering agent before they touch the Vercel dashboard. When this file and the Vercel dashboard disagree, this file wins — unless this file is wrong, in which case you amend this file first, then the dashboard, then the code, then the worklog. The order matters.*
