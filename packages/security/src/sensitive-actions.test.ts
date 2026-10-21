// packages/security/src/sensitive-actions.test.ts
// Verifies §4 sensitive-action registry — the 12-entry mirror between
// SPEC §4.1 and the UI behaviour tests.

import { describe, expect, it } from "vitest";
import { SENSITIVE_ACTIONS, lookupSensitiveAction, SENSITIVE_ACTIONS_TEST_GUARD, isSensitiveActionExemptAction } from "./sensitive-actions";

describe("sensitive-actions (10_Security.md §4)", () => {
  const EXACT_ENTRIES = 12;
  it(`registry carries exactly ${EXACT_ENTRIES} entries`, () => {
    expect(SENSITIVE_ACTIONS_TEST_GUARD.count).toBe(EXACT_ENTRIES);
  });

  it("every entry requires fresh-Auth ≤ 30s", () => {
    for (const [id, gate] of Object.entries(SENSITIVE_ACTIONS)) {
      expect(gate.freshAuthSeconds, id).toBeLessThanOrEqual(30);
    }
  });

  it("void_receipt and unlock_attendance do NOT require typed confirmation", () => {
    for (const id of ["void_receipt", "unlock_attendance"] as const) {
      expect(lookupSensitiveAction(id).typedConfirmRequired).toBeNull();
    }
  });

  it("bulk_delete and secure_erase DO require typed confirmation", () => {
    expect(lookupSensitiveAction("bulk_delete").typedConfirmRequired).toBe("DELETE");
    expect(lookupSensitiveAction("secure_erase").typedConfirmRequired).toBe("ERASE");
  });

  it("excel exempt actions are not gated", () => {
    expect(isSensitiveActionExemptAction("export_excel")).toBe(true);
    expect(isSensitiveActionExemptAction("export_receipt_pdf")).toBe(true);
    expect(isSensitiveActionExemptAction("export_statement_pdf")).toBe(true);
    // non-exempt
    expect(isSensitiveActionExemptAction("export_full")).toBe(false);
    expect(isSensitiveActionExemptAction("bulk_delete")).toBe(false);
  });

  it("registry ids are listed in deterministic order for the UI mirror test", () => {
    const ids = SENSITIVE_ACTIONS_TEST_GUARD.ids;
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
    // 12 unique ids
    expect(new Set(ids).size).toBe(12);
  });
});
