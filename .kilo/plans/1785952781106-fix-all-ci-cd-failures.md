# Plan: Fix All CI/CD Pipeline Failures + Verify Production

## Goal
Fix all 4 failing GitHub Actions workflows, verify web app, API gateway, and product page work in production.

---

## Root Cause Analysis

### Workflow 1: `Production Gate (P1)` (web-prod-gate.yml) — FAILURE (1m4s)

**Root cause:** `apps/web/src/lib/db.ts:90-91` has hardcoded Windows fallback path:

```ts
const envUrl = process.env.TURSO_DATABASE_URL || "file:Z:/Projects/buddysaradhi/buddysaradhi/prisma/dev.db";
const envToken = process.env.TURSO_AUTH_TOKEN || "dummy-token";
```

When the test's `beforeEach` deletes env vars, instead of throwing `DB_NOT_PROVISIONED`, the function returns the hardcoded Windows path. This causes 4 test failures in `apps/web/src/lib/db.test.ts` (tests 6-9).

**Local repro confirmed:** `npx vitest run src/lib/db.test.ts` — 4 failed, 6 passed.

### Workflow 2: `supabase-ci.yml` — FAILURE (0s, empty jobs)

**Root cause:** The YAML is valid. The `deploy` job (line 42) uses `secrets.SUPABASE_ACCESS_TOKEN != ''` in a job-level `if` condition. When ALL jobs fail to start, GitHub Actions marks the workflow as "failure" with 0s and empty jobs array.

The `lint` job has NO `if` condition and should always run. The 0s/empty-jobs pattern likely means:
- GitHub Actions evaluates `secrets.*` references in job-level `if` and the entire workflow fails to register jobs when the secret reference is problematic.
- OR: The workflow was superseded by a concurrent run (concurrency group `supabase-ci-${{ github.ref }}` with `cancel-in-progress: true`).

### Workflow 3: `eas-build.yml` — FAILURE (0s, empty jobs)

**Root cause:** Line 22: `if: secrets.EAS_TOKEN != ''` — same pattern. When secret doesn't exist, job is skipped. If ALL jobs skipped → workflow marked as failure.

Note: This workflow only triggers on tag pushes (`tags: ['v*']`) or `workflow_dispatch`. It shouldn't trigger on branch pushes at all. The 0s failure on a push event suggests GitHub Actions is recording a stale or mis-triggered run.

### Workflow 4: `eas-update.yml` — FAILURE (0s, empty jobs)

**Root cause:** Line 63: `if: needs.detect-changes.outputs.js_only == 'true' && vars.EXPO_PROJECT_ID != '' && secrets.EAS_TOKEN != ''` — same `secrets.*` pattern.

The `detect-changes` job has NO `if` condition and should run. The 0s/empty pattern suggests the workflow-level evaluation is failing.

---

## Implementation Tasks

### Task 1: Fix `db.ts` hardcoded fallback

**File:** `apps/web/src/lib/db.ts`

**Current (lines 88-93):**
```ts
const envUrl = process.env.TURSO_DATABASE_URL || "file:Z:/Projects/buddysaradhi/buddysaradhi/prisma/dev.db";
const envToken = process.env.TURSO_AUTH_TOKEN || "dummy-token";
return { dbUrl: envUrl, dbToken: envToken };
```

**Change to:**
```ts
const envUrl = process.env.TURSO_DATABASE_URL;
const envToken = process.env.TURSO_AUTH_TOKEN;

if (!envUrl || !envToken) {
  throw new Error("DB_NOT_PROVISIONED: User database is not yet provisioned.");
}

return { dbUrl: envUrl, dbToken: envToken };
```

**Why:** The hardcoded Windows path was a local dev convenience that leaked into production code. Tests expect the function to throw when no credentials exist. Removing the fallback makes the function correct for all environments.

**Risk:** Low. The only "risk" is that developers without env vars set will get the error locally — but that's the correct behavior (they need to set up their dev DB).

**Verify:** `cd apps/web && npx vitest run src/lib/db.test.ts` — all 10 tests pass.

---

### Task 2: Fix `supabase-ci.yml` — move secret checks to step-level

**File:** `.github/workflows/supabase-ci.yml`

**Current (lines 40-42):**
```yaml
deploy:
    name: Deploy to Production
    needs: lint
    if: github.ref == 'refs/heads/main' && github.event_name == 'push' && secrets.SUPABASE_ACCESS_TOKEN != ''
```

**Change to:**
```yaml
deploy:
    name: Deploy to Production
    needs: lint
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

Then add step-level checks inside the deploy job:
```yaml
    steps:
      - name: Check secrets
        id: check-secrets
        run: |
          if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
            echo "has_token=false" >> $GITHUB_OUTPUT
          else
            echo "has_token=true" >> $GITHUB_OUTPUT
          fi
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Checkout
        if: steps.check-secrets.outputs.has_token == 'true'
        uses: actions/checkout@v4

      # ... rest of steps with `if: steps.check-secrets.outputs.has_token == 'true'`
```

**Why:** GitHub Actions best practice is to avoid `secrets.*` in job-level `if` conditions. Use env vars + step-level output instead.

---

### Task 3: Fix `eas-build.yml` — same pattern

**File:** `.github/workflows/eas-build.yml`

**Current (line 22):**
```yaml
if: secrets.EAS_TOKEN != ''
```

**Change to:** Remove the job-level `if`. Add a step-level check:
```yaml
build:
    name: EAS Build (iOS + Android)
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    steps:
      - name: Check EAS token
        id: check-token
        run: |
          if [ -z "$EAS_TOKEN" ]; then
            echo "has_token=false" >> $GITHUB_OUTPUT
          else
            echo "has_token=true" >> $GITHUB_OUTPUT
          fi
        env:
          EAS_TOKEN: ${{ secrets.EAS_TOKEN }}

      - name: Checkout
        if: steps.check-token.outputs.has_token == 'true'
        uses: actions/checkout@v4
      # ... remaining steps all get `if: steps.check-token.outputs.has_token == 'true'`
```

Also add `if: needs.build.result == 'success'` to the `wait-and-mirror` job instead of relying on implicit skip propagation.

---

### Task 4: Fix `eas-update.yml` — same pattern

**File:** `.github/workflows/eas-update.yml`

**Current (line 63):**
```yaml
if: needs.detect-changes.outputs.js_only == 'true' && vars.EXPO_PROJECT_ID != '' && secrets.EAS_TOKEN != ''
```

**Change to:**
```yaml
if: needs.detect-changes.outputs.js_only == 'true' && vars.EXPO_PROJECT_ID != ''
```

Then add a step-level EAS_TOKEN check inside the `ota` job, gating each step on the token being available.

---

### Task 5: Verify Production Gate passes

Run locally:
```bash
# Fix db.ts first, then:
cd apps/web && npx vitest run src/lib/db.test.ts
# Should show: 10 tests | 0 failed
```

The Production Gate workflow also runs `deno lint` and `deno check` on the gateway. Verify those pass:
```bash
deno lint apps/gateway/
deno check apps/gateway/index.ts
```

---

### Task 6: Push and verify all workflows green

After committing all fixes:
1. Push to `main`
2. Monitor all 8 workflows via `gh run list --repo HKDevLoops/buddysaradhi --limit 8`
3. All should show `conclusion: "success"`

---

### Task 7: TestSprite verification — web app + gateway + product page

After CI is green, use TestSprite to verify the deployed application:

1. **Web app (main):** Full App Test — login, dashboard, students, attendance, fees, settings
2. **Gateway health:** Hit `/api/v1/students` endpoint to verify gateway is live
3. **Product page:** Verify landing page renders (need correct URL — currently shows login)

---

## Verification Checklist

- [ ] `db.test.ts` — all 10 tests pass locally
- [ ] `deno lint apps/gateway/` — 0 errors
- [ ] `deno check apps/gateway/index.ts` — passes
- [ ] Push to main
- [ ] Production Gate (P1) — SUCCESS
- [ ] supabase-ci — SUCCESS (or correctly skipped if no secrets)
- [ ] eas-build — SUCCESS (or correctly skipped if no tag push)
- [ ] eas-update — SUCCESS (or correctly skipped if no secret)
- [ ] lint — still SUCCESS
- [ ] CI/Testing — still SUCCESS
- [ ] web-deploy — still SUCCESS
- [ ] security-agent — still SUCCESS
- [ ] TestSprite smoke test — PASS
- [ ] TestSprite full app test — PASS

---

## Out of Scope

- Mobile app (apps/mobile) — not in this CI fix
- Desktop app (apps/desktop) — not in this CI fix
- Supabase function deployment — needs SUPABASE_ACCESS_TOKEN secret to be configured by repo owner
- EAS builds — needs EAS_TOKEN secret to be configured by repo owner
- LCP optimization (2.7s → target <2.5s) — separate task
- UI redesign — separate task
