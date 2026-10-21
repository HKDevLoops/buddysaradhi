// Implements: AGENTS.md §5.3 — the spec-ref CI gate's own regression test.
//
// The negative control is the point: a gate that cannot fail is not a gate
// (AGENTS.md §12). Every failure mode below is asserted to FAIL, so a
// regression that turns the gate into a rubber stamp is caught here rather
// than by the first PR that slips through.
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  checkSpecRef,
  collectSpecSections,
  extractCitations,
  extractSpecRefBlock,
} from "./spec-ref-gate";

const SECTIONS = collectSpecSections();

describe("collectSpecSections — the canonical spec set", () => {
  it("finds the numbered spec files at the repo root", () => {
    expect(SECTIONS).toContain("07_Fees_and_Payments.md");
    expect(SECTIONS).toContain("12_Business_Rules.md");
  });

  it("finds the numbered spec files in the platform subdirectories", () => {
    expect(SECTIONS).toContain("web/03_Auth_and_Provisioning.md");
    expect(SECTIONS).toContain("deployment/06_Edge_Function_Hosting.md");
  });

  it("does not treat a non-spec markdown file as a spec section", () => {
    // AGENTS.md is the operating manual, not a numbered spec section; a PR
    // may cite it, but it does not satisfy the gate on its own.
    expect(SECTIONS).not.toContain("AGENTS.md");
    expect(SECTIONS).not.toContain("README.md");
  });
});

describe("extractSpecRefBlock — the `## Spec ref` section", () => {
  it("returns the block between the heading and the next heading", () => {
    const body = [
      "## What changed",
      "stuff",
      "",
      "## Spec ref",
      "Implements: `07_Fees_and_Payments.md` §9 Flow 10",
      "",
      "## Risk",
      "ledger",
    ].join("\n");
    const block = extractSpecRefBlock(body);
    expect(block).toContain("07_Fees_and_Payments.md");
    expect(block).not.toContain("## Risk");
  });

  it("returns null when the heading is absent", () => {
    expect(extractSpecRefBlock("## What changed\n\nno spec here")).toBeNull();
  });
});

describe("extractCitations — the .md files the block names", () => {
  it("reads backticked and bare references", () => {
    expect(extractCitations("Implements: `07_Fees_and_Payments.md` and 10_Security.md")).toEqual([
      "07_Fees_and_Payments.md",
      "10_Security.md",
    ]);
  });
});

describe("checkSpecRef — the gate", () => {
  const good = [
    "## What changed",
    "",
    "## Spec ref",
    "",
    "Implements: `07_Fees_and_Payments.md` §9 Flow 10",
    "Principle: P4 (Immutable Ledger)",
    "Edge cases: EC-F-04, EC-F-03",
  ].join("\n");

  it("PASSES a description that cites a real spec section", () => {
    const result = checkSpecRef(good);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.cited).toContain("07_Fees_and_Payments.md");
  });

  it("FAILS a description with NO `## Spec ref` block — the negative control", () => {
    const body = ["## What changed", "", "A change with no spec reference at all."].join("\n");
    const result = checkSpecRef(body);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("no `## Spec ref` block");
  });

  it("FAILS a block that cites a spec file that does not exist", () => {
    const body = ["## Spec ref", "", "Implements: `99_Not_A_Spec.md` §1"].join("\n");
    const result = checkSpecRef(body);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain("99_Not_A_Spec.md");
  });

  it("FAILS a block that names no spec file at all", () => {
    const body = ["## Spec ref", "", "Implements: the ledger engine"].join("\n");
    const result = checkSpecRef(body);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("names no spec file");
  });

  it("FAILS a block that cites only a non-spec markdown file", () => {
    const body = ["## Spec ref", "", "Implements: `README.md`"].join("\n");
    const result = checkSpecRef(body);
    expect(result.ok).toBe(false);
    expect(result.problems.join(" ")).toContain("no canonical spec section");
  });

  it("accepts a platform-subdirectory spec citation", () => {
    const body = ["## Spec ref", "", "Implements: `web/03_Auth_and_Provisioning.md` §1"].join("\n");
    const result = checkSpecRef(body);
    expect(result.problems).toEqual([]);
    expect(result.cited).toContain("web/03_Auth_and_Provisioning.md");
  });

  it("reads the spec set from the real repository", () => {
    expect(SECTIONS.length).toBeGreaterThan(20);
    expect(REPO_ROOT).toContain("buddysaradhi");
  });
});
