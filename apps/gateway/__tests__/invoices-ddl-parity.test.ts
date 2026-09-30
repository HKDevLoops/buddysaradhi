// Implements: 11_Data_Model.md §4.12 (canonical `invoices` DDL) and
// AGENTS.md §3.4 — the runtime schema has TWO authorities,
// `migrations/0001_init.sql` (prisma/SQLite build) and `CORE_DDL_STATEMENTS`
// in `lib/schema.ts` (the gateway's idempotent self-heal). B1 found them
// diverged: `schema.ts` still carried the retired `invoice_number`/`*_paise`
// shape while `routes/ledger.ts` already read spec columns. This test fails
// the moment the two `invoices` definitions drift apart again.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CORE_DDL_STATEMENTS } from "../lib/schema.ts";

const TABLE = "invoices";
const SPEC_COLUMNS = [
  "number",
  "student_id",
  "fee_schedule_item_id",
  "issue_date",
  "due_date",
  "subtotal",
  "discount",
  "extra_charges",
  "total",
  "status",
  "voided_at",
  "void_reason",
  "tamper_hash",
  "created_at",
  "updated_at",
];

function migrationSql(): string {
  const path = fileURLToPath(
    new URL("../../../migrations/0001_init.sql", import.meta.url),
  );
  return readFileSync(path, "utf8");
}

function coreSql(): string {
  return CORE_DDL_STATEMENTS.join("\n");
}

/** Balanced-paren slice of a `CREATE TABLE ...` statement. The DDL contains no
 * parentheses inside single-quoted literals, so a depth counter is exact. */
function extractCreateTable(sql: string, table: string): string {
  const needle = `CREATE TABLE IF NOT EXISTS ${table}`;
  const start = sql.indexOf(needle);
  if (start < 0) throw new Error(`${needle} not found`);
  const open = sql.indexOf("(", start);
  if (open < 0) throw new Error(`no column list found for ${table}`);
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return sql.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced parentheses in ${table} DDL`);
}

/** Strip comments, punctuation and layout so only the statement's content is
 * compared — `11_Data_Model.md` §4.12 is the shape, not the formatting. */
function normalize(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/[;,]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function invoicesIndexes(sql: string): string[] {
  // `[^\n;]` — never let the match run past one statement; `CORE_DDL_STATEMENTS`
  // has no trailing semicolons, so a `[^;]*` would swallow every index.
  const matches = sql.match(/CREATE INDEX IF NOT EXISTS idx_invoices_\w+[^\n;]*/gi);
  return (matches ?? []).map(normalize);
}

describe("B1 — invoices DDL parity between the two schema authorities (11 §4.12, AGENTS §3.4)", () => {
  it("CORE_DDL_STATEMENTS matches migrations/0001_init.sql byte-for-byte after normalisation", () => {
    const fromMigration = normalize(extractCreateTable(migrationSql(), TABLE));
    const fromCore = normalize(extractCreateTable(coreSql(), TABLE));
    expect(fromCore).toBe(fromMigration);
  });

  it("the shared shape is the spec §4.12 column list, not the retired *_paise shape", () => {
    const ddl = normalize(extractCreateTable(coreSql(), TABLE));
    for (const column of SPEC_COLUMNS) {
      expect(ddl).toContain(`${column} `);
    }
    expect(ddl).toContain("unique(tenant_id number)");
    // The retired shape's tell — any of these means schema.ts regressed.
    expect(ddl).not.toContain("invoice_number");
    expect(ddl).not.toContain("total_paise");
    expect(ddl).not.toContain("paid_paise");
    expect(ddl).not.toContain("period_start");
    // `tamper_hash` is NOT NULL — 10_Security.md §10 evidence, no default.
    expect(ddl).toContain("tamper_hash text not null");
  });

  it("both authorities create idx_invoices_student and idx_invoices_due", () => {
    const fromMigration = invoicesIndexes(migrationSql());
    const fromCore = invoicesIndexes(coreSql());
    expect(fromCore).toEqual(fromMigration);
    expect(fromCore).toHaveLength(2);
  });
});
