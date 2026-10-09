// Implements: AGENTS.md §7.3 ("never mock the ledger") — this wrapper does NOT
// mock anything. It is the REAL `SqliteGatewayDb` (real DDL, real triggers, real
// SQLite) wearing a `SqlHandle` that also remembers what it was asked to run.
//
// It exists because two of the four performance defects this suite pins are
// about the SHAPE OF THE QUERY, not about the value that comes back. A response
// assertion cannot tell "bounded read" from "full read with a fast client"; only
// the statement text can, and the statement text is the thing the fix changes.
//
// The recorder is passive: it delegates every call and returns the result
// unchanged, so a suite using it still exercises the production
// `buildTenantWhere` / `stmtSelectWhere` builders end to end. `no-raw-sql.test.ts`
// already proves no caller assembles SQL by hand; this proves what the audited
// builders ASSEMBLE once a caller asks for the wrong thing.
import { SqliteGatewayDb } from "./sqlite-db.ts";

export interface RecordedStatement {
  /** Whitespace-collapsed, so assertions do not depend on template padding. */
  sql: string;
  args: unknown[];
}

export class RecordingDb {
  readonly inner: SqliteGatewayDb;
  readonly statements: RecordedStatement[] = [];

  constructor(inner = new SqliteGatewayDb()) {
    this.inner = inner;
  }

  get raw() {
    return this.inner.raw;
  }

  query(sql: string, args: unknown[] = []): Record<string, unknown>[] {
    return this.inner.query(sql, args);
  }

  /** The only member `SqlHandle` requires (lib/sql.ts:24-28). */
  execute(stmt: unknown): Promise<{
    rows?: Record<string, unknown>[];
    rowsAffected?: number;
  }> {
    this.record(stmt);
    return this.inner.execute(stmt);
  }

  transaction(mode?: "write" | "read" | "deferred") {
    return this.inner.transaction(mode).then((tx) => ({
      execute: (stmt: unknown) => {
        this.record(stmt);
        return tx.execute(stmt);
      },
      commit: () => tx.commit(),
      rollback: () => tx.rollback(),
      close: () => tx.close(),
    }));
  }

  batch(
    stmts: Array<{ sql: string; args?: unknown[] }>,
    mode: "write" | "read" = "write",
  ): Promise<{ rows?: Record<string, unknown>[]; rowsAffected?: number }[]> {
    for (const s of stmts) this.record(s);
    return this.inner.batch(stmts, mode);
  }

  /** Every SELECT the route issued against `table`, whitespace-collapsed. */
  selectsFrom(table: string): string[] {
    return this.statements
      .map((s) => s.sql)
      .filter((sql) => sql.startsWith("SELECT") && sql.includes(`FROM ${table}`));
  }

  /** How many statements have been executed so far (read or write). */
  get count(): number {
    return this.statements.length;
  }

  /** Forget everything recorded so far — lets a test time one phase. */
  reset(): void {
    this.statements.length = 0;
  }

  private record(stmt: unknown): void {
    const sql = typeof stmt === "string"
      ? stmt
      : stmt && typeof stmt === "object" && "sql" in stmt
        ? String((stmt as { sql: unknown }).sql)
        : "";
    if (!sql) return;
    const args = stmt && typeof stmt === "object" && "args" in stmt
      ? (stmt as { args?: unknown }).args
      : [];
    this.statements.push({
      sql: sql.replace(/\s+/g, " ").trim(),
      args: Array.isArray(args) ? args : [],
    });
  }
}