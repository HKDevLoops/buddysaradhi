// The reversal lookup must not blow the SQLite variable ceiling.
//
// The AUD-001 fix excludes a credit by looking for a VOID row that points back
// at it, and the ORM surface has no subquery - so it issued
// `WHERE void_of_id IN (<every credit id>)`. SQLite's variable ceiling is
// 32,766 on the shipped libsql build (MEASURED below), and exceeding it is a
// HARD error, not a truncation - so one invoice with enough micro-payments
// took the whole payment path down with a 500.
//
// The fixture is deliberately one credit MORE than the ceiling, so the
// unchunked statement is not merely slow, it is IMPOSSIBLE. That is the
// negative control: remove the chunking and this test fails with SQLite's own
// error rather than with an assertion about shape.
//
// Real file-backed SQLite, the shipped migration's schema, the real writers.
// Nothing is mocked (AGENTS.md 7.3).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient, type Client } from "@libsql/client";
import { ormFeeTx, MAX_SQL_VARIABLES_PER_STATEMENT } from "./feesPrisma";
import { createLibsqlProxy } from "../../../apps/web/src/lib/libsql-proxy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../");
const MIGRATION = resolve(REPO, "migrations/0001_init.sql");

const TENANT = "tenant_chunk";
const NOW = "2026-01-01T00:00:00.000Z";

/**
 * The ceiling of the SQLite build this product ships on. MEASURED on this
 * machine with a binary search over `SELECT ... IN (?,?,...)`: 32,766 binds
 * work, 32,767 fail with "too many SQL variables".
 */
const MEASURED_SQLITE_MAX_VARIABLES = 32_766;

let client: Client;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "chunk-money-"));
  client = createClient({ url: `file:${join(dir, "t.db")}` });
  const ddl = readFileSync(MIGRATION, "utf8");
  for (const stmt of ddl.split(";")) {
    const s = stmt.trim();
    if (s.length === 0) continue;
    try {
      await client.execute(s);
    } catch {
      // a statement this libsql build does not accept is not what this test is about
    }
  }
  await client.execute(
    `INSERT INTO settings (tenant_id, institute_name, tenant_secret, next_invoice_seq,
       next_receipt_seq, next_student_seq, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [TENANT, "T", "secret-pepper", 1, 1, 1, NOW, NOW],
  );
  await client.execute(
    `INSERT INTO students (id, tenant_id, code, first_name, admission_date, status, dup_key,
       created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    ["stu-1", TENANT, "S-1", "Aarav", "2026-01-01", "active", "S-1", NOW, NOW],
  );
  await client.execute(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, subtotal, discount,
       extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?,?,?,?,?,?,0,0,?,?,?,?,?)`,
    ["inv-1", TENANT, "INV-000001", "stu-1", "2026-01-01", 1000, 1000, "unpaid", "seed-hash", NOW, NOW],
  );
});

afterEach(async () => {
  try {
    await client.close();
  } catch {
    // best effort
  }
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

/**
 * Insert `count` credit rows on the invoice, in batched multi-row INSERTs
 * (one statement per batch, so the fixture itself never hits the ceiling).
 */
async function addCredits(count: number): Promise<void> {
  const BATCH = 500;
  for (let start = 0; start < count; start += BATCH) {
    const n = Math.min(BATCH, count - start);
    const placeholders = Array.from({ length: n }, () => "(?,?,?,?,'PAYMENT_RECEIVED',0,100,0,'c','seed-hash','2026-01-02','manual',?,?)").join(",");
    const args: unknown[] = [];
    for (let i = 0; i < n; i++) {
      const id = `c-${start + i}`;
      args.push(id, TENANT, "stu-1", "inv-1", NOW, NOW);
    }
    await client.execute(
      `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise,
         credit_paise, balance_after_paise, description, this_hash, occurred_on, source, created_at, updated_at)
       VALUES ${placeholders}`,
      args as never[],
    );
  }
}

/** The VOID row that reverses a credit (production shape: void_of_id only). */
async function addVoid(id: string, reverses: string): Promise<void> {
  await client.execute(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, type, debit_paise, credit_paise,
       balance_after_paise, description, this_hash, void_of_id, occurred_on, source, created_at, updated_at)
     VALUES (?,?,?,'VOID',100,0,0,'VOID','seed-hash',?,'2026-01-03','manual',?,?)`,
    [id, TENANT, "stu-1", reverses, NOW, NOW],
  );
}

describe("the reversal lookup stays inside SQLite's variable ceiling", () => {
  it("resolves the credited amount for an invoice with MORE credits than one statement can bind", async () => {
    const tx = ormFeeTx(createLibsqlProxy(client) as never);

    // ONE more credit than the ceiling can bind in a single statement.
    const total = MEASURED_SQLITE_MAX_VARIABLES + 1;
    await addCredits(total);
    // Void the first 50 — they must not count.
    for (let i = 0; i < 50; i++) {
      await addVoid(`v-${i}`, `c-${i}`);
    }

    const credited = await tx.creditedForInvoice(TENANT, "inv-1");
    expect(credited).toBe((total - 50) * 100);
  }, 180_000);

  it("the chunk size stays inside the OLDEST SQLite ceiling (999 variables)", () => {
    // 999 is SQLite's pre-3.32 default; a chunk above it would fail there.
    expect(MAX_SQL_VARIABLES_PER_STATEMENT).toBeLessThanOrEqual(999);
  });

  it("a single credit and a single void resolve correctly (no chunk needed)", async () => {
    const tx = ormFeeTx(createLibsqlProxy(client) as never);
    await addCredits(1);
    expect(await tx.creditedForInvoice(TENANT, "inv-1")).toBe(100);
    await addVoid("v-1", "c-0");
    expect(await tx.creditedForInvoice(TENANT, "inv-1")).toBe(0);
  });
});
