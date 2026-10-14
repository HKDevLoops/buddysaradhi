// Implements: F-27 (erase audit self-consistency) + 10_Security.md §18.1 /
// BR-SEC-03. The route must commit initiated + cascade + complete in ONE
// write transaction, so initiated-without-complete is unobservable. Part A
// pins the route's shape structurally (same style as no-raw-sql.test.ts);
// Part B pins the mechanism behaviorally with the production builders on a
// real in-memory SQLite (AGENTS.md §7.3 — never mock the DB).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach } from "vitest";
import { withWriteTransaction } from "../lib/tx.ts";
import {
  eraseTables,
  run,
  stmtEraseTable,
  stmtSecurityAuditInsert,
} from "../lib/sql.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-00000000f271";
const NOW = "2026-01-01T00:00:00.000Z";

const ROUTE_SRC = readFileSync(
  fileURLToPath(new URL("../routes/security.ts", import.meta.url)),
  "utf8",
);

describe("F-27 — the erase route commits initiated+cascade+complete atomically", () => {
  it("runs the erase section inside withWriteTransaction", () => {
    // The CALL, not a comment mentioning it: the erase section must execute
    // inside the transaction. (A comment-only mention would pass a naive
    // `toContain("withWriteTransaction")` on the reverted file too.)
    expect(ROUTE_SRC).toContain("await withWriteTransaction(db");
  });

  it("no longer cascades via a standalone db.batch (a batch cannot join the tx)", () => {
    // The tx handle exposes only `execute`: the cascade must be sequential
    // audited deletes inside the transaction, not a separate batch commit.
    expect(ROUTE_SRC).not.toContain("db.batch(");
  });

  it("still records both audit rows (initiated before, complete after the cascade)", () => {
    expect(ROUTE_SRC).toContain("security.erase_initiated");
    expect(ROUTE_SRC).toContain("security.erase_complete");
    expect(ROUTE_SRC).toContain("stmtSecurityAuditInsert");
  });
});

let db: SqliteGatewayDb;

beforeEach(() => {
  db = new SqliteGatewayDb();
  db.raw
    .prepare(
      `INSERT INTO settings (tenant_id, institute_name, tenant_secret, next_invoice_seq,
                             next_receipt_seq, next_student_seq, plan, created_at, updated_at)
       VALUES (?, 'Fixture Tuition', 'fixture-tenant-secret-pepper', 7, 11, 3, 'free', ?, ?)`,
    )
    .run(TENANT, NOW, NOW);
  db.raw
    .prepare(
      `INSERT INTO students (id, tenant_id, code, first_name, admission_date, status, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, 'Test', '2026-01-01', 'active', ?, ?, ?)`,
    )
    .run("018f0000-0000-7000-8000-00000000f272", TENANT, "f27", "f27", NOW, NOW);
});

function eraseActions(): string[] {
  return db
    .query(
      "SELECT action FROM audit_log WHERE tenant_id = ? AND action LIKE 'security.erase%'",
      [TENANT],
    )
    .map((r) => String(r.action));
}

function countStudents(): number {
  return Number(
    db.query("SELECT COUNT(*) AS c FROM students WHERE tenant_id = ?", [TENANT])[0].c,
  );
}

function countSettings(): number {
  return Number(
    db.query("SELECT COUNT(*) AS c FROM settings WHERE tenant_id = ?", [TENANT])[0].c,
  );
}

/**
 * The route's exact commit shape: initiated insert + per-table audited deletes
 * + complete insert inside one `withWriteTransaction`, using the production
 * builders. `injectFailure` simulates a crash mid-cascade.
 */
async function runEraseSequence(injectFailure: boolean): Promise<void> {
  const tables = [...eraseTables()];
  await withWriteTransaction(db, async (tx) => {
    const initiatedStmt = stmtSecurityAuditInsert(
      TENANT,
      "security.erase_initiated",
      JSON.stringify({ confirm: "ERASE", pinConfigured: true }),
      NOW,
    );
    await run(tx, initiatedStmt.sql, initiatedStmt.args);
    let done = 0;
    for (const table of tables) {
      const stmt = stmtEraseTable(table as never, TENANT);
      await run(tx, stmt.sql, stmt.args);
      done += 1;
      if (injectFailure && done === 2) {
        throw new Error("injected mid-cascade failure");
      }
    }
    const completeStmt = stmtSecurityAuditInsert(
      TENANT,
      "security.erase_complete",
      JSON.stringify({ tables }),
      NOW,
    );
    await run(tx, completeStmt.sql, completeStmt.args);
  });
}

describe("F-27 — single-transaction erase semantics on real SQLite", () => {
  it("success commits the wipe with erase_complete and no orphan initiated", async () => {
    await runEraseSequence(false);
    expect(countStudents()).toBe(0);
    // The cascade wipes audit_log itself, so initiated never survives; only
    // the complete row committed in the same tx remains.
    expect(eraseActions()).toEqual(["security.erase_complete"]);
  });

  it("a mid-cascade failure leaves NEITHER audit row AND destroys nothing", async () => {
    await expect(runEraseSequence(true)).rejects.toThrow("injected mid-cascade failure");
    // Rule 9: the failure is loud (it propagated), and the rollback took the
    // initiated row with it — initiated-without-complete is unobservable.
    expect(eraseActions()).toEqual([]);
    expect(countStudents()).toBe(1);
    expect(countSettings()).toBe(1);
  });
});
