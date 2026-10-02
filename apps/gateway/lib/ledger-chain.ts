// Implements: 12_Business_Rules.md BR-LED-06 (per-row tamper hash + chain) and
// 07_Fees_and_Payments.md §9.10 (void posts a mirrored reversing entry), using
// the CANONICAL chain algorithm from packages/core/src/ledger.ts:29-41 so the
// gateway and web/desktop write byte-identical chains (STOP-AND-ASK #2 ledger
// unification, approved). Every function here mirrors core's `computeHash`,
// `postLedgerEntry` tip read and payload serialisation exactly.
import { createHash } from "node:crypto";
import { oneRow, type SqlHandle, stmtTenantSecret, stmtChainTip } from "./sql.ts";

/** The chain head for one (tenant, student) — the only inputs a new row needs. */
export interface ChainTip {
  /** `this_hash` of the newest row; null when the chain is empty. */
  prevHash: string | null;
  /** `balance_after_paise` of the newest row; 0 when the chain is empty
   * (12_Business_Rules.md — every balance is a derived view over the ledger). */
  balanceAfterPaise: number;
}

/**
 * The exact field set and key order core hashes
 * (packages/core/src/ledger.ts:95-103). Changing the order or the members
 * breaks `reconcileLedger` on every existing tenant row — do not touch
 * without an RFC.
 */
export function ledgerEntryPayload(entry: {
  id: string;
  studentId: string;
  type: string;
  debitPaise: number;
  creditPaise: number;
  balanceAfterPaise: number;
  occurredOn: string;
}): string {
  return JSON.stringify({
    id: entry.id,
    studentId: entry.studentId,
    type: entry.type,
    debitPaise: entry.debitPaise,
    creditPaise: entry.creditPaise,
    balanceAfterPaise: entry.balanceAfterPaise,
    occurredOn: entry.occurredOn,
  });
}

/**
 * Byte-for-byte identical to core's `computeHash` (ledger.ts:29-41):
 * sha256(prevHash ‖ payload ‖ createdAt ‖ tenantSecret), with the prev hash
 * omitted from the stream for a genesis row.
 */
export function computeChainHash(
  prevHash: string | null,
  payload: string,
  createdAt: string,
  tenantSecret: string
): string {
  const hash = createHash("sha256");
  if (prevHash) hash.update(prevHash);
  hash.update(payload);
  hash.update(createdAt);
  hash.update(tenantSecret);
  return hash.digest("hex");
}

/**
 * Strictly-monotonic `created_at` (BR-LED-06 + 07_Fees_and_Payments.md §9.6).
 *
 * Mirrors `nextCreatedAtIso()` in packages/core/src/ledger.ts byte-for-byte:
 * `reconcileLedger` walks rows `ORDER BY created_at ASC` with no secondary
 * key, so two rows sharing a millisecond can be returned out of chain order
 * and fail verification. A per-process clock that never repeats or goes
 * backwards keeps the gateway and core dialects in the same order. The same
 * residual gap applies as in core: ties across isolates/processes remain
 * possible (documented, not fixed here).
 */
let lastCreatedAtIso = "";
export function nextCreatedAtIso(): string {
  const iso = new Date().toISOString();
  const next =
    lastCreatedAtIso && iso <= lastCreatedAtIso
      ? new Date(Date.parse(lastCreatedAtIso) + 1).toISOString()
      : iso;
  lastCreatedAtIso = next;
  return next;
}

/**
 * The per-tenant hash pepper (BR-LED-06 / packages/core/src/ledger.ts:88-92,
 * which throws "Tenant settings not found" the same way).
 */
export async function loadTenantSecret(
  db: SqlHandle,
  tenantId: string
): Promise<string> {
  const stmt = stmtTenantSecret(tenantId);
  const row = await oneRow(db, stmt.sql, stmt.args);
  if (!row || typeof row.tenant_secret !== "string" || row.tenant_secret.length === 0) {
    throw new Error(`Tenant settings not found for ${tenantId} (BR-LED-06)`);
  }
  return row.tenant_secret;
}

/**
 * Read the chain head for a student inside whatever handle the caller already
 * holds (a write transaction for mutations — audit 2026-09-26 G2).
 *
 * Ordering mirrors core's `orderBy: { createdAt: "desc" }`
 * (packages/core/src/ledger.ts:72) with `rowid DESC` added as the deterministic
 * tie-break for rows written in the same millisecond inside one transaction.
 */
export async function loadChainTip(
  db: SqlHandle,
  tenantId: string,
  studentId: string
): Promise<ChainTip> {
  const stmt = stmtChainTip(tenantId, studentId);
  const row = await oneRow(db, stmt.sql, stmt.args);
  if (!row) return { prevHash: null, balanceAfterPaise: 0 };
  if (typeof row.this_hash !== "string" || row.this_hash.length === 0) {
    // Rule 9: a chain head without `this_hash` is a broken chain, never a
    // silently-restarted one — failing here is the difference between
    // "diagnostics says CHAIN BROKEN" and a quietly rewritten history.
    throw new Error(
      "ledger_entries.this_hash is missing on the chain head for student " +
        `${studentId} (BR-LED-06)`
    );
  }
  return {
    prevHash: row.this_hash,
    balanceAfterPaise: Number(row.balance_after_paise ?? 0),
  };
}
