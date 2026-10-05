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

export interface ReceiptTamperFields {
  number: string;
  studentId: string;
  amountPaise: number;
  receivedOn: string;
}

/**
 * Receipt tamper evidence — 10_Security.md §10, `receipts.tamper_hash` NOT NULL,
 * BR-FEE-05.
 *
 * The canonical form is the SAME four-field pipeline as the invoice hash, which
 * is deliberate and load-bearing: the verifier
 * `apps/web/src/lib/ledger/tamper-check.ts:22` already computes
 * `sha256(number | student_id | total | issue_date | tenant_secret)` for a
 * receipt, using the receipt's own `amount`/`received_on` in the invoice slots.
 * A different formula here would make every receipt ever written read as
 * tampered the moment a tutor opened it — so this is a contract with the
 * verifier, not a fresh choice.
 */
export function computeReceiptTamperHash(
  fields: ReceiptTamperFields,
  tenantSecret: string,
): string {
  const payload = [
    fields.number,
    fields.studentId,
    String(fields.amountPaise),
    fields.receivedOn,
  ].join("|");
  return createHash("sha256")
    .update(`${payload}|${tenantSecret}`, "utf8")
    .digest("hex");
}
