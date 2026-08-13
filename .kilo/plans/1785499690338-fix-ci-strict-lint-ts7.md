# Plan: Fix All CI Issues + Enforce Strict Linting + TypeScript 7+ Compliance

## 1. Problem Statement

After the `supabase/` → `apps/gateway/` refactor, the CI pipeline is broken in multiple ways:

1. **Integration tests fail** — `vitest.integration.config.ts` points to non-existent paths (`apps/gateway/src/`, `supabase/functions/gateway/`)
2. **ESLint is broken** — `typescript-eslint@8.x` is incompatible with TypeScript 7.x (CJS undefined error), causing pre-commit hook failures and forcing `--no-verify` workarounds
3. **Deno lint excludes tests** — `apps/gateway/deno.json` excludes `__tests__/` from linting, leaving test files unchecked
4. **Codecov failures are hard failures** — `lint.yml` doesn't mark Codecov upload as non-blocking
5. **No zero-tolerance lint policy** — warnings are allowed to accumulate, violating "production-ready code" standards
6. **Documentation references old TypeScript versions** — AGENTS.md and other .md files don't enforce TS 7+

## 2. Root Causes

### 2.1 Integration Test Config Points to Deleted Paths
- **File:** `vitest.integration.config.ts`
- **Problem:** References `apps/gateway/src/**/*.test.ts` and `supabase/functions/gateway/__tests__/**/*.test.ts`
- **Why:** After the refactor, all gateway tests moved to `apps/gateway/__tests__/`
- **Impact:** CI integration test step fails with "No test files found"

### 2.2 typescript-eslint Incompatible with TypeScript 7.x
- **File:** `apps/desktop/eslint.config.mjs`, `eslint.config.mjs` (root), all package.json files
- **Problem:** `typescript-eslint@8.65.0` uses CJS API that TypeScript 7.x breaks
- **Why:** TypeScript 7.x removed legacy CJS exports; typescript-eslint 8.x still expects them
- **Impact:** Pre-commit hook crashes; ESLint fails on all TS files; forces `--no-verify` workaround
- **Error:** `Cjs undefined error in typescript-estree`

### 2.3 Deno Lint Excludes Test Files
- **File:** `apps/gateway/deno.json`
- **Problem:** `"exclude": ["**/__tests__/**"]` prevents `deno lint` from checking test files
- **Why:** Tests were originally excluded to avoid linting mock-heavy test code
- **Impact:** Test files accumulate lint errors; no CI enforcement of test quality

### 2.4 Codecov Upload Not Non-Blocking
- **File:** `.github/workflows/lint.yml`
- **Problem:** Codecov step has `continue-on-error: true` but no `fail_ci_if_error: false` in the `with:` block
- **Why:** Missing `fail_ci_if_error: false` means Codecov token issues or network failures still fail the step
- **Impact:** Unrelated CI failures when Codecov is misconfigured or token is missing

### 2.5 No Zero-Tolerance Lint Enforcement
- **File:** All ESLint configs
- **Problem:** No `--max-warnings 0` flag in CI lint commands
- **Why:** Warnings are treated as non-blocking
- **Impact:** Code quality degrades over time; "production-ready" standard not enforced

### 2.6 Documentation Doesn't Enforce TypeScript 7+
- **File:** `AGENTS.md`, `README.md`, `CLAUDE.md`, other .md files
- **Problem:** No explicit statement that TypeScript 7+ is required
- **Why:** Docs were written before TS 7.x adoption
- **Impact:** New agents might use TS 6.x patterns that break with TS 7.x

## 3. Decisions

1. **Remove typescript-eslint everywhere** — Replace with `@eslint/js` recommended + `languageOptions.globals`. This matches the pattern already in `apps/web/eslint.config.mjs` and eliminates the TS 7.x incompatibility.

2. **Repoint integration tests to `apps/gateway/__tests__/`** — Update `vitest.integration.config.ts` to match the new gateway structure.

3. **Include gateway tests in deno lint** — Remove `**/__tests__/**` from `deno.json` exclude list. Fix any lint issues in test files.

4. **Make Codecov non-blocking** — Add `fail_ci_if_error: false` to the Codecov step in `lint.yml`.

5. **Enforce zero warnings in CI** — Add `--max-warnings 0` to all ESLint commands in CI workflows.

6. **Update all docs to TS 7+** — Add explicit TypeScript 7+ requirements to AGENTS.md, README.md, and other relevant .md files.

## 4. Implementation Plan

### Task 1: Fix `vitest.integration.config.ts`

**File:** `vitest.integration.config.ts`

**Change:**
```diff
  test: {
    include: [
-     'apps/gateway/src/**/*.test.ts',
-     'supabase/functions/gateway/__tests__/**/*.test.ts',
+     'apps/gateway/__tests__/**/*.test.ts',
+     'apps/gateway/src/__tests__/**/*.test.ts',
    ],
  },
```

**Why:** Tests moved to `apps/gateway/__tests__/` after refactor. The old paths no longer exist.

**Verify:** `pnpm run test:integration` passes locally.

---

### Task 2: Remove `typescript-eslint` from All Configs

**Files:**
- `eslint.config.mjs` (root)
- `apps/desktop/eslint.config.mjs`
- `packages/core/package.json`
- `packages/shared/package.json`
- `packages/security/package.json`
- `apps/gateway/package.json`

#### 2a: Root `eslint.config.mjs`

**Before:**
```js
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([...]),
]);
```

**After:**
```js
import js from "@eslint/js";

export default [
  {
    ignores: [
      "node_modules/",
      ".next/",
      "out/",
      "dist/",
      "build/",
      ".turbo/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "*.db",
      "*.db-journal",
      "*.db-wal",
      "*.db-shm",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        NodeJS: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "error",
      "no-console": "warn",
    },
  },
];
```

**Why:** Eliminates typescript-eslint dependency. Uses `@eslint/js` recommended rules which are TS-compatible.

#### 2b: `apps/desktop/eslint.config.mjs`

**Before:**
```js
import ts from "typescript-eslint";
// ...
export default ts.config(
  { ignores: ["dist", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...ts.configs.recommended],
    // ...
  }
);
```

**After:**
```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  {
    ignores: ["dist/", "src-tauri/", "node_modules/"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        NodeJS: "readonly",
        React: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/#(4F46E5|4338CA|3730A3|312E81|1E1B4B)/]",
          message: "Indigo accents are forbidden (Rule 5). Use --accent-emerald, --accent-cyan, --accent-flare, --accent-amber, or --accent-violet.",
        },
        {
          selector: "Literal[value=/blue-(50|100|200|300|400|500|600|700|800|900)/]",
          message: "Tailwind blue-* accents are forbidden (Rule 5). Use emerald/cyan/flare/amber/violet.",
        },
      ],
    },
  },
];
```

**Why:** Removes typescript-eslint while preserving all existing rules (react-hooks, react-refresh, indigo/blue accent restrictions).

#### 2c: Remove `typescript-eslint` from package.json files

**Files:**
- `packages/core/package.json`
- `packages/shared/package.json`
- `packages/security/package.json`
- `apps/gateway/package.json`
- `package.json` (root)

**Change:** Remove `"typescript-eslint": "^8.0.0"` (or `^8.65.0`) from `devDependencies` in all files.

**Why:** Package is incompatible with TypeScript 7.x and no longer used.

---

### Task 3: Update `apps/gateway/deno.json` to Include Tests

**File:** `apps/gateway/deno.json`

**Change:**
```diff
  "lint": {
    "include": ["**/*.ts"],
-   "exclude": ["node_modules/", "dist/", "**/__tests__/**"],
+   "exclude": ["node_modules/", "dist/"],
    "rules": {
      "exclude": ["no-explicit-any"]
    }
  },
```

**Why:** Test files should be linted to the same standard as production code.

**Verify:** `deno lint apps/gateway/` passes with no errors or warnings.

---

### Task 4: Make Codecov Non-Blocking

**File:** `.github/workflows/lint.yml`

**Change:**
```diff
      - name: Upload coverage to Codecov
        if: always()
        continue-on-error: true
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
+         fail_ci_if_error: false
          token: ${{ secrets.CODECOV_TOKEN }}
```

**Why:** Codecov upload failures (missing token, network issues) should not fail the CI pipeline.

---

### Task 5: Enforce Zero Warnings in CI

**Files:**
- `.github/workflows/lint.yml`
- `.github/workflows/web-prod-gate.yml`
- `.github/workflows/supabase-ci.yml`
- `.github/workflows/test.yml`

#### 5a: `lint.yml`

**Change:**
```diff
      - name: Lint
-       run: pnpm run lint
+       run: pnpm run lint -- --max-warnings 0
        timeout-minutes: 5
```

#### 5b: `web-prod-gate.yml`

**Change:**
```diff
      - name: Core / Lint
-       run: pnpm --filter @buddysaradhi/core lint
+       run: pnpm --filter @buddysaradhi/core lint -- --max-warnings 0

      - name: Web / Lint
-       run: pnpm --filter web lint
+       run: pnpm --filter web lint -- --max-warnings 0
```

#### 5c: `supabase-ci.yml`

**Change:**
```diff
      - name: Deno Lint
-       run: deno lint apps/gateway/
+       run: deno lint apps/gateway/ --max-warnings 0
```

#### 5d: `test.yml`

**Change:**
```diff
      - name: Lint
-       run: pnpm --filter web lint
+       run: pnpm --filter web lint -- --max-warnings 0
```

**Why:** Zero-tolerance policy ensures production-ready code. Warnings are not acceptable.

---

### Task 6: Update Documentation to TypeScript 7+

**Files:**
- `AGENTS.md`
- `README.md`
- `CLAUDE.md`
- `packages/core/README.md`
- `packages/shared/README.md`
- `packages/security/README.md`
- `apps/desktop/README.md`

**Change:** Add a section to each file stating:

```markdown
## TypeScript Version

This project uses **TypeScript 7.x** or later. All code must be compatible with TypeScript 7's strict mode and ESM-only exports.

- Do not use legacy CJS patterns (`require()`, `module.exports`)
- Do not use typescript-eslint (incompatible with TS 7.x)
- Use `@eslint/js` recommended rules instead
```

**Why:** Ensures all agents and developers know the project requires TS 7+ and avoids TS 6.x patterns.

---

### Task 7: Fix All Lint Errors and Warnings

**Scope:** All workspaces (web, gateway, desktop, core, shared, security, product-page)

**Process:**
1. Run `pnpm run lint -- --max-warnings 0` locally
2. Fix all errors and warnings
3. Common issues to expect:
   - Unused variables
   - Missing return types
   - Console statements (should use `logInfo`, `logWarn`, `logError`)
   - Missing `// Implements:` comments on exported functions
   - Forbidden indigo/blue accents
   - Hardcoded `http://localhost` URLs
   - Non-integer money amounts

**Why:** Zero-tolerance policy requires all code to be production-ready.

---

### Task 8: Update Pre-Commit Hook

**File:** `.husky/pre-commit`

**Change:**
```diff
  #!/usr/bin/env sh
  . "$(dirname -- "$0")/_/husky.sh"

  pnpm exec lint-staged
+ pnpm run typecheck
```

**Why:** Ensures typecheck passes before commit, not just lint-staged.

---

### Task 9: Update Root `package.json` Scripts

**File:** `package.json`

**Change:**
```diff
  "scripts": {
    // ...
-   "lint": "pnpm -r --if-present lint",
+   "lint": "pnpm -r --if-present lint -- --max-warnings 0",
    "lint:fix": "pnpm -r --if-present lint -- --fix",
    // ...
  },
```

**Why:** Root lint script should enforce zero warnings by default.

---

### Task 10: Verify All CI Workflows Pass

**Files:**
- `.github/workflows/lint.yml`
- `.github/workflows/web-prod-gate.yml`
- `.github/workflows/supabase-ci.yml`
- `.github/workflows/test.yml`
- `.github/workflows/security.yml`

**Process:**
1. Commit all changes
2. Push to `main`
3. Watch all CI workflows
4. Fix any failures
5. Repeat until all workflows pass

**Why:** CI must be green before declaring the plan complete.

---

## 5. Validation Plan

After implementing all tasks:

1. **Local validation:**
   ```bash
   pnpm run lint -- --max-warnings 0  # Must pass with 0 errors, 0 warnings
   pnpm run typecheck                  # Must pass
   pnpm run test:unit                  # Must pass
   pnpm run test:integration           # Must pass
   pnpm run test:a11y                  # Must pass
   ```

2. **CI validation:**
   - Push to `main`
   - All workflows must be green:
     - `lint`
     - `web-prod-gate`
     - `supabase-ci`
     - `test`
     - `security-agent`
     - `web-deploy`
     - `eas-update`

3. **Pre-commit hook validation:**
   - Make a change to any .ts file
   - Run `git commit` (without `--no-verify`)
   - Pre-commit hook must pass

## 6. Rollout

1. Implement all tasks in order
2. Commit each task separately with descriptive messages
3. Push to `main`
4. Watch CI workflows
5. Fix any failures
6. Update memory files with final state

## 7. Success Criteria

- ✅ All CI workflows pass
- ✅ `pnpm run lint -- --max-warnings 0` passes with 0 errors, 0 warnings
- ✅ `pnpm run typecheck` passes
- ✅ `pnpm run test:unit` passes
- ✅ `pnpm run test:integration` passes
- ✅ Pre-commit hook passes without `--no-verify`
- ✅ All documentation references TypeScript 7+
- ✅ No `typescript-eslint` in any package.json
- ✅ Gateway tests are linted by `deno lint`
- ✅ Codecov upload is non-blocking

## 8. Risks

- **Risk:** Removing typescript-eslint might miss some TS-specific lint rules
  - **Mitigation:** Use `@eslint/js` recommended rules which cover most common issues. Type-checking is still enforced by `tsc --noEmit`.

- **Risk:** Fixing all warnings might require significant code changes
  - **Mitigation:** Fix warnings incrementally. Start with `--max-warnings 100`, then reduce to 0.

- **Risk:** Deno lint on test files might fail
  - **Mitigation:** Fix test file issues before pushing. Test locally with `deno lint apps/gateway/`.

- **Risk:** Updating docs might miss some files
  - **Mitigation:** Use `grep -r "typescript"` to find all .md files that mention TypeScript and update them.

## 9. Open Questions

None. All decisions are resolved.

## 10. Next Steps

1. Implement Task 1 (fix vitest.integration.config.ts)
2. Implement Task 2 (remove typescript-eslint)
3. Implement Task 3 (include gateway tests in deno lint)
4. Implement Task 4 (make Codecov non-blocking)
5. Implement Task 5 (enforce zero warnings in CI)
6. Implement Task 6 (update docs to TS 7+)
7. Implement Task 7 (fix all lint errors and warnings)
8. Implement Task 8 (update pre-commit hook)
9. Implement Task 9 (update root package.json scripts)
10. Implement Task 10 (verify all CI workflows pass)
