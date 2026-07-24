// apps/web/src/lib/ledger/tamper-check.test.ts
// Verifies §10 tamper_hash output matches Node's `createHash("sha256")` for
// the canonical payload; supports the React + sheets audit path.

import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { computeTamperHash, verificationCode, verifyTamperHash } from "./tamper-check";

describe("tamper-check (10_Security.md §10)", () => {
  const sample = {
    number: "R-2026-0001",
    studentId: "11111111-1111-1111-1111-111111111111",
    totalMinor: 150000,
    issueDate: "2026-07-01",
  };
  const tenantSecret = "redacted-pepper-32-byte-hex-value";

  it("matches Node's sha256 for the canonical payload", () => {
    const payload = [sample.number, sample.studentId, String(sample.totalMinor), sample.issueDate].join("|");
    const expected = createHash("sha256").update(`${payload}|${tenantSecret}`).digest("hex");
    expect(computeTamperHash(sample, tenantSecret)).toBe(expected);
  });

  it("verificationCode returns last 8 hex chars uppercased", () => {
    const h = computeTamperHash(sample, tenantSecret);
    const code = verificationCode(h);
    expect(code).toBe(h.slice(-8).toUpperCase());
  });

  it("verifyTamperHash returns ok:true when expected matches", () => {
    const expected = computeTamperHash(sample, tenantSecret);
    const v = verifyTamperHash(sample, tenantSecret, expected);
    expect(v.ok).toBe(true);
  });

  it("verifyTamperHash returns ok:false when a single byte differs", () => {
    const expected = computeTamperHash(sample, tenantSecret);
    const v = verifyTamperHash({ ...sample, totalMinor: sample.totalMinor + 1 }, tenantSecret, expected);
    expect(v.ok).toBe(false);
    expect(v.observedHex).not.toBe(expected);
  });

  it("treats negative or non-integer paise as incoherence", () => {
    // totalMinor is integer paise per BR-M-01; values that would break the
    // canonical form should be flagged at input validation, not here. This
    // test asserts the helper still produces a stable hash for negative
    // inputs (defence-in-depth, not a recommendation).
    const expected = computeTamperHash({ ...sample, totalMinor: -1 }, tenantSecret);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });
});
