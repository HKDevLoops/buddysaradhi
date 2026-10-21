// Implements: 12_Business_Rules.md BR-FEE-01 + BR-M-05 (the single paise
// rounding rule) and §15 row 16 (the Conflicts-Matrix row that resolves them).
//
// WHY THIS FILE EXISTS. `12_Business_Rules.md` named TWO rounding modes for
// the same money: BR-FEE-01 said "division rounds half-to-even" and BR-M-05
// said "`Math.round(result)` ... banker's rounding not used - round-half-up".
// An agent implementing the second one would credit a different number of
// paise than the first, and nothing in the tree could tell. The decision
// (2026-10-21, `12_Business_Rules.md` §15 row 16) is that half-to-even is THE
// rule, and that BR-M-05 now states the SCOPE rather than a second mode.
//
// The decision changed no arithmetic - `paiseDivHalfEven()` was already the
// implementation every division site used - so what this file guards is the
// two things that CAN silently drift back: the code's mode, and the spec's
// sentence. The second half is the interesting one: a spec that names a
// rounding mode the code does not implement is exactly the orphan-rule
// failure AGENTS.md §0.2 is about, and it is invisible until a tutor's
// discount is one paisa off.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { paiseDivHalfEven } from "./format";

/**
 * The repo root, found by walking up from the working directory.
 *
 * WHY NOT `import.meta.url`. This package compiles with `module: CommonJS`
 * (`packages/shared/tsconfig.json`), and `import.meta` is a hard TS1343 error
 * under CommonJS - so the package's OWN BUILD fails on a test file that uses
 * it. The working directory is the workspace root under the root vitest
 * config, and a package-local run sits one or two directories down, so the
 * search walks up until it finds the spec it is asserting against.
 */
function repoRoot(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(resolve(dir, "12_Business_Rules.md"))) return dir;
    dir = resolve(dir, "..");
  }
  throw new Error("cannot locate 12_Business_Rules.md above " + process.cwd());
}

const RULES = readFileSync(resolve(repoRoot(), "12_Business_Rules.md"), "utf8");

/** The row for a rule ID, or null when the ID is not in the file. */
function ruleRow(id: string): string | null {
  const line = RULES.split("\n").find((row) => row.startsWith(`|**${id}**`));
  return line ?? null;
}

describe("the single paise rounding rule (BR-FEE-01 + BR-M-05, §15 row 16)", () => {
  it("rounds a division half-to-even, and the two modes really do differ", () => {
    // A 10% discount on Rs 1,246.50 is 1246.5 paise. Half-to-even takes the
    // EVEN neighbour (1246); half-up takes 1247. The pair is chosen so the
    // assertion discriminates: a `Math.round` implementation would fail here,
    // and so would a half-to-even one that had the parity backwards.
    expect(paiseDivHalfEven(12465, 10)).toBe(1246);
    expect(Math.round(12465 / 10)).toBe(1247);
    // The other direction, so the parity rule is pinned from both sides.
    expect(paiseDivHalfEven(12555, 10)).toBe(1256);
    expect(Math.round(12555 / 10)).toBe(1256);
  });

  it("states ONE mode in BR-M-05, and it is the mode the code implements", () => {
    const row = ruleRow("BR-M-05");
    expect(row, "BR-M-05 must exist in 12_Business_Rules.md").not.toBeNull();
    expect(row).toContain("paiseDivHalfEven");
    expect(row).toContain("half-to-even");
    // The old text named `Math.round` as the rounding of every calculation and
    // declared banker's rounding "not used". Both are the defect.
    expect(row).not.toContain("Math.round");
    expect(row).not.toMatch(/banker's rounding not used/i);
  });

  it("keeps BR-FEE-01 as the rule that wins, and says so", () => {
    const row = ruleRow("BR-FEE-01");
    expect(row, "BR-FEE-01 must exist in 12_Business_Rules.md").not.toBeNull();
    expect(row).toContain("half-to-even");
    expect(row).toContain("§15 row 16");
  });

  it("has the Conflicts-Matrix row that resolves them (the row was missing)", () => {
    // The matrix is the spec's own tie-breaker table. The rounding conflict
    // was resolved in `22_Redundancy_Audit.md` P16 but had NO row here, so an
    // agent reading only the spec saw two rules and no winner.
    const row = RULES.split("\n").find((line) => line.startsWith("| 16 |"));
    expect(row, "§15 must carry a row 16 for the rounding conflict").toBeDefined();
    expect(row).toContain("BR-FEE-01");
    expect(row).toContain("BR-M-05");
    expect(row).toContain("half-to-even");
  });
});
