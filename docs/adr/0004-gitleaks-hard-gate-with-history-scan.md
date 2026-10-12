# 0004. Gitleaks hard gate over full history, red until rotation

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

The secrets gate (`gitleaks` job in `.github/workflows/security.yml`) was
`gitleaks-action@v2` with `continue-on-error: true` — advisory. It printed
findings and CI went green anyway: a scan nobody is blocked by
(`.github/workflows/security.yml:25-33`). Enabling the default ruleset on
real history surfaced dozens of findings across past commits, including four
real Turso API JWTs (live EdDSA shape, no `exp`) in `scratch/test-turso-web.ts`,
`scratch/test-turso-web.js`, `supabase/functions/gateway/lib/db.ts`, and
`apps/gateway/lib/db.ts` (`.gitleaks.toml:107-121`). None is in the current
tree, but history is still served by the remote.

An early version of the config suppressed two findings with a
`match`-scoped allowlist on the PEM header. That was wrong: the
`generic-private-key` rule matches the header only, so the allowlisted
`Match` string is byte-identical for a fixture and a real 2048-bit RSA key.
Measured, not theorised — with that allowlist a planted real key scanned
clean (exit 0); stock gitleaks and the corrected config both flag it
(`.gitleaks.toml:36-58`).

## Decision

- The gate is a **hard gate**: `gitleaks git` over **full history**
  (`fetch-depth: 0`), no `continue-on-error`, no token, `--redact` mandatory
  so the log cannot leak a credential a second time
  (`.github/workflows/security.yml:22-24,55-64`).
- Exclusions are **path-scoped, never match-scoped**: the two verified false
  positives (PEM-marker fixture, doc placeholder) are exempted by exact file
  path, and historical example credentials by path prefix — a real key
  committed anywhere else is still detected (`.gitleaks.toml:53-58,86-105`).
- The four historical Turso JWTs are **not allowlisted**: they must be
  rotated at the provider and history scrubbed only by explicit owner
  decision. `gitleaks git` walks the whole history, so the gate stays red
  until that happens — recorded as the correct state for a real exposure,
  not suppressed (`.gitleaks.toml:128-144`).
- The gitleaks binary itself is installed from a SHA256-pinned release
  (8.30.1), not a mutable tag (`.github/workflows/security.yml:38-54`).

## Consequences

**Positive:**

- A green tick means something: no advisory scan that reads as coverage
  while covering nothing (Rule 9).
- The planted-key experiment proves the corrected config catches what the
  match-allowlisted one missed; future exemptions must survive the same
  test.
- `--redact` plus a tokenless step keeps the scanner from becoming a second
  exfiltration path.

**Negative:**

- CI is red until the owner rotates the four Turso credentials (and
  optionally scrubs history) — every PR pays for a historical exposure, and
  only the owner can clear it. This is intentional but slower than an
  allowlist.
- Full-history scans grow with the repo; the 10-minute job timeout is the
  current ceiling (291 commits / ~60 MB scanned in ~3 s at the time of
  writing — comfortable, but not free forever).
- Verified live 2026-10-12 (gitleaks 8.30.1, `--redact`): the gate reports
  12 findings — 10× `jwt` across exactly the four documented files plus 2×
  `generic-api-key` in the historical gateway crypto test
  (`supabase/functions/gateway/__tests__/crypto.test.ts`, commit
  `91d7a7f`). The fixture-or-real status of those two assignments was not
  adjudicated here; they fail the gate either way until classified.

**UNVERIFIED:** the brief for this record mentioned a Supabase
`service_role` key found in history alongside the four Turso JWTs. That
could not be verified: the live scan reports zero `supabase-service-key`
findings, and the string `service_role` occurs in history only in spec prose
and in the `.gitleaks.toml` custom-rule definition itself. The custom rule
stays as a detector; no service-role exposure is claimed by this record.

## Alternatives Considered

1. **Stay advisory (`continue-on-error`).** Rejected: the prior state. An
   advisory secret scan is a comment, and a green CI with known historical
   JWTs is a lie about the repo's state.
2. **Match-scoped allowlists for the historical findings.** Rejected:
   empirically disproven — suppresses real keys rule-wide, verified with a
   planted RSA key. A scanner that passes a real key is worse than none.
3. **Allowlist the four Turso JWTs to get CI green now, rotate later.**
   Rejected: rotation is the only fix (rewriting history does not un-leak a
   secret); suppressing the finding removes the pressure that makes rotation
   happen and falsifies the gate in the meantime.
4. **Scan the working tree only (pre-commit / HEAD).** Rejected: the actual
   exposures are historical — committed under a now-gitignored `scratch/`
   path — so every tree-only scan misses exactly the class that matters.
   `.gitignore` does not protect history (`.gitleaks.toml:117-126`).
