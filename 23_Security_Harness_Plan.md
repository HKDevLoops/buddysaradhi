# 23 — Security Harness Plan

> Buddysaradhi holds a tutor's livelihood and a minor's personal data. `10_Security.md` is the SPEC — the trust model, the crypto envelope, the secure-erase flow, the audit chain, the PIN/biometric architecture. **This file is the HARNESS** — the automated enforcement of every control in `10_Security.md`, the cross-platform threat surface (web + Expo + Tauri + CF Workers gateway + Upstash + Turso + Vercel Blob), the SDLC gate that makes "bugless code" mechanically real, and the incident-response runbook aligned to India's DPDP Act 2023 + DPDP Rules 2025. Where `10_Security.md` says *what controls exist*, this file says *how they are enforced automatically, where the attack surfaces are on every platform, when the breach-notification clock starts*.
>
> **Source of truth:** `research_R-SECURITY-HARNESS.md` (40 web searches + 20 primary-source fetches). Every URL citation in this file comes from that research document. Four claims are explicitly carried forward as **UNVERIFIED** (see §13.6 caveats): (1) the exact hour-window under DPDP Rule 7 breach intimation; (2) Upstash at-rest encryption availability on the *free* tier; (3) Turso native encryption GA status (currently `--experimental-encryption`); (4) the exact patched Next.js release for CVE-2025-66478 (RCE).
>
> **Last updated: Task 23-SECURITY-HARNESS**

---

## 0. What This File Adds (vs `10_Security.md`)

This file is the **enforcement**, the **threat surface**, and the **incident response**. `10_Security.md` is the **control**. The non-overlap statement: a reader looking up "what is the PIN-lockout policy?" reads `10_Security.md §3.5`; a reader looking up "how is the PIN-lockout policy verified in CI on every platform?" reads this file. The two are complements, not duplicates.

| Dimension | `10_Security.md` — the SPEC | `23_Security_Harness_Plan.md` — the HARNESS |
|---|---|---|
| **Purpose** | What controls exist | How those controls are automatically enforced + the cross-platform threat surface + the SDLC gate + the incident-response runbook |
| **Trust model** | Asset/owner/boundary table (§1) | The 4 attack surfaces + shared spine (§1 of this file) |
| **Auth** | Supabase session, PIN/biometric, lockout (§2, §3) | Supabase RS256 + JWKS migration, refresh-token rotation with reuse-detection, per-platform token storage (httpOnly / expo-secure-store / OS keyring) (§2 of this file) |
| **Multi-tenant isolation** | 1-user-1-Turso-DB invariant + RLS (§2.1, §7) | Gateway `tutorId→dbUrl` HMAC-signed in Upstash + the `no-hardcode` lint + `service_role`-never-in-client CI rule (§3 of this file) |
| **Injection defence** | Zod + parameterised SQL + VACUUM exception (§11, §18) | OpenAPI+Zod contract spine + Tauri capabilities with no `remote:` block + Next.js ≥16.2.10 pin (UNVERIFIED exact patched release) + ESLint `react/no-danger` (§4 of this file) |
| **Supply chain** | SBOM + gitleaks in CI (§23.1) | Tauri updater signature mandatory + npm Sigstore provenance + CycloneDX SBOM + OSV-Scanner + license-checker — with the CI gate order (§5 of this file) |
| **Transport** | TLS 1.3, cert pinning, WSS (§6) | CSP header lint + Tauri no-localhost lint + WS Origin-validation test + replay window via nonce+timestamp (§6 of this file) |
| **Data at rest** | `.buddysaradhi` AES-256-GCM + Argon2id (§15) | Turso native AES-256-GCM page encryption (NEW per research) + Upstash Prod Pack + Vercel Blob OIDC + nonce-uniqueness test (§7 of this file) |
| **API gateway** | (was sandbox-local Caddy + BFF in 10's CI notes) | CF Workers + Durable Object rate-limit authority + Idempotency-Key SETNX dedup + replay window via nonce+timestamp + `wrangler secret put` (§8 of this file) |
| **Client-side** | Web CSP + mobile secure store + desktop SQLCipher (§12, §13, §14) | `rnsec` 85+ rules linter + Tauri capabilities minimal allowlist + Next.js 16 nonce-CSP header test (§9 of this file) |
| **Audit log** | Schema, hash chain, retention (§8) | Hash-chain already implemented; ADD impossible-travel detector + bulk-export anomaly + DPDP-aligned breach runbook (§10 of this file) |
| **SDLC** | High-level CI/CD harness (§23) | Full `.github/workflows/security.yml` skeleton + Semgrep custom rules (no-hardcode, never-mock-the-ledger, integer-paise) + OWASP ZAP nightly + the GitHub-required-status-check set (§11 of this file) |
| **Pen-test** | Quarterly threat-model review + annual third-party pen-test (§24.2) | The hard production-readiness gate: no P0/S1 vuln open + SAST clean + DAST baseline clean + secrets scan clean + SBOM generated + DPDP-compliant data-handling verified + pen-test passed or documented-exception (§12 of this file) |

**Non-overlap invariant (HARNESS-0):** if a paragraph in this file duplicates a paragraph in `10_Security.md`, the paragraph belongs in `10_Security.md`. This file references, enforces, and extends — it does not restate.

---

## 1. The Cross-Platform Threat Surface

Buddysaradhi runs on four platforms against one shared spine. Each platform has its own top-3 threats; the spine is shared so a weakness in one spine component (e.g. Supabase JWKS rotation) ripples to all four surfaces. The harness is designed so that a control failure on one surface cannot cascade to the others — defence in depth across the boundary.

```
   ┌─────────────────────────────────────────────────────────────────────┐
   │              THE BUDDYSARADHI CROSS-PLATFORM THREAT SURFACE          │
   │      four platforms · one shared spine · one contract tag            │
   └─────────────────────────────────────────────────────────────────────┘

   ┌─ SURFACE 1 · WEB ──────────┐   ┌─ SURFACE 2 · MOBILE ───────────┐
   │ Next.js 16 on Vercel       │   │ Expo SDK 52 / RN 0.76          │
   │ RSC + small client islands │   │ EAS Build · TestFlight + Play  │
   │ httpOnly cookies (Supabase)│   │ expo-secure-store (Keychain/   │
   │ CSP (nonce) + HSTS + COOP  │   │   Keystore) + requireAuth      │
   │                            │   │                                 │
   │ top 3 threats:             │   │ top 3 threats:                 │
   │  (1) XSS via dangerously-  │   │  (1) rooted/jailbroken device  │
   │      SetInnerHTML          │   │      extracting Keychain       │
   │  (2) CVE-2025-66478 RCE    │   │  (2) APK reverse-eng (apktool) │
   │      (UNVERIFIED patch ver)│   │  (3) StrandHogg task hijack    │
   │  (3) CSRF on ledger mut.   │   │      (taskAffinity leak)       │
   └─────────────┬──────────────┘   └─────────────┬───────────────────┘
                 │                                 │
                 │   HTTPS relative paths under one edge base
                 │   NEXT_PUBLIC_API_BASE / EXPO_PUBLIC_API_BASE
                 │                                 │
   ┌─ SURFACE 3 · DESKTOP ──────┐   ┌─ SURFACE 4 · GATEWAY ──────────┐
   │ Tauri v2 WebView           │   │ CF Workers + Durable Objects   │
   │ OS keyring + Stronghold    │   │ Upstash Redis + QStash         │
   │ minisign updater (mandat.) │   │ CF D1 audit_log (gateway-owned)│
   │                            │   │                                 │
   │ top 3 threats:             │   │ top 3 threats:                 │
   │  (1) over-permissive IPC   │   │  (1) replay / double-charge on │
   │      (capabilities scope)  │   │      ledger mutation           │
   │  (2) DNS-rebinding against │   │  (2) stale JWKS allowing revo- │
   │      the localhost plugin  │   │      ked-key JWT acceptance    │
   │  (3) unsigned updater      │   │  (3) cold-start secret leak via│
   │      (mitigated: mandator.)│   │      console.log(process.env)  │
   └─────────────┬──────────────┘   └─────────────┬───────────────────┘
                 │                                 │
                 └────────────────┬────────────────┘
                                  │
                                  ▼
   ┌─ SHARED SPINE ─────────────────────────────────────────────────────┐
   │  Supabase Auth (RS256 + JWKS, asymmetric keys, edge-cached 10 min) │
   │  Turso / libSQL (1-user-1-DB, NEW native AES-256-GCM page encr.)  │
   │  Upstash Redis (TLS always on; at-rest = Prod Pack add-on)        │
   │  Vercel Blob (AES-256 at rest; private stores; OIDC preferred)    │
   │  CF D1 audit (gateway-owned, hash-chained, append-only)           │
   │  .buddysaradhi envelope (AES-256-GCM + Argon2id m=64MiB t=3 p=2)  │
   └────────────────────────────────────────────────────────────────────┘
```

### 1.1 Per-surface top-3 threat paragraphs

**Web (Surface 1).** The Next.js 16 app on Vercel is the most-exposed surface because it serves a public hostname (`buddysaradhi.app`) and renders user-supplied content (student notes, receipt descriptions). The top three threats are: (1) **XSS via `dangerouslySetInnerHTML`** in client components — mitigated by ESLint `react/no-danger` + Zod validation + DOMPurify on rich text + Next.js 16 server-component auto-escaping (per `10_Security.md §11`); (2) **CVE-2025-66478 RCE** — a critical Next.js remote-code-execution vulnerability disclosed December 2025 ([nextjs.org/blog/security-update-2025-12-11](https://nextjs.org/blog/security-update-2025-12-11); [praetorian.com/blog/critical-advisory-remote-code-execution-in-next-js-cve-2025-66478-with-working-exploit](https://www.praetorian.com/blog/critical-advisory-remote-code-execution-in-next-js-cve-2025-66478-with-working-exploit)), patched in current 16.x — mitigated by pinning Next.js to `>=16.2.10` **(UNVERIFIED: exact patched release — the advisory URL does not name a specific patch version, only "current 16.x")** and by Dependabot/OSV-Scanner auto-PRs (§5); (3) **CSRF on ledger mutations** — mitigated by `SameSite=Lax` cookies, the `Idempotency-Key` header (§8.1), and the OpenAPI+Zod contract that rejects out-of-shape POST bodies (§4).

**Mobile / Expo (Surface 2).** The Expo SDK 52 / RN 0.76 app on EAS Build distributes an `.apk`/`.ipa` to a tutor's phone — a hostile environment (rooted Android, jailbroken iOS, reverse-engineering tools like `apktool`). The top three threats are: (1) **rooted/jailbroken device extracting Keychain/Keystore** — mitigated by soft root detection (`10_Security.md §13.4`), `expo-secure-store` with `requireAuthentication: true`, and `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`; (2) **APK reverse-engineering** — mitigated by R8/ProGuard obfuscation (EAS Build handles this), and by keeping sensitive logic (PIN verify, envelope decryption) in platform-native crypto (Keychain/Keystore) rather than JS (per research S8); (3) **StrandHogg task hijacking** — the Android task-affinity vulnerability that lets a malicious app overlay the legitimate UI — mitigated by `rnsec` linter rule `ANDROID_TASK_AFFINITY_VULNERABILITY` enforcing `taskAffinity=""` on all activities (per `rnsec.dev/docs/security-rules`). The OWASP MASVS 2.1 baseline ([mas.owasp.org/MASVS](https://mas.owasp.org/MASVS)) + the new MASVS-PRIVACY category ([mas.owasp.org/news/2024/01/18/masvs-v210-release--masvs-privacy](https://mas.owasp.org/news/2024/01/18/masvs-v210-release--masvs-privacy)) is the spec; `rnsec` + MASTG is the harness (§9).

**Desktop / Tauri v2 (Surface 3).** The Tauri v2 desktop binary runs a WebView2/WebKit sandbox on Windows/macOS/Linux, with all FS/DB/shell operations gated by per-window **capabilities** files. The top three threats are: (1) **over-permissive IPC capabilities** — a capability file that grants `fs:allow-read-dir` without a scope, or that enables a `shell:allow-execute` allowlist that includes `cmd.exe`, defeats the boundary — mitigated by a restrictive single `src-tauri/capabilities/main.json` with only the specific scopes the app needs, plus a CI test that fails if the file grows beyond a manual threshold (`tauri-capabilities-minimal.test.ts`); (2) **DNS-rebinding against the Tauri localhost plugin** — a malicious website resolves its own hostname to `127.0.0.1` and invokes Tauri IPC — the Tauri docs themselves carry a "considerable security risks" warning ([v2.tauri.app/ko/plugin/localhost](https://v2.tauri.app/ko/plugin/localhost)) — mitigated by *not using the localhost plugin at all* and using Tauri's default `tauri://` custom protocol, plus a CI lint that fails if `tauri-plugin-localhost` appears in `Cargo.lock`; (3) **unsigned updater** — a malicious `.dmg`/`.deb`/`.exe` masquerading as a Buddysaradhi update — mitigated by the **mandatory** Tauri updater signature (`TAURI_SIGNING_PRIVATE_KEY` as a GitHub Actions secret, signature checked before any patch applies, "cannot be disabled" per [v2.tauri.app/plugin/updater](https://v2.tauri.app/plugin/updater)).

**Gateway / CF Workers (Surface 4).** The Cloudflare Workers gateway at `api.buddysaradhi.app` is the single network chokepoint — every platform's HTTPS call transits it. The top three threats are: (1) **replay / double-charge on ledger mutations** — a captured `POST /api/v1/ledger/entries` request replayed by an attacker (or auto-replayed by a retrying mobile SDK) — mitigated by the `Idempotency-Key` header deduped via Upstash Redis `SETNX` with 24h TTL + the replay window (nonce + timestamp ±5 min) (§8.1); (2) **stale JWKS allowing revoked-key JWT acceptance** — if the gateway caches Supabase's JWKS too long, a key Supabase has rotated out is still accepted — mitigated by a 10-min JWKS cache TTL in Upstash Redis (`jwks:supabase`) + 20-min hard revalidate + reject any `kid` not in current JWKS to force a re-fetch ([supabase.com/docs/guides/auth/signing-keys](https://supabase.com/docs/guides/auth/signing-keys)); (3) **cold-start secret leak** — a `console.log(process.env)` in a Worker function exposing `SUPABASE_SERVICE_ROLE` to Cloudflare's logs — mitigated by a Semgrep rule `no-console-log-env` that fails any `console.log(process.env.*)` in `workers/gateway/` + the rule that all Worker secrets come from `wrangler secret put` (encrypted at rest by CF, distinct from plaintext `[vars]` per [developers.cloudflare.com/workers/configuration/secrets](https://developers.cloudflare.com/workers/configuration/secrets)).

The **shared spine** is the load-bearing trust boundary. A spine weakness (Supabase JWKS misconfiguration, Turso DB URL leaked, Upstash token committed to git) breaks all four surfaces at once. The harness therefore treats the spine as a separate defence-in-depth layer: every spine secret is in a per-vendor secrets store (Supabase Vault, CF Workers secrets, Turso Platform API token in GitHub Actions, Upstash REST token in `wrangler secret put`), every spine call is over TLS 1.3, and every spine access from a client is mediated by the gateway (the no-hardcode rule of `17_API_Gateway_System.md §2.2` forbids any client from holding a Turso URL or Blob token).

---

## 2. S1 — Authentication & Session Security

**Findings (from research S1).** Supabase supports asymmetric JWT signing keys (RS256/ES256) with JWKS at `/auth/v1/.well-known/jwks.json`, edge-cached 10 min, client-cache +10 min ⇒ 20-min total cache; the legacy HS256 shared secret is "not recommended for production applications" ([supabase.com/docs/guides/auth/signing-keys](https://supabase.com/docs/guides/auth/signing-keys)). OWASP Top 10 2025 lists **A07 — Identification and Authentication Failures** as a top-tier risk ([owasp.org/Top10/2025/A07_2025-Authentication_Failures](https://owasp.org/Top10/2025/A07_2025-Authentication_Failures)). OWASP MASVS 2.1 (Jan 2024 release, current in 2025) added the dedicated **MASVS-PRIVACY** category alongside MASVS-AUTH-1/2/3, MASVS-STORAGE, MASVS-CRYPTO, MASVS-NETWORK, MASVS-RESILIENCE ([mas.owasp.org/MASVS](https://mas.owasp.org/MASVS); [mas.owasp.org/news/2024/01/18/masvs-v210-release--masvs-privacy](https://mas.owasp.org/news/2024/01/18/masvs-v210-release--masvs-privacy)). OWASP ASVS 4.0.3 is the current web baseline; session chapter V3 mandates rotate-on-auth, idle + absolute timeouts, and refresh-token rotation ([owasp.org/www-project-application-security-verification-standard](https://owasp.org/www-project-application-security-verification-standard); [github.com/OWASP/ASVS](https://github.com/OWASP/ASVS)). Refresh-token rotation with reuse-detection is the standard pattern; rotation invalidates the entire family on replay ([authjs.dev/guides/refresh-token-rotation](https://authjs.dev/guides/refresh-token-rotation)). `expo-secure-store` stores values in iOS Keychain (`kSecClassGenericPassword`) and Android Keystore; `requireAuthentication: true` ties access to a biometric prompt; the key is *automatically invalidated* when biometrics change ([docs.expo.dev/versions/latest/sdk/securestore](https://docs.expo.dev/versions/latest/sdk/securestore)).

### 2.1 Controls (concrete, per platform)

| Platform | Token storage | Refresh strategy | Verification |
|---|---|---|---|
| **Web (Next.js 16)** | `@supabase/ssr` httpOnly + Secure + SameSite=Lax cookies | Auto-refresh on the server (server component) | Refresh-token rotation with reuse-detection (family revocation on replay) |
| **Mobile (Expo SDK 52)** | `expo-secure-store` with `keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY` + `requireAuthentication: true` for the envelope-key handle | SDK refresh-on-401, silent | Biometric release of envelope key (PIN never reconstructed) |
| **Desktop (Tauri v2)** | OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service) via `tauri-plugin-stronghold` or the `keyring` Rust crate; **never** `localStorage` | SDK refresh-on-401, silent | Same biometric envelope-key pattern as mobile |
| **Gateway (CF Workers)** | JWT in `Authorization: Bearer` (per request, not stored) | Gateway verifies RS256 against cached JWKS; rejects `kid` not in current JWKS → forces re-fetch | JWKS cached in Upstash Redis `jwks:supabase` (TTL 10 min) + 20-min hard revalidate |

### 2.2 The Supabase RS256 migration

`10_Security.md §2.3` already intends the asymmetric-key migration. This file's contribution is the **mechanical migration steps**:

1. In the Supabase project dashboard → Settings → API → JWT Signing Keys → generate an RS256 keypair.
2. Set the new asymmetric key as the current signing key; the legacy HS256 secret remains as a "previous key" for a 7-day migration window.
3. Deploy the gateway with the JWKS-fetch logic (`jwks:supabase` Upstash key, 10-min TTL, 20-min hard revalidate, reject unknown `kid`).
4. Verify the migration with the `jwks-cache-ttl.test.ts` CI test asserting the gateway's JWKS cache TTL ≤ 600s.
5. After 7 days, remove the HS256 key entirely. The migration is zero-downtime because both keys are accepted during the window.

### 2.3 The PIN derivation path

The Argon2id parameters in `10_Security.md §3.4` (`m=64 MiB, t=3, p=2`) exceed the OWASP cheat-sheet minimum (`m≥19 MiB, t≥2, p≥1`). This file adds: a CI test `pin-hash-argon2id.test.ts` (existing in `10_Security.md §24.1`) asserts the parameters programmatically — a regression to `m=16 MiB` would fail the test. The pepper (`tenant_secret`) means a stolen DB file cannot be brute-forced offline without `tenant_secret`, which is itself encrypted at rest. **Cross-ref `10_Security.md §6`** for the at-rest table.

### 2.4 Automation (the harness)

| Tool / rule | Scope | Failure mode |
|---|---|---|
| `eslint-plugin-security` + `@next/eslint-config-next` | web, gateway | lint error |
| Semgrep rule `no-supabase-token-in-localStorage` | web | blocks `localStorage.setItem('sb-…')` |
| `pin-hash-argon2id.test.ts` | all platforms (spine) | unit test failure if Argon2id params regress |
| `biometric-releases-envelope-key.test.ts` | mobile, desktop | integration test failure |
| `jwks-cache-ttl.test.ts` | gateway | CI test failure if JWKS TTL > 600s |
| Snyk Open Source (`security.snyk.io/package/npm/dependency-check`) | all | fails PR on vulnerable `@supabase/supabase-js` |

---

## 3. S2 — Authorization & Multi-Tenant Isolation

**Findings (from research S2).** Database-per-tenant is Turso's recommended multi-tenant pattern for apps with strict isolation needs ([turso.tech/multi-tenancy](https://turso.tech/multi-tenancy); [turso.tech/blog/database-per-tenant-architectures-get-production-friendly-improvements](https://turso.tech/blog/database-per-tenant-architectures-get-production-friendly-improvements); [turso.tech/blog/working-with-clerk-and-per-user-databases](https://turso.tech/blog/working-with-clerk-and-per-user-databases)). OWASP Top 10 2025 ranks **A01 — Broken Access Control** as the #1 risk ([owasp.org/Top10/2025/A01_2025-Broken_Access_Control](https://owasp.org/Top10/2025/A01_2025-Broken_Access_Control)). The OWASP Non-Human Identities Top 10 (2025) ranks *Overprivileged NHI* as #5 — applies to the Supabase `service_role` key ([owasp.org/www-project-non-human-identities-top-10/2025/5-overprivileged-nhi](https://owasp.org/www-project-non-human-identities-top-10/2025/5-overprivileged-nhi)). Supabase RLS must be enabled on every shared table; policies must use `auth.uid()` and never bypass with `service_role` from client code ([makerkit.dev/blog/tutorials/supabase-rls-best-practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices); [supabase.com/features/row-level-security](https://supabase.com/features/row-level-security)).

### 3.1 The architectural invariant

**1 user = 1 Turso DB** is the primary isolation control (`10_Security.md §2.1`). This is the load-bearing design choice: because each tutor's data lives in a *separate* libSQL database, there is **no `tenant_id` column to forget in a `WHERE` clause** — the database itself is the tenant boundary. A misrouted request (tutor A's request reads tutor B's DB) is the only way to cross the boundary, and that misroute is what this section's controls prevent.

### 3.2 The gateway route table

The gateway resolves `tutorId → dbUrl` from Upstash Redis (`tutor:{tutorId}:dburl`, TTL 1h) with a fallback to Supabase `user_metadata.db_url` (set by the provision-db Edge Function — `17_API_Gateway_System.md §5.1`). **Cache-poisoning defence:** the cache key is `tutorId` (not user-controllable — it comes from the verified JWT `sub` claim) and the cached value is **HMAC-signed** with a gateway-only key. A poisoned cache entry (an attacker who somehow writes to Upstash) would have an invalid HMAC and be rejected; the gateway falls back to Supabase `user_metadata` and re-signs.

```
   client request → gateway stage 2 AUTH verifies JWT (RS256) → ctx.tutorId = "t_7"
                                                                │
                                                                ▼
   ┌─ stage 7 STORAGE · resolve tutorId → dbUrl ───────────────────────────┐
   │  1. GET tutor:t_7:dburl from Upstash Redis (TTL 1h)                    │
   │  2. if HIT: verify HMAC signature                                      │
   │     - valid   → use the cached dbUrl                                   │
   │     - invalid → fall through to Supabase (poisoning defence)           │
   │  3. if MISS: fetch Supabase user_metadata.db_url                       │
   │     → sign with HMAC(gateway_key, dbUrl)                               │
   │     → SET tutor:t_7:dburl signed_value EX 3600                         │
   │  4. resolve PrismaClient from module Map<tutorId, PrismaClient> (LRU)  │
   │  5. if route is a mutation → write to audit_log (CF D1, hash-chained)  │
   │     in the same logical operation (BR-SEC-06 fail-closed)              │
   └─────────────────────────────────────────────────────────────────────────┘
```

The gateway route table itself is append-only and audit-logged; a misroute writes `E_TENANT_MISROUTE` to the gateway's CF D1 audit DB and fails closed (the request returns `403 forbidden`, never reads the wrong DB).

### 3.3 The `service_role` isolation rule

The Supabase `service_role` key lives **only** in (a) the provision-db Supabase Edge Function env (per `17_API_Gateway_System.md §5.1` — it must never cross a vendor boundary) and (b) the gateway Worker's CF-encrypted secrets (set via `wrangler secret put SUPABASE_SERVICE_ROLE`). It is **never** in a client bundle. The mechanical enforcement:

- ESLint rule `no-restricted-syntax` blocks any `import` of `process.env.SUPABASE_SERVICE_ROLE` outside `apps/web/server/` and `workers/gateway/src/`.
- CI test `no-service-role-in-client.test.ts` fails the build if `service_role` appears in any client-bound chunk (it scans the Vercel build output and the EAS bundle).
- Semgrep rule `no-hardcode-db-url` matches `libsql://` literals in `apps/web/`, `apps/mobile/`, `apps/desktop/` — Turso URLs (which embed the auth token) must never appear in client source.

### 3.4 RLS on shared Supabase tables

The per-tutor Turso DBs need no `tenant_id` column (the database is the tenant). But the Supabase Postgres shared tables (the `auth.users` join, any future `tutor_profiles` shared table, the Supabase storage bucket metadata) **do** carry `tenant_id` and **must** have RLS enabled with `auth.uid()`-based policies. The CI lint `tenant-predicate-required` (existing in `10_Security.md §24.1`) covers any shared table; it fails the build if a tenant-scoped shared table is queried without the predicate. **Cross-ref `17_API_Gateway_System.md §2.2`** (no-hardcode rule) and **`10_Security.md §7`** (RLS defence-in-depth).

### 3.5 Automation

| Test / rule | Verifies |
|---|---|
| `tenant-predicate-required.test.ts` (existing lint) | Every shared Supabase table query has `WHERE tenant_id = ?` |
| `gateway-route-signature.test.ts` (NEW) | The `tutorId → dbUrl` cache value is HMAC-signed; an unsigned value fails |
| `no-service-role-in-client.test.ts` (existing) | `service_role` never in a client-bound bundle |
| `no-hardcode-db-url` Semgrep rule (NEW) | No `libsql://` literals in `apps/*/` |

---

## 4. S3 — Input Validation & Injection

**Findings (from research S3).** Prisma's `$queryRaw` and `$executeRaw` as **tagged templates** are parameterised and safe; `$queryRawUnsafe(string)` is not. Prisma's docs explicitly warn that string interpolation inside a tagged template can still inject ([prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries); [nodejs-security.com/blog/prisma-raw-query-sql-injection](https://www.nodejs-security.com/blog/prisma-raw-query-sql-injection); [dev.to/whoffagents/sql-injection-prevention-with-prisma-where-the-protection-breaks-and-how-to-fix-it-128d](https://dev.to/whoffagents/sql-injection-prevention-with-prisma-where-the-protection-breaks-and-how-to-fix-it-128d)). Tauri v2 capabilities gate every command, scope, and asset-protocol access by a per-window, per-platform capability file in `src-tauri/capabilities/`; **remote API access is disabled by default** — enabling `remote: { urls: [...] }` is the documented opt-in ([v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities)). Next.js 16 nonce-based CSP is the recommended pattern ([nextjs.org/docs/app/guides/content-security-policy](https://nextjs.org/docs/app/guides/content-security-policy)). Zod v3+ is the canonical schema validator for TypeScript-first OpenAPI generation ([v3.zod.dev](https://v3.zod.dev); [daily.dev/posts/the-zod-canonical-a-contract-first-architecture-for-speed-coding-gytm5fpb8](https://daily.dev/posts/the-zod-canonical-a-contract-first-architecture-for-speed-coding-gytm5fpb8)).

### 4.1 The OpenAPI + Zod contract spine

The OpenAPI 3.1 document `contracts/openapi.json` is the single source of truth (`17_API_Gateway_System.md §2`). Every gateway route validates request body + params against a Zod schema generated from OpenAPI; the response is validated against the OpenAPI response schema before sending. A client literally cannot construct an out-of-contract request — the SDK has no function for it; the gateway rejects any request that doesn't match with `400 contract_violation`. **Cross-ref `17_API_Gateway_System.md §8`** (the error contract).

### 4.2 The VACUUM exception

`10_Security.md §18` confines the single raw-SQL exception (`VACUUM`) to `lib/db/admin.ts` — a SQLite admin command with no Prisma ORM equivalent. This file adds: a **Semgrep rule `no-queryRawUnsafe`** that flags any new `$executeRaw` / `$queryRawUnsafe` *outside* `lib/db/admin.ts`. The existing `ledger-no-delete.test.ts` is extended to also block `$executeRaw` against `ledger_entries`. **Cross-ref `11_Data_Model.md §10`** (ORM discipline) and **`17_API_Gateway_System.md §8`** (error contract).

### 4.3 Path traversal in restore

The `.buddysaradhi` restore path resolves through `path.resolve()` and asserts the normalised path `startsWith` the app's data directory; `..` components are rejected. This is already implied by `10_Security.md §11` (sandboxed parser); this file makes it explicit via a CI test `restore-path-traversal.test.ts` that feeds `../../etc/passwd` as the restore target and asserts rejection.

### 4.4 Tauri capabilities — no `remote:` block

Ship a single `src-tauri/capabilities/main.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Buddysaradhi desktop — minimal capability",
  "windows": ["main"],
  "permissions": [
    "core:path:default",
    "core:event:default",
    "core:window:default",
    { "identifier": "fs:allow-read-file", "allow": [{ "path": "$APPDATA/buddysaradhi/*" }] },
    { "identifier": "fs:allow-write-file", "allow": [{ "path": "$APPDATA/buddysaradhi/*" }] },
    { "identifier": "fs:allow-read-file", "allow": [{ "path": "$DOWNLOAD/*" }] }
  ]
}
```

No `remote:` block → all IPC is bundled-code-only. The CI test `tauri-capabilities-no-remote.test.ts` parses `src-tauri/capabilities/*.json` and fails if any `remote` key is present. **Cross-ref `desktop/03_IPC_Security.md`** for the deeper capability model.

### 4.5 XSS defence

Next.js 16 server components auto-escape; `dangerouslySetInnerHTML` is forbidden via ESLint `react/no-danger`. Rich text (student notes, receipt descriptions) is sanitised with DOMPurify before render. Receipt PDFs render server-side via `pdfkit` (no DOM, no XSS surface).

### 4.6 The Next.js CVE-2025-66478 pin

Next.js CVE-2025-66478 is a critical RCE disclosed December 2025 ([nextjs.org/blog/security-update-2025-12-11](https://nextjs.org/blog/security-update-2025-12-11); [praetorian.com/blog/critical-advisory-remote-code-execution-in-next-js-cve-2025-66478-with-working-exploit](https://www.praetorian.com/blog/critical-advisory-remote-code-execution-in-next-js-cve-2025-66478-with-working-exploit)). The patch advisory does not name a specific patched version; secondary sources indicate "current 16.x" is patched. **UNVERIFIED: exact patched release — pin to `>=16.2.10` until the advisory URL is updated with a specific version.** The pin is enforced in `package.json` (`"next": ">=16.2.10"`) and verified by `osv-scanner` in CI (§5).

### 4.7 Automation

| Test / rule | Verifies |
|---|---|
| `no-queryRawUnsafe` Semgrep rule | No `$queryRawUnsafe` / `$executeRaw` outside `lib/db/admin.ts` |
| `react/no-danger` ESLint rule | No `dangerouslySetInnerHTML` in web |
| `ledger-no-delete.test.ts` (extended) | No `$executeRaw` against `ledger_entries`; no `.delete()` on ledger |
| `tauri-capabilities-no-remote.test.ts` | No `remote:` block in any Tauri capability file |
| `restore-path-traversal.test.ts` | `../../etc/passwd` rejected as a restore target |
| `next-version-pin.test.ts` | `package.json` `"next"` satisfies `>=16.2.10` |

---

## 5. S4 — Secrets & Supply Chain

**Findings (from research S4).** Tauri updater signatures are mandatory and cannot be disabled: the public key is set in `tauri.conf.json`, the private key signs every installer via `tauri signer generate` ([v2.tauri.app/plugin/updater](https://v2.tauri.app/plugin/updater)). npm provenance: packages published from GitHub Actions/GitLab CI can be signed via **Sigstore** and logged in a public transparency ledger; verify with `npm audit signatures` ([docs.npmjs.com/generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements)). SLSA v1.0 is the framework ([slsa.dev/blog/2023/05/bringing-improved-supply-chain-security-to-the-nodejs-ecosystem](https://slsa.dev/blog/2023/05/bringing-improved-supply-chain-security-to-the-nodejs-ecosystem)). CycloneDX is preferred for application security (richer dependency graph + vulnerability linking); SPDX for licence compliance ([herodevs.com/blog-posts/spdx-vs-cyclonedx-choosing-the-right-sbom-format-for-your-software-supply-chain](https://www.herodevs.com/blog-posts/spdx-vs-cyclonedx-choosing-the-right-sbom-format-for-your-software-supply-chain); [cyclonedx.org/tool-center](https://cyclonedx.org/tool-center)). OSV-Scanner (Google) is the leading open-source SCA tool ([github.com/google/osv-scanner](https://github.com/google/osv-scanner); [aikido.dev/blog/top-open-source-dependency-scanners](https://www.aikido.dev/blog/top-open-source-dependency-scanners)). gitleaks is feature-complete for secrets scanning in git history, with a `.pre-commit-hooks.yaml` for pre-commit installation ([github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)). `license-checker` enforces an allow-list ([github.com/onebeyond/license-checker](https://github.com/onebeyond/license-checker); [codepunkt.de/writing/open-source-license-compliance-break-the-build-not-the-law](https://codepunkt.de/writing/open-source-license-compliance-break-the-build-not-the-law)).

### 5.1 The CI gate order

The supply-chain harness runs in this exact order on every PR. A failure at any step blocks merge.

```
   ┌─ STEP 1 · pre-commit (developer's machine, via lefthook/husky) ───────┐
   │  gitleaks detect --staged --redact                                    │
   │  (catches a secret BEFORE it ever reaches the remote)                 │
   └────────────────────────────────────────────────────────────────────────┘
                                  │ pass
                                  ▼
   ┌─ STEP 2 · PR opens · GitHub Actions security.yml ─────────────────────┐
   │  2a. gitleaks detect (whole-repo scan — defence-in-depth on step 1)   │
   │  2b. semgrep --config semgrep.yml                                     │
   │      (SAST: no-hardcode, never-mock-the-ledger, integer-paise,        │
   │       no-queryRawUnsafe, no-console-log-env — see §11)                │
   │  2c. osv-scanner --lockfile bun.lockb                                 │
   │              --lockfile apps/mobile/package-lock.json                 │
   │              --lockfile apps/desktop/Cargo.lock                       │
   │      (SCA: fails on High/Critical CVEs in any dependency)             │
   │  2d. license-checker --licenses licenses.allowlist.json               │
   │      (allow-list: MIT, ISC, Apache-2.0, BSD-*, MPL-2.0)               │
   │  2e. cyclonedx-bun -o bom.json (per app: web/mobile/desktop/gateway)  │
   │      (SBOM generation; bom.json uploaded as build artefact + pushed   │
   │       to a private Dependency-Track instance)                         │
   │  2f. tauri-updater-key-present                                         │
   │      (asserts TAURI_SIGNING_PRIVATE_KEY is set in the runner env;     │
   │       no-op locally, mandatory in CI release builds)                  │
   │  2g. npm audit signatures                                              │
   │      (verifies @buddysaradhi/* packages have Sigstore provenance)     │
   └────────────────────────────────────────────────────────────────────────┘
                                  │ all pass
                                  ▼
   ┌─ STEP 3 · nightly release-candidate build ────────────────────────────┐
   │  3a. owasp-zap-baseline against the Vercel preview URL                │
   │      (DAST — see §11)                                                 │
   │  3b. MASTG mobile smoke test (OWASP MASTG, the testing companion to   │
   │      MASVS — github.com/OWASP/mastg/releases)                         │
   │  3c. full audit-chain-verification recompute (10_Security.md §8.3)    │
   └────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Tauri updater keys

`TAURI_SIGNING_PRIVATE_KEY` stored as a GitHub Actions secret; never written to disk; the signed `latest.json` manifest is uploaded to Vercel Blob alongside the `.dmg`/`.deb`/`.exe`/`.msi`. The updater checks **both** the minisign-equivalent signature *and* a SHA-256 hash (per `10_Security.md §23.4`). Tauri's docs are explicit: "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled."

### 5.3 SBOM generation

`cyclonedx-bun` (or `@cyclonedx/cyclonedx-webpack-plugin`) runs on every build; output `bom.json` per app (web/mobile/desktop/gateway) uploaded as a build artefact + pushed to a private Dependency-Track instance for monitoring. SPDX is the licence-compliance format (used by `license-checker`'s output); CycloneDX is the security format (used by OSV-Scanner's vulnerability linking).

### 5.4 The license allow-list

`licenses.allowlist.json` permits only `{MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, MPL-2.0}`. A new dependency with a GPL/AGPL/LGPL licence fails the `license-check` CI step. (Buddysaradhi is closed-source; GPL-family licences are incompatible.) The allow-list is reviewed quarterly; additions require a §Decision Protocol run.

---

## 6. S5 — Transport & Network Security

**Findings (from research S5).** The Tauri localhost plugin carries a documented "considerable security risks" warning and should only be used "if you know what you are doing. If in doubt, use the default custom protocol implementation" ([v2.tauri.app/ko/plugin/localhost](https://v2.tauri.app/ko/plugin/localhost); [reddit.com/r/tauri/comments/1pq2sdj/tauri_localhost_plugin_security_risks](https://www.reddit.com/r/tauri/comments/1pq2sdj/tauri_localhost_plugin_security_risks)). DNS-rebinding is the primary attack ([daleseo.com/dns-rebinding](https://daleseo.com/dns-rebinding); [dottak.me/posts/2025-01-11-dns-rebinding-attack](https://www.dottak.me/posts/2025-01-11-dns-rebinding-attack)). The OWASP WebSocket Security Cheat Sheet mandates: always `wss://`, validate `Origin` header on upgrade, authenticate on the handshake (token in `Sec-WebSocket-Protocol` or query string over TLS), authorise *every* message (not just the connection), disable `permessage-deflate` unless needed ([cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html); [invicti.com/blog/web-security/websocket-security-best-practices](https://www.invicti.com/blog/web-security/websocket-security-best-practices)). Expo/RN SSL pinning: `react-native-ssl-public-key-pinning` is the maintained option ([callstack.com/blog/ssl-pinning-in-react-native-apps](https://www.callstack.com/blog/ssl-pinning-in-react-native-apps); [npmjs.com/package/react-native-ssl-public-key-pinning](https://www.npmjs.com/package/react-native-ssl-public-key-pinning); [medium.com/@tusharkumardev/security-best-practices-ssl-pinning-data-encryption-in-react-native-projects-36a6a56fef3b](https://medium.com/@tusharkumardev/security-best-practices-ssl-pinning-data-encryption-in-react-native-projects-36a6a56fef3b)).

### 6.1 Avoid the Tauri localhost plugin entirely

Use Tauri's default `tauri://` custom protocol; this sidesteps DNS-rebinding by construction. Documented in `apps/desktop/README.md`. The CI test `tauri-no-localhost-plugin.test.ts` asserts `tauri-plugin-localhost` is absent from `Cargo.lock`. **Cross-ref `desktop/03_IPC_Security.md`**.

### 6.2 TLS 1.3 everywhere

| Surface | TLS termination | Notes |
|---|---|---|
| Gateway | Cloudflare edge (auto-negotiates TLS 1.3) | HTTP/3 + HSTS |
| Turso | `libsql://` over TLS 1.3 | mTLS for replication |
| Upstash | TLS always on ([upstash.com/docs/redis/features/security](https://upstash.com/docs/redis/features/security)) | REST API → HTTPS |
| Vercel Blob | HTTPS only | Signed URLs are HTTPS |
| Supabase | HTTPS to `*.supabase.co` | JWKS endpoint cached 10 min |

### 6.3 HSTS + nonce-CSP on web

Headers enforced by Next.js 16 middleware (`next.config.js`):

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{nonce}';
  connect-src 'self' https://*.supabase.co https://*.turso.ai https://api.buddysaradhi.app;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

The CI test `csp-header-present.test.ts` curls the preview URL and asserts all required headers. **Cross-ref `10_Security.md §12.1`** (existing CSP, which is updated here from `'unsafe-inline'` to nonce-based per Next.js 16's recommendation).

### 6.4 Mobile cert pinning

Pin the gateway's public key (SPKI `sha256/256`) via `react-native-ssl-public-key-pinning`. Pin Supabase's public key (auto-rotates with their asymmetric-key system — pin a *set* of current+next keys to allow rotation). The pinning config is in `apps/mobile/app.config.ts` under `expo-build-properties`. iOS `NSAppTransportSecurity` requires `NSAllowsArbitraryLoads = false` (no per-domain exceptions). Android `network_security_config.xml` pins base64 public-key hashes for `*.supabase.co`, `*.turso.ai`, `api.buddysaradhi.app`; cleartext only for `10.0.2.2` (emulator dev).

### 6.5 Gateway WebSocket (CF Durable Object)

The `SyncDO` WebSocket (`17_API_Gateway_System.md §6.2` + `18_Microservice_Architecture.md §3.4`) follows the OWASP cheat-sheet:

- Always `wss://` (CF edge TLS).
- Validate `Origin` header against the tutor's known web origin (`https://app.buddysaradhi.app`) on upgrade — reject unknown origins with `403`.
- Auth the handshake with the Supabase JWT in `?token=<jwt>` (the SDK injects it; the query is HTTPS-encrypted so the token never crosses the wire in the clear).
- Authorise every message against the `tutorId` claim — a message from `tutor:t_7` may not write to `tutor:t_8`'s outbox.
- Disable `permessage-deflate` (CRIME/BREACH analogue; not needed for our message sizes).

### 6.6 CORS one-origin policy

The gateway emits `Access-Control-Allow-Origin: https://app.buddysaradhi.app` (one origin, no `*`). Preflight (`OPTIONS`) requests are handled at stage 4 (route) before the service is dispatched. The mobile and desktop apps are not browsers → CORS does not apply to them.

### 6.7 Automation

| Test | Verifies |
|---|---|
| `no-http-urls.test.ts` (existing) | No `http://` URLs in code (except dev allowlist) |
| `csp-header-present.test.ts` (NEW) | Web preview returns CSP + HSTS + COOP + COEP headers |
| `tauri-no-localhost-plugin.test.ts` (NEW) | `tauri-plugin-localhost` absent from `Cargo.lock` |
| `ws-origin-validation.test.ts` (NEW) | Gateway WS upgrade handler rejects unknown origins |
| `mobile-cert-pinning-present.test.ts` (NEW) | `app.config.ts` declares pinning config for all 3 hosts |

---

## 7. S6 — Data Protection at Rest & In Transit

**Findings (from research S6).** Turso now ships native page-level at-rest encryption (AES-256-GCM or AEGIS-256, 4 KiB pages, ~6% read / 14% write overhead, keys never stored on disk). Currently enabled via the `--experimental-encryption` flag and a `cipher=aes256gcm&hexkey=…` URI parameter ([docs.turso.tech/tursodb/encryption](https://docs.turso.tech/tursodb/encryption); [turso.tech/blog/introducing-fast-native-encryption-in-turso-database](https://turso.tech/blog/introducing-fast-native-encryption-in-turso-database); [turso.tech/blog/turso-cloud-native-encryption](https://turso.tech/blog/turso-cloud-native-encryption)). **UNVERIFIED: the `--experimental-encryption` flag's GA status — confirm before production rollout.** Upstash Redis: TLS is always on; **Encryption at Rest requires the Prod Pack add-on** ([upstash.com/docs/redis/features/security](https://upstash.com/docs/redis/features/security)). **UNVERIFIED: at-rest encryption availability on the free tier — the Prod Pack page indicates it requires a paid add-on; the free-tier fallback is client-side application-level encryption.** Vercel Blob: AES-256 encryption at rest on all blobs; private stores require auth for every read; OIDC-token auth preferred over long-lived `BLOB_READ_WRITE_TOKEN`; security headers enforced automatically ([vercel.com/docs/vercel-blob/security](https://vercel.com/docs/vercel-blob/security)). AES-256-GCM is FIPS 197-approved ([nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf](https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf)). Argon2id (RFC 9100) is the password-hash standard; `10_Security.md` already specifies `m=64 MiB, t=3, p=2` — exceeds the OWASP cheat-sheet minimum (`m≥19 MiB, t≥2, p≥1`).

### 7.1 Turso per-user DB encryption (NEW vs `10_Security.md`)

`10_Security.md §6` predates Turso's native encryption (it says only "Turso-managed encryption at rest + scoped JWT in transit"). This file adds: enable `cipher=aes256gcm` on every Turso DB at provisioning time. The `hexkey` is generated by the provision-db Edge Function and stored in Supabase `user_metadata.db_url` (the URL already contains the key — this matches Turso's documented pattern). The cloud replica is now ciphertext to Turso-the-company — a Turso insider with full DB access sees only AES-256-GCM ciphertext.

```
   ┌─ provision-db Supabase Edge Function ─────────────────────────────────┐
   │  1. POST /v1/databases  name=buddysaradhi-{user_uuid}                  │
   │     with --experimental-encryption (UNVERIFIED: confirm GA before prod)│
   │  2. generate hexkey = crypto.randomBytes(32).toString('hex')           │
   │  3. Turso returns db_url; append ?cipher=aes256gcm&hexkey=…            │
   │  4. write db_url into Supabase user_metadata                           │
   │  5. invalidate Upstash tutor:{tutorId}:dburl                           │
   └─────────────────────────────────────────────────────────────────────────┘
```

The CI test `turso-encryption-enabled.test.ts` asserts the provision-db Edge Function calls the Turso Platform API with the encryption params.

### 7.2 The `.buddysaradhi` envelope — unchanged

`10_Security.md §15` specifies the AES-256-GCM + Argon2id envelope. This file does not modify it; it adds two CI tests:

- `backup-roundtrip.test.ts` (existing) — encrypt→decrypt restores original; 1-byte tamper fails `E_WRONG_PASSPHRASE`.
- `backup-nonce-uniqueness.test.ts` (NEW) — asserts 1000 envelopes have unique 12-byte nonces. GCM is catastrophic under nonce reuse; with ≤2³² encryptions under one key the collision probability is negligible, but the test verifies the implementation, not the math.

**Cross-ref `10_Security.md §15`** (the envelope) and **`09_Backup_and_Import_Export.md §15`** (the round-trip test).

### 7.3 Upstash Redis — never cache a raw `db_token`

The Upstash `tutor:{tutorId}:dburl` key caches the *resolved dbUrl* (HMAC-signed per §3.2), **not** a raw `db_token`. The resolved dbUrl is itself the Turso connection string (which embeds the token), but the HMAC signature means an attacker who reads the Upstash value cannot use it without the gateway's HMAC key. Defence-in-depth: enable **Prod Pack** for at-rest encryption (UNVERIFIED: free-tier availability — confirm before launch). The CI test `upstash-no-plaintext-dbtoken.test.ts` asserts the cache key never holds a raw, unsigned `db_token`.

### 7.4 Vercel Blob — private stores + OIDC + signed URLs

Use *private* stores for receipts and backup envelopes. Serve via short-TTL (15-min) signed URLs generated by the gateway (already specified in `10_Security.md §1` and `17_API_Gateway_System.md §4.2`). OIDC-token auth preferred over long-lived `BLOB_READ_WRITE_TOKEN` — Vercel Blob security headers (`content-security-policy: default-src 'none'`, `x-frame-options: DENY`, `x-content-type-options: nosniff`) are enforced automatically per [vercel.com/docs/vercel-blob/security](https://vercel.com/docs/vercel-blob/security).

### 7.5 PII minimization inventory

`10_Security.md §16` already specifies the inventory. This file's contribution: the inventory is verified by a CI test `pii-inventory.test.ts` that asserts every column in the Prisma schema is in the inventory table (or is a system column like `id`, `created_at`, `updated_at`). A new PII column added without an inventory entry fails the build.

### 7.6 Automation

| Test | Verifies |
|---|---|
| `turso-encryption-enabled.test.ts` (NEW) | provision-db calls Turso Platform API with encryption params |
| `backup-roundtrip.test.ts` (existing) | Encrypt→decrypt restores original; tamper fails |
| `backup-nonce-uniqueness.test.ts` (NEW) | 1000 envelopes have unique 12-byte nonces |
| `upstash-no-plaintext-dbtoken.test.ts` (NEW) | Upstash cache key never holds raw `db_token` (only HMAC-signed dbUrl) |
| `pii-inventory.test.ts` (NEW) | Every Prisma column is in the `10_Security.md §16` inventory |

---

## 8. S7 — API Gateway & Edge-Function Security

**Findings (from research S7).** Cloudflare Durable Objects are the canonical edge rate-limit authority: a single-threaded DO per rate-limit key (e.g. `tutorId` or `ip`) gives an atomic sliding-window counter, beating per-colo CF rate-limit bindings which leak state ([monzim.com/blogs/distributed-rate-limiting-cloudflare-durable-objects](https://monzim.com/blogs/distributed-rate-limiting-cloudflare-durable-objects); [dev.to/horushe/why-i-ditched-redis-for-cloudflare-durable-objects-in-my-rate-limiter-jof](https://dev.to/horushe/why-i-ditched-redis-for-cloudflare-durable-objects-in-my-rate-limiter-jof); [developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier)). Cloudflare Workers secrets are encrypted at rest, distinct from plaintext env vars, set via `wrangler secret put` ([developers.cloudflare.com/workers/configuration/secrets](https://developers.cloudflare.com/workers/configuration/secrets); [blog.cloudflare.com/workers-secrets-environment](https://blog.cloudflare.com/workers-secrets-environment)). Idempotency keys for payment mutations: a client-supplied `Idempotency-Key` header; the server stores `(key, tutorId) → response` for 24h; a retry returns the cached response instead of re-charging ([medium.com/@tatomoaki/idempotency-for-payments-preventing-double-charges-8e58aed88b93](https://medium.com/@tatomoaki/idempotency-for-payments-preventing-double-charges-8e58aed88b93); [dev.to/budiwidhiyanto/ensuring-reliable-payment-systems-with-idempotency-2d0l](https://dev.to/budiwidhiyanto/ensuring-reliable-payment-systems-with-idempotency-2d0l); [geeksforgeeks.org/system-design/airbnb-idempotency-avoiding-double-payments-in-a-distributed-payments-system](https://www.geeksforgeeks.org/system-design/airbnb-idempotency-avoiding-double-payments-in-a-distributed-payments-system)). Credential-stuffing mitigation in 2025: per-IP + per-account rate limits, breach-password lists (haveibeenpwned k-anonymity), step-up OTP after a suspicious login ([authsignal.com/blog/articles/how-to-actually-stop-credential-stuffing-in-2025](https://www.authsignal.com/blog/articles/how-to-actually-stop-credential-stuffing-in-2025); [workos.com/blog/credential-stuffing-vs-brute-force-attacks](https://workos.com/blog/credential-stuffing-vs-brute-force-attacks)). Cloudflare's built-in L3/L4/L7 DDoS protection is on by default for any Workers route.

### 8.1 Rate limiting via RateLimitDO

The `RateLimitDO` Durable Object (sharded `tutor:<tutorId>`) is the single-threaded authority for one tutor's token bucket — no race, no lock, no CAS retry loop. Buckets:

| Route class | Limit | Burst | Lockout |
|---|---|---|---|
| `GET /api/v1/ledger/*` (reads) | 600 rpm | 60 | — |
| `POST /api/v1/ledger/entries` (writes) | 10 rpm | 5 | 3 fails in 60s → 60s cooldown |
| `POST /api/v1/auth/otp` (OTP request) | 5 per hour per `email` | 1 | 5 fails → 15-min cooldown per `email` (not per-IP — IP rotation is trivial) |
| `POST /api/v1/backup` (backup initiate) | 2 per minute | 1 | — |
| Default (any other route) | 300 rpm | 60 | — |

The Redis projection `rl:{tutorId}:{route}` (60s sliding TTL) is the cross-region cache so a request hitting a different CF colo still sees the same bucket; the DO is the authority (per `17_API_Gateway_System.md §6.3`). **Cross-ref `10_Security.md §17`** (the existing token-bucket spec) and **`17_API_Gateway_System.md §3` stage 3** (rate-limit in the request pipeline).

### 8.2 Idempotency-Key — REQUIRED on every ledger mutation

Every mutating ledger operation (`POST /api/v1/ledger/entries`, `POST /api/v1/ledger/entries/:id/void`, `POST /api/v1/receipt/attach-upload`, `POST /api/v1/sync/push`) requires an `Idempotency-Key` header — a client-generated UUID. The gateway dedupes via Upstash Redis (`SETNX` with 24h TTL):

```
   request: POST /api/v1/ledger/entries
            Idempotency-Key: 7c3f...e9 (UUIDv4)
            body: { tutorId, kind:"fee_payment", amountPaise, ... }

   stage 4.5 (after route, before service):
   ┌────────────────────────────────────────────────────────────────────┐
   │  redis.SET  idem:{tutorId}:{key}  reqHash  NX  EX 86400            │
   │                                                                    │
   │  • if SET returns OK → first time seen → proceed, store the        │
   │    response in  idem:{tutorId}:{key}:resp  (EX 86400)              │
   │  • if SET returns nil  → duplicate within 24h:                     │
   │    - if reqHash matches stored  → replay stored response (200 OK)  │
   │    - if reqHash differs        → 409 conflict                      │
   │      (same key, different body = client bug)                       │
   └────────────────────────────────────────────────────────────────────┘
```

The 24h TTL covers any realistic retry window (mobile offline → reconnect → outbox drain). The `reqHash` is SHA-256 of the canonicalised request body. A retried POST that lost connectivity mid-flight therefore **cannot double-charge** a student — the gateway returns the stored response from the first attempt. The SDK generates the key once per logical operation and reuses it across retries.

The ledger's append-only invariant (LEDGER-1, `10_Security.md §9`) + the idempotency key = double-charge is structurally impossible. The CI test `idempotency-key-required.test.ts` asserts every ledger mutation route requires the header; `idempotency-replay.test.ts` asserts a replayed request with the same key returns the cached response.

### 8.3 Replay window — nonce + timestamp

Every mutation requires `X-Timestamp` (±5 min of server time) + `X-Nonce` (random 16 bytes, base64). The gateway DO stores `(tutorId, nonce)` for 10 min via `alarm()`; a replayed request with the same nonce within 10 min is rejected with `409 conflict`. The CI test `replay-window.test.ts` asserts a replayed request is rejected.

### 8.4 OTP brute-force

5 attempts per OTP, then 15-min cooldown per `email` (not per-IP — IP rotation is trivial). Already implied by Supabase Auth rate limits; verify Supabase project settings enforce this. The CI test `otp-bruteforce.test.ts` asserts the lockout fires after 5 fails.

### 8.5 Secrets in Workers

All Worker secrets come from `wrangler secret put` — never in `wrangler.toml` `[vars]`:

- `SUPABASE_SERVICE_ROLE` (gateway + provision-db Edge Function)
- `TURSO_PLATFORM_API_TOKEN` (provision-db only — to create per-tutor DBs)
- `UPSTASH_REDIS_TOKEN` (gateway)
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY` (for rotation)
- Gateway HMAC key (for the `tutorId → dbUrl` cache signature, §3.2)

The CI test `no-wrangler-toml-secrets.test.ts` parses `wrangler.toml` and fails if any `secret`/`token`/`key` value appears in `[vars]`. The Semgrep rule `no-console-log-env` (§2.4) blocks `console.log(process.env.*)` in `workers/gateway/`.

### 8.6 DDoS

Cloudflare's built-in L3/L4/L7 protection is on by default for any Workers route. No additional configuration needed; the gateway inherits it.

**Cross-ref `17_API_Gateway_System.md §8.1`** (idempotency-key contract) and **`10_Security.md §17`** (existing rate-limit spec).

---

## 9. S8 — Client-Side Security (Web / Mobile / Desktop)

**Findings (from research S8).** OWASP MASVS 2.1 is the mobile baseline (8 categories incl. the new MASVS-PRIVACY) ([mas.owasp.org/MASVS](https://mas.owasp.org/MASVS)). The **MASTG** (Mobile Application Security Testing Guide) is the testing companion ([github.com/OWASP/mastg/releases](https://github.com/OWASP/mastg/releases)). `rnsec` is a dedicated React Native/Expo linter with 85+ rules across 14 categories; specific rules worth enforcing: `ANDROID_TASK_AFFINITY_VULNERABILITY` (StrandHogg task hijacking → set `taskAffinity=""`), `ANDROID_CLEARTEXT_ENABLED`, `ANDROID_DEBUGGABLE_ENABLED`, `INSECURE_KEYSTORE_USAGE` (require StrongBox + GCM/CBC), `ANDROID_MISSING_NETWORK_SECURITY_CONFIG` (for cert pinning), `IOS_ATS_DISABLED`, `INSECURE_KEYCHAIN_USAGE` (require `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometric `kSecAttrAccessControl`), `IOS_MISSING_APP_SNAPSHOT_PROTECTION`, `EXPO_UPDATES_INSECURE` ([rnsec.dev/docs/security-rules](https://www.rnsec.dev/docs/security-rules)). Tauri v2 capabilities: per-window, per-platform; remote API access disabled by default; security boundary = window *labels* (not titles); Tauri explicitly warns it cannot distinguish iframe-from-window on Linux/Android ([v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities)). Next.js 16 Trusted Types + COOP/COEP: framework supports nonce-CSP; SRI experimental; `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` enable isolated-frame security ([nextjs.org/docs/app/guides/content-security-policy](https://nextjs.org/docs/app/guides/content-security-policy)).

### 9.1 Web — CSP + Trusted Types + COOP/COEP + SRI

| Control | Implementation | Enforcement |
|---|---|---|
| Nonce-based CSP | `next.config.js` middleware generates per-request nonce | `csp-header-present.test.ts` (§6.3) |
| Trusted Types | `next.config.js` `experimental.trustedTypes` | `trusted-types-enabled.test.ts` |
| COOP | `Cross-Origin-Opener-Policy: same-origin` | `csp-header-present.test.ts` |
| COEP | `Cross-Origin-Embedder-Policy: require-corp` | `csp-header-present.test.ts` |
| CORP | `Cross-Origin-Resource-Policy: same-origin` | `csp-header-present.test.ts` |
| SRI (experimental) | Subresource Integrity hashes on third-party scripts (none in v1 — no third-party scripts) | n/a (deferred to v1.x if a third-party script is added) |
| `X-Content-Type-Options: nosniff` | Middleware header | `csp-header-present.test.ts` |
| `Referrer-Policy: strict-origin-when-cross-origin` | Middleware header | `csp-header-present.test.ts` |
| `Permissions-Policy: geolocation=(), microphone=(), camera=()` | Middleware header | `csp-header-present.test.ts` |
| No `dangerouslySetInnerHTML` | ESLint `react/no-danger` | lint error |

### 9.2 Mobile (Expo) — MASVS 2.1 + rnsec

The MASVS 2.1 baseline ([mas.owasp.org/MASVS](https://mas.owasp.org/MASVS)) is the spec; `rnsec` ([rnsec.dev/docs/security-rules](https://www.rnsec.dev/docs/security-rules)) is the linter; MASTG ([github.com/OWASP/mastg/releases](https://github.com/OWASP/mastg/releases)) is the testing companion. The `rnsec` CI job on `apps/mobile/` enforces (HIGH-severity findings fail the build):

| `rnsec` rule | What it catches | Mitigation |
|---|---|---|
| `ANDROID_TASK_AFFINITY_VULNERABILITY` | StrandHogg task hijacking | `taskAffinity=""` on all activities in `AndroidManifest.xml` |
| `ANDROID_CLEARTEXT_ENABLED` | Cleartext HTTP allowed | `android:usesCleartextTraffic="false"` (except `10.0.2.2` for emulator dev) |
| `ANDROID_DEBUGGABLE_ENABLED` | Debuggable flag in release build | `android:debuggable="false"` in release manifest |
| `INSECURE_KEYSTORE_USAGE` | Weak Keystore config | Require StrongBox + GCM/CBC mode |
| `ANDROID_MISSING_NETWORK_SECURITY_CONFIG` | No cert pinning | `android:networkSecurityConfig` with pinning for gateway + Supabase + Turso |
| `IOS_ATS_DISABLED` | App Transport Security disabled | `NSAppTransportSecurity` with `NSAllowsArbitraryLoads = false` |
| `INSECURE_KEYCHAIN_USAGE` | Weak Keychain accessibility | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` + biometric `kSecAttrAccessControl` |
| `IOS_MISSING_APP_SNAPSHOT_PROTECTION` | App switcher shows sensitive content | Blur overlay on `AppState='inactive'` (already in `10_Security.md §3.1`) |
| `EXPO_UPDATES_INSECURE` | Unsigned OTA updates | EAS Update with signed manifests |

**Rooted/jailbreak detection:** soft detection (`expo-local-authentication` + heuristics: Cydia/Substrate/Magisk) sets `app_state.device_rooted = 1`. The app does not refuse to run (punishes legitimate users) but: forces `session_timeout_min` ≤ 2 min, disables biometric unlock, surfaces a one-time yellow banner (`10_Security.md §13.4`).

**Code obfuscation:** enable R8/ProGuard obfuscation on Android release builds (EAS Build handles this). Accept that obfuscation is *not* security, only friction. Sensitive logic (PIN verification, envelope decryption) stays in Rust via `tauri-plugin-stronghold` on desktop; on mobile, use platform-native crypto (Keychain/Keystore) rather than JS.

### 9.3 Desktop (Tauri v2) — capabilities + shell scope + updater integrity

| Control | Implementation | Enforcement |
|---|---|---|
| Capabilities/allowlist minimal + per-window | Single `src-tauri/capabilities/main.json` (§4.4) | `tauri-capabilities-minimal.test.ts` + `tauri-capabilities-no-remote.test.ts` |
| File-system scope | `$APPDATA/buddysaradhi/*` (read/write) + `$DOWNLOAD/*` (read-only, for export) | Capability file scope |
| Shell scope | Allow-listed to specific commands (none in v1 unless user-initiated) | Capability file |
| Updater integrity | minisign signature (mandatory, §5.2) | `tauri-updater-key-present` CI step |
| No localhost plugin | Use `tauri://` custom protocol | `tauri-no-localhost-plugin.test.ts` (§6.1) |
| SQLCipher local DB | Key in OS keychain (`10_Security.md §14.2`) | `desktop-sqlcipher-key-in-keychain.test.ts` |
| OS-native window chrome | `tauri-plugin-decorum` (per R-TAILWIND-CROSSPLATFORM) | n/a (UI) |

Tauri explicitly warns it cannot distinguish iframe-from-window on Linux/Android ([v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities)) — Buddysaradhi does not embed iframes in the desktop WebView, so this is not a concern, but it is documented as an invariant: **no `<iframe>` elements in `apps/desktop/`** (enforced by ESLint `react/no-unknown-property` + a custom rule `no-iframe-in-desktop`).

### 9.4 Automation (cross-platform)

| Test / rule | Scope |
|---|---|
| `rnsec` CI job | `apps/mobile/` — 85+ rules, HIGH severity fails |
| `eslint-plugin-react-hooks` + `react/no-danger` + `no-iframe-in-desktop` | web + desktop |
| `tauri-capabilities-minimal.test.ts` + `tauri-capabilities-no-remote.test.ts` | desktop |
| `next-headers.test.ts` | web — deployed preview returns all required security headers |
| `desktop-sqlcipher-key-in-keychain.test.ts` | desktop — SQLCipher key in OS keychain, not on disk |
| Annual third-party pen-test per `10_Security.md §24.2` | all platforms |

---

## 10. S9 — Observability, Audit & Incident Response

**Findings (from research S9).** India DPDP Act 2023 + DPDP Rules 2025 are now the governing law for Indian tutors. **Rule 7** mandates "Intimation of personal data breach" (to the Data Protection Board + affected Data Principals); **Rule 6** mandates "Reasonable security safeguards"; **Rule 13** imposes additional obligations on *Significant Data Fiduciaries* (DPDP Rules 2025 notified January 2025; enforcement ramping through 2025) ([dpdpa.com/dpdparules.html](https://www.dpdpa.com/dpdparules.html); [roedl.com/en/insights/indias-dpdpa-2023-activates-with-2025-rules-revolutionizing-data-privacy-enforcement](https://www.roedl.com/en/insights/indias-dpdpa-2023-activates-with-2025-rules-revolutionizing-data-privacy-enforcement); [nxgsecure.com/blog/dpdp-act-2025](https://nxgsecure.com/blog/dpdp-act-2025); [static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)). **UNVERIFIED: the exact hours-of-notification window under Rule 7 — the rules text fetched lists only the rule title; secondary sources indicate "as soon as possible" with a structured intimation, not a fixed-hour window like GDPR's 72h. Treat the 72-hour ICO window as the stricter cross-border fallback until a primary source for a specific DPDP hour-window is found.** UK GDPR / ICO baseline: notify the supervisory authority within **72 hours** of becoming aware; notify affected individuals "without undue delay" if high risk ([ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide)). Tamper-evident audit log via SHA-256 hash chain: `h[n] = SHA-256(h[n-1] || canonical_json(row[n]))`; any out-of-band insert breaks the chain ([dev.to/veritaschain/building-a-tamper-evident-audit-log-with-sha-256-hash-chains-zero-dependencies-h0b](https://dev.to/veritaschain/building-a-tamper-evident-audit-log-with-sha-256-hash-chains-zero-dependencies-h0b); [appmaster.io/blog/tamper-evident-audit-trails-postgresql](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql)) — already implemented in `10_Security.md §8`. Impossible-travel detection: Microsoft Defender for Cloud Apps, Elastic prebuilt rules, and ThreatLocker all implement the pattern ([learn.microsoft.com/en-us/defender-cloud-apps/anomaly-detection-policy](https://learn.microsoft.com/en-us/defender-cloud-apps/anomaly-detection-policy); [elastic.co/docs/reference/security/prebuilt-rules/rules/integrations/o365/initial_access_entra_id_portal_login_impossible_travel](https://www.elastic.co/docs/reference/security/prebuilt-rules/rules/integrations/o365/initial_access_entra_id_portal_login_impossible_travel); [threatlocker.com/press-release/threatlocker-unveils-advanced-anomaly-detection-elevating-cloud-security-with-impossible-travel-insights](https://www.threatlocker.com/press-release/threatlocker-unveils-advanced-anomaly-detection-elevating-cloud-security-with-impossible-travel-insights)).

### 10.1 The hash-chained audit log (already implemented)

`10_Security.md §8` specifies the audit log: append-only (trigger-guarded), retained indefinitely, hash-chained (`h[n] = SHA-256(h[n-1] || canonical_json(row[n]))`). The gateway-owned CF D1 audit DB (`17_API_Gateway_System.md §3.1`) holds the canonical chain; the per-tutor Turso DB holds a per-domain shard for the tutor's own viewing in Settings → Security. The weekly `audit_reconcile_job` recomputes the chain; any drift writes `audit_chain_broken` and surfaces a red banner.

### 10.2 Impossible-travel detector (NEW)

A nightly job (`audit-reconcile-job`, runs Sun 02:00 local alongside the chain recompute) compares consecutive `audit_log` rows for the same `tutorId` with `actor='tutor'`. If two logins from different cities occur within a time window shorter than physically possible (e.g. Delhi → Mumbai in 30 min), the job writes `E_IMPOSSIBLE_TRAVEL` to the audit log and emails the tutor with a "Was this you?" step-up-OTP link. The CI test `impossible-travel-detector.test.ts` uses a fixture (Delhi login at 10:00, Mumbai login at 10:30) and asserts the alert fires.

### 10.3 Bulk-export anomaly detection (NEW)

If a tutor exports > N students in 24h (N = 3× their 30-day average), the gateway requires step-up PIN + audit-logs `bulk_export_anomaly`. This catches the "disgruntled staff member exfiltrating the student list" scenario. Already partially covered by `export-controls-matrix.test.ts` (`10_Security.md §24.1`); the threshold + step-up is the new addition. The CI test `bulk-export-anomaly.test.ts` asserts the threshold fires.

### 10.4 India DPDP Act 2023 + DPDP Rules 2025

Buddysaradhi's tutors are predominantly Indian; DPDP is the governing law. The tutor is the **Data Fiduciary** (the legal entity that determines the purpose and means of processing); Buddysaradhi-the-company is the **Processor** (processes data on the tutor's behalf). The DPDP Rules 2025 impose three specific obligations:

| Rule | Obligation | Buddysaradhi's compliance |
|---|---|---|
| **Rule 6** — Reasonable security safeguards | Implement reasonable security safeguards to protect personal data | This entire file (§§2-§9) is the safeguard inventory; the SDLC gate (§12) is the verification |
| **Rule 7** — Intimation of personal data breach | Intimate the Data Protection Board + affected Data Principals of any personal data breach | The incident-response runbook (§10.6) + the breach-notification timeline (§13.5); **UNVERIFIED: exact hour-window — apply the stricter of DPDP "as soon as possible" or ICO 72h** |
| **Rule 13** — Significant Data Fiduciary | SDFs (volume/sensitivity threshold) have additional obligations: DPIA, DPO appointment, audit | Buddysaradhi-the-product is unlikely to cross the SDF threshold in v1 (single-tutor DBs, no centralised processing); reassess annually |

### 10.5 ICO 72-hour cross-border fallback

For tutors outside India (EU, UK, US), the ICO 72-hour baseline applies as the stricter cross-border fallback: notify the supervisory authority within 72 hours of becoming aware of a personal data breach; notify affected individuals "without undue delay" if high risk ([ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide](https://ico.org.uk/for-organisations/report-a-breach/personal-data-breach/personal-data-breaches-a-guide)). The incident-response runbook (§10.6) tracks both timelines in parallel.

### 10.6 Incident-response runbook

The runbook is the checked-in artefact `docs/runbooks/incident-response.md` (NEW); a CI link-check test asserts every URL in the runbook resolves. The runbook's five phases (detect → contain → eradicate → notify → recover → postmortem) are encoded in the flowchart in §13.4. The runbook is **DPDP-aware**: it includes the DPDP-specific track (Rule 7 intimation, Rule 13 SDF check) alongside the ICO 72-hour track.

| Phase | Action | Owner | SLA |
|---|---|---|---|
| **1. Detect** | Alert from impossible-travel detector, bulk-export anomaly, audit-chain break, tamper-hash mismatch, or external report | On-call engineer | Immediate |
| **2. Contain** | Revoke affected tutor's Supabase session; rotate Turso `db_token`; if `.buddysaradhi` envelope flaw → publish CVE-style advisory + in-app notification (per `10_Security.md §21.3`) | On-call engineer | within 1h of detect |
| **3. Eradicate** | Identify root cause; ship patched build; force-rotate all gateway secrets; if a Turso DB was exfiltrated, re-provision with fresh `hexkey` | Engineering | within 24h |
| **4. Notify** | **DPDP track:** intimate the Data Protection Board + affected Data Principals (Rule 7; **UNVERIFIED: exact hour-window — apply "as soon as possible"**). **ICO track:** notify supervisory authority within 72h; notify affected individuals "without undue delay" if high risk. | Legal + on-call | DPDP: ASAP; ICO: 72h |
| **5. Recover** | Restore from last clean backup if data was corrupted; verify ledger integrity + audit chain; lift rate-limit cooldowns | Engineering | within 7 days |
| **6. Postmortem** | Blameless postmortem doc; root-cause analysis; action items tracked to closure; update threat model (`10_Security.md §20`) | Engineering + product | within 14 days |

**Cross-ref `10_Security.md §21`** (the existing vulnerability-disclosure + breach-notification commitment, which this file extends with DPDP specifics).

### 10.7 Automation

| Test / artefact | Verifies |
|---|---|
| `audit-chain-verification.test.ts` (existing) | Out-of-band audit row breaks chain; job logs `audit_chain_broken` |
| `impossible-travel-detector.test.ts` (NEW) | Delhi → Mumbai in 30 min fires alert |
| `bulk-export-anomaly.test.ts` (NEW) | 3× 30-day average fires step-up PIN |
| `docs/runbooks/incident-response.md` (NEW) | The DPDP-aware IR runbook; CI link-check asserts URLs resolve |

---

## 11. S10 — Secure SDLC & Automation Harness

**Findings (from research S10).** Semgrep is the leading developer-first SAST; supports custom YAML rules; the Semgrep Registry has community rules for TypeScript/JavaScript/React ([semgrep.dev/blog/2025/a-technical-deep-dive-into-semgreps-javascript-vulnerability-detection](https://semgrep.dev/blog/2025/a-technical-deep-dive-into-semgreps-javascript-vulnerability-detection); [github.com/semgrep/semgrep-rules](https://github.com/semgrep/semgrep-rules); [dev.to/semgrep/getting-started-with-sast-and-semgrep-cli-1cc1](https://dev.to/semgrep/getting-started-with-sast-and-semgrep-cli-1cc1)). OWASP ZAP baseline scan GitHub Action: scans a target URL and opens GitHub issues for alerts; configurable rules file to ignore known false positives ([github.com/marketplace/actions/zap-baseline-scan](https://github.com/marketplace/actions/zap-baseline-scan); [zaproxy.org/blog/2020-04-09-automate-security-testing-with-zap-and-github-actions](https://www.zaproxy.org/blog/2020-04-09-automate-security-testing-with-zap-and-github-actions); [lunavi.com/blog/using-the-owasp-zap-baseline-scan-github-action](https://www.lunavi.com/blog/using-the-owasp-zap-baseline-scan-github-action)). gitleaks for secrets in git history; `.pre-commit-hooks.yaml` ships with the repo ([github.com/gitleaks/gitleaks](https://github.com/gitleaks/gitleaks); [dev.to/sirlawdin/secret-scanning-in-ci-pipelines-using-gitleaks-and-pre-commit-hook-1e3f](https://dev.to/sirlawdin/secret-scanning-in-ci-pipelines-using-gitleaks-and-pre-commit-hook-1e3f); [sachinkasana.medium.com/once-a-secret-hits-git-its-compromised-forever-use-pre-commit-scanning-7faef6f5a3b8](https://sachinkasana.medium.com/once-a-secret-hits-git-its-compromised-forever-use-pre-commit-scanning-7faef6f5a3b8)).

### 11.1 The "bugless code" goal

The user's requirement #10 says: *"develop a thorough Security_harness_plan to ensure a solid protection of the project for all platforms... protect the app from all sorts of attack and ensure a bugless code and bug less + production ready plan."* "Bugless code" is not a state; it is a process. The harness makes it mechanically real: every PR runs the full SAST + SCA + secrets + license + lint + test suite; every nightly build runs DAST + the audit-chain recompute + MASTG mobile smoke; the production-deploy branch requires all of these as GitHub-required-status-checks. A bug that the harness can catch cannot reach production.

### 11.2 The Semgrep custom rules

The project ships a `semgrep.yml` with three custom rules that encode the Buddysaradhi-specific invariants (these are NOT in the Semgrep Registry — they are project-specific):

| Rule | Pattern | Why |
|---|---|---|
| `no-hardcode` | `libsql://...` or `https://api.buddysaradhi.app` literal in `apps/*/` | The no-hardcode rule (`17_API_Gateway_System.md §2.2`) |
| `never-mock-the-ledger` | `vi.mock(".../ledgerEntry")` without an `// allow: ...` comment | The never-mock-the-ledger rule (`AGENTS.md §7.3`); a test that mocks `db.ledgerEntry.create()` without an audited allowlist entry is a silent contract break |
| `integer-paise` | `amount * 0.01` or `parseFloat(amount)` or `Number(amount)` in `packages/core/` | The integer-paise rule (`12_Business_Rules.md` BR-LED-02); money is always integer paise, never floating-point rupees |
| `no-queryRawUnsafe` | `$queryRawUnsafe(...)` or `$executeRaw(...)` outside `lib/db/admin.ts` | The VACUUM exception (`10_Security.md §18`); the only raw-SQL call must be `VACUUM` in `lib/db/admin.ts` |
| `no-console-log-env` | `console.log(process.env.*)` in `workers/gateway/` | Cold-start secret leak defence (§1.1) |
| `no-supabase-token-in-localStorage` | `localStorage.setItem('sb-...')` | Token storage discipline (§2) |

### 11.3 The DAST pipeline (OWASP ZAP baseline nightly)

The nightly release-candidate build runs `owasp-zap-baseline` against the Vercel preview URL. ZAP opens GitHub issues for any alert above the configured threshold; the rules file (`zap-rules.tsv`) ignores known false positives (e.g. the CSP header is intentionally strict, ZAP's "X-Frame-Options not on /api/*" is a false positive — API routes don't need it). The 21_Automation_Testing.md flows + 4 NEW security flows (auth-replay, idempotency-double-charge, tamper-detect, secure-erase) run on every release-candidate. **Cross-ref `21_Automation_Testing.md §2`** (the AI bug-finding loop) and **§6** (a11y) — this file's §11 SDLC harness is the *security* layer that complements the *functional* layer in 21.

### 11.4 Pre-commit hooks

`lefthook.yml` (or `husky` if preferred) runs on every commit:

```yaml
# lefthook.yml
pre-commit:
  commands:
    gitleaks:
      run: gitleaks detect --staged --redact --config .gitleaks.toml
    eslint:
      glob: "*.{ts,tsx,js,jsx}"
      run: bunx eslint {staged_files}
    rnsec:
      glob: "apps/mobile/**/*.{ts,tsx,js,jsx}"
      run: cd apps/mobile && bunx rnsec
```

### 11.5 The `.github/workflows/security.yml` skeleton

```yaml
name: security
on:
  pull_request:
  schedule:
    - cron: '0 2 * * *'   # nightly 02:00 UTC = 07:30 IST
  push:
    branches: [main]

jobs:
  # ─── SAST + SCA + secrets + license + SBOM (every PR) ─────────────
  pr-security:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }              # gitleaks needs full history
      - uses: oven-sh/setup-bun@v2
      # 1. gitleaks (defence-in-depth on the pre-commit hook of §11.4)
      - uses: gitleaks/gitleaks-action@v2
        env: { GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} }
      # 2. Semgrep SAST (custom rules of §11.2 + registry packs)
      - uses: returntocorp/semgrep-action@v1
        with:
          config: >-
            semgrep.yml p/typescript p/react p/javascript p/owasp-top-ten
      # 3. OSV-Scanner SCA (bun + npm + cargo lockfiles)
      - uses: google/osv-scanner-action@v1
        with:
          scan-args: |-
            --lockfile=bun.lockb
            --lockfile=apps/mobile/package-lock.json
            --lockfile=apps/desktop/Cargo.lock
      # 4. License compliance (allow: MIT, ISC, Apache-2.0, BSD-*, MPL-2.0)
      - run: bunx license-checker --summary --licenses licenses.allowlist.json
      # 5. SBOM generation (CycloneDX, per app)
      - run: |
          bunx cyclonedx-bun -o bom.web.json      --app-name web
          bunx cyclonedx-bun -o bom.gateway.json  --app-name gateway
      - uses: actions/upload-artifact@v4
        with: { name: sbom, path: bom.*.json }
      # 6. Tauri updater key present (release builds only — tag push)
      - if: startsWith(github.ref, 'refs/tags/v')
        env: { TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }} }
        run: '[ -n "$TAURI_SIGNING_PRIVATE_KEY" ] || { echo "::error::missing key"; exit 1; }'
      # 7. npm audit signatures (Sigstore provenance verification)
      - run: bun audit signatures || echo "::warn::some packages lack provenance"

  # ─── DAST + audit recompute + security flows (nightly) ────────────
  nightly-dast:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - run: bun run dev &
      - run: npx wait-on http://localhost:3000 --timeout 60000
      # 1. OWASP ZAP baseline scan (DAST; opens GH issues for alerts)
      - uses: zaproxy/action-baseline@v0.13.0
        with:
          target: 'http://localhost:3000'
          cmd_options: '-a -j -r zap-report.html -z "-configfile zap-rules.tsv"'
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: zap-report, path: zap-report.html }
      # 2. Audit-chain recompute (10_Security.md §8.3)
      - run: bunx vitest run tests/security/audit-chain-verification.test.ts
      # 3. The 4 security flows (auth-replay, idempotency, tamper, secure-erase)
      - run: bunx playwright test --project=security

  # ─── MASTG mobile smoke (nightly, on macOS runner) ────────────────
  nightly-mobile-mastg:
    runs-on: macos-latest
    if: github.event_name == 'schedule'
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - uses: actions/setup-java@v4
        with: { distribution: 'temurin', java-version: '17' }
      - run: cd apps/mobile && bun install
      - run: cd apps/mobile && bunx eas build --profile preview --platform all --non-interactive
      # MASTG automated subset on the .ipa + .apk (full MASTG is a manual
      # pen-test activity per 10_Security.md §24.2; CI runs the automated subset)
      - run: bunx ts-node tests/mobile/mastg-smoke.ts
```

### 11.6 The required-status-check set (GitHub branch protection)

The production-deploy branch (`main`) requires the following status checks to pass before a PR can merge:

```
required_status_checks:
  - pr-security / gitleaks
  - pr-security / semgrep
  - pr-security / osv-scanner
  - pr-security / license-check
  - pr-security / cyclonedx
  - lint           (ESLint + @next/eslint-config-next + eslint-plugin-security + custom)
  - unit-tests     (existing 10_Security.md §24.1 suite)
  - integration-tests
  - tauri-capabilities-check   (custom; §9.3)
  - next-headers-check         (custom; §6.3)
enforce_admins: true            # no maintainer bypass
required_pull_request_reviews: 1
```

The 15-min `webDevReview` cron (job_id 266790, `21_Automation_Testing.md §8`) already runs the AI bug-resolution loop on the preview site — extend its prompt to include the security-flow results (the 4 flows from §11.3). **Cross-ref `21_Automation_Testing.md §2`** (AI bug-finding loop) + **§6** (a11y) — this file's SDLC harness is the security layer that runs alongside the functional layer. **Cross-ref `22_Redundancy_Audit.md §10`** (the dedup lint — every new test in this file is cross-checked against the existing inventory to avoid duplication).

---

## 12. The Security Gate (Production-Readiness)

The user's requirement #10 says "production ready plan." This is the gate. It is a **hard gate** — a single failing criterion blocks the production deploy. It is enforced as a GitHub-required-status-check on the production-deploy branch (`main`). **Cross-ref `16_Platform_Delivery_Sequence.md §4`** (the Web gate W1-W7) — this security gate is G3 (quality bar) + G4 (verified) made security-specific. It runs alongside W5 (deploy) and W6 (3D page); it does not replace them.

### 12.1 The hard gate (8 criteria, all must pass)

| # | Criterion | Verification | Failure action |
|---|---|---|---|
| **G-SEC-1** | No P0/S1 vulnerability open | `pr-security / osv-scanner` + `pr-security / semgrep` clean | block deploy |
| **G-SEC-2** | SAST clean (Semgrep + ESLint + `rnsec`) | `pr-security / semgrep` + `lint` + `rnsec` (mobile) clean | block deploy |
| **G-SEC-3** | DAST baseline clean (ZAP, nightly) | `nightly-dast / zap-baseline` — 0 high-severity alerts | block deploy (24h grace for new false positives) |
| **G-SEC-4** | Secrets scan clean (gitleaks, whole-repo) | `pr-security / gitleaks` clean | block deploy |
| **G-SEC-5** | SBOM generated for every app (web, mobile, desktop, gateway) | `pr-security / cyclonedx` artefact uploaded | block deploy |
| **G-SEC-6** | DPDP-compliant data-handling verified | `pii-inventory.test.ts` + `docs/runbooks/incident-response.md` link-check | block deploy |
| **G-SEC-7** | Pen-test passed (annual) OR documented-exception | Manual: the annual third-party pen-test report (`10_Security.md §24.2`) — a documented exception requires a `# security-exception` issue approved by a maintainer + tracked to closure | block deploy (no grace) |
| **G-SEC-8** | The `.buddysaradhi` envelope round-trip test passes | `backup-roundtrip.test.ts` + `backup-nonce-uniqueness.test.ts` | block deploy |

### 12.2 The 4 UNVERIFIED items + their gate implications

| UNVERIFIED item | Gate implication | Resolution path |
|---|---|---|
| DPDP Rule 7 exact hour-window | G-SEC-6: the IR runbook applies the stricter of DPDP "as soon as possible" or ICO 72h | Fetch the gazette PDF ([static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)) + legal review |
| Upstash at-rest encryption on free tier | G-SEC-1: if Prod Pack is required for at-rest encryption and the free tier lacks it, the gate requires either Prod Pack OR client-side AES-GCM of the cached `db_token` (defence-in-depth, §7.3) | Confirm Upstash pricing page ([upstash.com/docs/redis/features/security](https://upstash.com/docs/redis/features/security)) + enable Prod Pack before launch OR document the client-side-encryption fallback |
| Turso native encryption GA status | G-SEC-1: if `--experimental-encryption` is still experimental at launch, the gate requires a documented-exception (the experimental flag is acceptable for v1 given the `.buddysaradhi` envelope is the primary ciphertext boundary) | Monitor [docs.turso.tech/tursodb/encryption](https://docs.turso.tech/tursodb/encryption) for GA announcement |
| Next.js CVE-2025-66478 patched version | G-SEC-2: pin `>=16.2.10`; `osv-scanner` will flag if a lower version is installed | Monitor [nextjs.org/blog/security-update-2025-12-11](https://nextjs.org/blog/security-update-2025-12-11) for the specific patched version; update the pin |

### 12.3 The gate in the platform-delivery sequence

The security gate runs at G3 (quality bar) + G4 (verified) of `16_Platform_Delivery_Sequence.md §3`. Concretely:

- **Web gate (W1-W7):** G-SEC-1 through G-SEC-8 must pass before W5 (deploy to Vercel production).
- **Mobile gate (M1-M7):** G-SEC-1 through G-SEC-8 must pass before M4 (EAS Build green on production channel). M4 adds MASTG mobile smoke (§9.2).
- **Desktop gate (D1-D7):** G-SEC-1 through G-SEC-8 must pass before D5 (notarised build runs on a clean macOS + Windows VM). D5 adds the Tauri capabilities check (§9.3) + the minisign updater check (§5.2).

A gate regression (per `16_Platform_Delivery_Sequence.md §3.2`) re-locks the platform. A security-gate regression is the most severe: a new P0/S1 vuln in a dependency (caught by `osv-scanner`) re-locks the platform until the dep is upgraded or a documented-exception is filed.

---

## 13. ASCII Mockup Suite

> Mockups follow `13_UI_Guidelines.md §20` conventions: fenced code blocks, box-drawing chars, `↑ ←` annotations, accent colours named, glass tiers per §5.5, neumo recipes per §6.6. Box widths: 70-90 for the diagrams in this file (security diagrams are wider than UI mockups because they show cross-platform flows).

### 13.1 The Cross-Platform Threat Surface (§1 detail)

```
   ┌─────────────────────────────────────────────────────────────────────────┐
   │           THE BUDDYSARADHI CROSS-PLATFORM THREAT SURFACE                 │
   │    4 platforms · 1 shared spine · 1 contract tag · 1 audit pipeline      │
   └─────────────────────────────────────────────────────────────────────────┘

   ┌─ WEB (Next.js 16 on Vercel) ──────┐  ┌─ MOBILE (Expo SDK 52 / RN 0.76) ─┐
   │                                    │  │                                  │
   │  client ──HTTPS──▶ api.buddysaradhi.app  ◀──HTTPS── client               │
   │   │                                │  │   │                              │
   │   │ httpOnly cookies (Supabase)    │  │   │ expo-secure-store            │
   │   │ nonce-CSP + HSTS + COOP/COEP   │  │   │  + requireAuthentication     │
   │   │ Trusted Types + no-danger      │  │   │ ATS + networkSecurityConfig  │
   │   │                                │  │   │  (cert pinning)              │
   │   ▼ threats (top 3):               │  │   ▼ threats (top 3):             │
   │   1. XSS via dangerouslySetInner   │  │   1. rooted device → Keychain    │
   │   2. CVE-2025-66478 RCE (UNVERIF.) │  │   2. APK reverse-eng (apktool)   │
   │   3. CSRF on ledger mutations      │  │   3. StrandHogg task hijack      │
   └────────────────┬───────────────────┘  └────────────────┬─────────────────┘
                    │                                        │
                    │       one edge domain, one contract     │
                    │       NEXT_PUBLIC_API_BASE              │
                    │       EXPO_PUBLIC_API_BASE              │
                    │                                        │
   ┌─ DESKTOP (Tauri v2 WebView) ──────┐  ┌─ GATEWAY (CF Workers + DO) ─────┐
   │                                    │  │                                  │
   │  client ──HTTPS──▶ api.buddysaradhi.app  ◀──HTTPS── client (same)     │
   │   │                                │  │   │                              │
   │   │ OS keyring (Stronghold)        │  │   │ JWT in Authorization: Bearer  │
   │   │ minisign updater (MANDATORY)   │  │   │ JWKS cached 10min in Upstash  │
   │   │ capabilities minimal, no remote│  │   │ RateLimitDO per tutorId       │
   │   │ SQLCipher key in keychain      │  │   │ Idempotency-Key SETNX 24h     │
   │   │                                │  │   │ secrets via wrangler secret   │
   │   ▼ threats (top 3):               │  │   ▼ threats (top 3):             │
   │   1. over-permissive IPC           │  │   1. replay / double-charge      │
   │   2. DNS-rebinding localhost plug  │  │   2. stale JWKS acceptance       │
   │   3. unsigned updater (mitigated)  │  │   3. cold-start secret leak      │
   └────────────────┬───────────────────┘  └────────────────┬─────────────────┘
                    │                                        │
                    └────────────────────┬───────────────────┘
                                         │
                                         ▼
   ┌─ SHARED SPINE ───────────────────────────────────────────────────────────┐
   │  Supabase Auth (RS256 + JWKS, asymmetric keys)                            │
   │  Turso / libSQL (1-user-1-DB, NEW native AES-256-GCM page encr.)          │
   │  Upstash Redis (TLS always; at-rest = Prod Pack, UNVERIFIED for free tier)│
   │  Vercel Blob (AES-256 at rest; private stores; OIDC preferred)            │
   │  CF D1 audit (gateway-owned, hash-chained, append-only)                   │
   │  .buddysaradhi envelope (AES-256-GCM + Argon2id m=64MiB t=3 p=2)          │
   └───────────────────────────────────────────────────────────────────────────┘

   ↑ A spine weakness breaks all 4 surfaces at once. The harness treats the
     spine as a separate defence-in-depth layer: every spine secret is in a
     per-vendor secrets store; every spine call is TLS 1.3; every spine
     access from a client is mediated by the gateway (no-hardcode rule,
     17_API_Gateway_System.md §2.2).
   ↑ The 4 UNVERIFIED items (DPDP Rule 7 window, Upstash free-tier at-rest,
     Turso --experimental-encryption GA, Next.js CVE-2025-66478 patch ver)
     are tracked in §12.2; each has a gate implication + a resolution path.
```

### 13.2 The Idempotency-Key Dedup Flow (§8.1 detail)

```
   client (mobile, offline → reconnect)                    gateway Worker
     │                                                            │
     │  POST /api/v1/ledger/entries                               │
     │  Idempotency-Key: 7c3f...e9 (UUIDv4)                       │
     │  X-Timestamp: 2025-12-15T10:30:00Z                         │
     │  X-Nonce: k8x2... (16 bytes base64)                        │
     │  body: { tutorId, kind:"fee_payment", amountPaise, ... }    │
     ├───────────────────────────────────────────────────────────▶│
     │                                                            │
     │                                            ┌─ stage 4.5 ────┐
     │                                            │ idem dedup:    │
     │                                            │                │
     │                                            │ redis.SET      │
     │                                            │  idem:t_7:7c3f │
     │                                            │  reqHash       │
     │                                            │  NX  EX 86400  │
     │                                            └───────┬────────┘
     │                                                    │
     │                              ┌─────────────────────┴─────────────────────┐
     │                              │                                             │
     │                              ▼                                             │
     │                  ┌─ SET returns OK ─────────┐  ┌─ SET returns nil ────────┐
     │                  │ first time seen           │  │ duplicate within 24h:    │
     │                  │ proceed to service        │  │ GET idem:t_7:7c3f:resp   │
     │                  │ store response in         │  │  - reqHash matches?      │
     │                  │  idem:t_7:7c3f:resp       │  │    YES → 200 OK (cached) │
     │                  │  EX 86400                 │  │    NO  → 409 conflict    │
     │                  │                           │  │      (same key, diff     │
     │                  │ ledger.entry.create()     │  │       body = client bug) │
     │                  │  (append-only, LEDGER-1)  │  │                          │
     │                  │ audit_log (CF D1)         │  │                          │
     │                  │                           │  │                          │
     │                  ▼                           │  │                          │
     │  200 OK + Result.ok(LedgerEntry)            │  │  200 OK + cached resp    │
     │◀────────────────────────────────────────────┤  │◀─────────────────────────┤
     │                                            │                              │
     │                                            └──────────────────────────────┘
     │                                                            │
     │  (network drops; client SDK auto-retries the SAME request  │
     │   with the SAME Idempotency-Key, X-Timestamp, X-Nonce)     │
     │                                                            │
     │  POST /api/v1/ledger/entries                               │
     │  Idempotency-Key: 7c3f...e9 (SAME)                         │
     │  X-Timestamp: 2025-12-15T10:30:00Z (SAME)                  │
     │  X-Nonce: k8x2... (SAME)                                   │
     │  body: { ... (SAME) }                                       │
     ├───────────────────────────────────────────────────────────▶│
     │                                                            │
     │                                            ┌─ stage 4.5 ────┐
     │                                            │ redis.SET      │
     │                                            │  returns nil   │
     │                                            │  (key exists)  │
     │                                            │ GET resp →     │
     │                                            │  reqHash match │
     │                                            │  → 200 OK      │
     │                                            │  (CACHED)      │
     │                                            └────────────────┘
     │                                                            │
     │  200 OK + Result.ok(LedgerEntry) (CACHED — no double-charge)│
     │◀────────────────────────────────────────────────────────────┤

   ↑ The 24h TTL covers any realistic retry window (mobile offline →
     reconnect → outbox drain). The reqHash is SHA-256 of the canonicalised
     request body (no PII — same hash family as the audit row,
     10_Security.md §8.3).
   ↑ The ledger's append-only invariant (LEDGER-1) + the idempotency key =
     double-charge is structurally impossible. The CI test
     idempotency-replay.test.ts asserts a replayed request returns the
     cached response.
   ↑ The replay window (X-Timestamp ±5 min + X-Nonce 10-min dedup via
     DO alarm()) is a separate defence: even if the client generates a NEW
     Idempotency-Key for a replayed request (a client bug), the nonce+timestamp
     check still catches it.
```

### 13.3 The Security CI Pipeline (§11 detail)

```
   ┌─ DEVELOPER COMMITS ──────────────────────────────────────────────────────┐
   │                                                                          │
   │  lefthook pre-commit runs:                                               │
   │   1. gitleaks detect --staged --redact    ← catches secret BEFORE push   │
   │   2. eslint --cache                       ← lint                         │
   │   3. rnsec (apps/mobile/ only)            ← mobile SAST                  │
   │                                                                          │
   │  (any failure → commit blocked locally; the secret never reaches remote) │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        │ pass
                                        ▼
   ┌─ PR OPENS · GitHub Actions `security.yml` ───────────────────────────────┐
   │                                                                          │
   │  job: pr-security (ubuntu-latest, ~15 min)                               │
   │   ┌─ 1. gitleaks (whole-repo scan, defence-in-depth on pre-commit) ──┐  │
   │   ├─ 2. semgrep --config semgrep.yml + p/typescript + p/react +       │  │
   │   │      p/javascript + p/owasp-top-ten                              │  │
   │   │      (SAST: no-hardcode, never-mock-the-ledger, integer-paise,   │  │
   │   │       no-queryRawUnsafe, no-console-log-env,                     │  │
   │   │       no-supabase-token-in-localStorage)                         │  │
   │   ├─ 3. osv-scanner --lockfile bun.lockb                             │  │
   │   │              --lockfile apps/mobile/package-lock.json            │  │
   │   │              --lockfile apps/desktop/Cargo.lock                  │  │
   │   │      (SCA: fails on High/Critical CVEs)                          │  │
   │   ├─ 4. license-checker --licenses licenses.allowlist.json           │  │
   │   │      (allow: MIT, ISC, Apache-2.0, BSD-*, MPL-2.0)               │  │
   │   ├─ 5. cyclonedx-bun -o bom.{web,gateway}.json                      │  │
   │   │      (SBOM; uploaded as build artefact + Dependency-Track)       │  │
   │   ├─ 6. tauri-updater-key-present (release builds only)              │  │
   │   │      (asserts TAURI_SIGNING_PRIVATE_KEY in env)                  │  │
   │   └─ 7. npm audit signatures (Sigstore provenance)                   │  │
   │                                                                          │
   │  job: lint (ESLint + @next/eslint-config-next + eslint-plugin-security) │
   │  job: unit-tests (10_Security.md §24.1 suite)                           │
   │  job: integration-tests                                                  │
   │  job: tauri-capabilities-check (custom; §9.3)                            │
   │  job: next-headers-check (custom; §6.3)                                  │
   │                                                                          │
   │  ALL of the above are required-status-checks on `main` (branch protect.) │
   │  enforce_admins: true  ← no maintainer bypass                            │
   └────────────────────────────────────┬─────────────────────────────────────┘
                                        │ all pass + 1 review
                                        ▼
   ┌─ MERGE TO MAIN ──────────────────────────────────────────────────────────┐
   │                                                                          │
   │  (deploy to staging; no production yet)                                  │
   └─────────────────────────────────────────────────────────────────────────┘

   ┌─ NIGHTLY · GitHub Actions `security.yml` (cron 0 2 * * *) ────────────────┐
   │                                                                          │
   │  job: nightly-dast (ubuntu-latest, ~30 min)                              │
   │   ┌─ 1. owasp-zap-baseline against Vercel preview URL ────────────────┐  │
   │   │      (DAST; opens GitHub issues for alerts; rules file ignores    │  │
   │   │       known false positives)                                      │  │
   │   ├─ 2. audit-chain-verification (full recompute, 10_Security.md §8.3)│  │
   │   ├─ 3. security-flows (4 flows: auth-replay, idempotency-double-     │  │
   │   │      charge, tamper-detect, secure-erase)                         │  │
   │   └─ 4. upload zap-report.html + playwright traces as artefacts       │  │
   │                                                                          │
   │  job: nightly-mobile-mastg (macos-latest, ~40 min)                      │
   │   ┌─ MASTG smoke test on preview .ipa + .apk (automated subset) ──────┐  │
   │   │      (full MASTG is a manual pen-test activity, 10_Security.md §24.2)│
   │   └────────────────────────────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────────────┘

   ┌─ SECURITY GATE (§12) — required for production deploy ───────────────────┐
   │                                                                          │
   │  G-SEC-1  no P0/S1 vuln open         (osv-scanner + semgrep)             │
   │  G-SEC-2  SAST clean                  (semgrep + eslint + rnsec)          │
   │  G-SEC-3  DAST baseline clean         (zap, nightly)                      │
   │  G-SEC-4  secrets scan clean          (gitleaks, whole-repo)             │
   │  G-SEC-5  SBOM generated              (cyclonedx, every app)             │
   │  G-SEC-6  DPDP-compliant data-handling (pii-inventory + IR runbook)      │
   │  G-SEC-7  pen-test passed OR documented-exception (annual)               │
   │  G-SEC-8  .buddysaradhi round-trip     (backup-roundtrip + nonce-unique) │
   │                                                                          │
   │  ALL 8 must pass; a single failure blocks the production deploy.         │
   └─────────────────────────────────────────────────────────────────────────┘

   ↑ The 15-min webDevReview cron (job_id 266790, 21_Automation_Testing.md §8)
     runs the AI bug-resolution loop on the preview site; its prompt is
     extended to include the 4 security-flow results. This is the FUNCTIONAL
     layer (21) running alongside the SECURITY layer (this file).
   ↑ The 4 UNVERIFIED items (§12.2) each have a gate implication + a
     resolution path; none blocks the v1 launch outright, but each must be
     resolved or documented-exceptioned before G-SEC-6/7 passes.
```

### 13.4 The Incident-Response Runbook Flowchart (§10.6 detail)

```
   ┌─ DETECT ──────────────────────────────────────────────────────────────────┐
   │  alert source (any of):                                                   │
   │   • impossible-travel detector (§10.2)                                    │
   │   • bulk-export anomaly (§10.3)                                           │
   │   • audit-chain break (10_Security.md §8.3)                               │
   │   • tamper-hash mismatch (10_Security.md §10)                             │
   │   • external report (security@buddysaradhi.app per §21.1)                 │
   │   • osv-scanner new P0 CVE in a dependency                                │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ CONTAIN (SLA: within 1h of detect) ─────────────────────────────────────┐
   │  • on-call engineer acks the alert                                        │
   │  • revoke affected tutor's Supabase session (Settings → Revoke sessions)  │
   │  • rotate Turso db_token (provision-db re-issues)                         │
   │  • if .buddysaradhi envelope flaw:                                        │
   │     - publish CVE-style advisory at buddysaradhi.app/security/advisories  │
   │     - in-app notification to every active install (update-check channel)  │
   │  • if gateway secret leak:                                                │
   │     - rotate ALL gateway secrets (wrangler secret put)                    │
   │     - force JWKS re-fetch (DEL jwks:supabase in Upstash)                  │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ ERADICATE (SLA: within 24h) ─────────────────────────────────────────────┐
   │  • identify root cause (log review + code review + VLM analysis if UI)    │
   │  • ship patched build (hotfix branch; full security gate §12 must pass)   │
   │  • if Turso DB exfiltrated: re-provision with fresh hexkey               │
   │  • if .buddysaradhi envelope flaw: ship reencrypt_all_backups tool        │
   │    (10_Security.md §21.3 step 3)                                          │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ NOTIFY (parallel DPDP + ICO tracks) ─────────────────────────────────────┐
   │                                                                            │
   │   ┌─ DPDP track (India) ──────────────────────────┐                       │
   │   │  • Rule 7: intimate the Data Protection Board │                       │
   │   │    + affected Data Principals                  │                       │
   │   │  • SLA: "as soon as possible"                  │                       │
   │   │    (UNVERIFIED: exact hour-window; apply       │                       │
   │   │     stricter of DPDP or ICO 72h)               │                       │
   │   │  • Rule 13: if SDF threshold crossed, DPIA    │                       │
   │   │    + DPO involvement                           │                       │
   │   │  • tutor is the Data Fiduciary (legal oblig.) │                       │
   │   │    Buddysaradhi-the-company is the Processor  │                       │
   │   │    → the gateway/audit-log gives the tutor    │                       │
   │   │      the data to fulfil their obligation       │                       │
   │   └────────────────────────────────────────────────┘                       │
   │                                                                            │
   │   ┌─ ICO track (EU/UK/US fallback) ───────────────┐                       │
   │   │  • notify supervisory authority within 72h    │                       │
   │   │    of becoming aware                           │                       │
   │   │  • notify affected individuals "without undue │                       │
   │   │    delay" if high risk                         │                       │
   │   │  • (applies to tutors outside India)           │                       │
   │   └────────────────────────────────────────────────┘                       │
   │                                                                            │
   │   ↑ apply the STRICTER of the two tracks; document both in the IR runbook  │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ RECOVER (SLA: within 7 days) ────────────────────────────────────────────┐
   │  • restore from last clean backup if data was corrupted                   │
   │  • verify ledger integrity (Settings → Security → Verify integrity)       │
   │  • verify audit chain (audit_reconcile_job)                               │
   │  • lift rate-limit cooldowns on affected tutors                           │
   │  • communicate "all clear" to affected tutors + the Data Protection Board │
   └────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
   ┌─ POSTMORTEM (SLA: within 14 days) ────────────────────────────────────────┐
   │  • blameless postmortem doc at docs/postmortems/<YYYY-MM-DD>-<slug>.md    │
   │  • root-cause analysis (5-whys)                                           │
   │  • action items tracked to closure in GitHub issues                       │
   │  • update threat model (10_Security.md §20)                               │
   │  • update IR runbook if the response was slow or wrong                    │
   │  • share learnings with the team (weekly engineering review)              │
   └───────────────────────────────────────────────────────────────────────────┘

   ↑ The IR runbook is the checked-in artefact docs/runbooks/incident-response.md
     (NEW); a CI link-check test asserts every URL in the runbook resolves.
   ↑ The runbook is DPDP-aware: it includes the DPDP-specific track (Rule 7
     intimation, Rule 13 SDF check) alongside the ICO 72-hour track.
   ↑ The 10_Security.md §21.3 breach-notification commitment (24h advisory,
     72h in-app notification, 7-day patched build) is the existing baseline;
     this runbook extends it with the DPDP-specific Rule 7 intimation.
```

### 13.5 The DPDP Breach-Notification Timeline (§10.4 detail)

```
   ┌─ DPDP BREACH-NOTIFICATION TIMELINE ──────────────────────────────────────┐
   │                                                                          │
   │  t=0     breach occurs (or: Buddysaradhi becomes aware)                  │
   │           ↑ "becomes aware" = the detect phase (§13.4) fires             │
   │                                                                          │
   │  t=1h    contain phase complete (§13.4)                                  │
   │           - affected tutor's Supabase session revoked                    │
   │           - Turso db_token rotated                                       │
   │           - if envelope flaw: advisory published                         │
   │                                                                          │
   │  t=24h   eradicate phase complete (§13.4)                                │
   │           - patched build shipped (full security gate §12 passed)        │
   │           - if Turso DB exfiltrated: re-provisioned with fresh hexkey    │
   │                                                                          │
   │  t=ASAP  DPDP Rule 7 intimation (UNVERIFIED exact window)                │
   │   OR     ┌─────────────────────────────────────────────────────────┐    │
   │  t=72h   │ ICO 72h fallback (stricter cross-border baseline)        │    │
   │          │  - notify the Data Protection Board (DPDP)               │    │
   │          │    OR the supervisory authority (ICO/EU)                 │    │
   │          │  - notify affected Data Principals                       │    │
   │          │    ("without undue delay" if high risk)                  │    │
   │          └─────────────────────────────────────────────────────────┘    │
   │                                                                          │
   │  t=7d    recover phase complete (§13.4)                                  │
   │           - last clean backup restored if needed                         │
   │           - ledger integrity + audit chain verified                      │
   │           - "all clear" communicated to affected tutors + DPB            │
   │                                                                          │
   │  t=14d   postmortem complete (§13.4)                                     │
   │           - blameless postmortem doc                                     │
   │           - threat model updated (10_Security.md §20)                    │
   │           - IR runbook updated if response was slow/wrong                │
   │                                                                          │
   │  t=90d   public disclosure (coordinated, per 10_Security.md §21.2)       │
   │           - if external researcher reported: credit in Acknowledgments   │
   │           - if internal discovery: public advisory at                    │
   │             buddysaradhi.app/security/advisories/<id>                    │
   └─────────────────────────────────────────────────────────────────────────┘

   ↑ The 4 UNVERIFIED items affect this timeline:
     - DPDP Rule 7 hour-window: applied as "as soon as possible" pending
       gazette PDF confirmation (static.pib.gov.in/.../doc20251117695301.pdf)
     - The ICO 72h is the stricter cross-border fallback; for Indian tutors
       the DPDP "ASAP" track applies, for non-Indian the ICO 72h track applies
     - The tutor is the Data Fiduciary (legal obligation to intimate); the
       gateway/audit-log gives them the data to fulfil it
     - Buddysaradhi-the-company is the Processor; we provide the runbook +
       the audit data, the tutor files the intimation
```

### 13.6 Caveats / UNVERIFIED items (carried forward from research)

This file carries forward **four UNVERIFIED items** from `research_R-SECURITY-HARNESS.md`. Each is explicitly marked at its first mention in the body (§§1.1, 7.1, 10.4, 4.6) and tracked in the gate-implications table (§12.2). None blocks the v1 launch outright; each has a documented resolution path.

1. **DPDP Rule 7 exact hour-window** for breach intimation — first mention §10.4; gate G-SEC-6 (IR runbook applies stricter of DPDP "ASAP" or ICO 72h); resolution: fetch the gazette PDF ([static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf)) + legal review.
2. **Upstash at-rest encryption on the free tier** — first mention §7.3; gate G-SEC-1 (Prod Pack required OR client-side AES-GCM fallback); resolution: confirm [upstash.com/docs/redis/features/security](https://upstash.com/docs/redis/features/security).
3. **Turso native encryption GA status** (currently `--experimental-encryption`) — first mention §7.1; gate G-SEC-1 (documented-exception acceptable for v1); resolution: monitor [docs.turso.tech/tursodb/encryption](https://docs.turso.tech/tursodb/encryption).
4. **Next.js CVE-2025-66478 exact patched release** — first mention §1.1; gate G-SEC-2 (pin `>=16.2.10`); resolution: monitor [nextjs.org/blog/security-update-2025-12-11](https://nextjs.org/blog/security-update-2025-12-11).

**Everything else in this file is grounded in `research_R-SECURITY-HARNESS.md`** (40 web searches + 20 primary-source fetches); every URL citation comes from that research document.

---

## 14. Cross-References

- `10_Security.md` — the SPEC this file enforces (the "what controls exist"); this file is the HARNESS (the "how they are enforced"). Cross-refs throughout: §1 (trust model), §2 (auth + provisioning), §3 (PIN/biometric), §6 (data at rest), §7 (RLS), §8 (audit chain), §9 (ledger integrity), §10 (receipt tamper), §11 (input validation), §12 (web security), §13 (mobile), §14 (desktop), §15 (backup envelope), §16 (PII inventory), §17 (no-telemetry), §18 (secure erase), §20 (STRIDE), §21 (vuln disclosure), §22 (compliance), §23 (CI/CD harness), §24 (testing checklist).
- `17_API_Gateway_System.md` — the gateway this file secures (CF Workers + DO + Upstash + QStash + Prisma v6.16 + Turso + Supabase + Vercel Blob). Cross-refs: §2.2 (no-hardcode rule), §3 (request lifecycle stages 2/3/7/9 = auth/rate-limit/storage/audit), §5 (auth model three platforms), §6.2 (SyncDO WebSocket Hibernation), §6.3 (7 Upstash cache keys + 3 QStash schedules), §8.1 (Idempotency-Key contract).
- `18_Microservice_Architecture.md` — the 6 services + cross-cutting security the gateway dispatches to. Cross-refs: §3.4 (SyncDO Hibernation API), §3.7 (auth-svc provision-db stays Supabase Edge Function), §5.2 (per-service Prisma schema slices = mechanical boundary enforcement), §6 (secure-erase orchestration), §7 (wrangler.toml skeleton).
- `16_Platform_Delivery_Sequence.md` — the platform-delivery sequence whose G3/G4 gates this file's security gate (§12) makes security-specific. Cross-refs: §3 (G3/G4 generic gate), §4 (W5/W6 web gate), §3.2 (gate regression = re-lock).
- `21_Automation_Testing.md` — the AI bug-finding loop + a11y automation that this file's §11 SDLC harness complements (security layer alongside the functional layer). Cross-refs: §2 (the 5-step AI bug-finding loop), §6 (a11y 4 layers), §8 (the 15-min webDevReview cron, extended to include security flows), §10 (the GitHub Actions security.yml structure this file mirrors).
- `22_Redundancy_Audit.md` §10 — the dedup lint; every new test/rule in this file is cross-checked against the existing inventory to avoid duplication with `10_Security.md §24.1`.
- `11_Data_Model.md` §10 — ORM discipline (services use Prisma ORM only; the gateway never runs SQL except VACUUM in `lib/db/admin.ts`).
- `09_Backup_and_Import_Export.md` §15 — the `.buddysaradhi` envelope round-trip test this file's §7.2 + G-SEC-8 verify.
- `12_Business_Rules.md` BR-LED-02 (integer-paise) — the rule the `integer-paise` Semgrep rule (§11.2) enforces.
- `desktop/03_IPC_Security.md` — the Tauri capabilities model this file's §4.4 + §9.3 enforce.
- `deployment/06_Edge_Function_Hosting.md` (NEW — to be written) — the wrangler/CF Workers deployment recipe; this file's §8.5 (secrets via `wrangler secret put`) is the security spec for that recipe.
- `research_R-SECURITY-HARNESS.md` — the source of truth for every URL citation in this file; the 4 UNVERIFIED items are carried forward from its caveats section.
- `research_R-GQL-EDGE-REDIS.md` — the source of truth for the edge-stack claims (CF Workers + DO + Upstash + Prisma v6.16) that this file's gateway-security section (§8) depends on.

---

## 15. Summary (the whole file in five lines)

1. **10_Security.md is the SPEC; this file is the HARNESS** — the automated enforcement, the cross-platform threat surface, the SDLC gate, the DPDP-aware incident response (§0).
2. **Four surfaces, one shared spine** — web (XSS, CVE-2025-66478 RCE, CSRF) + mobile (rooted device, APK reverse-eng, StrandHogg) + desktop (over-permissive IPC, DNS-rebinding, unsigned updater) + gateway (replay/double-charge, stale JWKS, cold-start secret leak); the spine is Supabase/Turso/Upstash/Blob/D1/.buddysaradhi (§1).
3. **Ten security domains (S1-S10)** — auth (RS256+JWKS), authz (1-user-1-Turso-DB + HMAC cache), injection (OpenAPI+Zod + no-remote Tauri), supply chain (Tauri minisign + Sigstore + CycloneDX + OSV-Scanner + gitleaks + license-checker), transport (TLS 1.3 + nonce-CSP + cert pinning + no-localhost-plugin), data (Turso native AES-256-GCM NEW + Upstash Prod Pack + Blob OIDC), gateway (RateLimitDO + Idempotency-Key SETNX + nonce+timestamp replay window + wrangler secret put), client (rnsec 85+ rules + Tauri capabilities minimal + Next.js nonce-CSP), observability (hash-chained audit + impossible-travel + bulk-export anomaly + DPDP 2025 + ICO 72h fallback), SDLC (Semgrep custom rules + ZAP nightly + the security.yml skeleton) (§§2-§11).
4. **The hard production-readiness gate (G-SEC-1 through G-SEC-8)** — no P0/S1 vuln open, SAST clean, DAST baseline clean, secrets scan clean, SBOM generated, DPDP-compliant data-handling verified, pen-test passed or documented-exception, `.buddysaradhi` round-trip passes. All 8 must pass; a single failure blocks the production deploy (§12).
5. **Four UNVERIFIED items carried forward** — DPDP Rule 7 hour-window, Upstash free-tier at-rest encryption, Turso `--experimental-encryption` GA, Next.js CVE-2025-66478 exact patched release; each has a gate implication + a resolution path (§13.6).
