// Implements: docs/audit/DYNAMIC-SUPPLYCHAIN.md — negative controls for the
// supply-chain gates added by the 2026-10-21 audit.
//
// A gate that has never been shown to FAIL is not a gate (AGENTS.md §2 Rule 9).
// Each test below plants a REAL violation, runs the gate, asserts the gate
// FAILED, and then removes the planted file. The clean-tree test asserts the
// same gates PASS on the repository as it stands.
//
// The assertions are scoped to the rules under test (L10, L11) rather than to
// the process exit code, because other rules (L7 in particular) can be red on
// a tree where a concurrent agent has untracked scratch files in it. A test
// that fails for someone else's reason is a test that gets deleted.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const REPO_ROOT: string = fileURLToPath(new URL("..", import.meta.url));

// Every test below runs the FULL principle-lint over the whole repository,
// which takes ~20s on this tree. The default 5s Vitest timeout is therefore
// not a useful budget for these tests.
vi.setConfig({ testTimeout: 180000, hookTimeout: 180000 });

interface LintResult {
  stdout: string;
  exitCode: number;
}

function runLint(): LintResult {
  // spawnSync, NOT execFileSync: the lint EXITS NON-ZERO when it finds
  // something, which is the case every negative control depends on, and
  // execFileSync's thrown error does not reliably carry stdout on every
  // runtime. spawnSync never throws and always reports both.
  const res = spawnSync("bun", ["scripts/principle-lints.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { stdout: (res.stdout ?? "") + (res.stderr ?? ""), exitCode: res.status ?? 1 };
}

/** Rule ids that appear in the lint's finding report. */
function rulesReported(stdout: string): Set<string> {
  const ids = new Set<string>();
  // The report prints one heading per rule, then "  <file>:<line>" lines.
  // The output is ANSI-coloured, so the codes are stripped first.
  const plain = stdout.replace(/\u001b\[[0-9;]*m/g, "");
  const re = /^L(\d+)\s/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain)) !== null) ids.add(`L${m[1]}`);
  return ids;
}

/** The same, but stripped, so `toContain` assertions are not defeated by colour. */
function plain(stdout: string): string {
  return stdout.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Plant a violation, run an assertion against it, and remove it.
 *
 * The retry is not paranoia: this repository is worked on by several agents at
 * once, and a concurrent `git clean -fd` (or `git stash`) can delete an
 * untracked planted file between the write and the lint run. The assertion
 * would then fail for a reason that has nothing to do with the rule. So: if
 * the planted file is gone when the assertion returns, re-plant and run the
 * assertion once more.
 */
function withPlantedFile(relPath: string, content: string, fn: () => void): void {
  const abs = join(REPO_ROOT, relPath);
  const existed = existsSync(abs);
  const previous = existed
    ? execFileSync("cmd", ["/c", "type", abs], { cwd: REPO_ROOT, encoding: "utf8" })
    : null;
  const plant = (): void => {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, "utf8");
  };
  try {
    plant();
    fn();
    if (!existsSync(abs)) {
      // A concurrent operation removed the planted file mid-run.
      plant();
      fn();
    }
  } finally {
    if (existed && previous !== null) writeFileSync(abs, previous, "utf8");
    else rmSync(abs, { force: true });
    rmSync(join(REPO_ROOT, "apps/gateway/zz-l10-negative-control"), {
      force: true,
      recursive: true,
    });
  }
}

// A killed test run can leave a planted violation behind, and a leftover
// violation makes the "clean tree" assertions fail for the wrong reason.
// Remove any stale negative-control artefacts before the first test.
beforeAll(() => {
  for (const stale of [
    ".github/workflows/zz-l12-negative-control.yml",
    "apps/gateway/zz-l10-negative-control/deno.json",
    "packages/shared/src/zz-l11-negative-control.ts",
  ]) {
    rmSync(join(REPO_ROOT, stale), { force: true });
  }
  rmSync(join(REPO_ROOT, "apps/gateway/zz-l10-negative-control"), {
    force: true,
    recursive: true,
  });
});

describe("L10 — no remote or floating dependency specifier", () => {
  it("the clean tree has no L10 findings", () => {
    const { stdout } = runLint();
    expect(rulesReported(stdout).has("L10")).toBe(false);
  });

  it("FIRES on a remote URL dependency (negative control)", () => {
    withPlantedFile(
      "apps/gateway/zz-l10-negative-control/deno.json",
      JSON.stringify({ dependencies: { "@supabase/supabase-js": "https://esm.sh/@supabase/supabase-js@2" } }, null, 2),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L10")).toBe(true);
        expect(plain(stdout)).toContain("remote dependency specifier");
      },
    );
  });

  it("FIRES on a floating version specifier (negative control)", () => {
    withPlantedFile(
      "apps/gateway/zz-l10-negative-control/deno.json",
      JSON.stringify({ devDependencies: { "@types/bun": "latest" } }, null, 2),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L10")).toBe(true);
        expect(plain(stdout)).toContain("floating version specifier");
      },
    );
  });

  it("FIRES on a floating Deno npm specifier (negative control)", () => {
    withPlantedFile(
      "apps/gateway/zz-l10-negative-control/deno.json",
      JSON.stringify({ imports: { "@supabase/supabase-js": "npm:@supabase/supabase-js@^2" } }, null, 2),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L10")).toBe(true);
        expect(plain(stdout)).toContain("floating Deno npm specifier");
      },
    );
  });
});

describe("L11 — no credential in a log payload", () => {
  it("the clean tree has no L11 findings", () => {
    const { stdout } = runLint();
    expect(rulesReported(stdout).has("L11")).toBe(false);
  });

  it("FIRES when a credential env var is logged directly (negative control)", () => {
    withPlantedFile(
      "packages/shared/src/zz-l11-negative-control.ts",
      [
        "export function leak(): void {",
        '  console.log("secret is", Deno.env.get("GATEWAY_SHARED_SECRET"));',
        "}",
        "",
      ].join("\n"),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L11")).toBe(true);
        expect(plain(stdout)).toContain("is logged");
      },
    );
  });

  it("FIRES when a credential is bound and then logged (the indirect form)", () => {
    withPlantedFile(
      "packages/shared/src/zz-l11-negative-control.ts",
      [
        "export function leak(): void {",
        '  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;',
        '  console.log("using", token);',
        "}",
        "",
      ].join("\n"),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L11")).toBe(true);
        expect(plain(stdout)).toContain("holds a credential");
      },
    );
  });

  it("does NOT fire on a legitimate credential read that is not logged", () => {
    withPlantedFile(
      "packages/shared/src/zz-l11-negative-control.ts",
      [
        "export function use(): string {",
        '  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";',
        "}",
        "",
      ].join("\n"),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L11")).toBe(false);
      },
    );
  });
});

describe("L12 — no GitHub expression inside a run: body", () => {
  it("the clean tree has no L12 findings", () => {
    const { stdout } = runLint();
    expect(rulesReported(stdout).has("L12")).toBe(false);
  });

  it("FIRES on an expression interpolated into a run: body (negative control)", () => {
    withPlantedFile(
      ".github/workflows/zz-l12-negative-control.yml",
      [
        "name: negative-control",
        "on: workflow_dispatch",
        "permissions:",
        "  contents: read",
        "jobs:",
        "  probe:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: sink",
        "        run: |",
        "          echo \"value is ${{ github.event.head_commit.message }}\"",
        "",
      ].join("\n"),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L12")).toBe(true);
        expect(plain(stdout)).toContain("GitHub expression inside a run: body");
      },
    );
  });

  it("does NOT fire on an expression in an env: value", () => {
    withPlantedFile(
      ".github/workflows/zz-l12-negative-control.yml",
      [
        "name: negative-control",
        "on: workflow_dispatch",
        "permissions:",
        "  contents: read",
        "jobs:",
        "  probe:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - name: safe",
        "        env:",
        "          MSG: ${{ github.event.head_commit.message }}",
        "        run: echo \"$MSG\"",
        "",
      ].join("\n"),
      () => {
        const { stdout } = runLint();
        expect(rulesReported(stdout).has("L12")).toBe(false);
      },
    );
  });
});
