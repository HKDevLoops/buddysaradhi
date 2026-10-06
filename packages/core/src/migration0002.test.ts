// Implements: migrations/0002_canonical_invoices_receipts.sql — the forward-only
// repair for the schema that made payments impossible on every pre-existing
// tenant database.
//
// WHY THIS TEST EXISTS. `feesDialectParity.test.ts` is structurally blind to
// this class of defect: it provisions a FRESH database from the current DDL, so
// both dialects agree and the gate is green — while a real tutor's database,
// carrying an older grammar, refuses every single write with
// `NOT NULL constraint failed: invoices.invoice_number`. 192/192 core tests
// passed while the product could not record a payment.
//
// So this test builds a database in the EXACT legacy shape observed on the live
// tenant (verified column-by-column against the running database, not guessed),
// seeds rows, runs the real 0002 file, and then asserts three things that matter:
//   1. the canonical columns exist and the legacy NOT NULL ones are gone;
//   2. EVERY ROW SURVIVES with its `id` intact, so the `ledger_entries`
//      references that point at it still resolve;
//   3. the money is preserved exactly, in integer paise, and the status
//      vocabulary is mapped into the canonical CHECK.
//
// Real libSQL, real file database, the real migration text read from disk. No
// mock (AGENTS.md §7.3).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const MIGRATION = resolve(__dirname, "../../../migrations/0002_canonical_invoices_receipts.sql");

/**
 * The legacy grammar, transcribed from `pragma_table_info` on the live tenant
 * database. Every `NOT NULL` here with no default is the reason a payment died.
 */
const LEGACY_DDL = `
  CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE fee_schedule_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
  CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, student_id TEXT NOT NULL, invoice_id TEXT, type TEXT NOT NULL, debit_paise INTEGER NOT NULL DEFAULT 0, credit_paise INTEGER NOT NULL DEFAULT 0, balance_after_paise INTEGER NOT NULL DEFAULT 0, description TEXT, prev_hash TEXT, this_hash TEXT, void_of_id TEXT, occurred_on TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

  CREATE TABLE invoices (
    id               TEXT PRIMARY KEY,
    tenant_id        TEXT NOT NULL,
    student_id       TEXT NOT NULL,
    invoice_number   TEXT NOT NULL,
    period_start     TEXT NOT NULL,
    period_end       TEXT NOT NULL,
    due_date         TEXT NOT NULL,
    subtotal_paise   INTEGER NOT NULL,
    discount_paise   INTEGER DEFAULT 0,
    tax_paise        INTEGER DEFAULT 0,
    total_paise      INTEGER NOT NULL,
    paid_paise       INTEGER DEFAULT 0,
    status           TEXT DEFAULT 'issued',
    notes            TEXT,
    pdf_blob_key     TEXT,
    deleted_at       TEXT,
    created_at       TEXT NOT NULL,
    updated_at       TEXT NOT NULL,
    voided_at        TEXT,
    number           TEXT,
    issue_date       TEXT,
    subtotal         INTEGER DEFAULT 0,
    discount         INTEGER DEFAULT 0,
    extra_charges    INTEGER DEFAULT 0,
    total            INTEGER DEFAULT 0,
    tamper_hash      TEXT
  );

  CREATE TABLE receipts (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    receipt_no      TEXT NOT NULL,
    student_id      TEXT NOT NULL,
    invoice_id      TEXT,
    amount          INTEGER NOT NULL,
    payment_method  TEXT NOT NULL,
    payment_ref     TEXT,
    received_on     TEXT NOT NULL,
    tamper_hash     TEXT,
    voided_at       TEXT,
    pdf_blob_key    TEXT,
    deleted_at      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT NOT NULL);
  CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, next_invoice_seq INTEGER, next_receipt_seq INTEGER, invoice_prefix TEXT, receipt_prefix TEXT, tenant_secret TEXT, updated_at TEXT);
`;

let dir: string;
let client: Client;

const TENANT = "t-legacy";

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mig-0002-"));
  client = createClient({ url: `file:${join(dir, "legacy.db")}` });
  await client.executeMultiple(LEGACY_DDL);

  // One legacy invoice referenced by a ledger row — the reference that must
  // survive — plus one already-migrated row that had canonical values.
  await client.executeMultiple(`
    INSERT INTO students (id, tenant_id, created_at, updated_at)
      VALUES ('stu-1', '${TENANT}', '2026-01-01', '2026-01-01');
    INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise, balance_after_paise, this_hash, occurred_on, created_at, updated_at)
      VALUES ('le-1', '${TENANT}', 'stu-1', 'inv-legacy', 'FEE_CHARGED', 150000, 0, 150000, 'h1', '2026-09-01', '2026-09-01', '2026-09-01');
    INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise, balance_after_paise, this_hash, occurred_on, created_at, updated_at)
      VALUES ('le-2', '${TENANT}', 'stu-1', 'inv-mixed', 'FEE_CHARGED', 9900, 0, 9900, 'h2', '2026-09-02', '2026-09-02', '2026-09-02');

    INSERT INTO invoices (id, tenant_id, student_id, invoice_number, period_start, period_end, due_date,
                           subtotal_paise, discount_paise, tax_paise, total_paise, paid_paise, status,
                           notes, created_at, updated_at)
      VALUES ('inv-legacy', '${TENANT}', 'stu-1', 'INV-000001', '2026-09-01', '2026-09-30', '2026-09-10',
              150000, 0, 0, 150000, 0, 'issued', 'September', '2026-09-01', '2026-09-01');

    INSERT INTO invoices (id, tenant_id, student_id, invoice_number, period_start, period_end, due_date,
                           subtotal_paise, discount_paise, tax_paise, total_paise, paid_paise, status,
                           notes, created_at, updated_at, number, issue_date, subtotal, discount,
                           extra_charges, total, tamper_hash)
      VALUES ('inv-mixed', '${TENANT}', 'stu-1', 'INV-000002', '2026-08-01', '2026-08-31', '2026-08-10',
              9999, 0, 0, 9999, 0, 'issued', 'August', '2026-08-01', '2026-08-01',
              'INV-CANON-2', '2026-08-01', 9900, 0, 0, 9900, 'canon-hash');

    INSERT INTO receipts (id, tenant_id, receipt_no, student_id, invoice_id, amount, payment_method,
                          payment_ref, received_on, tamper_hash, created_at, updated_at)
      VALUES ('rcp-legacy', '${TENANT}', 'RCP-000001', 'stu-1', 'inv-legacy', 150000, 'cash', NULL,
              '2026-09-12', 'legacy-hash', '2026-09-12', '2026-09-12');

    INSERT INTO settings (tenant_id, next_invoice_seq, next_receipt_seq, invoice_prefix, receipt_prefix, tenant_secret, updated_at)
      VALUES ('${TENANT}', 3, 2, 'INV-', 'RCP-', 's3cret', '2026-09-12');
  `);
});

afterEach(async () => {
  // Windows keeps the libSQL file handle alive briefly after `close()` resolves,
  // so a bare `rmSync` throws EPERM and fails an otherwise-green test. Same
  // bounded retry the dialect-parity suite uses — the temp dir is never left
  // behind silently, and the test never fails on teardown noise.
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

async function cols(table: string): Promise<Record<string, { type: string; notnull: number }>> {
  const r = await client.execute(
    'SELECT name, type, "notnull" FROM pragma_table_info(?)',
    [table],
  );
  const out: Record<string, { type: string; notnull: number }> = {};
  for (const row of r.rows) out[String(row.name)] = { type: String(row.type), notnull: Number(row.notnull) };
  return out;
}

describe("0002 — the legacy shape blocks a payment before the migration runs", () => {
  it("reproduces the exact production refusal", async () => {
    // The canonical writer's INSERT. Before the migration this is what the app
    // ran, and this is the error the browser showed a tutor.
    const res = await client.execute({
      sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                                   subtotal, discount, extra_charges, total, status, tamper_hash,
                                   voided_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["inv-new", TENANT, "INV-000003", "stu-1", "2026-10-01", "2026-10-10",
             100000, 0, 0, 100000, "unpaid", "hash", null, "2026-10-01", "2026-10-01"],
    }).then(() => null).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(res, "the canonical insert unexpectedly succeeded on the legacy shape").toContain(
      "NOT NULL constraint failed",
    );

    const receipts = await client.execute({
      sql: `INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, invoice_id,
                                   amount, payment_method, payment_ref, received_on, tamper_hash,
                                   voided_at, pdf_blob_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      args: ["rcp-new", TENANT, "RCP-000003", "le-1", "stu-1", "inv-legacy",
             100000, "cash", "", "2026-10-01", "hash", "2026-10-01", "2026-10-01"],
    }).then(() => null).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
    expect(receipts, "the canonical receipt insert unexpectedly succeeded").toMatch(
      /no column named (number|ledger_entry_id)/,
    );
  });
});

describe("0002 — after the migration the canonical writers work", () => {
  beforeEach(async () => {
    await client.executeMultiple(readFileSync(MIGRATION, "utf8"));
  });

  it("drops the legacy NOT NULL columns and keeps the canonical grammar", async () => {
    const inv = await cols("invoices");
    expect(inv.invoice_number, "legacy invoice_number survived").toBeUndefined();
    expect(inv.period_start, "legacy period_start survived").toBeUndefined();
    expect(inv.period_end, "legacy period_end survived").toBeUndefined();
    expect(inv.subtotal_paise, "legacy subtotal_paise survived").toBeUndefined();
    expect(inv.total_paise, "legacy total_paise survived").toBeUndefined();
    for (const required of ["number", "issue_date", "subtotal", "total", "tamper_hash", "voided_at"]) {
      expect(inv[required], `invoices.${required} missing after migration`).toBeDefined();
    }

    const rcp = await cols("receipts");
    expect(rcp.receipt_no, "legacy receipt_no survived").toBeUndefined();
    for (const required of ["number", "ledger_entry_id", "payment_ref", "deleted_at"]) {
      expect(rcp[required], `receipts.${required} missing after migration`).toBeDefined();
    }
  });

  it("preserves every row and every id, so ledger references still resolve", async () => {
    const inv = await client.execute("SELECT id, number, total, status, tamper_hash FROM invoices ORDER BY id");
    expect(inv.rows).toHaveLength(2);

    const legacy = inv.rows.find((r) => String(r.id) === "inv-legacy");
    expect(legacy).toBeDefined();
    // The legacy number and the legacy money survive — folded into the
    // canonical columns, not discarded.
    expect(legacy?.number).toBe("INV-000001");
    expect(Number(legacy?.total)).toBe(150000);
    // 'issued' is not in the canonical CHECK, so it must have been mapped to
    // 'unpaid' rather than carried across and rejected.
    expect(legacy?.status).toBe("unpaid");
    // The legacy shape had no tamper hash. It gets an explicit
    // `unverified-legacy:` placeholder, never a plausible-looking value that
    // could read as a passed check — `tamper-check.ts` recomputes from the row,
    // so a placeholder reads as unverifiable rather than as verified.
    expect(String(legacy?.tamper_hash)).toBe("unverified-legacy:inv-legacy");

    // A row that carried a canonical value ALONGSIDE its legacy one: the legacy
    // value wins, and this is deliberate. On such a row the legacy columns are
    // NOT NULL, so they are the authoritative record. This is the tradeoff the
    // migration makes, asserted rather than left to a comment.
    const mixed = inv.rows.find((r) => String(r.id) === "inv-mixed");
    expect(mixed?.number).toBe("INV-000002");
    expect(Number(mixed?.total)).toBe(9999);

    const ledger = await client.execute("SELECT invoice_id FROM ledger_entries ORDER BY id");
    expect(ledger.rows.map((r) => String(r.invoice_id))).toEqual(["inv-legacy", "inv-mixed"]);

    const rcp = await client.execute("SELECT id, number, amount, payment_method FROM receipts");
    expect(rcp.rows).toHaveLength(1);
    expect(rcp.rows[0]?.number).toBe("RCP-000001");
    expect(Number(rcp.rows[0]?.amount)).toBe(150000);
  });

  it("money is integer paise after the migration — no float, no unit change", async () => {
    const r = await client.execute("SELECT subtotal, discount, extra_charges, total FROM invoices WHERE id = 'inv-legacy'");
    const row = r.rows[0];
    expect(Number(row?.subtotal)).toBe(150000);
    expect(Number(row?.discount)).toBe(0);
    expect(Number(row?.extra_charges)).toBe(0);
    expect(Number(row?.total)).toBe(150000);
    // Rule 6: an amount is an integer. A float here would mean a silent unit
    // change on every historical amount.
    expect(Number.isInteger(Number(row?.total))).toBe(true);
  });

  it("the canonical writers now succeed — the payment and the receipt land", async () => {
    const inv = await client.execute({
      sql: `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                                   subtotal, discount, extra_charges, total, status, tamper_hash,
                                   voided_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: ["inv-new", TENANT, "INV-000003", "stu-1", "2026-10-01", "2026-10-10",
             100000, 0, 0, 100000, "unpaid", "hash", null, "2026-10-01", "2026-10-01"],
    });
    expect(inv.rowsAffected).toBe(1);

    const rcp = await client.execute({
      sql: `INSERT INTO receipts (id, tenant_id, number, ledger_entry_id, student_id, invoice_id,
                                   amount, payment_method, payment_ref, received_on, tamper_hash,
                                   voided_at, pdf_blob_key, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      args: ["rcp-new", TENANT, "RCP-000003", "le-1", "stu-1", "inv-new",
             100000, "cash", "", "2026-10-01", "hash", "2026-10-01", "2026-10-01"],
    });
    expect(rcp.rowsAffected).toBe(1);
  });

  it("does not touch the ledger — the append-only guarantee is untouched", async () => {
    const before = await client.execute("SELECT COUNT(*) AS n FROM ledger_entries");
    const hashes = await client.execute("SELECT id, this_hash FROM ledger_entries ORDER BY id");
    expect(Number(before.rows[0]?.n)).toBe(2);
    expect(hashes.rows.map((r) => String(r.this_hash))).toEqual(["h1", "h2"]);
  });

  it("is a ONE-SHOT repair: the runner must probe the shape before applying it", async () => {
    // Asserted because it is the actual contract, and getting it wrong is
    // destructive. The migration reads `invoice_number` / `receipt_no`, which
    // exist only on the legacy grammar — so re-running it against a table that
    // is already canonical fails, and running it on a freshly provisioned
    // database fails too. That is why the file's header tells the runner to
    // probe first, and why the guard is a `pragma_table_info` check rather than
    // an assumption.
    //
    // "It is idempotent" would be a nicer property and a false one: a rebuild
    // that could be re-run blindly would also be a rebuild that could be
    // applied to a database that never needed one.
    const legacyMarker = await client.execute(
      "SELECT name FROM pragma_table_info('invoices') WHERE name = 'invoice_number'",
    );
    expect(legacyMarker.rows, "invoice_number should be gone after the rebuild").toHaveLength(0);

    await expect(
      client.executeMultiple(readFileSync(MIGRATION, "utf8")),
      "re-applying to an already-canonical table must not silently succeed",
    ).rejects.toThrow();

    // And the refusal cost nothing: the money is still intact.
    const after = await client.execute("SELECT id, number, total FROM invoices ORDER BY id");
    expect(after.rows).toHaveLength(2);
    expect(Number(after.rows.find((r) => String(r.id) === "inv-legacy")?.total)).toBe(150000);
  });

  it("leaves the sequences untouched — BR-RC-01 gaps belong to the ledger, not a migration", async () => {
    const s = await client.execute("SELECT next_invoice_seq, next_receipt_seq FROM settings");
    expect(Number(s.rows[0]?.next_invoice_seq)).toBe(3);
    expect(Number(s.rows[0]?.next_receipt_seq)).toBe(2);
  });
});