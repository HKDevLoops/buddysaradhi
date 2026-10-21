// Implements: 12_Business_Rules.md BR-LED-06 (per-row tamper hash + chain) and
// 07_Fees_and_Payments.md §9.10 (void posts a mirrored reversing entry), using
// the CANONICAL chain algorithm from packages/core/src/ledger.ts:29-41 so the
// gateway and web/desktop write byte-identical chains (STOP-AND-ASK #2 ledger
// unification, approved). Every function here mirrors core's `computeHash`,
// `postLedgerEntry` tip read and payload serialisation exactly.
//
// BR-LED-06 AS AMENDED 2026-10-21: the chain of one student is a LINKED LIST
// and the LINKS ARE THE ORDER. A writer extends the chain at its tip and gives
// the new row a `created_at` strictly greater than the tip's — the per-chain
// logical clock, `nextChainCreatedAtIso()` — so the timestamp order and the
// link order are the same order and a same-millisecond tie can never arise.
// A FORK (two rows claiming the same predecessor) is an integrity violation,
// not an ordering artefact, and it is REPORTED (`verifyChainLinks`), never
// silently resolved.
//
// The gateway cannot import `packages/core/src/ledger.ts` (core uses
// extensionless relative imports and pulls in `@prisma/client`, neither of
// which the edge bundler resolves), so the chain primitives are MIRRORED here
// — byte-for-byte, with the reference named at each one. The mirror is why
// every constant below names core's function: a change to core's chain rule
// has to be made here too, and the reviewer's job is to check the two agree.
import { createHash } from "node:crypto";
import { allRows, oneRow, type SqlHandle, stmtTenantSecret, stmtChainTip, stmtChainRows } from "./sql.ts";

/** The chain head for one (tenant, student) — the only inputs a new row needs. */
export interface ChainTip {
  /** `this_hash` of the newest row; null when the chain is empty. */
  prevHash: string | null;
  /** `balance_after_paise` of the newest row; 0 when the chain is empty
   * (12_Business_Rules.md — every balance is a derived view over the ledger). */
  balanceAfterPaise: number;
  /**
   * `created_at` of the newest row; null when the chain is empty.
   *
   * The per-chain logical clock reads it (BR-LED-06): the new row's timestamp
   * must be strictly greater than the TIP's, or the timestamp order and the
   * link order would be two different orders.
   */
  createdAt: string | null;
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
 * a per-process clock that never repeats or goes backwards, so two rows
 * written by the SAME process can never share a millisecond.
 *
 * It is NOT enough on its own, and that is what the per-chain clock below is
 * for: this clock is per PROCESS, and the edge runs many isolates (and the
 * web writes to the same tenant database from another process entirely). Two
 * processes can therefore still mint the same millisecond — and a reader that
 * had to break that tie would have to invent an order, which is how three
 * writers came to break it three different ways and a reader came to report
 * "CHAIN BROKEN" on a ledger nobody had touched.
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
 * The chain's LOGICAL CLOCK (BR-LED-06, amended 2026-10-21).
 *
 * The mirror of core's `nextChainCreatedAtIso()`
 * (packages/core/src/ledger.ts) — the same rule, the same arithmetic:
 *
 *     created_at(new row) = max(wall clock, tip.created_at + 1 ms)
 *
 * WHY IT EXISTS. A student's chain is a linked list: each row's `prev_hash`
 * names its predecessor, and the ORDER is the links. But the writer's tip is
 * found by `created_at`, and two writers in two processes can mint the SAME
 * millisecond. The fix is to make the tie IMPOSSIBLE rather than to argue
 * about how to break it: a writer gives its new row a `created_at` strictly
 * greater than the tip's, so the timestamp order and the link order are the
 * same order and the tie never arises. The bump is one millisecond —
 * invisible to a human reading the ledger, decisive to a machine ordering it.
 *
 * `tipCreatedAt` is the chain tip's timestamp; null/undefined means the chain
 * is empty (the genesis row), and the wall clock is then the answer.
 */
export function nextChainCreatedAtIso(
  tipCreatedAt: string | null | undefined,
): string {
  const own = nextCreatedAtIso();
  if (tipCreatedAt === null || tipCreatedAt === undefined) return own;
  const tipMs = Date.parse(String(tipCreatedAt));
  if (Number.isNaN(tipMs)) return own;
  const ownMs = Date.parse(own);
  if (ownMs > tipMs) return own;
  return new Date(tipMs + 1).toISOString();
}

/**
 * What the link-walk found (BR-LED-06).
 *
 * The chain of one student is a linked list, and these are the three ways
 * that list can be wrong — each one an INTEGRITY VIOLATION, never an ordering
 * artefact to be quietly resolved.
 */
export interface ChainLinkReport {
  /** The row ids in LINK order, from the genesis row to the tip. */
  order: string[];
  /** The genesis row (the one with no predecessor), or null when there is none. */
  genesisId: string | null;
  /** The tip — the last row the walk reached. */
  tipId: string | null;
  /**
   * A FORK: a predecessor claimed by MORE THAN ONE row. Two rows extending
   * the same tip is not a tie to be broken — it is two histories, and picking
   * one of them silently would make the books a guess.
   */
  fork: { prevHash: string; rowIds: string[] } | null;
  /** Rows the walk could not reach from the genesis row. */
  unreachable: string[];
  /**
   * Rows whose `created_at` does not INCREASE along the walk.
   *
   * This is the timestamp/link agreement BR-LED-06 asks for: with the
   * per-chain logical clock a writer's timestamps and the links are the same
   * order, so a row that goes backwards in time is a row some writer did not
   * write with the clock (a legacy row, or a writer that is not this one).
   * The LINKS are still the order — this is reported, never acted on.
   */
  timestampTies: string[];
}

/**
 * Walk one student's chain by its LINKS (BR-LED-06).
 *
 * WHY BY THE LINKS AND NOT BY `created_at`. The chain is a linked list: each
 * row names its predecessor in `prev_hash`, so the links ARE the order. A
 * reader that orders by timestamp has to invent an order for two rows that
 * share a millisecond — and three writers invented three different ones, so a
 * reader could disagree with a writer about which row came first and report
 * "CHAIN BROKEN" on a ledger nobody had touched. The links cannot disagree:
 * they are what the writer hashed.
 *
 * WHAT IT REPORTS (and never resolves):
 *   · a FORK — two rows claiming the same predecessor;
 *   · rows that the walk cannot reach from the genesis row;
 *   · rows whose `created_at` does not increase along the walk.
 *
 * It does NOT re-implement core's hash check: `reconcileLedger`
 * (packages/core/src/ledger.ts) owns the per-row hash verification, and the
 * gateway's rows are verified by it. This walk is the STRUCTURE — which is
 * what the gateway's own writer needs in order to know it is extending the
 * right tip.
 */
export async function verifyChainLinks(
  db: SqlHandle,
  tenantId: string,
  studentId: string,
): Promise<ChainLinkReport> {
  const stmt = stmtChainRows(tenantId, studentId);
  const rows = await allRows(db, stmt.sql, stmt.args);

  // The successors of each row, and the rows that claim no predecessor.
  const successors = new Map<string, string[]>();
  const roots: string[] = [];
  const thisHashById = new Map<string, string>();
  const createdAtOf = new Map<string, string>();
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (id.length === 0) continue;
    const hash = row.this_hash;
    if (hash !== null && hash !== undefined) thisHashById.set(id, String(hash));
    const createdAt = row.created_at;
    if (typeof createdAt === "string") createdAtOf.set(id, createdAt);
    const prevHash = row.prev_hash;
    if (prevHash === null || prevHash === undefined || String(prevHash).length === 0) {
      roots.push(id);
      continue;
    }
    const key = String(prevHash);
    const list = successors.get(key);
    if (list) list.push(id);
    else successors.set(key, [id]);
  }

  const report: ChainLinkReport = {
    order: [],
    genesisId: null,
    tipId: null,
    fork: null,
    unreachable: [],
    timestampTies: [],
  };
  if (rows.length === 0) return report;

  // A chain with no genesis row is broken; a chain with SEVERAL is forked at
  // the root. Either way the walk cannot start, and the caller is told.
  if (roots.length !== 1) {
    if (roots.length > 1) {
      report.fork = { prevHash: "", rowIds: roots };
    }
    report.unreachable = rows.map((row) => String(row.id ?? ""));
    return report;
  }

  const visited = new Set<string>();
  let current: string | null = roots[0] ?? null;
  let previousCreatedAtMs: number | null = null;
  while (current !== null) {
    if (visited.has(current)) break; // a loop: the walk stops, the report says so
    visited.add(current);
    report.order.push(current);

    const createdAt = createdAtOf.get(current);
    if (createdAt !== undefined) {
      const ms = Date.parse(createdAt);
      if (!Number.isNaN(ms) && previousCreatedAtMs !== null && ms <= previousCreatedAtMs) {
        report.timestampTies.push(current);
      }
      if (!Number.isNaN(ms)) previousCreatedAtMs = ms;
    }

    // The successors of the row just walked. MORE THAN ONE is a fork.
    const rowHash: string = current === null ? "" : thisHashById.get(current) ?? "";
    const next: string[] = successors.get(rowHash) ?? [];
    if (next.length > 1) {
      report.fork = { prevHash: rowHash, rowIds: next };
      break;
    }
    current = next.length > 0 ? next[0] : null;
  }

  report.genesisId = roots[0] ?? null;
  report.tipId = report.order[report.order.length - 1] ?? null;
  for (const row of rows) {
    const id = String(row.id ?? "");
    if (id.length > 0 && !visited.has(id)) report.unreachable.push(id);
  }
  return report;
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
 * (packages/core/src/ledger.ts:72), and it is CORRECT for the same reason
 * core's is: a writer gives its new row a `created_at` strictly greater than
 * the tip's (the per-chain logical clock, `nextChainCreatedAtIso`), so the
 * timestamp order and the link order are the same order. `rowid DESC` remains
 * only as the LEGACY tie-break for rows written before that clock existed —
 * within one millisecond the later-inserted row is the later link, so it
 * names the same tip.
 */
export async function loadChainTip(
  db: SqlHandle,
  tenantId: string,
  studentId: string
): Promise<ChainTip> {
  const stmt = stmtChainTip(tenantId, studentId);
  const row = await oneRow(db, stmt.sql, stmt.args);
  if (!row) return { prevHash: null, balanceAfterPaise: 0, createdAt: null };
  if (typeof row.this_hash !== "string" || row.this_hash.length === 0) {
    // Rule 9: a chain head without `this_hash` is a broken chain, never a
    // silently-restarted one — failing here is the difference between
    // "diagnostics says CHAIN BROKEN" and a quietly rewritten history.
    throw new Error(
      "ledger_entries.this_hash is missing on the chain head for student " +
        `${studentId} (BR-LED-06)`
    );
  }
  const createdAt = row.created_at;
  return {
    prevHash: row.this_hash,
    balanceAfterPaise: Number(row.balance_after_paise ?? 0),
    createdAt: typeof createdAt === "string" && createdAt.length > 0 ? createdAt : null,
  };
}
