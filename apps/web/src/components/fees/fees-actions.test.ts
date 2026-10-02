// Implements: RFC-003 workstream B gates — every touched mutation path has a
// test asserting outbox+audit rows exist (Rule 7); 07 §9.6/§9.10,
// 12_Business_Rules.md BR-M-01/BR-FEE-04/BR-FEE-15/BR-RC-01/BR-LED-04/05,
// 10_Security.md §9, 14_Edge_Cases.md EC-F-02/EC-L-07.
//
// Boundary strategy (AGENTS §7.3 — never mock the ledger): the LEDGER path
// (`@buddysaradhi/core` + a real file-backed libSQL DB) is REAL. Only the
// session seam (`getAuthenticatedDb`/`getAuthenticatedPrisma`) and the
// NETWORK (`gatewayPost`, `next/cache`) are stubbed. DDL below is test setup
// only — never runtime (AGENTS §3.4).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const mocks = vi.hoisted(() => ({
  getAuthenticatedDb: vi.fn(),
  getAuthenticatedPrisma: vi.fn(),
  gatewayPost: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", () => ({
  getAuthenticatedDb: mocks.getAuthenticatedDb,
  getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
  gatewayPost: mocks.gatewayPost,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import {
  recordPaymentAction,
  voidReceiptAction,
} from "@/server/actions/fees";

const TENANT = randomUUID();

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fees-actions-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, balance_paise INTEGER DEFAULT 0, updated_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, next_invoice_seq INTEGER, invoice_prefix TEXT, tenant_secret TEXT, updated_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT, payload TEXT, created_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT, number TEXT, student_id TEXT, issue_date TEXT, due_date TEXT, subtotal INTEGER, discount INTEGER, extra_charges INTEGER, total INTEGER, status TEXT, voided_at TEXT, tamper_hash TEXT, created_at TEXT, updated_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, invoice_id TEXT, type TEXT, debit_paise INTEGER, credit_paise INTEGER, balance_after_paise INTEGER, description TEXT, void_of_id TEXT, prev_hash TEXT, this_hash TEXT, occurred_on TEXT, source TEXT, created_at TEXT, updated_at TEXT)"
  );
  return { client, dir };
}

async function seedTenant(client: Client, studentId: string, balancePaise: number): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, next_invoice_seq, invoice_prefix, tenant_secret, updated_at) VALUES (?, 1, 'INV-', 'test-secret-not-for-production', ?)",
    args: [TENANT, now],
  });
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, balance_paise, updated_at) VALUES (?, ?, ?, ?)",
    args: [studentId, TENANT, balancePaise, now],
  });
}

async function seedInvoice(
  client: Client,
  invoiceId: string,
  studentId: string,
  totalPaise: number
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date, subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at) VALUES (?, ?, 'INV-000001', ?, '2026-09-01', '2026-09-05', ?, 0, 0, ?, 'unpaid', 'hash', ?, ?)",
    args: [invoiceId, TENANT, studentId, totalPaise, totalPaise, now, now],
  });
}

async function countRows(client: Client, table: string): Promise<number> {
  const res = await client.execute(`SELECT COUNT(*) AS c FROM ${table}`);
  return Number(res.rows[0]?.c ?? 0);
}

async function readSeq(client: Client): Promise<number> {
  const res = await client.execute({
    sql: "SELECT next_invoice_seq AS s FROM settings WHERE tenant_id = ?",
    args: [TENANT],
  });
  return Number(res.rows[0]?.s ?? 0);
}

let client: Client;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  try {
    if (client) await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated in each DB test.
  if (dir) {
    // Windows holds the file lock briefly after close — retry, then give up
    // (temp residue, never test failure).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined as unknown as string; // SAFETY: reset between tests; recreated in each DB test.
  }
});

describe("recordPaymentAction — method-enum rejects (07 §7)", () => {
  it("rejects a non-enum method before any DB touch", async () => {
    const studentId = randomUUID();
    // SAFETY: intentionally invalid — the boundary must reject it.
    const res = await recordPaymentAction(studentId, 150000, "Tuition", "2026-10-02", {
      method: "bitcoin" as unknown as "cash",
    });
    expect(res.success).toBe(false);
    expect(mocks.getAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("rejects UPI without a UTR reference", async () => {
    const res = await recordPaymentAction(randomUUID(), 150000, "Tuition", "2026-10-02", {
      method: "upi",
      reference: "",
    });
    expect(res.success).toBe(false);
    expect(mocks.getAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("rejects float paise and bad dates", async () => {
    const sid = randomUUID();
    expect((await recordPaymentAction(sid, 1500.5, "T", "2026-10-02")).success).toBe(false);
    expect((await recordPaymentAction(sid, 150000, "T", "02/10/2026")).success).toBe(false);
  });
});

describe("recordPaymentAction — Rule 7 outbox+audit (real core, real DB)", () => {
  it("posts ledger + outbox + audit in one flow and echoes the method", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: { student: { findUnique: async () => ({ balancePaise: 300000 }) } },
      userId: TENANT,
      tenantId: TENANT,
    });
    const seqBefore = await readSeq(client);

    const res = await recordPaymentAction(studentId, 150000, "Tuition Fee Payment", "2026-10-02", {
      method: "upi",
      reference: "AXISBK123456789",
    });

    if (!res.success) {
      throw new Error(`payment failed: ${res.error}`);
    }
    expect(res.success).toBe(true);
    // Pass-through: the posted payload is exactly what was previewed.
    expect(res.data.method).toBe("upi");
    expect(res.data.reference).toBe("AXISBK123456789");
    expect(res.data.creditedPaise).toBe(150000);
    // Rule 7: every mutation path leaves outbox + audit rows.
    expect(await countRows(client, "ledger_entries")).toBeGreaterThan(0);
    expect(await countRows(client, "sync_outbox")).toBeGreaterThan(0);
    expect(await countRows(client, "audit_log")).toBeGreaterThan(0);
    // BR-RC-01: the sequence never decrements (auto-invoice consumes one).
    expect(await readSeq(client)).toBeGreaterThanOrEqual(seqBefore);
  });

  it("blocks unacknowledged overpayment without writing anything", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: { student: { findUnique: async () => ({ balancePaise: 300000 }) } },
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 500000, "Too much", "2026-10-02", {
      method: "cash",
    });

    expect(res.success).toBe(false);
    expect(await countRows(client, "ledger_entries")).toBe(0);
    expect(await countRows(client, "sync_outbox")).toBe(0);
    expect(await countRows(client, "audit_log")).toBe(0);
  });

  it("splits acknowledged overpayment per EC-F-02 (exact + auto-invoice remainder)", async () => {
    const studentId = randomUUID();
    const invoiceId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    await seedInvoice(client, invoiceId, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: { student: { findUnique: async () => ({ balancePaise: 300000 }) } },
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 500000, "Advance month", "2026-10-02", {
      method: "cash",
      advanceAcknowledged: true,
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    // Every paise attributed somewhere (core invariant), surplus auto-invoiced.
    expect(res.data.creditedPaise).toBe(500000);
    expect(res.data.autoInvoiceNumber).not.toBeNull();
    const first = res.data.applied[0];
    expect(first?.paise).toBe(300000);
    expect(first?.status).toBe("paid");
    // Rule 7 on the overpayment path too.
    expect(await countRows(client, "sync_outbox")).toBeGreaterThan(0);
    expect(await countRows(client, "audit_log")).toBeGreaterThan(0);
  });
});

describe("voidReceiptAction — reason-required + PIN presence (07 §9.10)", () => {
  const entryId = randomUUID();
  const voidId = randomUUID();

  it("rejects empty reason and missing PIN without calling the gateway", async () => {
    const noReason = await voidReceiptAction(entryId, "123456", "");
    expect(noReason.success).toBe(false);
    const noPin = await voidReceiptAction(entryId, "", "Wrong student — should be Ananya");
    expect(noPin.success).toBe(false);
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
  });

  it("forwards exactly {entryId, reason} — never the PIN", async () => {
    mocks.gatewayPost.mockResolvedValue({
      success: true,
      data: { ok: true, voidId, newBalance: 0 },
    });
    const res = await voidReceiptAction(entryId, "123456", "Wrong student — should be Ananya");
    expect(res.success).toBe(true);
    expect(mocks.gatewayPost).toHaveBeenCalledTimes(1);
    // SAFETY: asserting the exact forwarded shape — the test fails if it drifts.
    const [path, body] = mocks.gatewayPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/api/v1/ledger/void");
    expect(body).toEqual({ entryId, reason: "Wrong student — should be Ananya" });
    expect("pin" in body).toBe(false);
    // Audit completeness: the void is audit-logged at the boundary too.
    expect(mocks.log.audit).toHaveBeenCalledWith(
      "fee_void_receipt_posted",
      "Void reversing entry posted",
      expect.objectContaining({ entryId, voidId })
    );
  });

  it("maps double-void to the typed BR-LED-04 conflict", async () => {
    mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 409: entry_already_voided" });
    const res = await voidReceiptAction(entryId, "123456", "Duplicate void attempt here");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/already voided/);
  });

  it("maps void-of-void to the typed BR-LED-05 conflict", async () => {
    mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 409: cannot_void_a_void_entry" });
    const res = await voidReceiptAction(entryId, "123456", "Void of a void attempt!");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Cannot void a void/);
  });
});
