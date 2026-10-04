# Test Strategy (runbook)

> Operational companion to `21_Automation_Testing.md` (the 36-flow spec) and
> `19_Concurrency_and_Testing.md` (the spine: floors, concurrency, contracts).
> This file is the runbook: what runs where, what blocks, what stays soft.

## 1. Pyramid map

| Layer          | Tool                     | Command                                                                                                     | Scope                  |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Unit (70%)     | vitest                   | `pnpm run test:unit`                                                                                        | packages, scripts      |
| Web unit       | vitest                   | `pnpm --filter web exec vitest run`                                                                         | apps/web (61 tests)    |
| Integ. (25%)   | vitest + :memory: SQLite | `pnpm run test:integration`                                                                                 | cross-module flows     |
| Floors         | vitest --coverage        | `pnpm --filter @buddysaradhi/core exec vitest run --coverage --coverage.all --coverage.thresholds.lines=70` | core, shared ≥70%      |
| A11y           | axe-core (BLOCKING)      | `pnpm run test:a11y`                                                                                        | every screen, 0 viol   |
| E2E (5%, soft) | Playwright               | `pnpm --filter web exec playwright test`                                                                    | W-01..W-12, P-01..P-10 |

## 2. Environments — the :3300 recipe

E2E never touches production. Build, serve locally, wait, test, teardown:

```sh
pnpm --filter web build && pnpm --filter product-page build
pnpm --filter web exec playwright install --with-deps
nohup setsid pnpm --filter web exec next start -p 3300 > /tmp/webserver.log 2>&1 &
echo $! > /tmp/webserver.pid
for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:3300/ && break; sleep 1; done
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3300 pnpm run test:a11y
PLAYWRIGHT_TEST_BASE_URL=http://127.0.0.1:3300 pnpm --filter web exec playwright test
kill -- -"$(cat /tmp/webserver.pid)"; pkill -f "next start -p 3300"
```

Use `127.0.0.1`, not `localhost`: the Playwright config spawns its own webServer
for localhost baseURLs. Dummy env for logged-out runs (lint.yml):

```sh
TURSO_DATABASE_URL=file:./prisma/dev.db TURSO_AUTH_TOKEN=test-token pnpm run test:unit
```

## 3. Gates — blocking vs soft

| Gate                                      | Workflow                    | Verdict                            |
| ----------------------------------------- | --------------------------- | ---------------------------------- |
| lint + typecheck + principle-lints (7/7)  | lint.yml                    | BLOCKING                           |
| unit + integration + web unit             | lint.yml, test.yml          | BLOCKING                           |
| coverage floors (core/shared ≥70%)        | test.yml                    | BLOCKING                           |
| axe-core, 0 violations                    | test.yml, web-prod-gate.yml | BLOCKING                           |
| Playwright e2e                            | test.yml, web-prod-gate.yml | SOFT (`continue-on-error`)         |
| gitleaks / semgrep / osv / license / SBOM | security.yml                | advisory, except semgrep `--error` |

Harden e2e only with a flake-rate measurement plan — never by deleting the flag.

## 4. 36-flow rollout

| Phase             | Flows      | Driver                     | Runs in              |
| ----------------- | ---------- | -------------------------- | -------------------- |
| Web golden path   | W-01..W-12 | Playwright                 | every PR (soft)      |
| Product/marketing | P-01..P-10 | Playwright                 | every PR (soft)      |
| Mobile            | M-01..M-08 | Maestro (Detox fallback)   | nightly + mobile PRs |
| Desktop           | D-01..D-06 | tauri-driver + WebDriverIO | tag push             |

Flow IDs are stable forever (`21_` §4) — cite them in `fix(test): <id>` commits.

## 5. AI loop wiring (webDevReview cron)

Run → Capture (assert + screenshot + console + HAR + trace) → Analyse (VLM JSON
`{root_cause, affected_file, suggested_fix, confidence}`) → Resolve (apply,
re-run; 3 fails → BLOCKED worklog) → Verify (full suite, not one test). Full
spec: `21_` §2 + §8.

## 6. Maintenance rules

1. New screen? Add its flows + baselines in the same PR (no orphan flows).
2. Flaky test? Quarantine with an issue link; 3 consecutive reds = investigate.
3. Baselines live in `tests/visual/__screenshots__/`; update via
   `pnpm --filter web exec playwright test --update-snapshots` — on purpose,
   never blindly.
4. Attach visual diffs to the PR and trace zips to `fix(test):` commits.
5. `node scripts/principle-lints.ts` must print 7/7 before any run counts.
