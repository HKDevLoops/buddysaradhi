// Implements: packages/shared barrel contract (AGENTS.md §0.2 no-orphan-code —
// every export maps to a spec section exercised by its own suite).
import { describe, it, expect } from "vitest";
import * as Shared from "./index";

describe("shared barrel (src/index.ts)", () => {
  it("re-exports the student schemas (05_Students.md)", () => {
    expect(Shared.StudentSchema).toBeDefined();
    expect(Shared.StudentListRowSchema).toBeDefined();
  });

  it("re-exports the ledger schema (07_Fees_and_Payments.md)", () => {
    expect(Shared.LedgerEntrySchema).toBeDefined();
  });

  it("re-exports the attendance schemas (06_Attendance.md)", () => {
    expect(Shared.AttendanceStatusSchema).toBeDefined();
    expect(Shared.AttendanceSessionSchema).toBeDefined();
    expect(Shared.AttendanceRecordSchema).toBeDefined();
    expect(Shared.StudentAttendanceRowSchema).toBeDefined();
    expect(Shared.UpdateAttendancePayloadSchema).toBeDefined();
  });

  it("re-exports the money utils (BR-M-01/BR-M-02)", () => {
    expect(Shared.paiseAdd(2, 3)).toBe(5);
    expect(Shared.paiseSub(5, 8)).toBe(-3);
    expect(Shared.paiseMul(150000, 3)).toBe(450000);
    expect(Shared.formatINR(100)).toContain("1.00");
  });

  it("parses through the barrel export", () => {
    const parsed = Shared.StudentListRowSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      code: "STU-0001",
      name: "Riya Sharma",
      grade: null,
      batch: null,
      fee_model: "mixed",
      balance_due: 0,
      status: "active",
    });
    expect(parsed.success).toBe(true);
  });

  it("re-exports the fzf-style search engine (docs/design/overhaul-plan.md §3)", () => {
    expect(typeof Shared.fuzzyMatch).toBe("function");
    expect(typeof Shared.fuzzySearch).toBe("function");
    expect(typeof Shared.splitQueryTerms).toBe("function");
  });
});
