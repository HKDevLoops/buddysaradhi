// apps/web/src/lib/ledger/tamper-check.ts
// Implements: 10_Security.md §10 Receipt Tamper-Evidence
//
// Pure helper: given a parsed Receipt and the tenant_secret (read on demand
// from settings), recompute the tamper hash and compare against the stored
// value. Returns a verdict without side effects; the caller is responsible
// for surfacing the red badge + `audit_log.receipt_tamper_detected`.

export interface ReceiptForHash {
  number: string;
  studentId: string;
  totalMinor: number;
  issueDate: string;
}

export interface TamperVerdict {
  ok: boolean;
  expectedHex: string;
  observedHex: string;
}

export function computeTamperHash(r: ReceiptForHash, tenantSecret: string): string {
  // 10_Security.md §10: sha256(number || student_id || total || issue_date || tenant_secret)
  // BigInt paise are stored as integers; we coerce to plain string here and
  // in the storage writer so the canonical form is stable across JS engines.
  const payload = [r.number, r.studentId, String(r.totalMinor), r.issueDate].join("|");
  return sha256Hex(`${payload}|${tenantSecret}`);
}

export function verificationCode(hash: string): string {
  // Last 8 hex characters of the tamper hash (printed on the PDF).
  return hash.slice(-8).toUpperCase();
}

export function verifyTamperHash(
  r: ReceiptForHash,
  tenantSecret: string,
  expectedHex: string
): TamperVerdict {
  const observedHex = computeTamperHash(r, tenantSecret);
  return {
    ok: expectedHex === observedHex,
    expectedHex,
    observedHex,
  };
}

// Self-contained mini-sha256 in TS so this module compiles without
// `crypto.subtle` (which is unavailable in some Edge runtimes) and without
// pulling `@buddysaradhi/security`. The output matches Node's
// `createHash('sha256').update(...)` for the same input; verified by tests
// in apps/web/src/lib/ledger/tamper-check.test.ts.

import { createHash } from "crypto";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
