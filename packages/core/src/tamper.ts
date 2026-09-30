// Implements: 10_Security.md §10 (invoice/receipt tamper evidence keyed by
// `tenant_secret`), 11_Data_Model.md §4.12 (`invoices.tamper_hash` NOT NULL),
// 12_Business_Rules.md BR-FEE-05.
//
// Extracted from `fees.ts` so the SECOND writer — `apps/gateway/routes/
// ledger.ts`'s invoice-create path — computes the identical bytes instead of
// duplicating the formula (writer and verifier `apps/web/src/lib/ledger/
// tamper-check.ts:22` must agree byte-for-byte or every invoice reads as
// tampered). Dependency-free on purpose: Deno (`@apps/gateway`), Node and the
// vitest suites all import this one module.
import { createHash } from "node:crypto";

export interface InvoiceTamperFields {
  number: string;
  studentId: string;
  totalPaise: number;
  issueDate: string;
}

/**
 * Canonical formula `sha256(number | student_id | total | issue_date |
 * tenant_secret)` — the exact mirror of `computeTamperHash` in
 * `apps/web/src/lib/ledger/tamper-check.ts:22` (the verifier).
 */
export function computeInvoiceTamperHash(
  fields: InvoiceTamperFields,
  tenantSecret: string,
): string {
  const payload = [
    fields.number,
    fields.studentId,
    String(fields.totalPaise),
    fields.issueDate,
  ].join("|");
  return createHash("sha256")
    .update(`${payload}|${tenantSecret}`, "utf8")
    .digest("hex");
}
