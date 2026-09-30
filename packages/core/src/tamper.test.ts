// Implements: 10_Security.md §10 (invoice tamper evidence keyed by
// `tenant_secret`), 07_Fees_and_Payments.md §10.3 BR-FEE-05 (canonical formula
// `sha256(number || student_id || total || issue_date || tenant_secret)`),
// 11_Data_Model.md §4.12 (`invoices.tamper_hash` NOT NULL),
// 14_Edge_Cases.md EC-SEC-03 (hash mismatch → TAMPERED).
//
// Pure unit tests for `tamper.ts` — the canonical formula that writer
// (`fees.ts`) and verifier (`apps/web/src/lib/ledger/tamper-check.ts:22`)
// must agree on byte-for-byte. No DB, no I/O.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { computeInvoiceTamperHash } from "./tamper";

const FIELDS = {
  number: "INV-000001",
  studentId: "student-1",
  totalPaise: 100000,
  issueDate: "2026-09-15",
};
const SECRET = "tenant-secret-abc";

describe("computeInvoiceTamperHash (10_Security.md §10 canonical formula)", () => {
  it("is deterministic for the same inputs", () => {
    expect(computeInvoiceTamperHash(FIELDS, SECRET)).toBe(
      computeInvoiceTamperHash(FIELDS, SECRET),
    );
  });

  it("returns a 64-char lowercase hex sha256 digest", () => {
    expect(computeInvoiceTamperHash(FIELDS, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the verifier byte-for-byte: sha256(number|student|total|date|secret)", () => {
    const expected = createHash("sha256")
      .update(
        `${FIELDS.number}|${FIELDS.studentId}|${String(FIELDS.totalPaise)}|${FIELDS.issueDate}|${SECRET}`,
        "utf8",
      )
      .digest("hex");
    expect(computeInvoiceTamperHash(FIELDS, SECRET)).toBe(expected);
  });

  it.each([
    [{ ...FIELDS, number: "INV-000002" }, "number"],
    [{ ...FIELDS, studentId: "student-2" }, "studentId"],
    [{ ...FIELDS, totalPaise: 100001 }, "totalPaise"],
    [{ ...FIELDS, issueDate: "2026-09-16" }, "issueDate"],
  ])("changes when %s changes", (mutated) => {
    expect(computeInvoiceTamperHash(mutated, SECRET)).not.toBe(
      computeInvoiceTamperHash(FIELDS, SECRET),
    );
  });

  it("changes when the tenant secret changes (EC-SEC-03: wrong key ≠ valid hash)", () => {
    expect(computeInvoiceTamperHash(FIELDS, "other-secret")).not.toBe(
      computeInvoiceTamperHash(FIELDS, SECRET),
    );
  });

  it("pipe delimiters prevent field-boundary ambiguity", () => {
    // Without the "|" separators, {number:"INV-1",student:"23"} and
    // {number:"INV-12",student:"3"} could collide. They must not.
    const a = computeInvoiceTamperHash(
      { ...FIELDS, number: "INV-1", studentId: "23" },
      SECRET,
    );
    const b = computeInvoiceTamperHash(
      { ...FIELDS, number: "INV-12", studentId: "3" },
      SECRET,
    );
    expect(a).not.toBe(b);
  });

  it("handles unicode and empty fields deterministically", () => {
    const unicode = computeInvoiceTamperHash(
      { ...FIELDS, number: "INV-आरव-01" },
      SECRET,
    );
    expect(unicode).toMatch(/^[0-9a-f]{64}$/);
    expect(computeInvoiceTamperHash({ ...FIELDS, number: "INV-आरव-01" }, SECRET)).toBe(
      unicode,
    );
  });
});
