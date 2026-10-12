# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Evidence rule for this file:** an entry appears here only if it can be tied
> to a commit in `git log` or to a diff hunk in the working tree. Anything
> unverifiable is left out, not reconstructed.

## [Unreleased]

### Added

- Gitleaks pre-commit secret scan (`.husky/pre-commit`) covering staged
  content before the object exists — verified both ways (clean content passes,
  a planted RSA key blocks the commit). Commit `773c051`.
- `between` range operator in the gateway audited SQL builder
  (`apps/gateway/lib/sql.ts`) as an ALTERNATIVE to the four one-sided
  operators (never alongside them), so no caller-supplied value reaches SQL
  text — covered by 7 new tests including injection attempts
  (`apps/gateway/__tests__/sql-range-operators.test.ts`). Commit `773c051`.
- Single range attendance read `GET /api/v1/attendance?from=&to=`
  (`apps/gateway/routes/attendance.ts`) with a shared, bounded roster read
  reporting `rosterTotal`/`rosterTruncated`, so a clipped roster is never
  silently complete. Covered by `apps/gateway/__tests__/attendance-range.test.ts`.
  Commit `773c051`.
- `paymentBreakdown` contract declared once in `@buddysaradhi/shared`
  (`packages/shared/src/paymentBreakdown.ts`) and consumed by both web call
  sites; the gateway's vendored copy (`apps/gateway/lib/vendor/paymentBreakdown.ts`)
  is held to it by a parity test
  (`apps/gateway/__tests__/payment-breakdown-contract.test.ts`). Commit `773c051`.
- Edge PIN-proof gate for secure erase (BR-SEC-04) — **INCOMPLETE, uncommitted
  working-tree work (not yet in any commit):** `pinProof`
  (HMAC-SHA256, domain-separated, tenant-bound) implemented on both sides
  (`apps/gateway/lib/crypto.ts`, `apps/web/src/lib/crypto.ts`), proof column
  (`pin_proof` / `pinProof`) added across `prisma/schema.prisma`,
  `migrations/0001_init.sql`, `schema.sql`, `apps/gateway/migrations/0001_init.sql`
  and `apps/mobile/src/lib/db/migrations/schema.ts`, contract updated
  (`contracts/openapi.yaml` — `pinProof` required, 64-hex bounded) with
  matching Zod body (`packages/shared/zod/index.ts`), edge verification in
  `apps/gateway/routes/security.ts` (constant-time compare, rate-limited 401s),
  derivation on PIN set in `apps/web/src/server/actions/settings.ts`, and a
  cross-runtime known-answer vector test
  (`apps/gateway/__tests__/pin-proof-vector.test.ts`). **What is missing:**
  no web client sends `pinProof` to the edge yet (no caller of
  `/api/v1/security/erase` in `apps/web/src` carries the field), and the spec
  amendment at `docs/rfc/pin-proof-spec-amendment.md` is **pending — that file
  does not exist yet**. Do not treat this gate as enforced end-to-end until
  both land.

### Changed

- Gitleaks promoted from advisory (`continue-on-error: true` — findings
  reported but CI went green anyway) to a **hard gate**, run via the
  OpenGITLEAKS CLI pinned by SHA256 instead of the licence-gated action
  wrapper; `.gitleaks.toml` now extends the DEFAULT ruleset (the previous
  `[[rules]]` declarations had been replacing it, so only four custom rules
  were running). All 11 workflows pinned to resolved 40-hex SHAs; the
  non-existent `coderabbitai/ai-pr-reviewer` step (404) disabled with evidence
  recorded rather than a fabricated SHA. Commit `773c051`.
- Attendance heatmap collapsed from 14 per-day calls (each re-reading the
  roster) to one range call; the single-day path now shares the bounded,
  `batchId`-aware roster read, fixing a real divergence where a day view and
  a heatmap for the same batch disagreed about who existed. Commit `773c051`.
- Ledger table (`apps/web/src/components/fees/ledger-table.tsx`) unified onto
  the shared `<Avatar>` — the local div showed one letter, painted an unsolved
  3.69:1 pairing, and lacked `aria-hidden`. Commit `773c051`.
- Four committed agent transcripts (~40 MB) removed and the pattern gitignored:
  `sess_prev.md`, `session-buddy.md`, `session_previous.md` (plus generated
  `typecheck-out.txt`). Commit `773c051`.

### Fixed

- Secret-gate enforcement gap — gitleaks findings no longer pass CI silently;
  false positives (PEM-marker redaction fixture, k8s doc placeholder)
  allowlisted BY PATH after proving a match-scoped allowlist suppressed a real
  planted 2048-bit RSA key. Spec ref: **CI-SUPPLY-05**. Commit `773c051`.
- Historical credential exposure documented, not fixed — four live-format
  Turso JWT findings plus a Supabase `service_role` key in history identified
  for owner rotation; none remain in the current tree. Spec ref: **SEC-CRED-06**.
  Commit `773c051` (code) + `docs/security/credential-exposure-2026-10.md`
  (untracked working-tree document at the time of writing).
- Attendance fan-out and roster divergence (single-day path uncapped and
  ignoring `batchId`). Spec ref: **PERF-ATT-10**. Commit `773c051`.
- Payment-breakdown shape triple-definition and ledger avatar contrast/consistency.
  Spec ref: **RPT-SHAPE-08**. Commit `773c051`.
- Edge erase PIN check proved nothing about the caller (PIN-presence check let
  any authenticated session erase an account) — replaced with the edge-verifiable
  PIN proof. Spec ref: **BR-SEC-04**. Status: **INCOMPLETE** — contract/Zod/edge
  updated in the working tree, no client sends `pinProof` yet, spec amendment
  pending (see Added above).

### Security

- Gitleaks hard gate + SHA-pinned workflows + pre-commit staged-content scan
  (see Added/Changed above). Commit `773c051`.
- **Known, NOT fixed — rotation pending owner action:**
  `docs/security/credential-exposure-2026-10.md` records one distinct live
  Turso DB auth token (EdDSA, read-write, no `exp`) across four file findings
  in history, a Supabase `service_role` key (RLS bypass, `exp` 2036) in
  historical workflow files, the paired `anon` key, and a plaintext E2E
  password — all history-only, none in the current tree. Rotation (Turso
  dashboard, Supabase project, E2E account) followed by access-log audit and a
  coordinated history scrub is the only remedy; see `SECURITY.md` ("Known
  issues awaiting rotation") and `docs/security/TURSO-ROTATION-RUNBOOK.md`.

## [1.0.0] — 2026-10-11 (committed work, selected)

> Entries below are summaries of already-committed history (`git log`), kept
> minimal per the evidence rule. Only the HEAD commit (`773c051`) is itemized
> above; earlier entries cite their commits without re-describing them.

- `773c051` — 2026-10-11 — fix(ci,gateway,dashboard): harden the secret gate,
  collapse the attendance fan-out, and unify the payment contract (the release
  described in Unreleased above).
- `15f7542` — 2026-10-10 — chore(tools): ReasoningBank as isolated dev-only
  local-embedding tooling (no product surface; `tools/` outside the pnpm
  workspace).
- `0800ab4` — 2026-10-10 — chore(planning): GSD initialised as an index over
  the ratified spec corpus (planning artifacts only).
- `257285f` — 2026-10-10 — fix(ci): PR reviewer no longer runs with
  base-repository secrets (`pull_request_target` → `pull_request`).
- `745bb80` — 2026-10-09 — fix(ui,analytics): dashboard payment-breakdown
  double-count (`noDues ⊆ paid`) removed; shared avatar contrast fix
  (tint-on-tint → mixed-toward-`--text-primary`) across three screens.
- `2eb97a2` — 2026-10-09 — fix(security,perf): authentication bypass and
  cross-tenant isolation gap closed.
