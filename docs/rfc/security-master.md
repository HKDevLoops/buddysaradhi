# RFC: 10_Security.md — Buddysaradhi Security Hardening

> This is the **master RFC** the user invoked via the "(a) + (b) + (c) + (d)" decision.
> The skeleton is intentional: each Tier-1 / Tier-2 gap gets its own **sub-RFC** (see `./security/` subfolder) so each is independently reviewable per `01_Product_Principles.md` §Amendment Process.

---

## 1. Spec ref

Implements: `10_Security.md` §1–§25 (the entire doc), cross-referenced with:

- `01_Product_Principles.md` P4 (Immutable Ledger), P5 (Offline-First Sovereign), AP-6 (Bioluminescent accents only), AP-7 (No data hostage), AP-10 (No telemetry, ever), AP-13 (Audit fail-closed).
- `AGENTS.md` §2 / Rule 1 (append-only ledger), Rule 8 (AES-256-GCM + Argon2id backups), Rule 9 (no silent failures, typed logger only).
- `12_Business_Rules.md` BR-LED-01..06, BR-SEC-01..06, BR-BAT-01..04, BR-FEE-05, BR-RC-02.
- `13_UI_Guidelines.md` §6.6 (neumorphic controls over glass surfaces, never mix), §20 (ASCII art conventions).

## 2. Why

10_Security.md is the contract; the runtime code barely implements it. A previous bug-fix pass (BUGS-FOLLOWUP-43-AUDIT, 11 files) covered the upper layer (typed logger, HMAC-SHA256 chain, ledger transaction wrapping, console.* removal) but didn't touch the load-bearing invariants: the ledger is mutable at runtime, there is no `.buddysaradhi` envelope, there is no argon2 PIN derivation, there is no audit-chain reconciliation, the secure-erase flow is just a `deleteMany`. **Every one of those is a CRITICAL that is exploitable today.**

## 3. What changes (summary — full scope in sub-RFCs)

In dependency order:

1. **`packages/security/` scaffold** *(depends on nothing)* — argon2id wrapper, SecureBuffer, AES-GCM envelope, panic-orchestrator, sensitive-actions registry. (See `./security/001-scaffold.md`.)
2. **`lib/db/admin.ts`** *(depends on #1)* — SQLCipher mount, VACUUM, `PRAGMA key`, `PRAGMA wal_checkpoint`. (See `./security/002-db-admin.md`.)
3. **Prisma schema bumps** *(depends on #1, #2)* — new columns: `client_seq`, `row_hash`, `pin_hash`, `panic_pin_hash`, `audit_chain_head`, `ledger_write_locked`, `session_timeout_min`, `theme_lock_at`. New table: `panic_log`. (See `./security/003-schema-bumps.md`.)
4. **Prisma middleware** `(packages/core/src/ledgerGuard.ts)` *(depends on #3)* — block `ledgerEntry.update`/`delete` at ORM level. (See `./security/004-ledger-guard.md`.)
5. **Lint rules** *(depends on nothing)* — `no-ledger-delete`, `no-telemetry-urls`, `no-http-urls`, `tenant-predicate-required`, `no-service-role-in-client`. (See `./security/005-lint-rules.md`.)
6. **Tests per §24.1** *(depends on #1–#5)* — 17 listed tests; we have 3 today; the 14 missing land here. (See `./security/006-tests.md`.)
7. **`secureErase` orchestrator** `(lib/security/secureErase.ts)` *(depends on #1, #2, #3)* — the single audited `deleteMany` site. (See `./security/007-secure-erase.md`.)
8. **Backup envelope** `(lib/security/backup/envelope.ts)` *(depends on #1)* + Restore + Reencrypt tooling (§21.3). (See `./security/008-backup-envelope.md`.)
9. **`audit_reconcile_job` + `ledger_reconcile_job`** *(depends on #3)* — nightly cron + on-demand entry point from Settings → Security → "Verify integrity". (See `./security/009-reconcile-jobs.md`.)
10. **`no-service-role-in-client` CI test** *(depends on nothing)* — fail the build if `service_role` appears in a client-bound bundle. (See `./security/010-service-role-guard.md`.)
11. **CI/CD harness per §23** *(depends on nothing)* — `.github/workflows/security.yml` (gitleaks + bun audit + Semgrep + the lint rules above). (See `./security/011-ci-harness.md`.)
12. **`THREAT_MODEL.md`** *(first artifact; per Anthropic harness blog)* — derived from `10_Security.md` §20 + the gap matrix. (See `./security/012-threat-model.md`.)

## 4. Risk

- **Ledger immutability (#4, #7):** changing the runtime path on the financial spine is a §8 stop-and-ask trigger (Rule 1). Requires 2-reviewer sign-off + a migration script for any Turso DB that already has rows.
- **Crypto envelope (#1, #8):** changing the backup format bricks every existing `.buddysaradhi` the user has ever made. Format-version byte (`10_Security.md` §15.1) is the load-bearing detail for backwards-compat. Requires pre-release announcement per §21.3.
- **Service-role test (#10):** false-positive risk during the first PR (currently zero test). Rollback via branch protection bypass.
- **Lint rule disablements (#5):** `// eslint-disable-next-line` lines introduced in #7 for the one permitted delete site MUST be in a single audited file (`lib/security/secureErase.ts`). Any deviation is itself a regression.

## 5. Test plan

- §24.1 unit + integration suite is the bar (see sub-RFC #6). The 3 existing test files (`db.test.ts`, `middleware.test.ts`, `use-auto-provision.test.tsx`) continue to pass.
- A separate `tests/security/sanity.test.ts` invokes the new lint rules against sample files and asserts they fire.
- A `tests/security/envelope.test.ts` round-trips a `.buddysaradhi` envelope (the §15.5 contract).
- A `tests/security/reconcile.test.ts` exercises the chain-broken detection.

## 6. Rollout

- **Pre-1.0:** sub-RFCs landed sequentially with separate `feature(security)` commits; gate per §7.
- **At 1.0 GA:** §21 disclosure policy activates; §21.3 reencryption-stewardship tooling ships; Bug Bounty invite list is opened (§24.3).
- **Post-1.0:** v1.x adds the multi-tenant RBAC pinned to `15_Future_Roadmap.md`; sync envelope (#) becomes the v2.0 WorkStream.

## 7. Reviewer allocation

Per `AGENTS.md` §5.4 — and explicitly per §5.4 ledger-crypto double-gate:

| Sub-RFC | Primary | Secondary |
|---|---|---|
| `#1` scaffold | security reviewer | orchestrator |
| `#2` db-admin | security reviewer | (none — single-reviewer; small surface) |
| `#3` schema bumps | ledger-crypto reviewer | security reviewer |
| `#4` ledger guard | ledger-crypto reviewer | orchestrator |
| `#5` lint rules | security reviewer | (none) |
| `#6` tests | security reviewer | ledger-crypto reviewer when ledger-touching |
| `#7` secureErase | ledger-crypto reviewer | security reviewer |
| `#8` envelope | security reviewer | ledger-crypto reviewer |
| `#9` reconcile | ledger-crypto reviewer | security reviewer |
| `#10` service-role | security reviewer | (none) |
| `#11` CI | security reviewer | (none) |
| `#12` threat model | security reviewer | orchestrator |

---

## A. Acceptance criteria (this RFC only "lands" when all sub-RFCs are merged)

- All 17 tests in §24.1 are present and pass on every PR.
- All 5 lint rules in #5 fire on a known-bad fixture.
- `prisma/schema.prisma` matches `buddyBasemodel.prisma` content shape.
- `packages/security/` exposes no runtime imports from `apps/web/src/**`; the security package must be imported by code, never the other way round.
- `next.config.ts` emits CSP + 4 Security headers and a test asserts each.
- The `apps/gateway` boot refuses to start without `GATEWAY_SHARED_SECRET` ≥ 32 chars.
- An in-app "Verify integrity" button runs the reconcile jobs and renders a green/red banner.

## B. Out of scope (deliberately, per AGENTS §0.2)

- Mobile (Expo) `expo-secure-store` + biometric prompt — tracked separately under `15_Future_Roadmap.md`.
- Desktop (Tauri v2) SQLCipher — same.
- v2.0 E2E sync encryption (§19.1) — same.

## C. Sub-RFC index

Each sub-RFC file lives next to this master under `./security/` and carries the same structure (Specs/Why/What/Risk/Test/Rollout/Reviewer).
