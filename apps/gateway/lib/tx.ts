// Implements: AGENTS.md §3.4 (`db.$transaction`-style atomic access on the
// gateway's libsql handle) + 12_Business_Rules.md BR-SYN-01 / audit 2026-09-26
// G2 ("5 separate awaits, no transaction"). Every ledger mutation runs its
// reads, writes, outbox and audit rows inside ONE write transaction: all of it
// commits, or none of it does.
import { logError } from "./log.ts";
import type { SqlHandle } from "./sql.ts";

/** The subset of libsql's interactive `Transaction` we rely on. `Client`
 * satisfies it structurally (`client.transaction("write")`). */
export interface WriteTransaction extends SqlHandle {
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): void;
}

export interface TransactionalDb {
  transaction(mode?: "write" | "read" | "deferred"): Promise<WriteTransaction>;
}

/**
 * Run `fn` inside a single BEGIN IMMEDIATE transaction. `BEGIN IMMEDIATE`
 * takes the write lock up front, so two concurrent payments for the same
 * student serialise instead of both reading the same chain tip (BR-LED-06 /
 * audit G2 lost-update). No retry loop is added here: SQLite BUSY fails the
 * request loudly (Rule 9) rather than silently re-running a mutation that may
 * already have committed.
 */
export async function withWriteTransaction<T>(
  db: TransactionalDb,
  fn: (tx: WriteTransaction) => Promise<T>
): Promise<T> {
  const tx = await db.transaction("write");
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch (rollbackErr) {
      // Rule 9 — a failed rollback is not swallowed: the original error is
      // what the caller sees, but the rollback failure is logged so the
      // connection state is diagnosable.
      logError("transaction.rollback_failed", {
        reason: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
  } finally {
    tx.close();
  }
}
