// Implements: 20_3D_Product_Page.md §3.2 (the 3D stack's payload regression
// guard - the byte budget the section used to carry, replaced on 2026-10-21 by
// a measured baseline plus an allowance) and §3 (the W6 performance bar).
//
// WHAT THIS IS. The static half of the payload gate. The dynamic half is
// `scripts/measure-payload.ts --gate`, which measures the PRODUCTION build -
// it needs a build, so it cannot be the gate that runs on every commit.
//
// These assertions are the cheap half, and they are the half that rots: a
// recorded baseline is a number in TWO places (the spec and the script), and
// two numbers drift apart silently. So this file pins them to each other,
// and it pins the RULE: a payload over the limit must fail, and a payload
// inside it must not.
//
// WHY THE OLD BUDGET WAS REPLACED RATHER THAN MET. The section used to budget
// the 3D stack at < 180 KB gzip. Measured on the production build of
// 2026-10-21, the stack is 151.0 KB - UNDER the old ceiling - and three.js
// 0.182's own module is 122.6 KB. The number was never measured, and the
// "245.3 KB, unreachable" figure the plan carried does not reproduce. A
// budget nobody can check against is a budget nobody can act on; the rule is
// now a REGRESSION GUARD against a measured baseline, so the 3D can grow
// inside the allowance and anything larger needs a decision written down in
// the spec.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BASELINE_BYTES,
  GROWTH_ALLOWANCE,
  LIMIT_BYTES,
  evaluatePayload,
} from "../scripts/measure-payload.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = readFileSync(resolve(here, "../../../20_3D_Product_Page.md"), "utf8");

describe("the 3D stack's payload regression guard (20_3D §3.2)", () => {
  it("pins the spec's baseline to the script's", () => {
    // The two numbers are the same fact stated twice, so they are pinned.
    const thousands = (n: number): string => n.toLocaleString("en-US");
    expect(SPEC).toContain(`**Baseline: ${thousands(BASELINE_BYTES)} B gzip**`);
    expect(SPEC).toContain(`+${Math.round(GROWTH_ALLOWANCE * 100)} %`);
  });

  it("pins the spec's limit to the script's", () => {
    expect(LIMIT_BYTES).toBe(Math.round(BASELINE_BYTES * (1 + GROWTH_ALLOWANCE)));
    expect(SPEC).toContain(LIMIT_BYTES.toLocaleString("en-US"));
  });

  it("has removed the old byte ceiling", () => {
    // The old row was a CEILING on ambition. If it comes back, the owner can
    // never ship a heavier scene without a fight - and the number was never
    // measured anyway. The section still NAMES the old ceiling while
    // explaining why it went, so the signature to look for is the TABLE ROW.
    const oldRow = SPEC.split("\n").find((line) => line.startsWith("| Bundle cost of the 3D stack"));
    expect(oldRow, "the old ceiling row must be gone from the §3 table").toBeUndefined();
    expect(SPEC).toContain("a REGRESSION GUARD, not a ceiling");
  });

  it("fails a payload over the allowance and passes one inside it", () => {
    // The negative control, in the guard's own arithmetic.
    expect(evaluatePayload(BASELINE_BYTES).ok).toBe(true);
    expect(evaluatePayload(LIMIT_BYTES).ok).toBe(true);
    expect(evaluatePayload(LIMIT_BYTES + 1).ok).toBe(false);
    expect(evaluatePayload(LIMIT_BYTES + 1).overBy).toBe(1);
    // A dependency that drags half a megabyte in - the accident the guard
    // exists to catch - is over the limit by a wide margin.
    expect(evaluatePayload(BASELINE_BYTES + 150_000).ok).toBe(false);
  });

  it("keeps the rest of §3's budgets intact", () => {
    // "As high as possible" is about the BYTES. The frame rate, the DPR
    // ladder and the sample counts are not negotiable, and an amendment that
    // touched them would be a different amendment.
    expect(SPEC).toContain("**≥ 50 fps**");
    expect(SPEC).toContain("≥ 30 fps");
    expect(SPEC).toContain("**≥ 90**");
    expect(SPEC).toContain("< 1.2 s");
    expect(SPEC).toContain("< 3 s");
    expect(SPEC).toContain("### 3.1 The Degradation Ladder");
  });
});
