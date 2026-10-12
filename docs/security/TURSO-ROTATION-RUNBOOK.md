# Rotation Runbook — Turso DB Tokens & Supabase Service Keys

> **Implements:** `docs/security/credential-exposure-2026-10.md` (findings F-01,
> F-02, F-03, F-04) · `deployment/01_Vercel_Hosting.md` §env matrix ·
> `10_Security.md` (threat model) · `AGENTS.md` §9.3.
>
> **Who this is for:** a human with Turso dashboard + Supabase dashboard + Vercel +
> GitHub repository-admin access. **No part of this runbook can be executed by an
> agent.** Rotation is a provider-side destructive action on live credentials.
>
> **Status:** NOT YET EXECUTED. No credential described here has been rotated.

---

## 0. Read this first — the two facts that dictate the order

1. **Rotate first, scrub second.** Rewriting git history does not un-leak a secret;
   it only stops future readers from finding it. See
   `credential-exposure-2026-10.md` §3 for the full reasoning. History rewriting is
   step 5 in §6, and it is an owner decision.
2. **The leaked Turso token has no `exp` claim.** Age does not retire it. It stays
   usable until explicitly revoked. F-01's `a` claim is `rw` — read-write — so it is
   a ledger-integrity exposure, not merely a confidentiality one
   (`AGENTS.md` Rule 1, BR-LED-01).

---

## 1. Environment variables this repository actually reads

Everything in this section was verified by reading the source, not assumed. Line
references are to commit `773c0512`.

### 1.1 Gateway (Deno edge, `apps/gateway/`)

| Variable | Read at | Source | Notes |
|---|---|---|---|
| `TURSO_DATABASE_URL` | **Per request** | `lib/sql.ts:50`, `index.ts:264`, `graphql/index.ts:411` | Resolver `resolveTursoUrl()`. Rejects any URL containing `supabase.co` or the literal project ref `gmqwdnvbfnwpzpctwvho` (`sql.ts:44-45`) and falls back to the env var. |
| `TURSO_AUTH_TOKEN` | **Per request** | `lib/sql.ts:68`, `index.ts:269` | Primary name. |
| `TURSO_TOKEN` | **Per request** | `lib/sql.ts:68`, `index.ts:270`, `graphql/index.ts:416` | **Fallback alias**, checked only if `TURSO_AUTH_TOKEN` is unset. Both names must be rotated or you will leave a live token behind. |
| `SUPABASE_URL` | **Per request** | `lib/auth.ts:26`, `provision/index.ts:178`, `graphql/index.ts:370` | Falls back to `NEXT_PUBLIC_SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Per request** | `lib/auth.ts:27`, `provision/index.ts:179`, `graphql/index.ts:371` | The F-02 key. |
| `GATEWAY_SHARED_SECRET` | **BOOT TIME** | `lib/crypto.ts:24` | `const HMAC_SECRET = readSecret(...)` at module scope. |
| `DATA_ENCRYPTION_KEY` | **BOOT TIME** | `lib/crypto.ts:25` | Falls back to `GATEWAY_SHARED_SECRET` when unset. |
| `GATEWAY_ADMIN_TOKEN` | Per request (not in `.env.example` list) | `.env.example:11` | Destructive `security/erase` endpoint. |

> **⚠ The project-ref string `gmqwdnvbfnwpzpctwvho` is hardcoded in
> `apps/gateway/lib/sql.ts:45`** as a blocklist check. That is the same Supabase
> project as F-02/F-03, which independently confirms the linkage between the
> findings. Flagged for the owner; **not changed here** (no source edits).

### 1.2 Web (Next.js, `apps/web/`)

| Variable | Read at | Source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build + runtime | `lib/supabase/client.ts:5`, `server.ts:7`, `middleware.ts:22`, `(auth)/callback/route.ts:20` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build + runtime | `lib/supabase/client.ts:6`, `server.ts:8`, `middleware.ts:23` |
| `SUPABASE_SERVICE_ROLE_KEY` | Per request | `lib/supabase/server.ts:31` (`createSupabaseAdmin`), `app/api/v1/[...slug]/route.ts:308` |
| `TURSO_API_TOKEN` | **Module scope** | `lib/turso/client.ts:11` — `export const TURSO_API_TOKEN = process.env.TURSO_API_TOKEN` evaluated at import; used at `app/api/v1/[...slug]/route.ts:303,350,369` for provisioning calls. **Not the leaked F-01 token** (F-01 is a *database* token; this is the *platform* token), but rotate it in the same sitting if you cannot prove it was never exposed. |

### 1.3 Boot-time vs per-request — why this decides redeploy scope

This distinction determines whether a rotation takes effect immediately or needs a
redeploy, and it is the single most common cause of a "rotation done but the old
token still works" incident.

- **Boot-time reads need a redeploy.** `GATEWAY_SHARED_SECRET` and
  `DATA_ENCRYPTION_KEY` are captured into module-scope `const`s at
  `crypto.ts:24-25`, before any request is served. `TURSO_API_TOKEN` likewise at
  `lib/turso/client.ts:11`. Setting the env var does nothing until the isolate is
  replaced. **`apps/gateway/lib/crypto.ts:37-55` runs a startup strength gate that
  THROWS in production** if these are weak or missing, so a botched rotation
  surfaces as a boot failure rather than as a silent degradation — that is
  fail-closed behaviour and is what you want.
- **Per-request reads take effect on the next request.** `TURSO_AUTH_TOKEN`,
  `TURSO_TOKEN`, `TURSO_DATABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are read
  inside the request handler each time, so an env-var change is effective as soon as
  the new deployment's environment is live. No isolate restart needed.
- **Turso has one extra wrinkle.** `lib/db.ts:48-72` caches libsql clients keyed by
  URL in an LRU (max 64) and stores a **fingerprint** of the token
  (`db.ts:39-46`, FNV-1a). On a token change the fingerprint mismatches and the
  client is rebuilt in place (`db.ts:53-63`). The comment at `db.ts:16-21` notes the
  key previously mixed `token.slice(-16)`, which minted a *second* live client on
  every rotation. **Practical consequence:** a stale-isolate is the only realistic
  way the old token keeps being used after rotation, so **force a fresh deployment
  of the gateway in step 4.3** rather than assuming env-var propagation is enough.

### 1.4 Pre-flight gap you should know about

`deployment/01_Vercel_Hosting.md:144` claims a `.env.example` exists at the monorepo
root and in `apps/web/` documenting every variable. **Neither file exists.** The only
tracked `.env.example` is `apps/gateway/.env.example` (32 lines), and it documents
`DATABASE_URL`, `PORT`, `GATEWAY_ADMIN_TOKEN`, `ALLOWED_ORIGINS`, `ALLOW_DEV_AUTH`
— **not** any Turso or Supabase variable. So if you are following this runbook from
a clean checkout, **the set of variables and their scopes above is the only
authoritative in-repo list.** Reported, not fixed.

---

## 2. Step 0 — Pre-flight (before touching any provider)

- [ ] Confirm you are on a clean tree and know the target commit:
      `git rev-parse --short HEAD` (expected `773c0512`).
- [ ] Record the current leak windows from
      `docs/security/credential-exposure-2026-10.md` §1 for the access-log audit in
      step 4.4:
      - Supabase: from **2026-07-27** (commit `0b001613fd`).
      - Turso: from **2026-08-03** (commit `4bce3ddd1`), earliest observed token
        commit `021e9efccc81`.
- [ ] Identify every place these secrets must be updated. From the code, that is:
      the **gateway** (Supabase Edge Function secrets), **Vercel** (production +
      preview env), **GitHub Actions** secrets, and any developer `.env.local`
      (git-ignored, but a developer's machine still holds the old value).
- [ ] Announce the window to collaborators **before** force-pushing anything.

---

## 3. Step 1 — Generate the new Turso tokens

Turso issues **database auth tokens** separately from the **platform API token**.
F-01 is a *database* token.

1. Sign in at <https://turso.io> (or the Cloud-hosted alternative if you have
   migrated) and select the organisation whose `rid` matches the leaked token's
   `rid` claim. The leaked token's `rid` is an org UUID — confirm the right org in
   the dashboard before generating.
2. For **each database** in that org, open the database → **Credentials / Auth
   Tokens**.
3. Click **Create token** and copy the value into your password manager **directly**.
   Do **not** paste it into a terminal you will screenshot, a chat, an issue, or a
   scratch file. That is precisely how F-01 was created.
4. Do **not** revoke the old token yet — order matters, see §4.3.

> **Note on scope:** Turso's dashboard generates a token scoped to one database, so
> "one leaked token" may in practice correspond to several databases. Enumerate all
> of them in the org, not just the one implied by the leaked `rid`.

---

## 4. Step 2 — Atomic cutover (add → verify → switch → remove)

This is the core procedure. The invariant: **the new credential is proven working
before the old one is destroyed, and every consumer is switched before the old one
is removed.**

### 4.1 ADD — stage the new values everywhere, without breaking anything

Set the new values as **additional** environment entries; do not overwrite yet.

| Consumer | Action |
|---|---|
| Gateway (Supabase Edge secrets) | `supabase secrets set TURSO_AUTH_TOKEN=<new> TURSO_TOKEN=<new>` — set **both**; `TURSO_TOKEN` is the fallback at `sql.ts:68`. |
| Gateway | `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<new-supabase-key>` (from §5). |
| Vercel production | Project Settings → Environment Variables → add `TURSO_AUTH_TOKEN`, `TURSO_TOKEN`, `TURSO_DATABASE_URL`. |
| GitHub Actions | Settings → Secrets → add `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `E2E_PASSWORD`. |

Leaving the old values in place is what makes step 4.2 safe: if the new value is
wrong, nothing has broken yet.

### 4.2 VERIFY — prove the NEW credential works, before touching the old

Run this **by hand**, not from a script that logs its output. Substitute values at
the prompt so nothing lands in shell history:

```sh
# --- Turso: does the NEW token authenticate? ---
read -r -p 'New token: ' TURSO_NEW_TOKEN
read -r -p 'DB URL (libsql://...): ' DB_URL

curl -sS -X POST "$DB_URL/v2/pipeline" \
  -H "Authorization: Bearer ${TURSO_NEW_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT 1 AS ok"}}]}'
unset TURSO_NEW_TOKEN
```

Expected: `{"results":[{"response":{"result":{"rows":[[{"ok":1}]]}},"type":"ok"}]}`.

- `200` + the row → **new token is valid.**
- `401` / `"token is not valid"` → stop. The old token is untouched, nothing is
  broken. Re-check the database, the org, and that you copied the whole token.

Then confirm the **read-only** nature of your check: this statement is a `SELECT`,
so a successful response proves authentication and read access. It does **not**
prove write access, and you should not test write access against a production
ledger database. The leaked token's `a: "rw"` claim is known from the decoded
payload; you do not need to prove yours can write to know the old one could.

```sh
# --- Supabase: does the NEW service_role key work? ---
read -r -p 'New service_role key: ' SB_KEY

curl -sS "https://gmqwdnvbfnwpzpctwvho.supabase.co/rest/v1/tenants?select=id&limit=1" \
  -H "apikey: ${SB_KEY}" \
  -H "Authorization: Bearer ${SB_KEY}"
unset SB_KEY
```

Expected: HTTP `200` with a JSON array. `401` → wrong key or wrong project.

### 4.3 SWITCH — promote the new value and redeploy

Only after 4.2 is green:

1. **Gateway:** redeploy the edge functions so the new secrets are picked up by
   fresh isolates. This is required regardless of the per-request read semantics,
   because `lib/db.ts`'s client cache (`db.ts:48-72`) holds long-lived libsql
   connections built with the old token. Use the same command your CI uses
   (`.github/workflows/supabase-ci.yml:79`):
   `supabase functions deploy gateway --project-ref gmqwdnvbfnwpzpctwvho --no-verify-jwt`
   — and likewise for `provision-db` (`supabase-ci.yml:89`) and `gateway-graphql`
   (`supabase-ci.yml:104`).
2. **Vercel:** promote the new values to Production and Preview, then redeploy
   (a fresh build is required for the `NEXT_PUBLIC_*` values, which are inlined at
   build time — `lib/supabase/client.ts:5-6`).
3. **GitHub Actions:** update the repository secrets. No redeploy needed; they are
   read per job run.

### 4.4 REMOVE — now destroy the old credentials

**Only after the switch is verified in production.**

1. **Turso dashboard** → revoke the old token for every database in the org. This
   is the step that actually kills the leak; §1-3 explains why nothing else does.
2. **Supabase dashboard** → rotate/regenerate the API keys so the old
   `service_role` JWT stops validating. (Full procedure in §5.)
3. **Change the E2E account password** (F-04) and review what that account can reach.
4. **Audit logs (do not skip).**
   - Supabase: project → Authentication → Users, and the API/analytics logs, over
     2026-07-27 → present. Look for unknown clients or elevated reads.
   - Turso: check the organisation's DB activity for reads/writes from unfamiliar
     IPs. `a: "rw"` means an attacker could have written to a ledger; assume the
     worst until the logs say otherwise, and reconcile against the ledger's hash
     chain (`packages/core` `postLedgerEntry`) per `AGENTS.md` Rule 1.
   - GitHub: review Actions run logs for the workflows that carried the plaintext
     password (F-04) — third-party Actions can read job env.

### 4.5 VERIFY the old credential is dead — the negative test

A rotation is not proven until you prove the old value fails.

```sh
read -r -p 'OLD (revoked) token: ' TURSO_OLD_TOKEN
read -r -p 'DB URL: ' DB_URL

curl -sS -o /dev/null -w 'HTTP %{http_code}\n' -X POST "$DB_URL/v2/pipeline" \
  -H "Authorization: Bearer ${TURSO_OLD_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT 1"}}]}'
unset TURSO_OLD_TOKEN
```

Expected: **`401`**. Any `200` means the revocation did not take effect — do not
proceed to the history scrub; go back to §4.4 step 1.

Same for Supabase: the old `service_role` key must return `401` from the
`/rest/v1/` endpoint.

---

## 5. Supabase service-role key rotation (F-02)

Covered here because it shares the project with F-03 and shares the runbook's
ordering discipline.

### 5.1 Which key leaked

The token committed at `.github/workflows/lint.yml:25` decoded to
`iss: supabase`, `role: service_role`, `ref: gmqwdnvbfnwpzpctwvho`,
`iat: 2026-06-27`, **`exp: 2036-06-27`**. Identified in this document only by its
SHA-256 prefix `bb3333b3a7d3`.

### 5.2 Procedure

1. Supabase dashboard → **Project Settings → API Keys**.
2. **Regenerate** the `service_role` secret key (legacy JWT). Supabase issues a new
   value; the old one stops validating once regenerated. Record the new value
   directly into a secret store.
3. **Also regenerate the `anon` key (F-03)** in the same operation. It is public by
   design and not independently dangerous, but the two share a project and a
   validity window; rotating together keeps them consistent and costs nothing.
   (`deployment/01_Vercel_Hosting.md:125` classifies anon as routine hygiene.)
4. If you have migrated to the newer `sb_secret_…` key format, rotate that too and
   update consumers — the repo already references `SUPABASE_SECRET_KEY` and
   `SUPABASE_PUBLISHABLE_KEY` in some places.
5. Propagate the new `SUPABASE_SERVICE_ROLE_KEY` to every consumer found in §1:
   gateway edge secrets (`auth.ts:27`, `provision/index.ts:179`,
   `graphql/index.ts:371`), Vercel production + preview, GitHub Actions secrets.
6. Redeploy the gateway (fresh isolates) and Vercel (the `NEXT_PUBLIC_*` pair is
   inlined at build time).
7. Verify new key → `200`; verify old key → `401`.

### 5.3 Post-rotation: fix the class, not just the instance

- Keep the gitleaks gate as a **hard** gate. `.gitleaks.toml:138-144` records that
  it is deliberately left failing on historical findings because "a scanner whose
  green tick is a lie" is worse than a red build. Preserve that stance.
- Consider adding `.github/workflows/**` env-var literal detection so F-04 cannot
  recur: the three workflow files currently source these correctly from
  `${{ secrets.* }}`, and that is the state to enforce.

---

## 6. Step 3 — Then (and only then) scrub history

History rewriting is **optional, separate, destructive, and an owner decision**.

Reasons it comes last: rewriting does not un-leak (every existing holder keeps a
working copy until rotation), it invalidates every clone, and it breaks every open
PR. Do it once, after rotation, with coordination.

- **Procedure + warnings + dry-run:** `scripts/security/history-scrub-dryrun.sh`.
  It is **dry-run by default**; it will not modify anything without `--execute`
  plus a typed confirmation string.
- **Costs to announce to collaborators first:** force-push required; **every clone
  must be deleted and re-cloned** (`git clone` again — do not try to repair); all
  open PRs become unmergeable and must be rebased onto the rewritten history; CI
  caches and forks retain the old objects until they expire.
- **Verify afterwards:** `gitleaks git` should exit 0, and
  `git grep -I -E 'eyJ[A-Za-z0-9_.-]{20,}' $(git rev-list --all)` should return
  nothing for the identifiers in `credential-exposure-2026-10.md` §1.

---

## 7. Rollback plan

### 7.1 Before you revoke (steps 1-3)

Trivially reversible — nothing is destroyed yet. Delete the staged new secrets and
the old values are still in place. **This is why §4 is ordered add → verify → switch
→ remove.**

### 7.2 After revoking Turso (step 4.4) but before/while switching

If the new token fails in production after revocation:

1. **Do not** try to re-activate the old token. Generate another **new** token from
   the dashboard and redeploy. This is slower, but it never re-exposes the leaked
   value and it keeps the "old token is dead" invariant true — which is the whole
   point of the rotation. Reinstating the revoked token would make the breach
   window reopen with an unknown set of holders.
2. Roll back the **application** deploy instead: redeploy the last known-good build
   *with the new secrets injected*. The code and the credentials are independent.
3. If the gateway is returning 500s, check `crypto.ts:37-49` — the boot-time
   strength gate throws in production when `GATEWAY_SHARED_SECRET` or
   `DATA_ENCRYPTION_KEY` are weak or missing. A boot failure here means the
   **secrets** are wrong, not the Turso token; verify the ≥32-character requirement.

### 7.3 After revoking Supabase

Same shape. If the new service-role key misbehaves, generate another new key and
redeploy; do not restore the old. If you need to isolate the blast radius,
`temporarily disable* the affected gateway routes and audit them independently —
the gateway fails closed on a missing key (`auth.ts:28-34` throws
`INTERNAL: gateway auth misconfigured`, HTTP 500), so a missing key degrades to a
loud failure rather than an open one.

### 7.4 Rollback of the history scrub

There is none, short of re-cloning from a mirror. This is the strongest reason the
scrub is step 3 and requires an explicit confirmation string: **the destructive
step is the last one, after everything recoverable has been made safe.**

---

## 8. Things this runbook deliberately does NOT claim

Per the requirement to mark what cannot be verified from the repository:

- **Whether the F-01 token is still live.** It has no `exp`. Only a Turso
  dashboard check or the §4.5 negative test answers this. If the token was already
  rotated by someone else, §4.5 returns `401` and steps 3-4 are already done.
- **Whether the F-02 key is still live** in project `gmqwdnvbfnwpzpctwvho`, and
  whether someone else already rotated it.
- **Which databases F-01 can currently reach.** `rid` maps to an org in Turso's
  control plane, not in this repo.
- **Who cloned or scraped the repository, and when.** The exposure window is
  unbounded by anything in-repo; only provider logs and GitHub's audit log narrow it.
- **Exact Turso/Supabase UI navigation labels.** The dashboards change. The
  *operations* — create a DB token, revoke a token, regenerate an API key — are
  stable; the menu names are not. Verify in the UI as you go.
- **That `TURSO_API_TOKEN` was leaked.** It is a *platform* token (provisioning),
  distinct from the F-01 *database* token, and it does not appear in history in
  plaintext. It is mentioned only as an optional precautionary rotation.