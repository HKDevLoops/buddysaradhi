// Implements: AGENTS.md §6.1 (TS strict) — regression guard for L7
// `no-js-source` in scripts/principle-lints.ts.
//
// Mirrors apps/gateway/__tests__/no-raw-sql.test.ts: asserts zero
// *.js/*.mjs/*.cjs under the TS-only scope (apps/ + packages/ + scripts/).
// The file set comes from the same `git ls-files` invocation the lint uses
// (tracked + untracked-but-not-ignored), so git-ignored tooling (e.g. the
// Expo-generated *.js under apps/mobile/, ignored via apps/mobile/.gitignore)
// is out of scope here exactly as it is in the lint. Keep ALLOW below in
// sync with L7_ALLOW in scripts/principle-lints.ts — update both together.
// The second test fails on stale entries so the list stays honest.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT: string = fileURLToPath(new URL("..", import.meta.url));

const L7_PREFIXES: string[] = ["apps/", "packages/", "scripts/"];
const L7_EXTS: string[] = [".js", ".mjs", ".cjs"];

// Mirror of L7_ALLOW in scripts/principle-lints.ts (repo-relative paths).
// eslint.config.mjs: ESLint 10 has no .ts autodiscovery (verified by trial).
// desktop/mobile .mjs: locked platforms per 16_Platform_Delivery_Sequence.md,
// migrate at platform unlock (expiry MOBILE-PROD-GATE / DESKTOP-PROD-GATE).
const ALLOW: Set<string> = new Set([
  "apps/web/eslint.config.mjs",
  "apps/product-page/eslint.config.mjs",
  "packages/core/eslint.config.mjs",
  "packages/shared/eslint.config.mjs",
  "packages/security/eslint.config.mjs",
  "apps/desktop/eslint.config.mjs",
  "apps/desktop/postcss.config.mjs",
  "apps/desktop/scripts/generate-tokens.mjs",
  "apps/desktop/scripts/verify-tokens.mjs",
  "apps/mobile/scripts/generate-tokens.mjs",
]);

function listLintFiles(): string[] {
  const out: string = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((f: string) => f.trim().replace(/\\/g, "/"))
    .filter((f: string) => f.length > 0);
}

describe("no-js-source: TS-only scope holds no *.js/*.mjs/*.cjs", () => {
  it("finds zero JS files outside the L7 allowlist", () => {
    const offenders: string[] = listLintFiles().filter(
      (f: string) =>
        L7_PREFIXES.some((p: string) => f.startsWith(p)) &&
        L7_EXTS.some((e: string) => f.endsWith(e)) &&
        !ALLOW.has(f),
    );
    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still exists (no stale entries)", () => {
    const stale: string[] = [...ALLOW].filter((rel: string) => !existsSync(`${REPO_ROOT}/${rel}`));
    expect(stale).toEqual([]);
  });
});
