// Implements: AGENTS.md §2 Rule 7 (every mutation writes sync_outbox in the
// same transaction) + §2 Rule 9 (no silent failures); 12_Business_Rules.md
// BR-SYN-01/02; 11_Data_Model.md §4.18 (`op IN ('insert','update','soft_delete')`).
//
// Why this file exists: the ORM shim's `$transaction` used to be
// `for (const t of tasks) results.push(await t)` over ALREADY-STARTED promises.
// Every statement had therefore auto-committed on the outer client before
// `$transaction` was entered — the "transaction" was a sequential await with no
// atomicity, so a failure between the write and its `sync_outbox` row left the
// tutor's books and the replication queue permanently out of sync. The suite
// below asserts the two properties that array form could never provide:
//
//   1. ROLLBACK: a throw inside the callback leaves NO row behind (all or
//      nothing — BR-SYN-01, 10_Security.md §18.1 for the erase cascade).
//   2. COMMIT: a resolved callback commits write + outbox + audit together.
//
// Plus the ORM-parity surface the money flow depends on: atomic `{ increment }`
// (BR-LED-03 — a sequence consumed in the database, never read-modify-written in
// JS) and `updateMany().count` (F5 — prove the row existed inside the tx).
//
// Mock-free: a real libSQL client on a real temp file, real DDL, real writes
// (AGENTS.md §7.3 — "Never Mock the Ledger").
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLibsqlProxy } from "./libsql-proxy";

const TENANT = "t_tx_1";
const OTHER_TENANT = "t_tx_2";

let dir: string;
let client: Client;

async function scalar(sql: string, args: unknown[] = []): Promise<number> {
  const res = await client.execute({ sql, args: args as never[] });
  return Number(res.rows[0]?.c ?? 0);
}

async function textOf(sql: string, args: unknown[] = []): Promise<string | null> {
  const res = await client.execute({ sql, args: args as never[] });
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const v = Object.values(row)[0];
  return v === null || v === undefined ? null : String(v);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "buddysaradhi-proxy-tx-"));
  client = createClient({ url: `file:${join(dir, "tenant.db")}` });
  await client.executeMultiple(`
    CREATE TABLE settings (
      tenant_id       TEXT PRIMARY KEY,
      institute_name  TEXT NOT NULL DEFAULT 'My Tuition',
      tenant_secret   TEXT NOT NULL,
      pin_hash        TEXT,
      next_invoice_seq INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );
    CREATE TABLE students (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      first_name    TEXT NOT NULL,
      balance_paise INTEGER NOT NULL DEFAULT 0,
      archived_at   TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE sync_outbox (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL,
      table_name  TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      op          TEXT NOT NULL CHECK(op IN ('insert','update','soft_delete')),
      payload     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      id         TEXT PRIMARY KEY,
      tenant_id  TEXT NOT NULL,
      actor      TEXT NOT NULL,
      action     TEXT NOT NULL,
      ref_type   TEXT,
      ref_id     TEXT,
      metadata   TEXT,
      created_at TEXT NOT NULL
    );
  `);
});

afterEach(async () => {
  try {
    await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  // Windows keeps the libSQL handle open for a beat after `close()`, so the
  // temp dir is removed with a short retry rather than failing the suite on
  // EPERM (same pattern as `server/actions/sql-removal.test.ts`).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

function seedStudent(id: string, tenantId = TENANT): void {
  const now = new Date().toISOString();
  client
    .execute({
      sql: `INSERT INTO students (id, tenant_id, first_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [id, tenantId, "Asha", now, now],
    })
    .catch(() => {
      throw new Error(`seed failed for ${id}`);
    });
}

async function seedStudentAsync(id: string, tenantId = TENANT): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, tenantId, "Asha", now, now],
  });
}

describe("$transaction — Rule 7 atomicity", () => {
  it("COMMIT: the write, its sync_outbox row and its audit row all land", async () => {
    const db = createLibsqlProxy(client);
    const now = new Date().toISOString();

    await db.$transaction(async (tx) => {
      await tx.student.create({
        data: { id: "s1", tenantId: TENANT, firstName: "Asha", createdAt: now, updatedAt: now },
      });
      await tx.syncOutbox.create({
        data: {
          id: "o1",
          tenantId: TENANT,
          tableName: "students",
          rowId: "s1",
          op: "insert",
          payload: "{}",
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: { id: "a1", tenantId: TENANT, actor: TENANT, action: "student.create", createdAt: now },
      });
    });

    expect(await scalar(`SELECT COUNT(*) c FROM students WHERE id = 's1'`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*) c FROM sync_outbox WHERE row_id = 's1'`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*) c FROM audit_log WHERE action = 'student.create'`)).toBe(1);
  });

  it("ROLLBACK: a failure after the write leaves NOTHING behind (all-or-nothing)", async () => {
    const db = createLibsqlProxy(client);
    const now = new Date().toISOString();

    await expect(
      db.$transaction(async (tx) => {
        await tx.student.create({
          data: { id: "s_ghost", tenantId: TENANT, firstName: "Ghost", createdAt: now, updatedAt: now },
        });
        await tx.syncOutbox.create({
          data: {
            id: "o_ghost",
            tenantId: TENANT,
            tableName: "students",
            rowId: "s_ghost",
            op: "insert",
            payload: "{}",
            createdAt: now,
          },
        });
        throw new Error("simulated failure after the write");
      }),
    ).rejects.toThrow("simulated failure after the write");

    // Neither the write nor its replication row survived: the tutor's books and
    // the outbox cannot disagree.
    expect(await scalar(`SELECT COUNT(*) c FROM students WHERE id = 's_ghost'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*) c FROM sync_outbox WHERE row_id = 's_ghost'`)).toBe(0);
  });

  it("ROLLBACK: a CHECK violation inside the transaction aborts the whole thing", async () => {
    const db = createLibsqlProxy(client);
    const now = new Date().toISOString();

    await expect(
      db.$transaction(async (tx) => {
        await tx.student.create({
          data: { id: "s2", tenantId: TENANT, firstName: "Asha", createdAt: now, updatedAt: now },
        });
        // `op` is CHECK-constrained to insert/update/soft_delete — this INSERT
        // aborts, and the student row written a moment earlier must vanish.
        await tx.syncOutbox.create({
          data: {
            id: "o2",
            tenantId: TENANT,
            tableName: "students",
            rowId: "s2",
            op: "batch_archive",
            payload: "{}",
            createdAt: now,
          },
        });
      }),
    ).rejects.toThrow();

    expect(await scalar(`SELECT COUNT(*) c FROM students WHERE id = 's2'`)).toBe(0);
  });

  it("ARRAY FORM THROWS: the removed Prisma-shaped array is rejected, not silently non-atomic", async () => {
    const db = createLibsqlProxy(client);
    const now = new Date().toISOString();
    // The exact shape the previous implementation "supported".
    const dangling = db.student.create({
      data: { id: "s3", tenantId: TENANT, firstName: "Asha", createdAt: now, updatedAt: now },
    });
    await expect(db.$transaction([dangling])).rejects.toThrow(/ORM_TX_ARRAY_FORM_REMOVED/);
  });

  it("NESTED $transaction is rejected rather than silently opening two transactions", async () => {
    const db = createLibsqlProxy(client);
    await expect(
      db.$transaction(async (tx) => {
        await tx.$transaction(async () => undefined);
      }),
    ).rejects.toThrow(/ORM_TX_UNSUPPORTED_HANDLE/);
  });

  it("the callback's return value is handed back to the caller", async () => {
    const db = createLibsqlProxy(client);
    const value = await db.$transaction(async (tx) => {
      const row = await tx.student.count({ where: { tenantId: TENANT } });
      return { row };
    });
    expect(value.row).toBe(0);
  });
});

describe("ORM parity surface the money flow needs", () => {
  it("increment is applied in the DATABASE (atomic sequence, BR-LED-03)", async () => {
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO settings (tenant_id, tenant_secret, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      args: [TENANT, "s3cret", now, now],
    });
    const db = createLibsqlProxy(client);

    await db.setting.update({
      where: { tenantId: TENANT },
      data: { nextInvoiceSeq: { increment: 1 } },
    });
    // The used number is the pre-increment value, exactly like the SQL dialect's
    // `UPDATE ... RETURNING` in packages/core/src/fees.ts.
    const afterFirst = Number(await textOf(`SELECT next_invoice_seq AS s FROM settings WHERE tenant_id = ?`, [TENANT]));
    expect(afterFirst).toBe(2);

    await db.setting.update({
      where: { tenantId: TENANT },
      data: { nextInvoiceSeq: { increment: 1 } },
    });
    expect(Number(await textOf(`SELECT next_invoice_seq AS s FROM settings WHERE tenant_id = ?`, [TENANT]))).toBe(3);
  });

  it("updateMany reports a 0-row write so callers can prove the row existed (F5)", async () => {
    await seedStudentAsync("s4");
    const db = createLibsqlProxy(client);

    const hit = await db.student.updateMany({
      where: { tenantId: TENANT, id: "s4" },
      data: { firstName: "Asha Rao" },
    });
    expect(hit.count).toBe(1);
    expect(await textOf(`SELECT first_name AS n FROM students WHERE id = 's4'`)).toBe("Asha Rao");

    const miss = await db.student.updateMany({
      where: { tenantId: TENANT, id: "does-not-exist" },
      data: { firstName: "Nobody" },
    });
    expect(miss.count).toBe(0);
  });

  it("updateMany is tenant-scoped: another tenant's row is untouched", async () => {
    await seedStudentAsync("s5", OTHER_TENANT);
    const db = createLibsqlProxy(client);

    const res = await db.student.updateMany({
      where: { tenantId: TENANT, id: "s5" },
      data: { firstName: "Hijacked" },
    });
    expect(res.count).toBe(0);
    expect(await textOf(`SELECT first_name AS n FROM students WHERE id = 's5'`)).toBe("Asha");
  });

  it("an update with nothing to assign is a loud error, not a silent no-op", async () => {
    await seedStudentAsync("s6");
    const db = createLibsqlProxy(client);
    await expect(
      db.student.update({ where: { id: "s6" }, data: { nothing: undefined } }),
    ).rejects.toThrow(/ORM_UPDATE_EMPTY/);
  });

  it("create rejects an atomic operator (Prisma parity — increment is update-only)", async () => {
    const db = createLibsqlProxy(client);
    await expect(
      db.student.create({
        data: {
          id: "s7",
          tenantId: TENANT,
          firstName: "Asha",
          balancePaise: { increment: 1 },
        },
      }),
    ).rejects.toThrow(/ORM_CREATE_ATOMIC_OP/);
  });

  it("Date values are bound as ISO strings, not as [object Object]", async () => {
    const now = new Date();
    const db = createLibsqlProxy(client);
    await db.student.create({
      data: {
        id: "s8",
        tenantId: TENANT,
        firstName: "Asha",
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(await textOf(`SELECT created_at AS t FROM students WHERE id = 's8'`)).toBe(now.toISOString());
  });

  it("a missing table raises the typed schema error, never an empty result (Rule 9)", async () => {
    const db = createLibsqlProxy(client);
    await expect(db.invoice.findMany({ where: { tenantId: TENANT } })).rejects.toThrow(
      /Schema missing at runtime/,
    );
  });
});

// Referenced so the unused-helper lint does not fire on the sync seeding form
// kept for readability of the fixtures above.
void seedStudent;
