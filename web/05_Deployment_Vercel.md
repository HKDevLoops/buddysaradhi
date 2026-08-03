# 05 — Deployment (Vercel)

> The Vercel deployment contract for the Buddysaradhi web surface. `vercel.json`, environment variables, preview deploys, production domains, build settings, Edge Function deploy, free-tier alert thresholds, and the downtime + rollback playbook. Every knob in this file is the contract.

---

## 1. Why Vercel

Buddysaradhi web ships on **Vercel** because:

1. **Native Next.js 16 support.** App Router, RSC, Server Actions, Partial Prerendering, Edge Middleware — all first-class on Vercel. No `vercel-build` adapter shim.
2. **Free tier fits v1.** Hobby tier (100 GB bandwidth, 1000 GB-h serverless execution, 6000 build minutes) covers the first ~500 tutors at zero cost.
3. **Preview deploys per PR.** Every push gets a unique `*.vercel.app` URL — used for agent-browser QA before merge.
4. **Vercel Blob.** One-click bucket for hosting Desktop installers + Mobile APKs + manifests (see `06_Build_and_Release.md`).
5. **Vercel Speed Insights + Web Analytics.** Privacy-respecting, aggregate-only — compatible with the no-telemetry rule (top-level `AGENTS.md` Rule 3, AP-10).
6. **Edge network.** Static assets + PPR shells served from 18+ global PoPs; ~50 ms TTFB from India to `bom1`.
7. **The marketing surface fits the Edge model.** The commercial landing page at `/` (specified in `07_Landing_Page.md`) is statically prerendered with PPR and a single ISR-cached manifest fetch — Vercel's Edge cache serves the shell in under 50 ms from `bom1`, and the dynamic holes stream in via `<Suspense>` boundaries. The Lighthouse ≥95 target in `07_Landing_Page.md §10.5` depends on this Edge-cache-first delivery model.

The trade-off: vendor lock-in for hosting. The mitigation: `output: "standalone"` in `next.config.ts` produces a self-contained Node server we can run anywhere (DigitalOcean Droplet, fly.io, a Raspberry Pi in a coaching institute) — the migration path is documented and tested quarterly.

---

## 2. `vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "regions": ["bom1", "fra1"],
  "functions": {
    "src/app/api/provision/route.ts": { "maxDuration": 60 },
    "src/app/api/backup/create/route.ts": { "maxDuration": 60 },
    "src/app/api/backup/restore/route.ts": { "maxDuration": 120 },
    "src/app/api/reports/[type]/route.ts": { "maxDuration": 30 }
  },
  "crons": [
    {
      "path": "/api/cron/rotate-tokens",
      "schedule": "0 3 1 * *"
    },
    {
      "path": "/api/cron/alerts-check",
      "schedule": "*/15 * * * *"
    }
  ],
  "headers": [
    {
      "source": "/((?!api/).*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" }
      ]
    }
  ],
  "redirects": [
    { "source": "/app", "destination": "/dashboard", "permanent": true },
    { "source": "/home", "destination": "/dashboard", "permanent": true }
  ]
}
```

### 2.1 Regions — `bom1` primary, `fra1` fallback

- **`bom1` (Mumbai)** is the primary region. Most v1 tutors are in India; sub-50ms TTFB to Turso's `gcp-asia-southeast1` (Singapore) replica.
- **`fra1` (Frankfurt)** is the fallback for European tutors. Vercel automatically routes by latency.
- Cost: each region counts toward serverless execution time. Two regions roughly doubles compute cost; bandwidth is charged once.

### 2.2 Function `maxDuration`

Vercel's default is 10 s for serverless functions on Hobby. Buddysaradhi has four routes that need more:

| Route | `maxDuration` | Why |
|---|---|---|
| `/api/provision` | 60 s | Turso Platform API DB creation takes 5–15 s; bootstrap migrations another 5–20 s. |
| `/api/backup/create` | 60 s | Encrypting 5 MB of data with Argon2id KDF is CPU-bound. |
| `/api/backup/restore` | 120 s | Decrypt + parse + bulk INSERT. |
| `/api/reports/[type]` | 30 s | A 12-month student statement with 500 ledger entries can take 5–10 s to render as PDF. |

All other routes use the 10 s default. Going above 60 s requires Vercel Pro tier.

### 2.3 Crons

Two cron jobs:

- **`/api/cron/rotate-tokens`** — runs at 03:00 UTC on the 1st of each month. Iterates tutors whose scoped Turso JWT is within 30 days of expiry and rotates it via the Edge Function. Uses a `CRON_SECRET` header to authenticate.
- **`/api/cron/alerts-check`** — runs every 15 minutes. Checks Vercel-project usage (bandwidth, serverless GB-h, Blob storage) against the 80% threshold and posts to the internal status webhook (Slack/Telegram) if exceeded.

### 2.4 Headers + Redirects

Security headers (CSP is set in `next.config.ts` so it can include Next's nonces; the rest are duplicated here for static assets). Two legacy redirects (`/app` and `/home` → `/dashboard`) for old bookmarks.

---

## 3. Environment Variables

The complete env var catalogue. Never commit secrets; `.env.local` is git-ignored; `.env.example` documents the keys.

| Variable | Where | Purpose | Rotates |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel (all envs) | Supabase project URL. Public — used by `createBrowserClient`. | Rarely. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (all envs) | Supabase anon key. Public — safe in client bundle. | Quarterly. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (server-only, **never** `NEXT_PUBLIC_`) | Supabase admin key. Used by Server Actions that need to update `user_metadata`. | Quarterly. |
| `SUPABASE_WEBHOOK_SECRET` | Supabase Edge Function env | HMAC secret for `user.created` webhook verification. | Yearly. |
| `TURSO_API_TOKEN` | Supabase Edge Function env (only) | Turso org-scope token. Creates DBs, issues scoped JWTs. | Quarterly. **Never** in Vercel env. |
| `TURSO_ORG` | Vercel + Edge Function | Turso org slug (e.g. `buddysaradhi-org`). | Rarely. |
| `BLOB_READ_WRITE_TOKEN` | Vercel (server-only) | Vercel Blob token. Upload + delete installer artifacts. | Quarterly. |
| `BLOB_PUBLIC_BASE_URL` | Vercel (all envs) | `https://public.blob.vercel-storage.com/...` — public read base. | Rarely. |
| `NEXTAUTH_SECRET` | Vercel (server-only) | 32-byte random. Used for signing server-action nonces. | Yearly. |
| `ENCRYPTION_KEY` | Vercel (server-only) | 32-byte AES key for at-rest encryption of Vercel Blob `manifests/*.json` (the manifest files contain SHA-256 + version + URL — not PII, but tamper-evident). | Quarterly. |
| `CRON_SECRET` | Vercel (server-only) | Authenticates `/api/cron/*` requests via `Authorization: Bearer`. | Quarterly. |
| `NEXT_PUBLIC_APP_URL` | Vercel (all envs) | `https://buddysaradhi.vercel.app` (preview) or `https://buddysaradhi.app` (production). Used to defeat hardcoded-origin bugs (FM-06). | Per-env. |
| `NEXT_PUBLIC_VERCEL_ENV` | Vercel (auto) | `production` / `preview` / `development`. Used to gate Speed Insights. | Auto. |
| `SENTRY_DSN` | **NOT SET** | The no-telemetry rule (Rule 3) forbids Sentry. The variable exists in `.env.example` as a comment-stub with the line `# DO NOT SET — see AGENTS.md Rule 3`. | — |

### 3.1 Rotation Discipline

- **Quarterly rotation** for `SUPABASE_SERVICE_ROLE_KEY`, `TURSO_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`, `ENCRYPTION_KEY`, `CRON_SECRET`. The rotation is automated via `/api/cron/rotate-tokens` for Turso; the rest are manual in Vercel → Settings → Environment Variables.
- **`ENCRYPTION_KEY` rotation** requires re-encrypting every existing `manifests/*.json` in Vercel Blob. The rotation script in `scripts/rotate-encryption-key.ts` downloads, decrypts with old key, re-encrypts with new, uploads, deletes old.
- **Never** rotate `TURSO_API_TOKEN` without first provisioning the new token in Turso → updating Edge Function env → re-deploying Edge Function → verifying new signups work for 24h → deleting the old token.

---

## 4. Preview Deploys — Per-PR QA

Every push to a non-`main` branch produces a unique `*.vercel.app` URL. This is the **QA surface** for agent-browser smoke tests.

### 4.1 The QA Loop

```
┌────────────────┐    push     ┌──────────────┐   build success   ┌──────────────────────┐
│  Feature       │ ──────────► │  Vercel      │ ────────────────► │  *.vercel.app        │
│  branch (PR)   │             │  preview     │                   │  preview deploy      │
└────────────────┘             │  build       │                   └──────────┬───────────┘
                               └──────────────┘                              │
                                                                             │ URL pasted
                                                                             ▼
                                                               ┌──────────────────────────┐
                                                               │  agent-browser smoke     │
                                                               │  • navigate to /         │
                                                               │  • switch to /dashboard  │
                                                               │  • sticky footer check   │
                                                               │  • primary interaction   │
                                                               │  • screenshot diff       │
                                                               └──────────┬───────────────┘
                                                                          │ pass
                                                                          ▼
                                                               ┌──────────────────────────┐
                                                               │  PR ready for review     │
                                                               │  (reviewer = human +     │
                                                               │   another agent)         │
                                                               └──────────────────────────┘
```

### 4.2 Preview Env Vars

Preview deploys inherit Production env vars by default. Sensitive overrides:

- `NEXT_PUBLIC_APP_URL` → set to the preview URL (per-deploy, via Vercel's `VERCEL_URL`).
- `NEXT_PUBLIC_SUPABASE_URL` → use the Supabase **staging** project (separate from prod) so preview-deploy logins don't pollute prod `auth.users`.
- All server-only secrets (`SUPABASE_SERVICE_ROLE_KEY`, `BLOB_READ_WRITE_TOKEN`, `ENCRYPTION_KEY`) → staging values.

### 4.3 Supabase Redirect URL Allowlist

Supabase Auth settings → URL Configuration → Redirect URLs must include:

```
https://buddysaradhi.vercel.app/auth/callback
https://buddysaradhi.app/auth/callback
https://*-buddysaradhi.vercel.app/auth/callback     ← wildcard for preview deploys
https://localhost:3000/auth/callback            ← local dev
```

A missing preview URL here causes the OAuth `redirect_mismatch` error (top-level `03_Auth_and_Provisioning.md` §8 #5).

---

## 5. Production Deploy

### 5.1 Branch → Domain Map

| Branch | Vercel Environment | Domain |
|---|---|---|
| `main` | Production | `buddysaradhi.vercel.app` (default) + `buddysaradhi.app` (custom) |
| `staging` | Preview (promoted) | `staging.buddysaradhi.app` |
| `feature/*`, `fix/*` | Preview | `*.vercel.app` (ephemeral) |

### 5.2 Custom Domain — `buddysaradhi.app`

- DNS: `A` record → `76.76.21.21` (Vercel's anycast IP); `CNAME` `www` → `cname.vercel-dns.com`.
- Vercel → Settings → Domains → Add `buddysaradhi.app` → Vercel issues a Let's Encrypt cert (auto-renewed).
- The cert is for the apex + `www`; no wildcard (wildcard requires DNS validation + a separate cert).

### 5.3 Build Settings (Vercel Dashboard)

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Build command | `bun run build` (NOT `next build` directly — the sandbox `package.json` build script copies `.next/static` + `public` into `.next/standalone`) |
| Output directory | `.next` (auto-detected) |
| Install command | `bun install` |
| Node.js version | 20.x |
| Install cache | `~/.bun/install/cache` (auto) |
| Build cache | `.next/cache` (auto) |
| Function memory | 1024 MB (default) for `/api/*` routes |

### 5.4 The `bun run build` Script

From `package.json`:

```json
"build": "next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/"
```

This produces a self-contained `.next/standalone/` directory (thanks to `output: "standalone"` in `next.config.ts`) that includes:

- `server.js` — the Node server entry point.
- `.next/static/` — the static assets (JS chunks, CSS, fonts).
- `public/` — static files served from the root.

On Vercel, this is largely cosmetic (Vercel uses its own Next.js adapter), but it's required for the **self-hosted fallback** path (Droplet, fly.io, Raspberry Pi). The script is a no-op on Vercel but a hard requirement for self-hosting.

### 5.5 Build Performance

- Cold build (no cache): ~90 s.
- Warm build (cache hit): ~30 s.
- Build cache key: `bun.lockb` hash + `next.config.ts` hash + `tailwind.config` hash.
- Turbopack is **not** used for production builds in v1 (still marked experimental for `next build`). The build uses webpack 5 (Next.js default). v1.x flips to Turbopack for prod builds once stable.

---

## 6. Vercel Speed Insights + Web Analytics

Both are **enabled** at Vercel → Settings → Speed Insights / Web Analytics. The commercial landing page (`07_Landing_Page.md`) is the highest-traffic surface on the deployment and the primary consumer of both — the page's LCP, INP, and CLS numbers roll up into Speed Insights, and the CTA conversion events (§8.2 of `07_Landing_Page.md`) flow through Web Analytics' `track()` API.

| Feature | What it collects | Why compatible with no-telemetry (Rule 3) |
|---|---|---|
| Speed Insights | Core Web Vitals (LCP, INP, CLS) per route, aggregate. | No PII. No user identifiers. Aggregated across all visitors. Opt-out via `NEXT_PUBLIC_VERCEL_SPEED_INSIGHTS=0`. |
| Web Analytics | Page views, referrers, top routes, aggregate. | No cookies, no cross-site tracking. Aggregate only. Vercel's policy: "We don't share or sell data." |

The `@vercel/speed-insights` and `@vercel/analytics` packages are mounted in `src/app/providers.tsx`:

```tsx
"use client";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ /* ... */ }));
  return (
    <QueryClientProvider client={client}>
      {children}
      {process.env.NEXT_PUBLIC_VERCEL_ENV === "production" && (
        <>
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </QueryClientProvider>
  );
}
```

The `production` gate ensures preview deploys don't pollute prod analytics.

---

## 7. Edge Functions — Supabase Side

The `provision-db` Edge Function (top-level `10_Security.md` §2.1, this directory's `03_Auth_and_Provisioning.md` §3) is deployed **separately from Vercel** via the Supabase CLI:

```bash
# Install Supabase CLI (one-time)
brew install supabase/tap/supabase

# Link the project (one-time)
supabase link --project-ref <project-ref>

# Deploy the function
supabase functions deploy provision-db \
  --no-verify-jwt \
  --env-file .env.supabase

# Set the secrets
supabase secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  TURSO_API_TOKEN=... \
  TURSO_ORG=... \
  SUPABASE_WEBHOOK_SECRET=...
```

The function runs on Supabase's Deno Deploy infra, not Vercel. The webhook subscription (Supabase → Auth → Webhooks) is configured in the Supabase dashboard:

- **Webhook URL:** `https://<project>.functions.supabase.co/provision-db`
- **Events:** `user.created`
- **Secret:** `SUPABASE_WEBHOOK_SECRET` (HMAC-signed payload)

---

## 8. Free-Tier Limits & Alerts

Vercel Hobby tier (free) limits as of 2025. The alert thresholds set in `/api/cron/alerts-check` (Vercel → Usage → Alerts):

| Resource | Hobby limit | Alert at 80% | Action at 95% |
|---|---|---|---|
| Bandwidth | 100 GB / month | 80 GB → Slack alert | 95 GB → email; consider Pro upgrade |
| Serverless execution | 1000 GB-h / month | 800 → alert | 950 → email; audit `/api/*` for slow routes |
| Build minutes | 6000 min / month | 4800 → alert | 5700 → email; reduce PR-triggered builds |
| Vercel Blob storage | 1 GB | 800 MB → alert | 950 MB → email; run retention script (see `06_Build_and_Release.md` §7) |
| Vercel Blob bandwidth | 10 GB / month | 8 GB → alert | 9.5 GB → email; consider CDN pass-through |
| Supabase DB | 500 MB | 400 MB → alert | 475 MB → email; archive old audit_log rows |
| Supabase Auth MAU | 50,000 | 40,000 → alert | 47,500 → email; consider Pro upgrade |
| Turso DBs | 500 / org | 400 → alert | 475 → email; consider Turso Scaler plan |
| Turso row reads | 1 B / month (aggregate) | 800 M → alert | 950 M → email; audit slow queries |

The `/api/cron/alerts-check` route uses the Vercel REST API (`https://api.vercel.com/v2/usage`) and the Turso Platform API (`https://api.turso.tech/v1/usage`) to fetch usage, compares against thresholds, and posts to a Slack incoming webhook.

### 8.1 When to Upgrade to Pro

Trigger: any single alert at 95% for two consecutive months. Pro is $20/month and lifts bandwidth to 1 TB, serverless to 6000 GB-h, build minutes to 24,000. The upgrade is a Vercel dashboard toggle; no code change.

---

## 9. Downtime Playbook

### 9.1 Detection

- **Vercel Status page** (`https://www.vercel-status.com`) — subscribe to RSS / Slack / email.
- **Vercel Web Analytics** drop → 30%+ traffic drop in a 5-minute window triggers a Slack alert via `/api/cron/alerts-check`.
- **Turso Status page** (`https://status.turso.tech`) — subscribe.
- **Supabase Status page** (`https://status.supabase.com`) — subscribe.

### 9.2 Communication

- **Status page** at `https://status.buddysaradhi.app` (a static site hosted on Vercel, separate from the main app). Updated manually within 15 minutes of detection.
- **In-app banner** — if the web app can render at all, a flare-coloured banner at the top of `GlassShell` announces the incident.

### 9.3 Rollback

Vercel → Deployments → select the previous known-good deploy → "Instant Rollback". The rollback is atomic (DNS flip in < 60 s). No code change needed.

Triggers for rollback:

1. Production deploy causes a > 5% error rate in `/api/*` routes (Vercel → Monitoring → Error Rate).
2. Production deploy breaks the agent-browser smoke test on `https://buddysaradhi.app` (run automatically post-deploy via `/api/cron/post-deploy-smoke`).
3. A user reports data corruption (a ledger row with a broken `tamper_hash`) — rollback immediately, then investigate.

### 9.4 Recovery

- **Vercel outage.** No action required from us; Vercel handles it. The status page updates automatically.
- **Turso outage.** Web app shows `SYNC_OFFLINE` toast; reads fall back to TanStack cache + IndexedDB; writes queue in client memory and retry on the 30-second poll. Mobile/desktop (with embedded replica) continue to work offline.
- **Supabase outage (Auth).** Existing sessions continue (the JWT is valid for 1 hour). New logins fail; the login page shows a flare toast "Authentication provider unavailable — please retry in a few minutes."
- **Edge Function (`provision-db`) outage.** New signups are stuck on `/signup/provision` with a retry button. Existing tutors are unaffected.

### 9.5 Post-Incident Review

Within 72 hours of any P0/P1 incident:

1. A post-mortem document in `Buddysaradhi_Planning/incidents/<date>-<slug>.md`.
2. Root cause (technical + process).
3. Timeline of detection, communication, recovery.
4. Action items with owners and due dates.
5. Worklog entry summarising the incident.

---

## 10. The `.env.example` File

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...   # server-only, never in client bundle
SUPABASE_WEBHOOK_SECRET=...           # HMAC secret for auth webhooks

# Turso (Edge Function env only — never Vercel)
TURSO_API_TOKEN=...                   # org-scope; creates DBs, issues scoped JWTs
TURSO_ORG=buddysaradhi-org

# Vercel Blob
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
BLOB_PUBLIC_BASE_URL=https://public.blob.vercel-storage.com

# Crypto
NEXTAUTH_SECRET=...                   # 32-byte random; signs server-action nonces
ENCRYPTION_KEY=...                    # 32-byte AES key; encrypts Vercel Blob manifests

# Cron
CRON_SECRET=...                       # authenticates /api/cron/*

# App
NEXT_PUBLIC_APP_URL=https://buddysaradhi.app

# Forbidden (DO NOT SET — see AGENTS.md Rule 3)
# SENTRY_DSN=
# MIXPANEL_TOKEN=
# POSTHOG_KEY=
```

The commented-out telemetry keys are documentation: they exist in the example to remind the next agent **not** to add them.

---

## 11. Cross-References

- Top-level `AGENTS.md` §2 Rule 3 — no telemetry SDK.
- Top-level `AGENTS.md` §3.2 — web stack snapshot.
- Top-level `10_Security.md` §2 — Supabase Auth, service-role isolation.
- Top-level `10_Security.md` §17 — TELE-1 (no-telemetry contract).
- Top-level `15_Future_Roadmap.md` — v1.x self-hosting path.
- This directory's `01_Architecture.md` §7 — `next.config.ts` (PPR, headers, CSP).
- This directory's `03_Auth_and_Provisioning.md` §3 — Edge Function code.
- This directory's `06_Build_and_Release.md` — Vercel Blob storage layout + retention.
- This directory's `07_Landing_Page.md` — the commercial landing page (the marketing surface this Vercel deployment serves at `/`); `§10.4` for the Speed Insights + Web Analytics wiring, `§10.5` for the Lighthouse ≥95 budget that the Vercel Edge cache makes achievable.
- Sibling `deployment/01_Vercel_Hosting.md` — the master hosting spec (this file is the per-surface summary).
- Sibling `deployment/02_Vercel_Blob_Build_Storage.md` — the master Blob bucket layout (mirrored in `06_Build_and_Release.md §3`).

---

## 12. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ deployment file must carry ≥ 2 ASCII art mockups. The mockups below add three views the existing §2 `vercel.json` and §3 env-var catalogue do not surface: (1) the Vercel project structure with build output + Edge network + per-region function placement, (2) the Edge function regions map with TTFB annotations from India, and (3) the cron schedule as a 24-hour timeline. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only. The Vercel deployment surface is infrastructure — it carries **no glass tier and no neumorphic recipe** (the in-app surfaces that Vercel serves — the GlassShell, the marketing nav, the auth card — ARE in the design system, catalogued in `01_Architecture.md` §12.1).

### 12.1 Design System Reference — Deployment Surface (Infra, No Glass)

> **The single rule (§6.6) does not apply to the deployment layer.** Vercel regions, serverless functions, Edge network PoPs, and cron jobs are infrastructure — they return JSON, HTML, or scheduled side-effects, not UI. The **in-app surfaces that Vercel serves** (the GlassShell, the marketing landing, the auth card) ARE in the design system; the tables below list the consumer surfaces and their tier/recipe so the deployment author knows which UI surfaces a given Vercel route will paint.

| Surface (served by Vercel) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Marketing landing (PPR shell, Edge-cached) | `glass` hero + `glass-faint` footer | `/` (marketing) | §5.5, `07 §4` |
| Auth card (Node runtime, server-rendered) | `glass-strong` centered + backdrop | `/login`, `/signup`, `/verify` | §5.5, §8.7 |
| App shell (Node runtime, server-rendered + Client islands) | `glass-strong` sidebar + topbar; `glass-faint` footer | `/dashboard`, `/students`, `/attendance`, `/fees`, `/settings` | §5.5, `01 §3.3` |
| 500 / 502 error page (Vercel fallback) | `glass` centered + flare accent | `/500` (Vercel-managed) | §5.5, §8.19 |
| 404 not-found page (Next.js not-found.tsx) | `glass` centered + amber accent | `/*` unmatched routes | §5.5, §8.19 |

| Control (served by Vercel on error pages) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| "Retry" button on 5xx error page | `neumo-raised` + cyan glow | `/500` | §6.6, §8.2 |
| "Go home" link on 404 | ghost (transparent, `--text-secondary`) | `/404` | §8.2 |

> **References.** Vercel docs (project settings, preview deploys, env vars, cron jobs, `@vercel/speed-insights`, `@vercel/analytics`, `@vercel/blob`, Edge runtime vs Node.js runtime, `maxDuration` limits, regions, Edge firewall); Next.js 16 App Router docs (PPR, `force-static` + `revalidate`, `next/font`, `next/image`, `next/script`, metadata routes); Supabase Edge Functions docs (Deno runtime, webhook verification); web.dev — "Vercel Edge Network Performance" (TTFB benchmarks from India); Smashing Magazine — "Deploying Next.js Apps On Vercel"; CSS-Tricks — "A Guide To Vercel Cron Jobs". These are the same references cited in `README.md` §7.2.

### 12.2 Mockup M1 — Vercel Project Structure (Build → Edge → Function Placement)

The §2 `vercel.json` listed the knobs; this mockup shows the **runtime topology** — what Vercel produces when `bun run build` runs, where each chunk lives (Edge cache vs serverless function vs Blob), and how a request flows from the browser through the Edge network to the right execution target. The point: the marketing surface is Edge-cached (sub-50 ms TTFB from India); the app surface is serverless (Node 20, `bom1` primary); the `/api/*` routes run on the same serverless pool with per-route `maxDuration`.

```
   Vercel Project — buddysaradhi (Hobby → Pro)
   Build: bun run build  →  .next/standalone/ (output: "standalone" in next.config.ts)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  GITHUB REPO  ── git push ──►  VERCEL BUILD                                                     │
   │                              • bun install (lockfile verified)                                  │
   │                              • bun run lint   (ESLint + design-system rules)                    │
   │                              • bun run typecheck (tsc --noEmit)                                 │
   │                              • next build     (Turbopack, PPR enabled)                          │
   │                              • @next/bundle-analyzer (if ANALYZE=true)                          │
   │                              • output: .next/standalone/ (self-contained Node server)           │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                            │
                                                            ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  VERCEL EDGE NETWORK (18+ global PoPs, anycast)                                                  │
   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
   │  │ bom1     │  │ sin1     │  │ fra1     │  │ iad1     │  │ sfo1     │  │ ... 18   │              │
   │  │ Mumbai   │  │ Singapore│  │ Frankfurt│  │ Washington│ │ San Fran │  │ PoPs     │              │
   │  │ PRIMARY  │  │ (Turso   │  │ FALLBACK │  │          │  │          │  │          │              │
   │  │ (India)  │  │  replica)│  │ (EU)     │  │          │  │          │  │          │              │
   │  │          │  │          │  │          │  │          │  │          │  │          │              │
   │  │ TTFB     │  │ TTFB     │  │ TTFB     │  │ TTFB     │  │ TTFB     │  │          │              │
   │  │ <50 ms   │  │ <80 ms   │  │ <120 ms  │  │ <150 ms  │  │ <150 ms  │  │          │              │
   │  │ (India)  │  │ (India)  │  │ (EU)     │  │ (US-E)   │  │ (US-W)   │  │          │              │
   │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────────┘              │
   │       │             │             │             │             │                                  │
   │       │  Edge-cached (static assets + PPR shells):                                              │
   │       │  • /_next/static/*  (JS chunks, CSS, fonts)  — immutable, max-age=31536000               │
   │       │  • /  (marketing landing PPR shell)          — revalidate=3600 (ISR)                     │
   │       │  • /pricing, /faq, /download                 — revalidate=3600                           │
   │       │  • /changelog/[version]                      — SSG (force-static)                        │
   │       │  • /opengraph-image, /twitter-image          — build-time Edge runtime                   │
   │       │  • /sitemap.xml, /robots.txt                 — build-time                                │
   │       │                                                                                            │
   └───────┼────────────────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼  (cache MISS → serverless function)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  VERCEL SERVERLESS (Node 20, regions: bom1 + fra1)                                              │
   │  ┌──────────────────────────────────────────────────┐  ┌──────────────────────────────────────┐ │
   │  │  bom1 (Mumbai, PRIMARY)                          │  │  fra1 (Frankfurt, FALLBACK)         │ │
   │  │  ──────────────────                              │  │  ──────────────────                  │ │
   │  │  • (app)/* RSC pages (5 screens)                 │  │  • same routes (Vercel auto-routes   │ │
   │  │  • (auth)/* RSC pages                            │  │    by latency)                       │ │
   │  │  • /api/* routes (default 10 s maxDuration):     │  │  • used by EU tutors (< 120 ms TTFB) │ │
   │  │    - /api/spec, /api/students/*, /api/ledger/*   │  │                                      │ │
   │  │    - /api/attendance/mark, /api/sync/pull        │  │                                      │ │
   │  │    - /api/newsletter/subscribe                   │  │                                      │ │
   │  │  • /api/* routes (extended maxDuration):         │  │                                      │ │
   │  │    - /api/provision              (60 s)          │  │                                      │ │
   │  │    - /api/backup/create          (60 s)          │  │                                      │ │
   │  │    - /api/backup/restore        (120 s)          │  │                                      │ │
   │  │    - /api/reports/[type]         (30 s)          │  │                                      │ │
   │  │  • /api/cron/* (CRON_SECRET bearer):             │  │                                      │ │
   │  │    - /api/cron/rotate-tokens   (monthly)         │  │                                      │ │
   │  │    - /api/cron/alerts-check    (every 15 min)    │  │                                      │ │
   │  │    - /api/cron/post-deploy-smoke (post-deploy)   │  │                                      │ │
   │  └──────────────────────────────────────────────────┘  └──────────────────────────────────────┘ │
   │                                                                                                   │
   │  • per-instance in-memory token bucket (rate-limit) — approximate on serverless                  │
   │  • Edge firewall handles DDoS (not the per-instance bucket)                                      │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼  (server-side fetch to per-user Turso DB)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  TURSO (libSQL, per-user db-{uuid})                                                              │
   │  • group: buddysaradhi-primary                                                                        │
   │  • primary replica: gcp-asia-southeast1 (Singapore) — ~80 ms RTT from bom1                      │
   │  • read replicas: auto-placed by Turso (free tier: 500 DBs / org)                                │
   │  • the scoped JWT (db_token, 1-year expiry) routes the request to db-{user.uuid}                 │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼  (release artifacts only — never on the request path)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  VERCEL BLOB (buddysaradhi-releases bucket)                                                           │
   │  • desktop/{windows,macos,linux}/*  — .msi, .dmg, .AppImage + .sig                              │
   │  • mobile/{android,ios}/*           — .apk, .ipa (placeholder)                                  │
   │  • manifests/*.json + .sig          — desktop-stable, mobile-stable                             │
   │  • changelogs/*.md                  — per-version release notes                                 │
   │  ↑ served from public.blob.vercel-storage.com (separate CDN from the app)                        │
   │  ↑ immutable URLs (per version) — Cache-Control: max-age=31536000, immutable                     │
   │  ↑ see 06_Build_and_Release.md §3 for the full bucket layout                                     │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼  (newsletter subscribers only — platform Turso DB, not per-user)
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  PLATFORM TURSO DB (buddysaradhi-platform)                                                            │
   │  • newsletter_subscribers table (email, created_at)                                              │
   │  • NOT a per-user DB — single shared DB for platform-wide concerns                               │
   │  • written by /api/newsletter/subscribe (rate-limited 5/hr per IP)                               │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Request flow (browser → response) ────────────────────────────────────────────────────────────────
     1. Browser → Vercel Edge PoP (anycast, < 50 ms from India to bom1)
     2. Edge PoP → cache HIT? → return cached asset/shell (< 50 ms TTFB)
     3. Edge PoP → cache MISS → serverless function (bom1 primary, fra1 fallback)
     4. Serverless function → @supabase/ssr reads sb-access-token cookie → getUser()
     5. Serverless function → @libsql/client (db_token from user_metadata) → Turso db-{uuid}
     6. Serverless function → RSC render → HTML stream → Edge PoP → browser
     7. Browser → Client islands hydrate (Recharts, drawers, toggles) → 180 KB JS total (§9 of 01_)
   ↑ the 30-second sync poll (useSyncPoll) hits /api/sync/pull directly (serverless, not Edge-cached)
```

The topology shows the four execution targets: Vercel Edge Network (static assets + PPR shells, anycast, 18+ PoPs), Vercel Serverless (Node 20, `bom1` primary + `fra1` fallback), Turso (per-user `db-{uuid}`, Singapore primary replica), and Vercel Blob (release artifacts, separate CDN). The request flow at the bottom traces a single request from browser to response: Edge PoP cache HIT returns in < 50 ms; cache MISS falls through to serverless, which reads the Supabase cookie, fetches the Turso DB token, queries Turso, renders RSC, and streams HTML back through the Edge PoP. The 30-second sync poll bypasses the Edge cache (it's a POST, not a GET) and hits serverless directly.

### 12.3 Mockup M2 — Edge Function Regions Map (TTFB from India)

The §2.1 narrative described the regions; this mockup shows the **geography** — where each region lives, what the TTFB is from a typical Indian tutor (Pune/Nagpur), and which Turso replica each region talks to. The point: `bom1` is the primary because most v1 tutors are in India and the Turso primary replica is in Singapore (sub-80 ms RTT from Mumbai).

```
   Edge Function Regions Map — TTFB from India (Pune/Nagpur tutor, 4G connection)

                            ┌─────────────────────────────────────────────┐
                            │  EUROPE                                      │
                            │  ┌───────────┐                               │
                            │  │ fra1      │  Frankfurt (DE)               │
                            │  │ FALLBACK  │  TTFB from India: < 120 ms   │
                            │  │           │  Used by EU tutors            │
                            │  └───────────┘                               │
                            └─────────────────────────────────────────────┘
                                                │
                                                │  (Vercel auto-routes by latency;
                                                │   fra1 only handles EU traffic)
                                                │
   ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  INDIA                                                                                          │
   │                                                                                                 │
   │        Pune ●                              Nagpur ●                                             │
   │           │                                    │                                                │
   │           │  4G RTT ~30 ms                      │  4G RTT ~40 ms                                │
   │           │  to bom1                            │  to bom1                                      │
   │           ▼                                    ▼                                                │
   │       ┌──────────────────────────────────────────────────┐                                     │
   │       │  bom1 (Mumbai, PRIMARY)                          │                                     │
   │       │  ──────────────────                              │                                     │
   │       │  • Vercel serverless region (Node 20)            │                                     │
   │       │  • TTFB from Pune:     < 50 ms                   │                                     │
   │       │  • TTFB from Nagpur:   < 60 ms                   │                                     │
   │       │  • TTFB from Bengaluru: < 50 ms                  │                                     │
   │       │  • TTFB from Delhi:    < 50 ms                   │                                     │
   │       │  • TTFB from Chennai:  < 50 ms                   │                                     │
   │       │  • TTFB from Kolkata:  < 60 ms                   │                                     │
   │       │                                                  │                                     │
   │       │  → Turso primary replica (gcp-asia-southeast1):  │                                     │
   │       │    RTT from bom1: ~80 ms (Singapore)             │                                     │
   │       │    total request latency: 50 + 80 + render       │                                     │
   │       │    ≈ 180-250 ms server-side (RSC fetch + render)  │                                     │
   │       └──────────────────────────────────────────────────┘                                     │
   │                │                                                                                │
   │                │  (Turso scoped JWT routes the request to db-{user.uuid})                      │
   │                ▼                                                                                │
   │       ┌──────────────────────────────────────────────────┐                                     │
   │       │  TURSO PRIMARY REPLICA                            │                                     │
   │       │  gcp-asia-southeast1 (Singapore)                  │                                     │
   │       │  • group: buddysaradhi-primary                          │                                     │
   │       │  • 500 per-user DBs (free tier)                    │                                     │
   │       │  • RTT from bom1: ~80 ms                           │                                     │
   │       │  • read replicas: auto-placed by Turso             │                                     │
   │       └──────────────────────────────────────────────────┘                                     │
   │                                                                                                 │
   └────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Why bom1 is primary (3 reasons) ──────────────────────────────────────────────────────────────────
     1. Most v1 tutors are in India (Pune, Nagpur, Bengaluru, Delhi, Chennai, Kolkata).
        bom1 gives them < 60 ms TTFB for the Edge-cached marketing shell and < 250 ms for the
        server-rendered app shell (including the Turso roundtrip).
     2. Turso's primary replica is in Singapore (gcp-asia-southeast1) — bom1 → Singapore is ~80 ms RTT,
        the shortest available path. fra1 → Singapore would be ~280 ms RTT (EU → SEA), unacceptable.
     3. Vercel's Edge network anycast-routes by latency; bom1 is the natural PoP for Indian traffic
        without configuration. fra1 is the fallback for EU tutors; Vercel auto-routes by latency.

   ── Why fra1 is fallback (2 reasons) ─────────────────────────────────────────────────────────────────
     1. EU tutors (a small v1 minority) get < 120 ms TTFB to fra1 for the Edge-cached shell.
        fra1 → Turso Singapore is ~280 ms RTT (acceptable for EU; not acceptable for India).
     2. Two regions roughly double compute cost (each region counts toward serverless GB-h).
        Bandwidth is charged once. Hobby tier (1000 GB-h) covers ~500 tutors at this config.

   ── Regions NOT used (and why) ───────────────────────────────────────────────────────────────────────
     • iad1 (US-East), sfo1 (US-West): not configured. US tutors use bom1 (high latency, ~150 ms TTFB);
       acceptable for v1 (US is not the target market). Add iad1/sfo1 when US traffic justifies.
     • sin1 (Singapore): not a Vercel region (Turso is in Singapore, Vercel is not).
     • syd1 (Sydney): not configured. AU tutors use fra1 or bom1 (high latency; AU is not v1 target).
```

The map shows the two configured regions (`bom1` primary, `fra1` fallback), the TTFB from major Indian cities to `bom1` (all < 60 ms), and the RTT from `bom1` to the Turso primary replica in Singapore (~80 ms). The total server-side latency for an Indian tutor's request is ~180–250 ms (Edge PoP → serverless → Turso → render → stream back). `fra1` is the fallback for EU tutors — it gives them < 120 ms TTFB for the Edge-cached shell, but the Turso roundtrip is ~280 ms (acceptable for EU; not acceptable for India). The "regions NOT used" section documents the deliberate non-configuration of `iad1`/`sfo1`/`syd1` — US/AU tutors use `bom1` or `fra1` with high latency, acceptable for v1 (US/AU are not the target market). Adding `iad1`/`sfo1` is a future-roadmap decision (see `15_Future_Roadmap.md`).

### 12.4 Mockup M3 — Cron Schedule (24-Hour Timeline)

The §2.3 narrative listed the two crons; this mockup shows them on a **24-hour timeline** (UTC) with the side-effects of each run, so a future agent can see at a glance when the platform is busiest and when a deploy would cause the least disruption. The point: the crons are staggered (rotate-tokens is monthly at 03:00 UTC; alerts-check is every 15 min) and the post-deploy-smoke runs only on deploy — they never overlap.

```
   Cron Schedule — 24-Hour Timeline (UTC; IST = UTC + 5:30)

   UTC  00  01  02  03  04  05  06  07  08  09  10  11  12  13  14  15  16  17  18  19  20  21  22  23
        │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
        ├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
        │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
   rotate-tokens (monthly, 1st of month at 03:00 UTC = 08:30 IST)
        │   │   │   │ ◉ │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
        │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
   alerts-check (every 15 min, 96 runs/day)
        ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉ ◉
        │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │   │
   post-deploy-smoke (on every production deploy, not scheduled)
        ◉ (runs after deploy; not on the timeline — event-driven)

   ── Cron detail ────────────────────────────────────────────────────────────────────────────────────────
     /api/cron/rotate-tokens
       schedule: 0 3 1 * *       (03:00 UTC on the 1st of each month = 08:30 IST)
       auth:     CRON_SECRET bearer (Authorization: Bearer ${CRON_SECRET})
       purpose:  iterates tutors whose Turso scoped JWT (db_token) is within 30 days of 1-year expiry;
                 rotates via the Edge Function (which calls Turso POST /v1/databases/:name/auth/tokens);
                 writes new db_token to auth.users.user_metadata (server-side, service-role key).
       side-effects:
         • ~0-5 tutors rotated per run (depending on signup anniversaries)
         • audit_log row per tutor: action='db_token_rotated', actor='system'
         • if Edge Function fails for a tutor: retry 3× then alert Slack; tutor unaffected (old token
           still valid for 30 days)
       duration: ~30 s (per tutor ~5 s; serial to avoid Turso rate limit)
       rate:     not rate-limited (CRON_SECRET gated; no IP bucket)

     /api/cron/alerts-check
       schedule: */15 * * * *    (every 15 min, 96 runs/day)
       auth:     CRON_SECRET bearer
       purpose:  checks Vercel project usage (bandwidth, serverless GB-h, Blob storage) + Turso usage
                 (DB count, row reads) against 80% threshold; posts to Slack/Telegram webhook if exceeded.
       side-effects:
         • 1 HTTP GET to https://api.vercel.com/v2/usage (Vercel REST API)
         • 1 HTTP GET to https://api.turso.tech/v1/usage (Turso Platform API)
         • 1 HTTP POST to Slack incoming webhook (if threshold exceeded; otherwise no-op)
         • no audit_log row (this is infra monitoring, not a user-facing mutation)
       duration: ~5 s (two HTTP GETs + optional POST)
       rate:     not rate-limited (CRON_SECRET gated)

     /api/cron/post-deploy-smoke
       schedule: (not scheduled; event-driven, runs after every production deploy)
       auth:     CRON_SECRET bearer
       purpose:  agent-browser smoke test on https://buddysaradhi.app/; asserts 200, screenshots the
                 dashboard, posts the screenshot to the deploy summary in Vercel.
       side-effects:
         • 1 agent-browser run (Playwright, ~10 s)
         • 1 screenshot upload to Vercel deploy artifacts
         • on failure: alerts Slack + pages on-call engineer
       duration: ~15 s
       rate:     not rate-limited (CRON_SECRET gated; production-only — preview deploys skip it)

   ── Deploy window (least disruption) ───────────────────────────────────────────────────────────────────
     Best deploy window: 02:00-03:00 UTC (07:30-08:30 IST) — before rotate-tokens, after midnight low-traffic.
     Avoid: 18:00-22:00 IST (peak Indian tutoring hours; highest traffic + most-likely-to-be-noticed bugs).
     ↑ Vercel "Instant Rollback" makes the deploy window soft — a bad deploy can be rolled back in < 60 s.
```

The timeline shows the three crons on a 24-hour UTC axis with IST conversion. `rotate-tokens` is monthly at 03:00 UTC (08:30 IST) — outside peak Indian tutoring hours (18:00–22:00 IST). `alerts-check` runs every 15 minutes (96 runs/day) — it's lightweight (~5 s per run) and posts to Slack only on threshold breach. `post-deploy-smoke` is event-driven (runs after every production deploy, not on a schedule). The crons never overlap because `rotate-tokens` is monthly and `alerts-check` skips the 03:00 UTC slot if `rotate-tokens` is running (Vercel cron jobs are serialised per route). The deploy window recommendation at the bottom — 02:00–03:00 UTC — is the soft guidance; Vercel's Instant Rollback makes it non-binding.

---

*Deployment in this file is the contract. When a region, an env var, or a rollback trigger diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog.*
