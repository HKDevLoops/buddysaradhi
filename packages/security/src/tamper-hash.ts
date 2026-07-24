// Implements: 10_Security.md §10 Receipt Tamper-Evidence
//
// tamper_hash = sha256(number || student_id || total || issue_date || tenant_secret)
// The last 8 hex chars of the hash are printed on the receipt PDF as a
// "verification code". On audit/receipt-view, recompute and compare; mismatch →
// red "TAMPERED" badge + `audit_log.receipt_tamper_detected` (BR-RC-02).
//
// Pure helper — call sites land in sub-RFC #6.

import { createHash } from "crypto";

export interface ReceiptForHash {
  number: string;
  studentId: string;
  totalMinor: bigint | number;
  issueDate: string;       // ISO 8601 calendar date
  description?: string;
}

export function computeTamperHash(r: ReceiptForHash, tenantSecret: string): string {
  const total = typeof r.totalMinor === "bigint" ? r.totalMinor.toString() : String(r.totalMinor);
  const payload = [r.number, r.studentId, total, r.issueDate].join("|");
  return createHash("sha256").update(`${payload}|${tenantSecret}`).digest("hex");
}

export function verificationCode(hash: string): string {
  // Last 8 hex characters of the tamper hash. Matches the "verification code"
  // printed on the PDF (10_Security.md §10).
  return hash.slice(-8).toUpperCase();
}

export function verifyTamperHash(r: ReceiptForHash, tenantSecret: string, expectedHex: string): boolean {
  return computeTamperHash(r, tenantSecret) === expectedHex;
}
