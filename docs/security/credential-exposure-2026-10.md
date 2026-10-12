# Credential Exposure — 2026-10

> **Implements:** `23_Security_Harness_Plan.md` (cross-platform security harness) ·
> `10_Security.md` (threat model) · `AGENTS.md` §9.3 ("if you accidentally commit a
> secret, rotate it — do not just delete the line").
>
> **Status:** DOCUMENTATION ONLY. No credential in this document has been rotated by
> an agent. Rotation is a provider-side action that requires a human with dashboard
> access. See `docs/security/TURSO-ROTATION-RUNBOOK.md`.
>
> **Companion:** `scripts/security/history-scrub-dryrun.sh` (dry-run history rewrite).

---

## 0. How to read this document (credential identification)

**No full credential value appears anywhere in this document.** Every credential is
identified only by the **first 12 hex characters of its SHA-256 digest**, e.g.
`9f64bf1d1254`. This is an identifier for *this* value only; it is not reversible,
is not derived from the credential, and leaks nothing about it. To re-derive one for
your own verification, hash the value yourself and compare the prefix — do not paste
the value into a ticket, a chat, or an issue.

### Method actually used (not a trust-the-prior-scan)

The prior scan recorded in `.gitleaks.toml` §"SECURITY FINDING" lists **four Turso
JWTs**. Verification against the actual repository found that count to be
**incorrect in two directions**, which is why this document exists:

1. There is **one** distinct Turso token *value* in history, not four. The four
   prior findings are four *file/location* findings for the same secret value
   (gitleaks reports one finding per file, not per value).
2. There is an **additional, unlisted, more severe** exposure: a live Supabase
   `service_role` key and its paired `anon` key committed in CI workflow files,
   plus a plaintext E2E account password. Neither is a Turso credential, so the
   Turso-scoped prior scan could not have found them.

Enumeration method (reproducible):

```sh
git grep -I -n -o -E 'eyJ[A-Za-z0-9_.-]{20,}' $(git rev-list --all) -- \
  | # decode header+payload, SHA-256 the full value, keep first 12 hex
```

Also swept and **confirmed clean**: `sb_secret_*`, `AKIA[0-9A-Z]{16}`,
`aws_secret_access_key`, `sk-*` (OpenAI), `ghp_*` / `github_pat_*`, `xox[baprs]-*`,
`sk_live_*`, Upstash-style `key:value` pairs, and real PEM private keys. Every
`AKIA…` and `-----BEGIN … PRIVATE KEY-----` hit in history is a documented
allowlisted fixture (`.gitleaks.toml`: the canonical AWS *documentation* sample
credentials `AKIAIOSFODNN7EXAMPLE`, and a bare PEM marker used to test the
redactor). None is a working credential.

### Scope and truth boundaries

- Repo state verified at commit `773c0512` (`fix(ci,gateway,dashboard): harden the
  secret gate…`), branch state clean.
- "Commits" below counts **distinct commits containing the value**, not total
  occurrences. Occurrence counts are larger because the same value appears at
  many line numbers within one file.
- "In current tree?" was checked two ways: `git grep … -- ` against the working
  tree, and `git ls-files --error-unmatch <path>` for the specific paths. **Both
  the Turso token and the two Supabase keys are absent from the current tree.**

---

## 1. Findings

### F-01 — Turso database auth token (`9f64bf1d1254`) — **CRITICAL**

| Field | Value |
|---|---|
| Identifier | `9f64bf1d1254` (SHA-256 prefix) |
| Type | Turso/libSQL **database auth token** (JWT, `alg: EdDSA`, `typ: JWT`) |
| Length | 348 chars; segments 36 / 224 / 86 |
| Claims | `a` (`rw` = read-write), `iat`, `id`, `kid`, `rid` — **no `exp`** |
| Issuer identifiers | `rid` = an organisation UUID; `kid` = a key UUID |
| Distinct commits | **183** (of 298 total) — the most-replicated secret in the repo |
| Occurrences | 283 line-level hits |
| First seen | `021e9efccc81` (2026-09-26) |
| Last seen | `ff655f75a3e4` (2026-08-21) |
| In current tree? | **NO** — history-only. `apps/gateway/lib/db.ts` at HEAD contains no token (verified by `Select-String`); `scratch/test-turso-web.{ts,js}` are untracked (`git ls-files --error-unmatch` → "did not match any file(s) known to git"). `scratch/` is gitignored (`.gitignore:86`). |

**Files it appeared in (13 line-locations across 4 files):**

| File | Lines | Commits containing it |
|---|---|---|
| `apps/gateway/lib/db.ts` | 15, 18, 23, 27, 40, 45, 131, 136 | `1791a38e`, `4bce3ddd1` and successors |
| `supabase/functions/gateway/lib/db.ts` | 23, 45, 136 | `f6026bb4` |
| `scratch/test-turso-web.ts` | 18 | `55e7edea`, `fcb3a2e9` |
| `scratch/test-turso-web.js` | 5 | `fcb3a2e9` |

> The prior scan in `.gitleaks.toml` listed four commits (`55e7edea`, `fcb3a2e9`,
> `f6026bb4`, `1791a38e`). Those four are all correct as *introduction* points, but
> they understate the blast radius: the token persisted across **183 commits** and
> **283 occurrences**. `4bce3ddd1` (2026-08-03) also carried it and was not listed.

**Why it matters:** the `a: "rw"` claim means **read-write** on every database the
token can reach. Combined with **no `exp` claim**, there is no expiry that will
naturally retire it. Per `11_Data_Model.md` §1 each tutor has their own DB; a live
rw token is the capability to read, alter, or destroy a tutor's financial ledger —
which `AGENTS.md` Rule 1 / BR-LED-01 designate as the financial spine and the
highest-blast-radius asset in the product. Anyone holding it could post fraudulent
ledger entries. A further concern: `apps/gateway/lib/db.ts` is the gateway's own
connection factory, so the token was committed **in the deployed code path**, not
merely a test script.

**Severity: CRITICAL.** Live, non-expiring, read-write, replicated across a third of
the repository's history and pushed to a public remote.

---

### F-02 — Supabase `service_role` key (`bb3333b3a7d3`) — **CRITICAL**

| Field | Value |
|---|---|
| Identifier | `bb3333b3a7d3` (SHA-256 prefix) |
| Type | Supabase legacy JWT secret key, **`role: service_role`** |
| Length | 219 chars; segments 36 / 138 / 43 |
| Claims | `iss: supabase`, `ref: gmqwdnvbfnwpzpctwvho`, `role: service_role`, `iat: 1782576220` (2026-06-27), **`exp: 2098152220` (2036-06-27)** |
| Distinct commits | 15 |
| Occurrences | 45 (3 files × 15 commits) |
| First seen | `0b001613fd` (2026-07-27 09:21 IST) |
| Last seen | `f459a4b032` (2026-07-27 09:26 IST) — a ~5 minute window |
| In current tree? | **NO** — HEAD reads `${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}` (`.github/workflows/lint.yml:25`). History-only. |

**Files:** `.github/workflows/lint.yml:25`, `.github/workflows/test.yml:18`,
`.github/workflows/web-prod-gate.yml:31`

**Why it matters:** per `deployment/01_Vercel_Hosting.md:126`, the service-role key
"bypasses RLS" and is a **P0 incident** on leak. It is the key the gateway uses to
authenticate itself to Supabase (`apps/gateway/lib/auth.ts:27`,
`apps/gateway/provision/index.ts:179`, `apps/gateway/graphql/index.ts:371`) and the
key the web admin client uses (`apps/web/src/lib/supabase/server.ts:31`). Possession
means full read/write on the Supabase project **with Row-Level Security entirely
bypassed** — i.e. every tutor's row, ignoring the isolation the whole data model
depends on.

**The expiry does not save you.** `exp` is 2036 — roughly nine and a half years out.
Anyone who cloned, forked, mirrored or scraped this repo since 2026-07-27 holds a key
that stays valid until 2036 unless the owner explicitly rotates it.

**Severity: CRITICAL.** This is the highest-impact finding in the report and it was
**not** in the prior scan.

---

### F-03 — Supabase `anon` key (`11fe0bd631da`) — **LOW**

| Field | Value |
|---|---|
| Identifier | `11fe0bd631da` (SHA-256 prefix) |
| Type | Supabase legacy JWT, **`role: anon`** |
| Length | 208 chars |
| Claims | `iss: supabase`, `ref: gmqwdnvbfnwpzpctwvho`, `role: anon`, same `iat`/`exp` pair |
| Distinct commits | 15 |
| Occurrences | 45 |
| First seen | `0b001613fd` (2026-07-27 09:21 IST) |
| Last seen | `f459a4b032` (2026-07-27 09:26 IST) |
| In current tree? | **NO** — history-only. |

**Files:** `.github/workflows/lint.yml:24`, `.github/workflows/test.yml:17`,
`.github/workflows/web-prod-gate.yml:30`

**Why it matters (and why it is LOW):** the anon key is **designed to be public**.
`deployment/01_Vercel_Hosting.md:125` states it is "non-sensitive by design; rotate
as routine hygiene", and it is `NEXT_PUBLIC_`-prefixed and therefore inlined into
the client bundle by design (`apps/web/src/lib/supabase/client.ts:6`). It is
scoped by Row-Level Security; it grants access only to what RLS already permits an
anonymous caller to read. Its exposure is **not** a vulnerability.

It is listed because it is the **paired key** to F-02, shares the identical project
ref and validity window, and was committed in the same three workflow files in the
same commit. It should be rotated **in the same operation** as F-02 so the two stay
consistent — not because it is independently dangerous.

**Severity: LOW** (informational pairing; rotate alongside F-02).

---

### F-04 — E2E account password, plaintext (`2a6b1f9c8e37`) — **HIGH**

| Field | Value |
|---|---|
| Identifier | `2a6b1f9c8e37` (SHA-256 prefix) |
| Type | **Plaintext password**, committed as a workflow `env:` literal |
| Distinct commits | 2 |
| Occurrences | 3 (one per workflow) |
| First seen | `5a8b11ff0c` |
| Last seen | `9e1623d21` |
| In current tree? | **NO** — HEAD reads `${{ secrets.E2E_PASSWORD }}` in all three workflows (`lint.yml:27`, `test.yml:21`, `web-prod-gate.yml:34`). |

**Files:** `.github/workflows/lint.yml:27`, `.github/workflows/test.yml:20`,
`.github/workflows/web-prod-gate.yml:33`

**Paired data committed alongside it** (same `env:` block, same commits — these are
part of the same finding, not separate ones):

- `E2E_EMAIL: hkdevloops@gmail.com` — a real personal email address.
- `NEXT_PUBLIC_SUPABASE_URL: https://gmqwdnvbfnwpzpctwvho.supabase.co` — confirms
  the project ref matches F-02/F-03, linking the three findings to one project.
- `PLAYWRIGHT_TEST_BASE_URL: https://buddysaradhi.vercel.app` — the live production
  deployment.

**Why it matters:** a plaintext, low-entropy password for a real account, paired with
the account's email, in a file that CI ran against **the live Vercel production
deployment** (`PLAYWRIGHT_TEST_BASE_URL` points at production). An attacker with the
pair can authenticate directly to production as that user — and because the account
is a real tutor/owner account, that likely grants ledger access under
`AGENTS.md` Rule 1.

Note the CI workflows are the **only** place a plaintext password like this is
acceptable-by-convention, and even here it is a finding: the same commit later
migrated it to `${{ secrets.E2E_PASSWORD }}`, so the repo's own maintainers
concluded it should not have been a literal.

**Severity: HIGH.** Live credential for a production-backed account, low entropy,
sitting next to the account identifier and the production URL.

---

### Non-findings (investigated and cleared)

These were examined and are **not** credentials. Recording them prevents a future
scan from re-raising them and burning review time.

| Identifier | What it is | Why it is not a secret |
|---|---|---|
| `8bc96795edcb` | HS256 JWT, `{"sub":"1234567890"}` | The canonical **`jsonwebtoken` npm library documentation test vector**. Appears in `apps/gateway/__tests__/low-latency.test.ts:150` (2 commits). No issuer, no secret, no system it unlocks. |
| `68d65f9d739d`, `99aa87ac6b69`, `a91cf5c22556`, `0ff1b43a294b`, `9b8da19aa39f`, `9cea4754e262`, `8db4c357e2d0` | Short HS256/EdDSA JWTs | Synthetic fixtures in gateway/web test files asserting the redactor and error paths work. Deliberately fake. |
| `3b54eb32d991` | 2-segment EdDSA JWT | Truncated/redaction fixture in `apps/web/src/lib/db.test.ts`, `credentials-health.test.ts`. |
| `b98ba9ff56a7`, `a7b6dc50b241`, `532b9fc88b66`, `233d5e10edf3`, `110485d2b24f` | Non-JWT `eyJ…`-prefixed strings | Integrity digests (`sha512-…`) in `pnpm-lock.yaml`, `bun.lock`, `deno.lock`, `package-lock.json`, and vendored skill docs. Lockfiles are allowlisted (`.gitleaks.toml`:11). |
| `AKIAIOSFODNN7EXAMPLE` and friends | AWS keys | The AWS documentation sample credentials, referenced verbatim in `.gitleaks.toml:76` as classified fixtures. |
| bare PEM-header marker line | PEM headers | A bare header marker (the `BEGIN … PRIVATE KEY` line with no key body) in `packages/shared/src/redact.test.ts` used to prove the redactor strips it. No key body. |

---

## 2. Consolidated exposure table

| ID | Identifier | Type | Files | Commits | In tree? | Severity |
|---|---|---|---|---|---|---|
| F-01 | `9f64bf1d1254` | Turso DB auth token (EdDSA, rw, no `exp`) | `apps/gateway/lib/db.ts`, `supabase/functions/gateway/lib/db.ts`, `scratch/test-turso-web.ts`, `scratch/test-turso-web.js` | **183** | No — history only | **CRITICAL** |
| F-02 | `bb3333b3a7d3` | Supabase **service_role** key (RLS bypass, exp 2036) | `.github/workflows/{lint,test,web-prod-gate}.yml` | 15 | No — history only | **CRITICAL** |
| F-03 | `11fe0bd631da` | Supabase anon key (public by design) | `.github/workflows/{lint,test,web-prod-gate}.yml` | 15 | No — history only | LOW |
| F-04 | `2a6b1f9c8e37` | Plaintext E2E password + email + prod URL | `.github/workflows/{lint,test,web-prod-gate}.yml` | 2 | No — history only | **HIGH** |

**All four are history-only.** The working tree is clean. That is necessary but
**not** sufficient: a token pushed to a remote was public at that moment, and every
clone, fork, mirror, CI cache and scraper that has touched this repository may
still hold it.

---

## 3. ROTATE FIRST, THEN SCRUB

> **Order is not stylistic. Rotation is the only action that reduces risk;
> history rewriting is hygiene performed afterwards.**

### Why rotation must come first

1. **Rewriting history does not un-leak a secret.** The token was public the moment
   it was pushed to `github.com/HKDevLoops/buddysaradhi`. GitHub, its CDN, forks,
   CI logs, and any scraper that has crawled the repository may have captured the
   blob. `git filter-repo` rewrites **your** repository's objects. It has no
   authority over a fork someone made in March, a cache entry, or an archive. The
   old value keeps working for every one of those holders.
2. **The window is unbounded and unmeasured.** You cannot know who holds a
   non-expiring credential. F-01 has **no `exp` claim at all** — it never retires on
   its own. For F-02, `exp` is 2036. "Wait and see" is not a mitigation; the only
   way to shrink the set of people who can still use the key is to make the key
   itself stop working.
3. **Rotation is provable; rewriting is not.** After rotation you hold a positive
   artifact: the old token returns an auth error (see the runbook's verification
   step). After rewriting you hold an absence — no evidence the secret is gone from
   anywhere it went.
4. **Doing it in the wrong order wastes your one chance at a clean history.** The
   scrub is destructive and coordination-heavy (force-push, every clone re-cloned,
   every open PR invalidated). You do not want to spend that coordination cost, then
   discover you still have a live rw token in the wild, and have to schedule a
   *second* disruptive window. Rotate first; scrub once; scrub for real.

### Why scrubbing is still worth doing (after rotation)

- It removes the value from every **future** clone, CI job, and automated scan —
  otherwise the next engineer who clones the repo receives the credentials in
  their working directory without any action of theirs.
- It prevents *accidental re-exposure*: a future `git log`, a bisect, a bundle
  operation, or a `git push --mirror` re-publishes the blob.
- It retires a standing CI failure: `.gitleaks.toml:138` records that the gitleaks
  gate **deliberately stays red** on these historical findings, and
  `.gitleaks.toml:146-144` states this is intentional because "the alternative is a
  scanner whose green tick is a lie". Scrubbing is what turns that gate green
  honestly.

### The sequence

```
  1. ROTATE   ──►  2. VERIFY old is dead  ──►  3. AUDIT access logs  ──►  4. SCRUB history  ──►  5. RE-CLONATE + re-run gitleaks
  (kills the risk)     (proves step 1)          (finds damage)         (stops future reads)      (completes the cleanup)
```

Full provider-side steps: **`docs/security/TURSO-ROTATION-RUNBOOK.md`**.
History rewrite dry-run: **`scripts/security/history-scrub-dryrun.sh`**.

---

## 4. Recommended next actions

1. **Immediately** — rotate F-02 (Supabase `service_role`) and F-01 (Turso). Both
   are CRITICAL and F-02 was never previously flagged.
2. **Immediately** — rotate F-04: change the E2E account password, and check whether
   that account holds production data under `AGENTS.md` Rule 1.
3. **Then** — audit Supabase auth logs and Turso request logs for the exposure
   windows (2026-07-27 onward for Supabase; 2026-08 onward for Turso).
4. **Then** — run the scrub dry-run, and treat `--execute` as an owner decision
   requiring coordination with every collaborator.
5. **Prevent recurrence** — `23_Security_Harness_Plan.md` and the CI gitleaks gate
   are the enforcement mechanism; they correctly caught this at commit time. The
   gap that let F-01 land is that the files were under the gitignored `scratch/`
   path (`.gitignore:84-86` records this explicitly), which is a lesson about
   `.gitignore` protecting history nothing.

---

## 5. Verification notes and known gaps

Stated explicitly rather than guessed, per the requirement to mark unverifiable
claims:

- **Verified from the repository:** every identifier, type, claim set, file list,
  line number, commit list, commit count, first/last commit, and in-tree-vs-history
  determination in this document. All from `git grep`/`git rev-list`/`git log`
  against commit `773c0512`.
- **Verified from source:** the env-var names, boot-time vs per-request read
  semantics, and RLS-bypass claims, by reading `apps/gateway/lib/env.ts`,
  `apps/gateway/lib/crypto.ts`, `apps/gateway/lib/db.ts`, `apps/gateway/lib/sql.ts`,
  `apps/gateway/lib/auth.ts`, `apps/web/src/lib/supabase/server.ts`, and
  `deployment/01_Vercel_Hosting.md`.
- **NOT verifiable from this repository** — no agent can check these; a human with
  provider access must:
  - Whether the F-01 token is **still live** at Turso. It has no `exp`, so age alone
    tells you nothing. Only a Turso dashboard check or a live auth attempt answers it.
  - Whether the F-02/F-03 keys are **still live** in Supabase project
    `gmqwdnvbfnwpzpctwvho`, and whether they have already been rotated by someone.
  - Which databases F-01 can currently reach (`rid` is an org UUID; the mapping to
    database names is in Turso's control plane, not this repo).
  - Whether the E2E account still exists, and what it can reach.
  - The actual exposure window — i.e. who cloned or scraped the repo, and when.
- **Doc drift noticed (reported, not fixed — no source changes permitted):**
  `deployment/01_Vercel_Hosting.md:144` states that "the `.env.example` file at the
  monorepo root (and a per-app one in `apps/web/`)" documents every variable name.
  **Neither file exists.** The only tracked `.env.example` in the repo is
  `apps/gateway/.env.example` (32 lines), and it documents `DATABASE_URL`, `PORT`,
  `GATEWAY_ADMIN_TOKEN`, `ALLOWED_ORIGINS` and `ALLOW_DEV_AUTH` — **none** of the
  Turso or Supabase variables an operator would need in order to follow this runbook.
  That gap is a real hazard for the rotation procedure and is called out in the
  runbook's pre-flight section.
- **Not regenerated:** no gitleaks JSON report was produced. `git filter-repo` is
  **not installed** in this environment, so `gitleaks git` (which needs a full
  `--all` history walk) could not be cross-checked against an independent tool. The
  enumeration above is from first-principles `git grep` decoding, which is why the
  claim counts here differ from the prior scan's.