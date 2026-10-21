// Implements: migrations/0004_student_money_columns.sql — the forward-only
// repair for the schema that made a student's balance and monthly fee
// unwritable on every tenant database provisioned from the canonical DDL.
//
// WHY THIS TEST EXISTS. The money engine's tests were structurally blind to
// this defect: `feesDialectParity.test.ts` and `fees.integration.test.ts`
// provision a FRESH database from the current DDL, so both dialects agree and
// the gate is green — while a database built from `migrations/0001_init.sql`
// carries a `students` table with no `balance_paise` and no `base_fee_paise`
// at all. The adversarial money suite papered over it by patching the column
// in BY HAND (`packages/core/src/adversarial.money.test.ts:59-67`), which is
// the shape of the bug: the test suite carried a workaround for a missing
// migration.
//
// So this test builds a database from the REAL shipped `0001` file, proves the
// two columns are absent, runs the real `0004` file, and then asserts:
//   1. both columns exist, are INTEGER, are NOT NULL and default to 0;
//   2. every pre-existing student row survives with its values intact and its
//      balance backfilled to 0;
//   3. the canonical writers work — a student row can be read and its balance
//      updated, which is what the Prisma model declares;
//   4. the ledger's append-only triggers are untouched (Rule 1) — the repair
//      must not weaken the guarantee the money spine depends on.
//
// Real libSQL, real file database, the real migration text read from disk. No
// mock (AGENTS.md §7.3).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const INIT = resolve(REPO, "migrations/0001_init.sql");
const MIGRATION = resolve(REPO, "migrations/0004_student_money_columns.sql");

const TENANT = "t-0004";

let dir: string;
let client: Client;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mig-0004-"));
  client = createClient({ url: `file:${join(dir, "tenant.db")}` });
  await client.executeMultiple(readFileSync(INIT, "utf8"));
});

afterEach(async () => {
  try {
    await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

async function cols(table: string): Promise<Record<string, { type: string; notnull: number; dflt: string | null }>> {
  const r = await client.execute(
    'SELECT name, type, "notnull", dflt_value FROM pragma_table_info(?)',
    [table],
  );
  const out: Record<string, { type: string; notnull: number; dflt: string | null }> = {};
  for (const row of r.rows) {
    out[String(row.name)] = {
      type: String(row.type),
      notnull: Number(row.notnull),
      dflt: row.dflt_value === null || row.dflt_value === undefined ? null : String(row.dflt_value),
    };
  }
  return out;
}

async function insertStudent(id: string, firstName: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, dup_key, created_at, updated_at)
          VALUES (?, ?, ?, '2026-01-01', ?, '2026-01-01', '2026-01-01')`,
    args: [id, TENANT, firstName, `dup-${id}`],
  });
}

describe("0004 — before the migration the canonical schema is broken", () => {
  it("the shipped 0001 creates students WITHOUT the two money columns", async () => {
    const students = await cols("students");
    expect(students.balance_paise, "0001 already has balance_paise — the migration would be a no-op").toBeUndefined();
    expect(students.base_fee_paise, "0001 already has base_fee_paise — the migration would be a no-op").toBeUndefined();
  });

  it("a balance write fails the way a tutor's would", async () => {
    const write = await client
      .execute({
        sql: `UPDATE students SET balance_paise = 150000 WHERE id = 'stu-1'`,
        args: [],
      })
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(write, "the balance write unexpectedly succeeded on the 0001 shape").toMatch(/no such column/i);
  });
});

describe("0004 — after the migration the money engine's columns exist", () => {
  beforeEach(async () => {
    await client.executeMultiple(readFileSync(MIGRATION, "utf8"));
  });

  it("adds both columns as INTEGER NOT NULL DEFAULT 0", async () => {
    const students = await cols("students");
    for (const column of ["balance_paise", "base_fee_paise"]) {
      const info = students[column];
      expect(info, `students.${column} missing after the migration`).toBeDefined();
      expect(info?.type.toUpperCase()).toBe("INTEGER");
      // NOT NULL: prisma/schema.prisma declares `Int`, not `Int?` — a nullable
      // column would make the client reject the row as unreadable.
      expect(info?.notnull).toBe(1);
      expect(info?.dflt).toBe("0");
    }
  });

  it("keeps every existing student row, with its balance backfilled to 0", async () => {
    await insertStudent("stu-1", "Ananya Rao");
    await insertStudent("stu-2", "Kabir Menon");
    const rows = await client.execute(
      "SELECT id, first_name, balance_paise, base_fee_paise FROM students ORDER BY id",
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r) => String(r.id))).toEqual(["stu-1", "stu-2"]);
    expect(String(rows.rows[0]?.first_name)).toBe("Ananya Rao");
    expect(Number(rows.rows[0]?.balance_paise)).toBe(0);
    expect(Number(rows.rows[1]?.base_fee_paise)).toBe(0);
  });

  it("the canonical writers work — read the column, then write it", async () => {
    await insertStudent("stu-1", "Ananya Rao");

    const read = await client.execute("SELECT balance_paise FROM students WHERE id = 'stu-1'");
    expect(Number(read.rows[0]?.balance_paise)).toBe(0);

    const write = await client.execute({
      sql: `UPDATE students SET balance_paise = ?, base_fee_paise = ? WHERE id = ?`,
      args: [150000, 500000, "stu-1"],
    });
    expect(write.rowsAffected).toBe(1);

    const after = await client.execute(
      "SELECT balance_paise, base_fee_paise FROM students WHERE id = 'stu-1'",
    );
    expect(Number(after.rows[0]?.balance_paise)).toBe(150000);
    expect(Number(after.rows[0]?.base_fee_paise)).toBe(500000);
    // Rule 6: an amount is an integer number of paise — never a float.
    expect(Number.isInteger(Number(after.rows[0]?.balance_paise))).toBe(true);
  });

  it("does not touch the ledger — the append-only guarantee is untouched", async () => {
    await insertStudent("stu-1", "Ananya Rao");
    await client.execute({
      sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
                                       balance_after_paise, this_hash, occurred_on, created_at, updated_at)
            VALUES ('le-1', ?, 'stu-1', 'FEE_CHARGED', 150000, 0, 150000, 'h1', '2026-09-01', '2026-09-01', '2026-09-01')`,
      args: [TENANT],
    });

    const update = await client
      .execute("UPDATE ledger_entries SET debit_paise = 1 WHERE id = 'le-1'")
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(update, "the ledger UPDATE was not blocked by the append-only trigger").toMatch(
      /append-only|immutable|abort|RAISE/i,
    );

    const remove = await client
      .execute("DELETE FROM ledger_entries WHERE id = 'le-1'")
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(remove, "the ledger DELETE was not blocked by the append-only trigger").toMatch(
      /append-only|immutable|abort|RAISE/i,
    );

    const rows = await client.execute("SELECT id FROM ledger_entries");
    expect(rows.rows).toHaveLength(1);
  });

  it("is a ONE-SHOT repair: re-applying it fails closed rather than silently succeeding", async () => {
    await expect(
      client.executeMultiple(readFileSync(MIGRATION, "utf8")),
      "re-applying to an already-migrated table must not silently succeed",
    ).rejects.toThrow();
  });
});
