// Implements: docs/rfc/004-multi-device-network-contract.md C4
// (compare-and-swap) + 12_Business_Rules.md BR-SYN-01 (absent base =
// documented legacy last-write-wins, so old clients keep working).
//
// Shared mutable rows (settings singleton, student profile) carry
// `updated_at`. A PATCH may send the `updated_at` it read as `base_updated_at`
// (snake or camel spelling); a mismatch aborts with 409 CONFLICT + the
// safe-projected server row and NO write. Ledger/invoice/receipt POSTs are
// append-only + atomic sequences, so they need no CAS (Rule 1, BR-RC-01).
import { json } from "./errors.ts";

/**
 * Read the CAS base from a PATCH body. Returns the timestamp string, null when
 * the client sent no base (legacy last-write-wins), or "INVALID" when a base
 * was supplied in a non-string shape (typed 400, never silently ignored).
 */
export function readCasBase(body: unknown): string | null | "INVALID" {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const raw = record.base_updated_at ?? record.baseUpdatedAt;
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return "INVALID";
  return raw.length > 0 ? raw : null;
}

/**
 * Rule 9 carrier: a CAS mismatch aborts the write transaction as a typed
 * error (like `LedgerRouteError`), and the handler maps it to the 409 below.
 */
export class CasConflictError extends Error {
  readonly serverRow: unknown;
  constructor(serverRow: unknown) {
    super("CONFLICT: shared row changed on another device (RFC-004 C4)");
    this.name = "CasConflictError";
    this.serverRow = serverRow;
  }
}

/**
 * Typed 409 CONFLICT with the safe-projected `server_row` (RFC-004 C4 — the
 * client refreshes and re-applies the intent with a NEW key). Uses `json()`
 * (not `fail()`) because the contract needs the extra `server_row` field
 * alongside the leading `CONFLICT:` code the web dispatches on (RFC-003
 * G-ERR). Callers MUST pass an already safe-projected row (settings strips
 * `tenant_secret`/`pin_hash` via `toSafeSettings` — 10_Security.md §1).
 */
export function casConflictResponse(serverRow: unknown): Response {
  const res = json(
    {
      success: false,
      error:
        "CONFLICT: shared row changed on another device; refresh and retry as a new intent (RFC-004 C4)",
      server_row: serverRow ?? null,
    },
    409,
  );
  // SAFETY: `encrypt` defaults to false, so `json()` takes the synchronous
  // `new Response(...)` branch — never the encrypted Promise branch.
  return res as Response;
}
