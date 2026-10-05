// Implements: RFC-003 workstream B gates — every touched mutation path has a
// test asserting outbox+audit rows exist (Rule 7); 07 §9.6/§9.10,
// 12_Business_Rules.md BR-M-01/BR-FEE-04/BR-FEE-15/BR-RC-01/BR-LED-04/05,
// 10_Security.md §3 (PIN-gated mutation) + §9, 14_Edge_Cases.md EC-F-02/EC-L-07.
//
// Boundary strategy (AGENTS §7.3 — never mock the ledger): the LEDGER path
// (`@buddysaradhi/core` + the ORM surface over a real file-backed libSQL DB) is
// REAL. Only the session seam (`getAuthenticatedDb`/`getAuthenticatedPrisma`)
// and the NETWORK (`gatewayPost`, `next/cache`) are stubbed. DDL below is test
// setup only — never runtime (AGENTS §3.4).
//
// THE PIN IS NOW VERIFIED, NOT MERELY PRESENT. This file used to assert the
// weaker contract — `voidReceiptAction` accepted any 4-8 digits, checked only
// that a PIN had been typed, and forwarded nothing. On an append-only ledger
// void is the ONLY correction path a mistaken payment has, so that made the
// correction path unauthenticated while the dialog promised "That PIN isn't
// right" — an outcome the server could not produce. Both `voidReceiptAction`
// and a backdated `recordPaymentAction` now verify against `settings.pin_hash`
// and fail closed when none is set. The cases below encode THAT contract: a real
// argon2id hash, a wrong PIN refused, an unset PIN refused, and the PIN still
// never crossing the wire.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";

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

/** Today in the tenant's local terms, matching `todayLocalIso()` in the action.
 *  The Rule 7 / EC-F-02 cases below are about attribution, not the backdate
 *  gate, so they must not be backdated. */
const TODAY_ISO = (() => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
})();

/** A date unambiguously in the past, for the BR-SEC-04 backdate gate. */
const BACKDATE_ISO = "2020-01-15";

/** The one PIN the seeded tenant accepts. Argon2id+pepper, hashed exactly as
 *  `apps/web/src/lib/crypto.ts` does, so `verifyPin` really verifies. */
const TEST_PIN = "1379";
let TEST_PIN_HASH: Promise<string>;
beforeAll(async () => {
  TEST_PIN_HASH = hashPin(TEST_PIN);
});

const TENANT = randomUUID();

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fees-actions-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, balance_paise INTEGER DEFAULT 0, updated_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, next_invoice_seq INTEGER, next_receipt_seq INTEGER DEFAULT 1, invoice_prefix TEXT, receipt_prefix TEXT DEFAULT 'RCP-', tenant_secret TEXT, pin_hash TEXT, updated_at TEXT)"
  );
  await client.execute(
    // 07 §9.6 step 4 — a receipt exists for every payment. The fixture used to
    // omit the table entirely, which meant a flow that minted receipts could not
    // be tested here at all (and one that minted none looked identical).
    "CREATE TABLE receipts (id TEXT PRIMARY KEY, tenant_id TEXT, number TEXT, ledger_entry_id TEXT, student_id TEXT, invoice_id TEXT, amount INTEGER, payment_method TEXT, payment_ref TEXT, received_on TEXT, tamper_hash TEXT, voided_at TEXT, pdf_blob_key TEXT, created_at TEXT, updated_at TEXT, UNIQUE(tenant_id, number))"
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)"
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT, payload TEXT, status TEXT DEFAULT 'pending', created_at TEXT)"
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
    sql: "INSERT INTO settings (tenant_id, next_invoice_seq, invoice_prefix, tenant_secret, pin_hash, updated_at) VALUES (?, 1, 'INV-', 'test-secret-not-for-production', ?, ?)",
    args: [TENANT, await TEST_PIN_HASH, now],
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

  it("accepts UPI without a UTR reference (optional, amended 07 §6.4) and posts", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });
    const res = await recordPaymentAction(studentId, 150000, "Tuition", TODAY_ISO, {
      method: "upi",
      reference: "",
    });
    if (!res.success) {
      throw new Error(`payment without reference failed: ${res.error}`);
    }
    expect(res.success).toBe(true);
    expect(res.data.reference).toBe("");
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
      // The REAL ORM surface over the REAL test DB: the payment now runs
      // through the ORM dialect (AGENTS.md §3.4), so the shim - not a stub -
      // is what writes the rows this file then asserts on.
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });
    const seqBefore = await readSeq(client);

    const res = await recordPaymentAction(studentId, 150000, "Tuition Fee Payment", TODAY_ISO, {
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
    // 07 §9.6 step 4/7 + BR-RC-01: the payment mints ONE receipt, numbered from
    // `next_receipt_seq`, carrying the tutor's chosen method and reference. This
    // is the assertion the sheet's promise ("your receipt number is issued the
    // moment this saves") actually rests on — before the flow grew a receipt
    // step, `recordPaymentFlow` returned no number at all and the sheet was
    // promising something the code could not deliver.
    expect(res.data.receiptNo).toMatch(/^RCP-\d{6}$/);
    const receipts = await client.execute({
      sql: `SELECT number, amount, payment_method, payment_ref, received_on, tamper_hash, ledger_entry_id
            FROM receipts WHERE tenant_id = ?`,
      args: [TENANT],
    });
    expect(receipts.rows).toHaveLength(1);
    expect(receipts.rows[0]?.number).toBe(res.data.receiptNo);
    expect(receipts.rows[0]?.amount).toBe(150000);
    expect(receipts.rows[0]?.payment_method).toBe("upi");
    expect(receipts.rows[0]?.payment_ref).toBe("AXISBK123456789");
    expect(receipts.rows[0]?.received_on).toBe(TODAY_ISO);
    // Tamper evidence is NOT NULL and must actually be a hash (10_Security.md §10).
    expect(String(receipts.rows[0]?.tamper_hash ?? "")).toMatch(/^[0-9a-f]{64}$/);
    // The receipt back-links the ledger row it was issued against.
    expect(String(receipts.rows[0]?.ledger_entry_id ?? "")).toBe(res.data.entryIds[0]);
    // The sequence was consumed, and the receipt replicated (Rule 7).
    const receiptSeq = await client.execute({
      sql: `SELECT next_receipt_seq FROM settings WHERE tenant_id = ?`,
      args: [TENANT],
    });
    expect(Number(receiptSeq.rows[0]?.next_receipt_seq)).toBe(2);
    expect(
      await client.execute({
        sql: `SELECT COUNT(*) AS n FROM sync_outbox WHERE table_name = 'receipts' AND op = 'insert'`,
      }).then((r) => Number(r.rows[0]?.n)),
    ).toBe(1);
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
      // The REAL ORM surface over the REAL test DB: the payment now runs
      // through the ORM dialect (AGENTS.md §3.4), so the shim - not a stub -
      // is what writes the rows this file then asserts on.
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 500000, "Too much", TODAY_ISO, {
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
      // The REAL ORM surface over the REAL test DB: the payment now runs
      // through the ORM dialect (AGENTS.md §3.4), so the shim - not a stub -
      // is what writes the rows this file then asserts on.
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 500000, "Advance month", TODAY_ISO, {
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

describe("voidReceiptAction — reason-required + VERIFIED PIN (07 §9.10, 10_Security.md §3)", () => {
  const entryId = randomUUID();
  const voidId = randomUUID();
  const reason = "Wrong student — should be Ananya";

  /** A tenant whose settings row carries a real argon2id `pin_hash`. */
  async function seedPinnedTenant(): Promise<void> {
    ({ client, dir } = await createTestDb());
    await seedTenant(client, randomUUID(), 0);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });
  }

  it("rejects empty reason and missing PIN without calling the gateway", async () => {
    await seedPinnedTenant();
    const noReason = await voidReceiptAction(entryId, TEST_PIN, "");
    expect(noReason.success).toBe(false);
    const noPin = await voidReceiptAction(entryId, "", reason);
    expect(noPin.success).toBe(false);
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
  });

  it("refuses a structurally invalid PIN before touching the DB", async () => {
    const res = await voidReceiptAction(entryId, "12", reason);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/at least 4 digits/);
    expect(mocks.getAuthenticatedPrisma).not.toHaveBeenCalled();
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
  });

  it("refuses a WRONG PIN of valid length — this is the case that was open", async () => {
    await seedPinnedTenant();
    const res = await voidReceiptAction(entryId, "9999", reason);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/isn't right/);
    // The whole point: a wrong PIN must not reach the ledger.
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
  });

  it("fails closed when the tenant has no PIN configured", async () => {
    ({ client, dir } = await createTestDb());
    // Seed WITHOUT calling seedTenant's pin insert.
    await client.execute({
      sql: "INSERT INTO settings (tenant_id, next_invoice_seq, invoice_prefix, tenant_secret, pin_hash, updated_at) VALUES (?, 1, 'INV-', 'test-secret-not-for-production', NULL, ?)",
      args: [TENANT, new Date().toISOString()],
    });
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });
    const res = await voidReceiptAction(entryId, TEST_PIN, reason);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/No PIN is set/);
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
  });

  it("accepts the correct PIN and forwards exactly {entryId, reason} — never the PIN", async () => {
    await seedPinnedTenant();
    mocks.gatewayPost.mockResolvedValue({
      success: true,
      data: { ok: true, voidId, newBalance: 0 },
    });
    const res = await voidReceiptAction(entryId, TEST_PIN, reason);
    expect(res.success).toBe(true);
    expect(mocks.gatewayPost).toHaveBeenCalledTimes(1);
    // SAFETY: asserting the exact forwarded shape — the test fails if it drifts.
    const [path, body] = mocks.gatewayPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/api/v1/ledger/void");
    expect(body).toEqual({ entryId, reason });
    // Verified here, never forwarded: the PIN stays on this side of the wire.
    expect("pin" in body).toBe(false);
    // Audit completeness: the void is audit-logged at the boundary too.
    expect(mocks.log.audit).toHaveBeenCalledWith(
      "fee_void_receipt_posted",
      "Void reversing entry posted",
      expect.objectContaining({ entryId, voidId })
    );
  });

  it("maps double-void to the typed BR-LED-04 conflict", async () => {
    await seedPinnedTenant();
    mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 409: entry_already_voided" });
    const res = await voidReceiptAction(entryId, TEST_PIN, "Duplicate void attempt here");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/already voided/);
  });

  it("maps void-of-void to the typed BR-LED-05 conflict", async () => {
    await seedPinnedTenant();
    mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 409: cannot_void_a_void_entry" });
    const res = await voidReceiptAction(entryId, TEST_PIN, "Void of a void attempt!");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Cannot void a void/);
  });
});

describe("recordPaymentAction — BR-SEC-04 backdate gate (10_Security.md §3)", () => {
  it("refuses a backdated payment with no PIN, writing nothing", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 150000, "July tuition", BACKDATE_ISO, {
      method: "cash",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/PIN/);
    // A month already closed must not be rewritten without a PIN.
    expect(await countRows(client, "ledger_entries")).toBe(0);
    expect(await countRows(client, "sync_outbox")).toBe(0);
  });

  it("refuses a backdated payment with a WRONG PIN", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 150000, "July tuition", BACKDATE_ISO, {
      method: "cash",
      pin: "9999",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/isn't right/);
    expect(await countRows(client, "ledger_entries")).toBe(0);
  });

  it("accepts a backdated payment with the correct PIN — the gate has an opening", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 150000, "July tuition", BACKDATE_ISO, {
      method: "cash",
      pin: TEST_PIN,
    });
    expect(res.success).toBe(true);
    expect(await countRows(client, "ledger_entries")).toBeGreaterThan(0);
    // Rule 7 still holds on the backdate path.
    expect(await countRows(client, "sync_outbox")).toBeGreaterThan(0);
    expect(await countRows(client, "audit_log")).toBeGreaterThan(0);
  });

  it("does NOT demand a PIN for a payment dated today", async () => {
    const studentId = randomUUID();
    ({ client, dir } = await createTestDb());
    await seedTenant(client, studentId, 300000);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(client),
      userId: TENANT,
      tenantId: TENANT,
    });

    const res = await recordPaymentAction(studentId, 150000, "Today's tuition", TODAY_ISO, {
      method: "cash",
    });
    expect(res.success).toBe(true);
  });
});
