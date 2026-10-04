// Implements: AGENTS.md §7.3 ("never mock the ledger" — an in-memory SQLite
// running the REAL migrations) + AGENTS.md §3.4 (the gateway's own DDL,
// append-only ledger triggers included, is what the integration tests exercise)
// + Rule 9 (no silent failures — every error surfaces).
//
// The adapter satisfies `SqlHandle` (lib/sql.ts) and implements libsql's
// interactive `Transaction` contract (`commit`/`rollback`/`close`) so the
// production code path — `withWriteTransaction` → `createPrismaOrm(tx)` — runs
// unchanged against `node:sqlite`.
import { DatabaseSync } from "node:sqlite";
import { CORE_DDL_STATEMENTS } from "../lib/schema.ts";

interface Statement {
  sql: string;
  args: unknown[];
}

function normalize(stmt: unknown): Statement {
  if (typeof stmt === "string") return { sql: stmt, args: [] };
  if (stmt && typeof stmt === "object" && "sql" in stmt) {
    const candidate = stmt as { sql: unknown; args?: unknown };
    if (typeof candidate.sql !== "string") {
      throw new Error("SqliteGatewayDb: statement.sql must be a string");
    }
    const rawArgs = candidate.args;
    let args: unknown[] = [];
    if (Array.isArray(rawArgs)) args = rawArgs;
    else if (rawArgs && typeof rawArgs === "object") {
      args = Object.values(rawArgs);
    }
    // node:sqlite binds `undefined` with a hard error; the libsql client
    // accepts it as NULL, so normalise the same way here.
    return { sql: candidate.sql, args: args.map((a) => (a === undefined ? null : a)) };
  }
  throw new Error("SqliteGatewayDb: unsupported statement shape");
}

export class SqliteGatewayDb {
  readonly raw: DatabaseSync;
  /** Serialises write transactions the way a single-writer DB does. */
  private writeTail: Promise<void> = Promise.resolve();

  constructor() {
    this.raw = new DatabaseSync(":memory:");
    for (const ddl of CORE_DDL_STATEMENTS) {
      this.raw.exec(ddl);
    }
  }

  execute(stmt: unknown): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }> {
    return runStatement(this.raw, stmt);
  }

  async transaction(mode?: "write" | "read" | "deferred") {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      // BEGIN IMMEDIATE takes the write lock up front — the production client
      // does the same for a "write" transaction.
      this.raw.exec(mode === "read" ? "BEGIN" : "BEGIN IMMEDIATE");
    } catch (err) {
      release();
      throw err;
    }
    return new SqliteWriteTransaction(this.raw, release);
  }

  /**
   * libsql's `client.batch(stmts, mode)`: every statement in ONE transaction,
   * committed together or rolled back together. The secure-erase cascade
   * (routes/security.ts) depends on exactly that guarantee — "an account is
   * never half-erased" is only true if the batch is atomic.
   *
   * `BEGIN` is used rather than `BEGIN IMMEDIATE` because node:sqlite refuses a
   * nested BEGIN; the surrounding `writeTail` queue already serialises writers,
   * so the lock is taken by the first statement that needs it.
   */
  async batch(
    stmts: Array<{ sql: string; args?: unknown[] }>,
    mode: "write" | "read" = "write",
  ): Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number }[]> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.raw.exec(mode === "read" ? "BEGIN" : "BEGIN");
    try {
      const results: { rows?: Record<string, unknown>[]; rowsAffected?: number }[] = [];
      for (const stmt of stmts) {
        results.push(await runStatement(this.raw, { sql: stmt.sql, args: stmt.args ?? [] }));
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (err) {
      // All-or-nothing: a mid-batch failure must leave NOTHING deleted, which
      // is the property the route's comment claims.
      try {
        this.raw.exec("ROLLBACK");
      } catch {
        // The transaction was already aborted by SQLite; nothing to undo.
      }
      throw err;
    } finally {
      release();
    }
  }

  /** Convenience for assertions: read rows straight from the fixture DB. */
  query(sql: string, args: unknown[] = []): Record<string, unknown>[] {
    return this.raw.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
  }

  close(): void {
    this.raw.close();
  }
}

class SqliteWriteTransaction {
  private finished = false;

  constructor(
    private readonly raw: DatabaseSync,
    private readonly release: () => void,
  ) {}

  execute(stmt: unknown): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }> {
    return runStatement(this.raw, stmt);
  }

  commit(): Promise<void> {
    if (!this.finished) {
      this.raw.exec("COMMIT");
      this.finished = true;
      this.release();
    }
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    if (!this.finished) {
      this.raw.exec("ROLLBACK");
      this.finished = true;
      this.release();
    }
    return Promise.resolve();
  }

  close(): void {
    if (this.finished) return;
    // Mirrors libsql's `Transaction.close()`: an open transaction is rolled
    // back when the handle is dropped. Best-effort by design — throwing here
    // would mask the original error that led to close(), and the statement
    // that failed already propagated (Rule 9).
    try {
      this.raw.exec("ROLLBACK");
    } catch {
      // Nothing to roll back — the transaction is already closed.
    }
    this.finished = true;
    this.release();
  }
}

function runStatement(
  raw: DatabaseSync,
  stmt: unknown,
): Promise<{ rows: Record<string, unknown>[]; rowsAffected: number }> {
  const { sql, args } = normalize(stmt);
  const prepared = raw.prepare(sql);
  // Statements that return columns (SELECT / INSERT…RETURNING) use `all()`;
  // everything else (INSERT/UPDATE/DELETE/DDL) uses `run()` so `rowsAffected`
  // is the real change count.
  const columns = prepared.columns();
  if (columns.length > 0) {
    const rows = prepared.all(...(args as never[])) as Record<string, unknown>[];
    return Promise.resolve({ rows, rowsAffected: rows.length });
  }
  const info = prepared.run(...(args as never[]));
  return Promise.resolve({ rows: [], rowsAffected: Number(info.changes) });
}

export interface LedgerFixture {
  db: SqliteGatewayDb;
  tenantId: string;
  studentId: string;
  tenantSecret: string;
}

export const TEST_TENANT_SECRET = "fixture-tenant-secret-pepper";

/**
 * A fresh in-memory tenant DB (gateway DDL + triggers) with one settings row
 * and one student, ready for `handleLedger`.
 */
export function createLedgerFixture(): LedgerFixture {
  const db = new SqliteGatewayDb();
  const now = new Date().toISOString();
  const tenantId = "018f0000-0000-7000-8000-000000000001";
  const studentId = "018f0000-0000-7000-8000-000000000002";

  db.raw
    .prepare(
      `INSERT INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at)
       VALUES (?, 'Fixture Tuition', ?, ?, ?)`,
    )
    .run(tenantId, TEST_TENANT_SECRET, now, now);

  db.raw
    .prepare(
      `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key, balance_paise, created_at, updated_at)
       VALUES (?, ?, 'Aarav', '2026-01-04', 'active', 'S-001', 0, ?, ?)`,
    )
    .run(studentId, tenantId, now, now);

  return { db, tenantId, studentId, tenantSecret: TEST_TENANT_SECRET };
}
