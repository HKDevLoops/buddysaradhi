# 0005. Dead `coderabbitai/ai-pr-reviewer` reference disabled, not pinned

- **Status:** PROPOSED
- **Date:** 2026-10-12
- **Deciders:** owner (approval pending)

## Context

The reviewer workflow referenced `coderabbitai/ai-pr-reviewer`, which does
not exist. Verified 2026-10-11: `git ls-remote` → "Repository not found",
the repos API → HTTP 404, org search → zero results, and the org's
similarly-named `coderabbit-pr-review` repo has no tags and no `action.yml`
— so it is not an action either (`.github/workflows/reviewer.yml:46-64`).
Every pull request was failing or erroring on a step that could never run.
A concurrent pin audit (CI-SUPPLY-05) required the step to be pinned to a
commit SHA, which is impossible for a repo that 404s.

## Decision

The step is **disabled (commented out), not pinned**: the job still checks
out the repo and emits a notice, but runs no third-party code
(`.github/workflows/reviewer.yml:79-106`). No SHA was written. The file
records three options as an explicit owner decision: restore CodeRabbit
under its correct current name pinned to a resolved SHA, delete the job and
the file outright, or replace it with another reviewer pinned to a SHA
(`.github/workflows/reviewer.yml:72-77`).

The same change moved the trigger from `pull_request_target` (base-repo
context with secrets and a write token for any fork PR) to `pull_request`,
since a reviewer that analyses untrusted diffs must never execute with the
base repo's secrets (`.github/workflows/reviewer.yml:4-23`).

## Consequences

**Positive:**

- PRs stop failing on a step that could never succeed; the live CI defect
  the pin audit exposed is recorded instead of papered over.
- Zero fabricated supply-chain references: an unverifiable 40-hex string
  GitHub can never resolve is indistinguishable from a real pin to every
  reader and every future scanner.
- The disabled job cannot fail the build — a dead optional reviewer must
  not block a release, and a permanently-red workflow is one nobody reads.

**Negative:**

- PRs currently get no AI review at all; review coverage is strictly worse
  until the owner picks one of the three options.
- Fork PRs run with a read-only token and no secrets, so a restored
  third-party reviewer will fail for fork contributors unless its auth is
  designed for that (failing closed on untrusted input is the intent, but
  it is a real limitation to communicate).
- A commented-out step plus a notice is easy to mistake for "someone will
  re-enable it later" and leave indefinitely; the owner decision has no
  deadline attached.

## Alternatives Considered

1. **Pin the reference to a SHA anyway.** Rejected: there is nothing to
   resolve a SHA from (no repo, no commits, no tags). A fabricated SHA is a
   supply-chain landmine and violates Rule 9 — state the truth, never a
   value that looks right (`.github/workflows/reviewer.yml:66-70`).
2. **Point at `coderabbit-pr-review` (the existing org repo).** Rejected: it
   has no tags and no `action.yml` at HEAD, so it is not a usable action;
   wiring it in trades a loud failure for a subtler one.
3. **Delete `reviewer.yml` outright.** Rejected as an agent action: removing
   review coverage permanently is a supply-chain choice with a credential
   attached (`GITHUB_TOKEN` at `pull-requests: write`, plus the stray
   `OPENAI_API_KEY` the step carried). Offered as owner option 2 instead.
