// Implements: 12_Business_Rules.md BR-LED-01 (append-only), BR-LED-06 (hash
// chain), BR-M-01 (integer paise), BR-SYN-01/02 (sync_outbox in the same
// transaction); AGENTS.md §2 Rules 1, 6, 7, 9 + §7.3 ("never mock the ledger"
// — REAL SQLite + the REAL `migrations/0001_init.sql`, no mocked DB, no
// mocked ledger).
//
// Harness note: the task brief asks for `:memory:`, but @libsql/client 0.14
// gives each explicit `transaction("write")` its OWN empty memory DB (and the
// commit then drops the shared handle's tables — reproduced in isolation),
// so `:memory:` cannot host any `withWriteTx` test. This file therefore uses
// a REAL temp-file SQLite DB with the verbatim migration — the same proven
// recipe as `fees.integration.test.ts` (file-backed = every connection sees
// the same tables).
//
// Direct unit coverage for the libsql dialect (`ledgerSql.ts`) that the
// fees-integration suite exercises only indirectly: validation Err paths,
// fail-closed secret handling, STUDENT_NOT_FOUND, and the `withWriteTx`
// commit/rollback contract. `postLedgerEntrySql` returns a `Result`; inside
// `withWriteTx` callers MUST re-throw Err (the `mustPost` pattern from
// `fees.ts`) or partial writes commit — these tests mirror that contract.
// The two stub-client tests at the bottom cover pure connection-plumbing
// (`withWriteTx` begin/rollback failure) that a real client cannot
// deterministically produce; every ledger-behaviour test above them runs
// against the real DB.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import {
  existsSync,
  unlinkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { createClient, type Client } from "@libsql/client";
import {
  postLedgerEntrySql,
  withWriteTx,
  requireTenantSecretTx,
  type SqlTransaction,
  type SqlWriteClient,
} from "./ledgerSql";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../");
const MIGRATION = resolve(REPO, "migrations/0001_init.sql");

const FEE_DATE = "2026-09-15";

let client: Client;
let tmpDir: string;
let TEST_DB: string;

async function seedSettings(tenantId: string, secret: string): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO settings (tenant_id, tenant_secret, created_at, updated_at)
          VALUES (?, ?, ?, ?)`,
    args: [tenantId, secret, now, now],
  });
}

async function seedStudent(tenantId: string): Promise<string> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key, created_at, updated_at)
          VALUES (?, ?, 'Test', ?, 'active', ?, ?, ?)`,
    args: [id, tenantId, FEE_DATE, `dup-${id}`, now, now],
  });
  return id;
}

type SqlArgs = Array<string | number | null>;

async function scalar(sql: string, args: SqlArgs = []): Promise<number> {
  const res = await client.execute({ sql, args });
  const row = res.rows[0];
  if (!row) throw new Error(`scalar query returned no rows: ${sql}`);
  return Number(Object.values(row)[0] ?? 0);
}

async function ledgerCount(tenantId: string): Promise<number> {
  return scalar(`SELECT COUNT(*) FROM ledger_entries WHERE tenant_id = ?`, [tenantId]);
}

/**
 * Production call pattern (`mustPost` in `fees.ts`): a `Result` returned
 * inside `withWriteTx` must re-throw on Err, otherwise partial writes
 * commit. Unwraps to the inner entry id.
 */
async function mustPostInTx(
  tenantId: string,
  studentId: string,
  debitPaise: number,
  creditPaise: number,
  type: "FEE_CHARGED" | "PAYMENT_RECEIVED" = "FEE_CHARGED",
): Promise<string> {
  const txRes = await withWriteTx(client, async (tx) => {
    const inner = await postLedgerEntrySql(tx, {
      tenantId,
      studentId,
      type,
      debitPaise,
      creditPaise,
      occurredOn: FEE_DATE,
    });
    if (!inner.ok) throw inner.error;
    return inner.value;
  });
  if (!txRes.ok) throw txRes.error;
  return txRes.value;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ledgersql-"));
  TEST_DB = join(tmpDir, "ledgersql.db").replace(/\\/g, "/");
  client = createClient({ url: `file:${TEST_DB}` });
  await client.executeMultiple(readFileSync(MIGRATION, "utf-8"));
  try {
    await client.execute({
      sql: `ALTER TABLE students ADD COLUMN balance_paise INTEGER NOT NULL DEFAULT 0`,
      args: [],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/duplicate column name/i.test(msg)) throw error;
  }
}, 90000);

afterAll(async () => {
  try {
    client?.close();
  } catch {
    // already closed
  }
  await new Promise((r) => setTimeout(r, 200));
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    const p = TEST_DB + ext;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort — libsql may release the handle late (Windows)
    }
  }
  try {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}, 30000);

describe("postLedgerEntrySql validation (BR-M-01, Rule 6 — typed Err, nothing written)", () => {
  it.each([
    ["negative debit", -100, 0],
    ["negative credit", 0, -50],
    ["both negative", -10, -10],
  ])("rejects %s without touching the DB", async (_label, debitPaise, creditPaise) => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());
    const studentId = await seedStudent(tenantId);

    // Validation fires before any SQL — no transaction wrapper needed.
    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "FEE_CHARGED",
      debitPaise,
      creditPaise,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/positive/);
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it("rejects fractional paise without touching the DB", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());
    const studentId = await seedStudent(tenantId);

    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 100.5,
      creditPaise: 0,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/integers/);
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it("rejects a zero-amount entry (debit + credit <= 0)", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());
    const studentId = await seedStudent(tenantId);

    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 0,
      creditPaise: 0,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it("rejects an unknown entry type (Rule 9 typed error)", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());
    const studentId = await seedStudent(tenantId);

    // SAFETY: intentional invalid type to hit the fail-closed branch.
    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "BOGUS_TYPE" as unknown as "FEE_CHARGED",
      debitPaise: 100,
      creditPaise: 0,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/Invalid ledger entry type/);
    expect(await ledgerCount(tenantId)).toBe(0);
  });
});

describe("postLedgerEntrySql success path (BR-LED-06 chain + Rule 7 outbox pair)", () => {
  it("chains two entries and syncs the student balance with both outbox rows", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());
    const studentId = await seedStudent(tenantId);

    await mustPostInTx(tenantId, studentId, 100000, 0, "FEE_CHARGED");
    await mustPostInTx(tenantId, studentId, 0, 40000, "PAYMENT_RECEIVED");

    const rows = (
      await client.execute({
        sql: `SELECT id, balance_after_paise, prev_hash, this_hash
              FROM ledger_entries WHERE tenant_id = ? ORDER BY created_at ASC`,
        args: [tenantId],
      })
    ).rows;
    expect(rows).toHaveLength(2);
    expect(Number(rows[0]?.balance_after_paise)).toBe(100000);
    expect(Number(rows[1]?.balance_after_paise)).toBe(60000);
    expect(rows[0]?.prev_hash).toBeNull();
    expect(rows[1]?.prev_hash).toBe(rows[0]?.this_hash);

    expect(
      await scalar(`SELECT balance_paise FROM students WHERE id = ?`, [studentId]),
    ).toBe(60000);

    // Rule 7: one outbox row for the ledger insert + one for the balance sync,
    // per entry — 4 total, all pending.
    expect(
      await scalar(
        `SELECT COUNT(*) FROM sync_outbox WHERE tenant_id = ? AND table_name = 'ledger_entries'`,
        [tenantId],
      ),
    ).toBe(2);
    expect(
      await scalar(
        `SELECT COUNT(*) FROM sync_outbox WHERE tenant_id = ? AND table_name = 'students'`,
        [tenantId],
      ),
    ).toBe(2);
  });
});

describe("postLedgerEntrySql fail-closed reads (F1/F5)", () => {
  it("returns STUDENT_NOT_FOUND for a cross-tenant student id and writes nothing", async () => {
    // The FK on `ledger_entries.student_id` fires first for a totally ghost
    // id, so the explicit STUDENT_NOT_FOUND branch (defence-in-depth for
    // FK-off DBs) is reached via a student id that EXISTS under another
    // tenant: the INSERT satisfies the FK, then the tenant-scoped balance
    // sync matches 0 rows and throws the typed error.
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await seedSettings(tenantA, randomUUID());
    await seedSettings(tenantB, randomUUID());
    const otherStudent = await seedStudent(tenantA);

    const txRes = await withWriteTx(client, async (tx) => {
      const inner = await postLedgerEntrySql(tx, {
        tenantId: tenantB,
        studentId: otherStudent,
        type: "FEE_CHARGED",
        debitPaise: 10000,
        creditPaise: 0,
        occurredOn: FEE_DATE,
      });
      if (!inner.ok) throw inner.error;
      return inner.value;
    });

    expect(txRes.ok).toBe(false);
    if (!txRes.ok) expect(txRes.error.message).toMatch(/STUDENT_NOT_FOUND/);
    expect(await ledgerCount(tenantB)).toBe(0);
    expect(await ledgerCount(tenantA)).toBe(0);
    expect(
      await scalar(`SELECT COUNT(*) FROM sync_outbox WHERE tenant_id = ?`, [tenantB]),
    ).toBe(0);
  });

  it("fails closed for a totally ghost student id (FK abort) and writes nothing", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());

    const txRes = await withWriteTx(client, async (tx) => {
      const inner = await postLedgerEntrySql(tx, {
        tenantId,
        studentId: randomUUID(),
        type: "FEE_CHARGED",
        debitPaise: 10000,
        creditPaise: 0,
        occurredOn: FEE_DATE,
      });
      if (!inner.ok) throw inner.error;
      return inner.value;
    });

    // Either the FK or the explicit guard fires — both are typed Err paths
    // and both roll back the whole transaction (F5: never a phantom row).
    expect(txRes.ok).toBe(false);
    if (!txRes.ok) expect(txRes.error.message).toMatch(/STUDENT_NOT_FOUND|FOREIGN KEY|constraint/i);
    expect(await ledgerCount(tenantId)).toBe(0);
    expect(
      await scalar(`SELECT COUNT(*) FROM sync_outbox WHERE tenant_id = ?`, [tenantId]),
    ).toBe(0);
  });

  it("returns TENANT_SETTINGS_NOT_FOUND when the tenant is unprovisioned", async () => {
    const tenantId = randomUUID();
    const studentId = await seedStudent(tenantId); // student exists, settings do not

    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 10000,
      creditPaise: 0,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/TENANT_SETTINGS_NOT_FOUND/);
    expect(await ledgerCount(tenantId)).toBe(0);
  });

  it("refuses to hash under an empty tenant secret (SECURITY_VIOLATION, F1)", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, "");
    const studentId = await seedStudent(tenantId);

    const res = await postLedgerEntrySql(client, {
      tenantId,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 10000,
      creditPaise: 0,
      occurredOn: FEE_DATE,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/SECURITY_VIOLATION/);
    expect(await ledgerCount(tenantId)).toBe(0);
  });
});

describe("requireTenantSecretTx (10_Security.md §10 fail-closed)", () => {
  it("returns the stored secret", async () => {
    const tenantId = randomUUID();
    const secret = randomUUID();
    await seedSettings(tenantId, secret);
    await expect(requireTenantSecretTx(client, tenantId)).resolves.toBe(secret);
  });

  it("throws TENANT_SETTINGS_NOT_FOUND for an unprovisioned tenant", async () => {
    await expect(requireTenantSecretTx(client, randomUUID())).rejects.toThrow(
      /TENANT_SETTINGS_NOT_FOUND/,
    );
  });
});

describe("withWriteTx plumbing (BR-SEC-03 fail-closed, Rule 9 no silent swallow)", () => {
  it("returns the callback value on commit", async () => {
    const res = await withWriteTx(client, async () => "committed");
    expect(res).toEqual({ ok: true, value: "committed" });
  });

  it("rolls back and returns the primary error when the callback throws", async () => {
    const tenantId = randomUUID();
    await seedSettings(tenantId, randomUUID());

    const res = await withWriteTx(client, async () => {
      throw new Error("business failure");
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("business failure");
    expect(
      await scalar(`SELECT COUNT(*) FROM settings WHERE tenant_id = ?`, [tenantId]),
    ).toBe(1);
  });

  it("returns Err when the write transaction cannot begin (stubbed client — plumbing only, not a ledger test)", async () => {
    // NOTE: a real client cannot deterministically fail `transaction()`, so
    // this one plumbing branch uses a stub of OUR OWN minimal SqlWriteClient
    // interface. All ledger-behaviour tests above use the real DB.
    const down: SqlWriteClient = {
      transaction: async (_mode: "write"): Promise<SqlTransaction> => {
        throw new Error("db down");
      },
    };
    const res = await withWriteTx(down, async () => "unreachable");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toBe("db down");
  });

  it("surfaces BOTH errors when the callback and the rollback fail (stubbed tx — plumbing only)", async () => {
    const brokenTx: SqlTransaction = {
      execute: async () => ({ rows: [], rowsAffected: 0 }),
      commit: async () => {},
      rollback: async () => {
        throw new Error("rollback down");
      },
    };
    const txClient: SqlWriteClient = {
      transaction: async (_mode: "write") => brokenTx,
    };
    const res = await withWriteTx(txClient, async () => {
      throw new Error("biz fail");
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.message).toMatch(/biz fail/);
      expect(res.error.message).toMatch(/rollback down/);
    }
  });
});
