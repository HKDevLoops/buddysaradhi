# 03 — Auth & Provisioning (Web)

> The complete web authentication and per-user Turso provisioning contract. Supabase Auth for identity, a Supabase Edge Function for provisioning, Turso Platform API for DB creation, a scoped JWT for libSQL access, forward-only SQL migrations for schema bootstrap. Every step, every SQL call, every error code in this file is the contract.

---

## 1. The Identity Model — Supabase Auth

Buddysaradhi does not store user passwords. Identity is delegated to **Supabase Auth** (`auth.users` table) which hosts the email + password hash (or Google OAuth identity). Buddysaradhi-the-product sees only the JWT Supabase issues and the `user_metadata` it carries.

### 1.1 Sign-Up Methods (v1)

- **Email + OTP.** The tutor enters their email on `/signup`; Supabase sends a 6-digit OTP to that address; the tutor confirms on `/verify`. No password is set by the user in v1 — Supabase's email OTP flow is the primary credential.
- **Google OAuth (v1.x).** A "Continue with Google" button on `/login` triggers `supabase.auth.signInWithOAuth({ provider: 'google', redirectTo: '/callback' })`. The callback handler exchanges the code for a session.

> **No passwords.** v1 ships email-OTP only. Password-based login is a v1.x addition gated behind a security review (top-level `AGENTS.md` §8 trigger #4) — when added, the password hash lives in Supabase, never in the Buddysaradhi Turso DB.

### 1.2 The Supabase Session — JWT + Refresh Token

A successful Supabase login produces:

1. An **access token** (JWT) — 1-hour expiry, signed by Supabase, carrying `sub` (user UUID), `email`, `user_metadata` (incl. `db_url`, `db_token` after provisioning).
2. A **refresh token** — opaque, 30-day rolling expiry, stored in the `sb-access-token` / `sb-refresh-token` HTTP-only cookies set by `@supabase/ssr`.

The web app **never** reads the access token from JavaScript. It is sent as a cookie on every request; the server-side `createServerClient({ cookies })` reads it, and middleware refreshes it on the way through.

### 1.3 The Identity Root — `auth.users`

The `auth.users` table in the Supabase project is the **single source of truth for identity**. The `user.id` (UUID) is the tenant ID throughout the Buddysaradhi system (`tenant_id` on every table in the per-user Turso DB — top-level `11_Data_Model.md` §1, P-DM1). Email changes are handled by Supabase; account deletion is handled by Supabase; OAuth linkage is handled by Supabase. Buddysaradhi-the-product never re-implements identity.

---

## 2. The SSR Cookie Strategy

The web app uses **`@supabase/ssr`** (not the older `@supabase/auth-helpers` package). The pattern:

### 2.1 The Server-Side Client (`src/lib/supabase/server.ts`)

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}
```

This client is used inside RSC and Server Actions to read the session, refresh the JWT (the `setAll` callback writes the refreshed cookie back to the response), and call `supabase.auth.getUser()`.

### 2.2 The Browser Client (`src/lib/supabase/client.ts`)

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

Used inside Client islands for the OTP input flow (`supabase.auth.verifyOtp`) and the logout button (`supabase.auth.signOut()`).

### 2.3 The Middleware Refresh (`src/middleware.ts`)

The middleware (full code in `01_Architecture.md` §6) calls `supabase.auth.getSession()` on every protected route. Supabase's SSR client transparently refreshes the access token if it's within the refresh window; the refreshed tokens are written back to the response cookies via the `setAll` callback. This eliminates the "stale session → 401 → refetch loop" failure mode.

### 2.4 Why Not `localStorage`?

The Supabase SSR cookie strategy is **HTTP-only cookies** because:

1. **XSS defence.** An HTTP-only cookie is not readable by JavaScript, so a malicious script cannot exfiltrate the access token.
2. **SSR-friendly.** The cookie is sent on every server request, so RSC and Server Actions can read the session without a round-trip to the browser.
3. **`localStorage` is blocked** by the sandbox CSP for auth tokens. The `createBrowserClient` reads from cookies, not localStorage, when configured with the SSR cookie adapter.

---

## 3. The Provisioning Edge Function

Provisioning is the act of creating a fresh per-user Turso DB the first time a tutor signs up. It runs as a **Supabase Edge Function** (Deno runtime) named `provision-db` so that the Supabase service-role key (which has Turso Platform API scope) never lands in the Next.js server bundle.

### 3.1 Why an Edge Function?

- The Turso Platform API token (`TURSO_API_TOKEN`) has full org scope — it can create and delete any DB in the org. **This token must never reach the Next.js client or server.**
- The Edge Function runs in Supabase's infra, behind Supabase Auth. The Next.js app calls the function via an authenticated HTTP request; the function uses the Supabase service-role key to read `auth.users`, calls Turso, and writes the result back into `auth.users.user_metadata`.
- The function is deployed separately via `supabase functions deploy provision-db` (see `05_Deployment_Vercel.md` §9).

### 3.2 The Function Trigger

The function is triggered by a Supabase **auth webhook** on `user.created`:

```
┌──────────────────┐  user.created   ┌──────────────────────────┐
│  Supabase Auth   │ ──────────────► │  Edge Function           │
│  (auth.users)    │                 │  provision-db (Deno)     │
└──────────────────┘                 └─────────────┬────────────┘
                                                   │
                                ┌──────────────────┼──────────────┐
                                ▼                  ▼              ▼
                       Turso Platform   Supabase admin    Returns 200
                       POST /v1/databases   .updateUser    (or 500)
                       name=db-{uuid}       (set user_metadata)
```

The webhook payload includes the new user's UUID + email. The function:

1. Validates the webhook signature (HMAC-SHA256 with `SUPABASE_WEBHOOK_SECRET`).
2. Calls Turso Platform API: `POST https://api.turso.tech/v1/databases` with body `{ "name": "db-${user.uuid}", "group": "buddysaradhi-primary" }`.
3. Turso returns the new DB's `db_url` (`libsql://db-{uuid}-<org>.turso.io`).
4. The function calls Turso again to issue a scoped JWT: `POST https://api.turso.tech/v1/databases/db-{uuid}/auth/tokens` with body `{ "expiration": "1y" }`. The returned token is scoped to **this DB only**.
5. The function calls Supabase Admin: `supabase.auth.admin.updateUser(user.uuid, { user_metadata: { db_url, db_token, provisioned_at: new Date().toISOString() } })`.
6. Returns 200 OK. The webhook is retried on 5xx, so the function is **idempotent** — if it sees that `user_metadata.db_url` is already set, it short-circuits and returns 200.

### 3.3 The Function Stub (Deno)

```ts
// supabase/functions/provision-db/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256Verify } from "https://deno.land/std/crypto/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TURSO_API_TOKEN = Deno.env.get("TURSO_API_TOKEN")!;
const TURSO_ORG = Deno.env.get("TURSO_ORG")!;
const WEBHOOK_SECRET = Deno.env.get("SUPABASE_WEBHOOK_SECRET")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

async function provision(userId: string) {
  // Idempotency: short-circuit if already provisioned
  const { data: existing } = await supabase.auth.admin.getUserById(userId);
  if (existing?.user?.user_metadata?.db_url) return { ok: true, skipped: true };

  const dbName = `db-${userId}`;
  // 1. Create the Turso DB
  const createRes = await fetch(`https://api.turso.tech/v1/databases`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TURSO_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: dbName, group: "buddysaradhi-primary" }),
  });
  if (!createRes.ok) throw new Error(`TURSO_CREATE_FAILED: ${await createRes.text()}`);
  const createJson = await createRes.json();
  const dbUrl = `libsql://${createJson.hostname}`;

  // 2. Issue a scoped JWT (1-year expiry)
  const tokenRes = await fetch(
    `https://api.turso.tech/v1/databases/${dbName}/auth/tokens`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TURSO_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiration: "1y" }),
    }
  );
  if (!tokenRes.ok) throw new Error(`TURSO_TOKEN_FAILED: ${await tokenRes.text()}`);
  const tokenJson = await tokenRes.json();
  const dbToken = tokenJson.jwt;

  // 3. Write to user_metadata
  const { error } = await supabase.auth.admin.updateUser(userId, {
    user_metadata: { db_url: dbUrl, db_token: dbToken, provisioned_at: new Date().toISOString() },
  });
  if (error) throw new Error(`SUPABASE_UPDATE_FAILED: ${error.message}`);

  return { ok: true, db_url: dbUrl };
}

Deno.serve(async (req) => {
  // Verify webhook signature
  const body = await req.text();
  const sig = req.headers.get("x-supabase-signature") ?? "";
  const valid = await hmacSha256Verify(sig, body, WEBHOOK_SECRET);
  if (!valid) return new Response("INVALID_SIGNATURE", { status: 401 });

  const payload = JSON.parse(body);
  const userId: string | undefined = payload?.record?.id;
  if (!userId) return new Response("NO_USER_ID", { status: 400 });

  try {
    const result = await provision(userId);
    return Response.json(result);
  } catch (e) {
    console.error("[provision-db] FAILED", e);
    return new Response(`PROVISION_FAILED: ${(e as Error).message}`, { status: 500 });
  }
});
```

### 3.4 Provisioning Without the Webhook (Manual / Retry Path)

If the webhook fails (or if a tutor signs up but the function 5xxs), the middleware detects the missing `db_url` on next page load and redirects to `/signup/provision`. That page shows a "Setting up your database…" spinner and **calls the function directly** via an authenticated POST. The function is the same; only the trigger differs.

---

## 4. The 7-Step Provisioning Flow

The landing page (`src/app/page.tsx`, `PROVISIONING_STEPS` array) already enumerates these steps. Here they are expanded with the actual SQL/HTTP calls.

### Step 1 — Web Signup (Supabase)

- **Surface:** `/signup`.
- **Call:** `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '/verify' } })`.
- **Result:** Supabase sends a 6-digit OTP to the email. The user is redirected to `/verify`.
- **DB:** A new row appears in `auth.users` with `email_confirmed_at = NULL`.

### Step 2 — OTP Verification (Supabase)

- **Surface:** `/verify`.
- **Call:** `supabase.auth.verifyOtp({ email, token: otp, type: 'email' })`.
- **Result:** Supabase confirms the email, sets `email_confirmed_at = now()`, creates a session, and fires the `user.created` webhook (which triggers the Edge Function).
- **Cookies:** `sb-access-token` and `sb-refresh-token` are set HTTP-only.

### Step 3 — Edge Function `provision-db` (Supabase Edge, Deno)

- **Trigger:** `user.created` webhook (or manual POST from `/signup/provision`).
- **Calls:** Turso Platform API → create `db-{user.uuid}` → issue scoped JWT → write `user_metadata`.
- **Result:** The user's Supabase JWT now carries `user_metadata.db_url` and `user_metadata.db_token`.
- **Failure:** 5xx → webhook retried by Supabase (3 attempts with exponential backoff).

### Step 4 — Turso Platform API Creates `db-{uuid}`

- **HTTP:** `POST https://api.turso.tech/v1/databases` with `Authorization: Bearer ${TURSO_API_TOKEN}`.
- **Body:** `{ "name": "db-${user.uuid}", "group": "buddysaradhi-primary" }`.
- **Response:** `{ "uuid": "...", "name": "db-...", "hostname": "db-{uuid}-{org}.turso.io", ... }`.
- **Scoped JWT (Step 4b):** `POST /v1/databases/db-{uuid}/auth/tokens` with `{ "expiration": "1y" }` → returns `{ "jwt": "..." }`. The JWT is scoped to this single DB.

### Step 5 — Scoped JWT Issued (1-Year Expiry)

- **Storage:** In `auth.users.user_metadata` (set by the Edge Function).
- **Claims:** `{ "db_url": "libsql://...", "exp": <1y>, "iss": "turso" }`. (The actual claim structure is set by Turso; we just store the JWT string.)
- **Use:** Every web request reads `user_metadata.db_url` + `db_token` from the Supabase JWT and passes them to `@libsql/client` (`createClient({ url, authToken })`).
- **Rotation:** If a JWT is compromised (or at 11-month mark), the tutor can re-provision via Settings → Diagnostics → "Rotate DB token", which calls the Edge Function again to issue a fresh token.

### Step 6 — Client Inits libSQL (`@libsql/client` HTTP)

- **Server-side:** `src/lib/turso/server.ts` creates a per-request client (see `02_State_and_Data_Flow.md` §2.1).
- **Client-side:** `src/hooks/use-turso-client.ts` creates a per-tab client for read-only queries (via the `/api/sync/pull` Server Action that proxies to libSQL — never direct libSQL HTTP from the browser, because the scoped JWT must not be in the client bundle).

> **Security boundary.** The `db_token` is **never** in the Next.js client bundle. Every libSQL call from a Client island goes through a Server Action or `/api/*` route, which reads the token from the Supabase JWT server-side and forwards the libSQL HTTP call.

### Step 7 — Schema Bootstrap

- **Migrations:** `migrations/0001_init.sql` through `migrations/0010_ledger_chain.sql` (per top-level `11_Data_Model.md` §11).
- **Call:** `bootstrapSchema(dbUrl, dbToken)` runs each migration in order against the new DB. Each migration is idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).
- **First row:** The bootstrap also inserts the singleton `settings` row with `tenant_id = user.uuid`, `currency_code = 'INR'`, `locale = 'en-IN'`, `timezone = 'Asia/Kolkata'`, and a freshly generated `tenant_secret` (256-bit cryptographically random, hex-encoded).
- **Result:** The DB is ready. The client navigates to `/dashboard`, which shows the empty state (top-level `02_Core_Logic.md` §3.1, P15 "Honest Empty States").

### Full Flow Diagram

```
┌─────────┐    1.OTP    ┌──────────┐   2.verify   ┌─────────────────┐
│ /signup │ ──────────► │ /verify  │ ────────────►│ auth.users      │
└─────────┘             └──────────┘              │ email_confirmed │
                                                  └────────┬────────┘
                                                           │ user.created webhook
                                                           ▼
                                              ┌─────────────────────────┐
                                              │ Edge Function           │
                                              │ provision-db (Deno)     │
                                              └────────┬────────────────┘
                                                       │ 3.+4. create DB + JWT
                                                       ▼
                                              ┌─────────────────────────┐
                                              │ Turso Platform API      │
                                              │ POST /v1/databases      │
                                              │ POST /auth/tokens       │
                                              └────────┬────────────────┘
                                                       │ 5. db_url + db_token
                                                       ▼
                                              ┌─────────────────────────┐
                                              │ auth.users.user_metadata│
                                              │ { db_url, db_token }    │
                                              └────────┬────────────────┘
                                                       │ next page load
                                                       ▼
                                              ┌─────────────────────────┐
                                              │ Middleware: redirect to │
                                              │ /signup/provision       │
                                              └────────┬────────────────┘
                                                       │ 6. libSQL HTTP
                                                       ▼
                                              ┌─────────────────────────┐
                                              │ /api/provision          │
                                              │ → bootstrapSchema()     │
                                              │ → 0001_init.sql ...     │
                                              │ → settings row + secret │
                                              └────────┬────────────────┘
                                                       │ 7. empty state
                                                       ▼
                                              ┌─────────────────────────┐
                                              │ /dashboard              │
                                              │ "Welcome. Add your 1st  │
                                              │  student."              │
                                              └─────────────────────────┘
```

---

## 5. Why 1 User = 1 Turso DB

The architecture decision to give every tutor their own Turso database is load-bearing. The reasons, in order of importance:

### 5.1 Data Isolation

A bug in one tutor's schema migration cannot corrupt another tutor's data. A misconfigured RLS policy on a shared DB cannot leak one tutor's roster to another. The blast radius of any single bug is exactly one tutor.

### 5.2 Free-Tier Fit

Turso's free tier (as of 2025) includes 500 databases per organization. That covers the first 500 tutors at zero cost. Each DB has its own 9 GB storage limit and 1 billion row-reads-per-month limit — both far beyond what any individual tutor will hit. A single shared DB would hit the row-read limit much faster under multi-tenant load.

### 5.3 Sovereign Backup Story

A tutor can download their entire DB as an encrypted `.buddysaradhi` file (top-level `09_Backup_and_Import_Export.md`) and take it to a different host. The "export your DB" flow is trivial when the DB is already single-tenant.

### 5.4 Cross-Device Sync Simplifies

The libSQL embedded-replica sync protocol (mobile/desktop) is one-DB-to-many-devices. If the web app shared a multi-tenant DB, mobile/desktop would need to filter by `tenant_id` on every query — a constant source of bugs.

### 5.5 Performance Isolation

A slow query from one tutor (e.g. a 10-year ledger scan) cannot slow down another tutor. Turso's per-DB resource isolation handles this for us.

### 5.6 The Trade-Off

The cost: 500 separate DBs to manage (migrations, backups, monitoring). The mitigation: migrations are forward-only and idempotent; a script in `migrations/apply-to-all.ts` iterates the org's DBs and applies new migrations. Backups are per-user `.buddysaradhi` files. Monitoring is aggregate (Vercel Speed Insights on the web app; Turso's own metrics on the DBs).

---

## 6. Security — RLS Not Needed; Identity Root Is Supabase

### 6.1 Why No RLS

Row-Level Security (RLS) is a Postgres feature for **multi-tenant tables in a shared DB**. Buddysaradhi gives every tutor their own Turso DB; the `tenant_id` column on every table is constant within a DB. RLS would be redundant.

The defence-in-depth rationale for `tenant_id` (top-level `11_Data_Model.md` §1, P-DM1) is: if a future migration accidentally creates a shared table, `tenant_id` filters prevent cross-tenant leaks. But in v1, no table is shared.

### 6.2 The Identity Root

`auth.users` in Supabase is the identity root. Every Buddysaradhi feature that needs "who is the current user?" calls `supabase.auth.getUser()` server-side (or reads `session.user.id` from the SSR client). The `user.id` (UUID) is the `tenant_id`.

### 6.3 The Scoped JWT Boundary

The Turso `db_token` (scoped JWT) is the **only credential** that grants access to a tutor's DB. It is:

1. Created by the Edge Function (server-side, Deno).
2. Stored in `auth.users.user_metadata` (Supabase-side, encrypted at rest).
3. Read by the Next.js server (RSC, Server Action, `/api/*` route) via `cookies()` → Supabase SSR → `session.user.user_metadata.db_token`.
4. Passed to `@libsql/client` (`createClient({ url, authToken: dbToken })`).
5. **Never** reaches the Next.js client bundle. The lint rule `no-db-token-in-client` (in `eslint.config.js`) fails the build if `db_token` appears in any client-side chunk.

### 6.4 Logout — BR-SEC-04

On logout, the client calls `wipeLocalCache()` (see `02_State_and_Data_Flow.md` §5.3) and then `supabase.auth.signOut()`. The sign-out:

1. Clears the `sb-access-token` and `sb-refresh-token` cookies (Supabase SSR does this).
2. Revokes the session server-side (Supabase invalidates the refresh token).
3. The middleware's next request sees no session → redirects to `/login`.

The IndexedDB wipe is mandatory even though the data is encrypted at rest in Turso — a shared computer must not show the previous tutor's student list in the dashboard's TanStack cache.

### 6.5 The Lockout Discipline (Web)

Web lockout is the "tab hidden > 60s" rule (top-level `10_Security.md` §3.2). The `useSyncStore` listens for `visibilitychange` and calls `lock()` if `document.hidden` stays true past 60 seconds. The lock:

1. Blurs the content pane (CSS `backdrop-blur(24px)` over the GlassShell).
2. Disables the sidebar (`pointer-events: none`).
3. Mounts the unlock sheet (PIN entry or WebAuthn prompt).
4. Writes `audit_log` row `action='app_locked', actor='system'`.

Unlock is biometric-first (WebAuthn on web v1.x), PIN fallback. Five failed PINs → 240s lockout; ten cumulative → local cache wipe (top-level `10_Security.md` §3.5).

---

## 7. The Auth Route Map

| Route | Group | Auth Required | Purpose |
|---|---|---|---|
| `/login` | `(auth)` | No (redirect to `/dashboard` if logged in) | Email + OTP entry; Google OAuth button. |
| `/signup` | `(auth)` | No | Email entry; sends OTP. |
| `/verify` | `(auth)` | No (OTP-verified → session) | 6-digit OTP input. |
| `/signup/provision` | `(auth)` | Yes (session, no `db_url`) | Spinner page; calls Edge Function. |
| `/callback` | `(auth)` | No | OAuth redirect target; exchanges code for session. |
| `/dashboard` | `(app)` | Yes + provisioned | The 5 screens start here. |
| `/download` | `(marketing)` | No | Public download hub (Desktop/Mobile installers). |

---

## 8. Common Failures & Recovery

| # | Failure | Cause | Recovery |
|---|---|---|---|
| 1 | Stuck on `/signup/provision` | Edge Function 5xx; webhook not delivered | Retry button on the page calls the function directly; if still failing, tutor can contact support with their user UUID. |
| 2 | `UNPROVISIONED` error in RSC | `user_metadata.db_url` missing | Middleware should have caught this; if not, force a refresh (`window.location.reload()`). |
| 3 | `TURSO_TOKEN_EXPIRED` | Scoped JWT hit 1-year expiry | Settings → Diagnostics → "Rotate DB token" calls the Edge Function to issue a fresh token. |
| 4 | `AUTH_INVALID_JWT` | Supabase JWT expired (1h) but refresh failed | `supabase.auth.signOut()` → redirect to `/login`. |
| 5 | OAuth `redirect_mismatch` | `redirectTo` URL not in Supabase allowlist | Add the URL to Supabase Auth settings (Vercel preview URLs need wildcards). |
| 6 | `BOOTSTRAP_MIGRATION_FAILED` | A migration SQL is non-idempotent; first run succeeded, retry failed | Mark the migration as applied in `app_state.applied_migrations`; never edit the migration. |

---

## 9. Cross-References

- Top-level `10_Security.md` §2 — trust model, signup, service-role isolation.
- Top-level `10_Security.md` §3 — PIN/biometric lockout.
- Top-level `10_Security.md` §4 — BR-SEC-04 logout wipe.
- Top-level `11_Data_Model.md` §1 — P-DM1 single-tenant rule.
- Top-level `11_Data_Model.md` §11 — migration strategy.
- Top-level `AGENTS.md` Rule 2 — no network calls that process user data (Turso HTTP is the allowed exception).
- This directory's `01_Architecture.md` §6 — middleware code.
- This directory's `02_State_and_Data_Flow.md` §3.6 — schema bootstrap detail.
- This directory's `04_API_Routes.md` §3 — `/api/provision` contract.
- This directory's `05_Deployment_Vercel.md` §9 — Edge Function deploy.
- This directory's `07_Landing_Page.md §8.3` — the signup funnel as it lands on `/signup` from the commercial landing page's Hero CTA (`cta_hero_click`), and the `?plan={tier}` query parameter that propagates the pricing intent into `user_metadata.plan_intent` before the provisioning flow runs.

---

## 10. ASCII Art Mockup Suite (§20 Compliance)

Per `13_UI_Guidelines.md` §20.6, every web/ auth file must carry ≥ 2 ASCII art mockups. The mockups below complement the existing §4 full-flow diagram — they add three new views: (1) the signup funnel as a 7-step state machine with conversion-rate annotations, (2) the session/JWT lifecycle as a token-flow diagram, and (3) the scope diagram showing which credential reaches which surface. Every mockup sits inside a fenced code block per §20.3 rule 1; box widths stay within the 80–120 character desktop range per §20.3 rule 2; the §20.2 character set is in use; accent colours are named, never hexed; cross-references use canonical IDs only.

### 10.1 Design System Reference — Auth Surface

> **The single rule (§6.6) carried into the auth surface.** The `(auth)` route group renders a single centered glass card on the cosmic canvas — that is the only structural surface. Inside the card, the controls are: the OTP input wells, the submit button, and the Google OAuth button. Every surface is glass (per §5.5); every control is neumorphic (per §6.6).

| Surface (auth) | Glass tier | Where on web | Cross-ref |
|---|---|---|---|
| Auth centered card | `glass-strong` + `bg-black/60 + backdrop-blur-sm` backdrop | `(auth)/layout.tsx` | §5.5, §8.7 |
| Provisioning spinner card (full-page) | `glass` centered + spinner island | `/signup/provision` | §5.5, §8.20 (skeleton/empty) |
| Lockout overlay (when 5× PIN fail) | `glass-strong` + backdrop over GlassShell | `/dashboard` (transient) | §5.5, §8.7 |
| Toast (provisioning success / failure) | `glass-strong` + 4px accent bar | app-wide transient | §5.5, §8.8 |

| Control (auth) | Neumo recipe | Where on web | Cross-ref |
|---|---|---|---|
| Email input well | `neumo-inset`; focus → cyan inset ring + glow | `/login`, `/signup` | §6.6, §8.9 |
| OTP digit wells (6×) | `neumo-inset` per digit; active → cyan ring | `/verify` | §6.6, §8.9 |
| Submit button (primary) | `neumo-raised` + emerald glow | all auth forms | §6.6, §8.2 |
| Google OAuth button | `neumo-raised` transparent (no glow) | `/login`, `/signup` | §6.6, §8.2 |
| "Resend OTP" link | ghost (transparent, `--text-secondary`) | `/verify` | §8.2 |
| "Rotate DB token" button (`/settings`) | `neumo-raised`; PIN-gated (BR-SEC-02) | `/settings` security tab | §6.6, §8.2, BR-SEC-02 |

> **References.** Supabase Auth docs (`signInWithOtp`, `verifyOtp`, `@supabase/ssr` cookie strategy, `user_metadata` writes); Turso Platform API docs (`POST /v1/databases`, `POST /v1/databases/:name/auth/tokens`, scoped JWT expiration); Vercel Edge Functions docs (Supabase Deno Deploy runtime, webhook HMAC verification); Smashing Magazine — "A Guide To Securing React Apps With Supabase Auth"; CSS-Tricks — "Cookie-Based Auth In Next.js With Supabase"; OWASP Authentication Cheat Sheet (rate-limiting, OTP entropy, lockout windows). These are the same references cited in `README.md` §7.2.

### 10.2 Mockup M1 — Signup Funnel (7-Step State Machine, Conversion-Annotated)

The §4 narrative walked the 7-step flow linearly; this mockup shows it as a **state machine** with the conversion rate between each step (target percentages) and the recovery path for each failure mode. The point: every step has a known failure mode and a known recovery — a tutor who drops at Step 3 (Edge Function 5xx) lands on `/signup/provision` with a retry button, not a stuck spinner.

```
   Signup Funnel — 7-Step State Machine (web/(auth))
   Target end-to-end time: < 90 s (landing → /dashboard empty state)

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 0 — Landing CTA click                                                                      │
   │  surface: /  (marketing landing, Hero)                                                            │
   │  control: .neumo-raised primary CTA + emerald glow (§6.6 §8.2)                                   │
   │  event: cta_hero_click  →  navigate to /signup?plan={tier}                                       │
   │  conversion target: 100% (every visitor who clicks the CTA enters step 1)                        │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ≥ 95% (5% abandon at the email field)
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 1 — /signup (email entry)                                                                  │
   │  surface: .glass-strong centered card + bg-black/60 backdrop (§5.5 §8.7)                         │
   │  control: email input .neumo-inset (§6.6 §8.9); submit .neumo-raised (§6.6 §8.2)                 │
   │  call: supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '/verify' } })           │
   │  side-effect: auth.users row created with email_confirmed_at = NULL                              │
   │  conversion target: ≥ 95% → /verify                                                              │
   │  failure: INVALID_EMAIL (Zod) → flare helper text under input; user stays on /signup             │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ≥ 90% (10% OTP delivery failure or typo)
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 2 — /verify (6-digit OTP)                                                                  │
   │  surface: .glass-strong centered card (same shell)                                               │
   │  control: 6× .neumo-inset OTP wells (§6.6 §8.9); auto-advance; submit .neumo-raised              │
   │  call: supabase.auth.verifyOtp({ email, token: otp, type: 'email' })                             │
   │  side-effect: email_confirmed_at = now(); sb-access-token + sb-refresh-token cookies set         │
   │              (HTTP-only, Secure, SameSite=Lax); user.created webhook fires                       │
   │  conversion target: ≥ 90% → /signup/provision                                                    │
   │  failure: OTP_EXPIRED (5 min) → flare toast "OTP expired — resend"; user stays on /verify       │
   │           OTP_INVALID (3 attempts) → lockout 60 s; flare toast "Too many attempts — wait 60 s"   │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ≥ 99% (1% webhook delivery failure)
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 3 — Edge Function provision-db (Supabase Deno)                                             │
   │  surface: server-only (no UI); triggered by user.created webhook                                 │
   │  call: Turso Platform API POST /v1/databases → create db-{user.uuid}                             │
   │  side-effect: db_url + db_token written to auth.users.user_metadata (server-side, service-role)  │
   │  conversion target: ≥ 99% → Step 4                                                               │
   │  failure: 5xx → Supabase retries webhook 3× (exponential backoff); if still failing, middleware  │
   │           detects missing db_url on next page load → redirects to /signup/provision (manual      │
   │           retry path — see §3.4 of this file)                                                     │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ~100% (Turso Platform API is reliable)
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 4 — Turso Platform API creates db-{uuid}                                                   │
   │  surface: server-only (no UI)                                                                    │
   │  call: POST /v1/databases + POST /v1/databases/:name/auth/tokens (expiration: '1y')              │
   │  side-effect: scoped JWT issued; stored in auth.users.user_metadata.db_token                     │
   │  conversion target: ~100% → Step 5                                                               │
   │  failure: TURSO_API_FAILED → 500 to client; /signup/provision retry button calls /api/provision  │
   │           directly (idempotent — if db_url is already set, returns 200 without re-provisioning)  │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ~100%
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 5 — Scoped JWT (1-year expiry) stored in user_metadata                                     │
   │  surface: server-only (no UI)                                                                    │
   │  claims: { db_url: 'libsql://...', exp: <1y>, iss: 'turso' }                                     │
   │  ↑ NEVER reaches the Next.js client bundle — lint rule `no-db-token-in-client` fails the build   │
   │  conversion target: ~100% → Step 6                                                               │
   │  failure: token compromise → Settings → Diagnostics → "Rotate DB token" calls Edge Function      │
   │           again to issue a fresh token (BR-SEC-02 sensitive-action PIN gate)                     │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ~100%
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 6 — Client inits libSQL (@libsql/client HTTP)                                              │
   │  surface: /signup/provision (spinner card .glass centered, §5.5)                                 │
   │  control: spinner island (16px cyan ring); "Setting up your database…" caption                   │
   │  server-side: src/lib/turso/server.ts creates a per-request client                               │
   │  client-side: src/hooks/use-turso-client.ts NEVER calls libSQL directly — all reads go through   │
   │               Server Actions or /api/* routes (the scoped JWT must not be in the client bundle)  │
   │  conversion target: ~100% → Step 7                                                               │
   │  failure: TURSO_TOKEN_EXPIRED (1-year mark) → /api/cron/rotate-tokens rotates automatically      │
   │           30 days before expiry; if missed, Settings → Diagnostics → "Rotate DB token"           │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │  ~100%
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  Step 7 — Schema bootstrap (migrations 0001..0010)                                               │
   │  surface: server-only; client shows spinner until redirect                                      │
   │  call: bootstrapSchema(dbUrl, dbToken) → runs each migration in order (idempotent)               │
   │  side-effect: settings singleton row inserted (tenant_id, currency='INR', locale='en-IN',        │
   │              timezone='Asia/Kolkata', tenant_secret=256-bit random hex)                          │
   │  conversion target: ~100% → /dashboard (empty state, P15)                                        │
   │  failure: BOOTSTRAP_MIGRATION_FAILED → mark migration as applied in app_state.applied_migrations;│
   │           never edit the migration. Show flare toast "Setup failed — contact support with UUID." │
   └──────────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                                      │
                                                      ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
   │  /dashboard empty state                                                                          │
   │  surface: .glass empty-state card (§5.5 §8.19)                                                   │
   │  control: "Add your 1st student" CTA .neumo-raised + emerald glow (§6.6 §8.2)                    │
   │  copy: "Welcome to Buddysaradhi. Add your first student to get started." (sourced from product/)      │
   │  ↑ time_to_dashboard_ms event fired here (Vercel Web Analytics, TELE-1 compatible)               │
   └──────────────────────────────────────────────────────────────────────────────────────────────────┘

   ── Overall funnel conversion (landing → /dashboard empty state) ──────────────────────────────────────
     Step 0 → 1:  ≥ 95%     Step 1 → 2:  ≥ 90%     Step 2 → 3:  ≥ 99%
     Step 3 → 4:  ~100%     Step 4 → 5:  ~100%     Step 5 → 6:  ~100%
     Step 6 → 7:  ~100%     Step 7 → /dashboard: ~100%
     ─────────────────────────────────────────────
     Overall target: ≥ 85% of landing CTA clickers reach /dashboard empty state within 90 s
     ↑ measured by time_to_dashboard_ms (Speed Insights aggregate; TELE-1 compatible)
     ↑ failure modes are dominated by OTP delivery (Step 1→2) and human typing — not by infra
```

The state machine shows the 7 steps as nodes with three numbers each: the conversion target into the step, the call/side-effect, and the failure-mode recovery. The funnel narrows at Step 1→2 (OTP delivery — 10% drop target) and is ~100% from Step 3 onwards (infra is reliable once the user is authenticated). The overall target — 85% of CTA clickers reach `/dashboard` empty state within 90 seconds — is the contract the `time_to_dashboard_ms` Speed Insights event measures. Every failure has a recovery path that lands the user on a `.glass-strong` card with a retry button, not a stuck spinner.

### 10.3 Mockup M2 — Session / JWT Lifecycle (Token-Flow Diagram)

The §2 narrative described the SSR cookie strategy; this mockup shows the **token flow** across the four boundaries: Browser, Next.js Server, Supabase, and Turso. The point: the `sb-access-token` (1-hour JWT) and the `db_token` (1-year scoped JWT) live in different places and have different rotation cadences; the boundary between them is the Next.js server.

```
   Session / JWT Lifecycle — Token-Flow Diagram
   Four boundaries: Browser · Next.js Server · Supabase · Turso

   ┌──────────────┐       ┌─────────────────────┐       ┌──────────────┐       ┌──────────────┐
   │   Browser    │       │  Next.js Server     │       │   Supabase   │       │    Turso     │
   │  (client)    │       │  (RSC + Server      │       │  (auth +     │       │  (per-user   │
   │              │       │   Actions + /api)   │       │   user_meta) │       │   DB)        │
   └──────┬───────┘       └──────────┬──────────┘       └──────┬───────┘       └──────┬───────┘
          │                          │                         │                      │
          │  1. sb-access-token      │                         │                      │
          │     (HTTP-only cookie,   │                         │                      │
          │      Secure,             │                         │                      │
          │      SameSite=Lax,       │                         │                      │
          │      1-hour expiry)      │                         │                      │
          │  ──────────────────────► │                         │                      │
          │                          │  2. supabase.auth.      │                      │
          │                          │     getUser() via       │                      │
          │                          │     @supabase/ssr       │                      │
          │                          │     cookies() adapter   │                      │
          │                          │  ─────────────────────► │                      │
          │                          │                         │  3. verify JWT;      │
          │                          │                         │     return session   │
          │                          │  ◄───────────────────── │     { user: { id,    │
          │                          │                         │       email,         │
          │                          │  4. read user_metadata  │       user_metadata: │
          │                          │     .db_url + .db_token │       { db_url,      │
          │                          │     (already in JWT     │         db_token }   │
          │                          │      claims — no        │       }              │
          │                          │      extra round trip)  │       }              │
          │                          │                         │                      │
          │                          │  5. createClient({      │                      │
          │                          │     url: db_url,        │                      │
          │                          │     authToken: db_token │                      │
          │                          │   })                    │                      │
          │                          │  ─────────────────────────────────────────────► │
          │                          │                         │                      │  6. verify scoped
          │                          │                         │                      │     JWT; route to
          │                          │                         │                      │     db-{user.uuid}
          │                          │                         │                      │
          │                          │  7. db.batch([          │                      │
          │                          │     INSERT …,           │                      │
          │                          │     INSERT sync_outbox, │                      │
          │                          │     INSERT audit_log    │                      │
          │                          │   ])                    │                      │
          │                          │  ─────────────────────────────────────────────► │
          │                          │                         │                      │  8. atomic commit
          │                          │  ◄───────────────────────────────────────────── │
          │                          │  9. Result<Ok, { id }>  │                      │
          │  ◄─────────────────────  │                         │                      │
          │  10. HTML / RSC stream    │                         │                      │
          │      (no tokens in        │                         │                      │
          │       client bundle —     │                         │                      │
          │       only the rendered   │                         │                      │
          │       UI)                 │                         │                      │
          │                          │                         │                      │

   ── Rotation cadence ──────────────────────────────────────────────────────────────────────────────────
     sb-access-token  (1 h)    → Supabase auto-refreshes via sb-refresh-token cookie on next request
     sb-refresh-token (7 d)    → Supabase rotates on each use; revoked on signOut()
     db_token         (1 y)    → /api/cron/rotate-tokens rotates 30 d before expiry (BR-SEC-02 path)
     ↑ all three are HTTP-only cookies; none are readable from document.cookie (XSS defence)
     ↑ the lint rule `no-db-token-in-client` fails CI if db_token appears in any client chunk

   ── Logout wipe (BR-SEC-04) ───────────────────────────────────────────────────────────────────────────
     1. wipeLocalCache() — qc.clear() + idbClear() + every Zustand store .reset()
     2. supabase.auth.signOut() — clears sb-access-token + sb-refresh-token cookies server-side
     3. router.replace('/login') — full navigation; no client-side cache survives
     ↑ the wipe is mandatory even though Turso data is encrypted at rest — a shared computer must not
       show the previous tutor's roster in the dashboard's TanStack cache (10_Security.md §4)
```

The diagram shows the four boundaries and the seven-step token flow. The `sb-access-token` (1-hour JWT) lives in the browser cookie but is HTTP-only — never readable from `document.cookie`. The `db_token` (1-year scoped JWT) lives in Supabase's `user_metadata` and is read server-side via the Supabase SSR `cookies()` adapter; it NEVER reaches the Next.js client bundle. The boundary is the Next.js server: every libSQL call from a Client island goes through a Server Action or `/api/*` route, which reads the token server-side and forwards the libSQL HTTP call. The rotation cadence at the bottom shows the three tokens and their lifespans; the logout wipe (BR-SEC-04) clears all three plus every client-side cache.

### 10.4 Mockup M3 — Credential Scope Diagram (What Reaches Where)

The §6 narrative described why no RLS is needed; this mockup shows the **scope** of each credential — which surface can read it, which surface can use it, and which surface must never see it. The point: every credential has exactly one home and one consumer; a credential that leaks outside its scope is a security defect.

```
   Credential Scope Diagram — what reaches where, what must NEVER reach where

   Credential              │ Lives in                │ Used by                │ NEVER reaches
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   SUPABASE_SERVICE_ROLE   │ Vercel env (server-only)│ Edge Function           │ ✕ Client bundle
   _KEY                    │ Supabase project        │ (provision-db)          │ ✕ /api/* routes (only Edge
                           │ settings                │ Writes user_metadata    │   Function uses it)
                           │                         │ (db_url, db_token)      │ ✕ RSC tree
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   TURSO_API_TOKEN         │ Supabase Edge Function  │ Edge Function           │ ✕ Vercel env (NEVER in
   (org-scope)             │ env only                │ Creates db-{uuid},      │   Vercel — see 05 §3)
                           │                         │ issues scoped JWT       │ ✕ Client bundle
                           │                         │                         │ ✕ RSC tree
                           │                         │                         │ ✕ /api/* routes
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   db_token                │ auth.users.             │ Next.js Server (RSC +   │ ✕ Client bundle (lint rule
   (scoped JWT, 1 y)       │  user_metadata          │  Server Actions +       │   `no-db-token-in-client`)
                           │ (encrypted at rest)     │  /api/* routes) via     │ ✕ document.cookie
                           │                         │  @supabase/ssr          │ ✕ localStorage / IndexedDB
                           │                         │  cookies() adapter      │ ✕ Vercel Blob
                           │                         │ → createClient({        │ ✕ Third-party APIs (Rule 2)
                           │                         │    url, authToken })    │
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   sb-access-token         │ Browser cookie          │ Next.js Server          │ ✕ Client JS (HTTP-only;
   (Supabase JWT, 1 h)     │ (HTTP-only, Secure,     │ (via @supabase/ssr      │   document.cookie can't
                           │  SameSite=Lax)          │  cookies() adapter)     │   read it)
                           │                         │ → supabase.auth.getUser │ ✕ Turso (Supabase JWT is
                           │                         │                         │   not a Turso credential)
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   sb-refresh-token        │ Browser cookie          │ Supabase Auth (auto-    │ ✕ Client JS (HTTP-only)
   (Supabase, 7 d)         │ (HTTP-only, Secure,     │  refreshes sb-access-   │ ✕ Turso
                           │  SameSite=Lax)          │  token on each use)     │ ✕ Next.js Server (only
                           │                         │                         │   Supabase touches it)
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   tenant_secret           │ Per-user Turso DB       │ Per-user DB only        │ ✕ Everything outside that
   (256-bit random hex)    │ (app_state table)       │ (receipt tamper hash    │   one Turso DB
                           │                         │  pepper + PIN argon2id  │ ✕ Client bundle
                           │                         │  hash)                  │ ✕ Supabase
                           │                         │                         │ ✕ Vercel
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   PIN (user-chosen)       │ Per-user Turso DB       │ Per-user DB only        │ ✕ Everything outside that
                           │ (argon2id hash,         │ (SecurityEngine.challenge│   one Turso DB
                           │  peppered with          │  verifies; never        │ ✕ Client bundle (only the
                           │  tenant_secret)         │  decoded)               │   transient pinEntry slice
                           │                         │                         │   in useSettingsStore, NEVER
                           │                         │                         │   persisted — §4.2 rule 4 of
                           │                         │                         │   02_State_and_Data_Flow.md)
   ────────────────────────┼─────────────────────────┼────────────────────────┼─────────────────────────────
   ENCRYPTION_KEY          │ Vercel env (server-only)│ /api/* routes that      │ ✕ Client bundle
   (32-byte AES)           │                         │  encrypt/decrypt Vercel │ ✕ Supabase
                           │                         │  Blob manifests         │ ✕ Turso
                           │                         │                         │ ✕ Edge Function

   ── The four boundaries, restated ─────────────────────────────────────────────────────────────────────
     Browser    : sb-access-token (cookie, HTTP-only) + sb-refresh-token (cookie, HTTP-only)
     Next.js    : db_token (read from Supabase JWT via cookies()) + ENCRYPTION_KEY (Vercel env)
     Supabase   : auth.users + user_metadata (stores db_url, db_token) + service-role key
     Turso      : per-user db-{uuid} (holds tenant_secret + PIN argon2id hash + sync_outbox + ledger)

   ── The two credentials that NEVER cross a boundary ──────────────────────────────────────────────────
     ✕ TURSO_API_TOKEN  → Supabase Edge Function env only (NEVER Vercel — see 05_Deployment_Vercel.md §3)
     ✕ tenant_secret    → per-user Turso DB only (NEVER exported; the receipt hash pepper is internal)
```

The scope diagram shows seven credentials and their three columns: where they live, who uses them, and who must never see them. The two credentials that NEVER cross a boundary are `TURSO_API_TOKEN` (lives in Supabase Edge Function env only — never in Vercel env, per `05_Deployment_Vercel.md` §3) and `tenant_secret` (lives in the per-user Turso DB only — never exported, even to Supabase or Vercel). The `db_token` is the load-bearing credential: it lives in Supabase's `user_metadata`, is read by the Next.js server, and is passed to `@libsql/client` — but it must never reach the client bundle, `document.cookie`, `localStorage`, or any third-party API. The lint rule `no-db-token-in-client` (in `eslint.config.js`) fails the build if `db_token` appears in any client-side chunk — the rule is the gate, this diagram is the contract.

---

*Auth and provisioning in this file is the contract. When a flow, a token claim, or a redirect diverges, the spec wins — unless the spec is wrong, in which case you amend this file first, then the code, then the worklog.*
