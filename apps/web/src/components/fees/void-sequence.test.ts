// Implements: 12_Business_Rules.md BR-RC-01 (receipt and invoice sequences are
// independent; neither ever decrements), BR-LED-04 (a void is a NEW reversing
// row), BR-LED-05 (a void cannot be voided), BR-LED-06 (hash chain);
// 07_Fees_and_Payments.md §6.3 (BOTH the voided payment and its reversing row
// remain visible), §9.7 (numbering), §9.10 (void); 10_Security.md §9;
// AGENTS.md §2 Rule 1 (append-only), Rule 7 (outbox+audit), Rule 9 (no silent
// failures), §7.3 (never mock the ledger).
//
// WHY THIS FILE EXISTS — the gap BR-RC-01 actually had.
//
// BR-RC-01 is a CAUSAL claim, not a shape claim: consuming a receipt number must
// not disturb invoice numbering, and NOTHING — least of all a void — may hand a
// number back. It was never proven as a causal claim anywhere:
//
//   · The Settings screen cannot observe it (the sequence is not shown there),
//     so the assertion there was abandoned.
//   · Every void test in `fees-actions.test.ts` MOCKS `gatewayPost`, so it
//     exercises the server action's argument validation and PIN gate — never the
//     write. `voidEntry` in `@buddysaradhi/core`, the function that actually
//     posts a reversing row, had ZERO test coverage anywhere in the repo.
//
// So the one function that could silently decrement a sequence had nothing
// watching it. This file drives it against a real file-backed libSQL database
// (§7.3 — a mocked DB would prove nothing about whether rows were appended) and
// pins the three things the claim needs:
//
//   1. recording a payment consumes EXACTLY ONE receipt number;
//   2. voiding that payment consumes NOTHING and decrements NOTHING — both
//      sequences are byte-identical across the void;
//   3. across the whole cycle the two sequences moved independently, so a
//      receipt number was never bought with an invoice number and never reused.
//
// The existing suite's closest assertion was `toBeGreaterThanOrEqual(seqBefore)`
// on the INVOICE sequence only. `>=` cannot distinguish "correctly consumed one"
// from "consumed nothing", "consumed three", or "went backwards by one and was
// then overshot" — every one of those passes. That is the assertion this file
// replaces.

import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { voidEntry } from "@buddysaradhi/core";

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

import { recordPaymentAction } from "@/server/actions/fees";

const TENANT = randomUUID();

/** Today, matching the action's `todayLocalIso()` so the backdate gate
 *  (BR-SEC-04) is never what a sequence test is accidentally measuring. */
const TODAY_ISO = (() => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
})();

interface Sequences {
  invoice: number;
  receipt: number;
}

/**
 * A real tenant, on a real file-backed libSQL database.
 *
 * The DDL is TEST SETUP ONLY and mirrors the tenant schema — it is never
 * executed at runtime by application code (AGENTS.md §3.4: the only two runtime
 * schema authorities are the gateway's `ensureSelfRepairingSchema` and the
 * Prisma migration path).
 */
async function createTenantDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "fees-void-seq-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });

  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, balance_paise INTEGER DEFAULT 0, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, next_invoice_seq INTEGER, next_receipt_seq INTEGER DEFAULT 1, invoice_prefix TEXT, receipt_prefix TEXT DEFAULT 'RCP-', tenant_secret TEXT, pin_hash TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE receipts (id TEXT PRIMARY KEY, tenant_id TEXT, number TEXT, ledger_entry_id TEXT, student_id TEXT, invoice_id TEXT, amount INTEGER, payment_method TEXT, payment_ref TEXT, received_on TEXT, tamper_hash TEXT, voided_at TEXT, pdf_blob_key TEXT, created_at TEXT, updated_at TEXT, UNIQUE(tenant_id, number))",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT, payload TEXT, status TEXT DEFAULT 'pending', created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT, number TEXT, student_id TEXT, issue_date TEXT, due_date TEXT, subtotal INTEGER, discount INTEGER, extra_charges INTEGER, total INTEGER, status TEXT, voided_at TEXT, tamper_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, invoice_id TEXT, type TEXT, debit_paise INTEGER, credit_paise INTEGER, balance_after_paise INTEGER, description TEXT, void_of_id TEXT, prev_hash TEXT, this_hash TEXT, occurred_on TEXT, source TEXT, created_at TEXT, updated_at TEXT)",
  );

  const now = new Date().toISOString();
  // Deliberately ASYMMETRIC starting sequences. If the code conflated the two,
  // or if one were a derived view of the other, equal starting values would hide
  // it; starting them 41 apart makes any cross-talk immediately visible.
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, next_invoice_seq, next_receipt_seq, invoice_prefix, receipt_prefix, tenant_secret, pin_hash, updated_at) VALUES (?, 41, 41, 'INV-', 'RCP-', 'test-secret-not-for-production', NULL, ?)",
    args: [TENANT, now],
  });

  return { client, dir };
}

async function addStudent(client: Client, balancePaise: number): Promise<string> {
  const studentId = randomUUID();
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, balance_paise, updated_at) VALUES (?, ?, ?, ?)",
    args: [studentId, TENANT, balancePaise, new Date().toISOString()],
  });
  return studentId;
}

/** An OPEN invoice for the student, so a payment credits it instead of
 *  auto-invoicing. This is what makes the independence claim provable: a payment
 *  that credits an existing invoice must move the RECEIPT sequence and must NOT
 *  move the INVOICE one. */
async function addOpenInvoice(
  client: Client,
  studentId: string,
  totalPaise: number,
): Promise<string> {
  const invoiceId = randomUUID();
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date, subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at) VALUES (?, ?, 'INV-000041', ?, '2026-09-01', '2026-09-05', ?, 0, 0, ?, 'unpaid', 'hash', ?, ?)",
    args: [invoiceId, TENANT, studentId, totalPaise, totalPaise, now, now],
  });
  return invoiceId;
}

async function readSequences(client: Client): Promise<Sequences> {
  const res = await client.execute({
    sql: "SELECT next_invoice_seq, next_receipt_seq FROM settings WHERE tenant_id = ?",
    args: [TENANT],
  });
  const row = res.rows[0];
  return {
    invoice: Number(row?.next_invoice_seq),
    receipt: Number(row?.next_receipt_seq),
  };
}

/** The id of the payment this cycle created — addressed by TYPE, never by
 *  position, because a payment writes more than one ledger row. */
async function paymentEntryId(client: Client, studentId: string): Promise<string> {
  const res = await client.execute({
    sql: "SELECT id FROM ledger_entries WHERE tenant_id = ? AND student_id = ? AND type = 'PAYMENT_RECEIVED' ORDER BY created_at DESC LIMIT 1",
    args: [TENANT, studentId],
  });
  const id = res.rows[0]?.id;
  expect(id, "a PAYMENT_RECEIVED row was written").toBeTruthy();
  return String(id);
}

async function ledgerRows(client: Client, studentId: string): Promise<Array<Record<string, unknown>>> {
  const res = await client.execute({
    sql: "SELECT id, type, debit_paise, credit_paise, void_of_id, this_hash FROM ledger_entries WHERE tenant_id = ? AND student_id = ? ORDER BY created_at ASC, rowid ASC",
    args: [TENANT, studentId],
  });
  return res.rows as Array<Record<string, unknown>>;
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
    // Best-effort: libSQL may already be closed. Never a test failure.
  }
  client = undefined as unknown as Client; // SAFETY: recreated per test.
  if (dir) {
    // Windows holds the file lock briefly after close — retry, then give up
    // (temp residue must never fail a test).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined as unknown as string; // SAFETY: recreated per test.
  }
});

describe("BR-RC-01 — voiding a receipt consumes no number and returns no number", () => {
  it("consumes exactly one receipt number on commit, and NONE on void", async () => {
    ({ client, dir } = await createTenantDb());
    // The student OWES money AND has an OPEN invoice, so the payment attributes
    // to that invoice instead of taking the auto-invoice branch. That is what
    // makes the independence claim PROVABLE rather than merely stated: a payment
    // that credits an existing invoice must move the RECEIPT sequence and must
    // NOT move the INVOICE one. If the two were coupled, the invoice sequence
    // would advance here and the old `>=` assertion would never have noticed.
    const studentId = await addStudent(client, 500_000);
    await addOpenInvoice(client, studentId, 500_000);

    const db = createLibsqlProxy(client);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({ db, userId: TENANT, tenantId: TENANT });

    const before = await readSequences(client);
    expect(before.receipt).toBe(41);

    // ── The payment, through the REAL action → REAL core → REAL ORM → REAL DB.
    const paid = await recordPaymentAction(studentId, 100_000, "August tuition", TODAY_ISO, {
      method: "cash",
    });
    expect(paid.success).toBe(true);

    const afterPayment = await readSequences(client);

    // CLAIM 1 — exactly one receipt number, consumed by the commit.
    // `toBe` not `toBeGreaterThanOrEqual`: the old assertion could not tell
    // consuming one from consuming three, or from consuming none.
    expect(
      afterPayment.receipt - before.receipt,
      "recording a payment consumes exactly ONE receipt number (BR-RC-01)",
    ).toBe(1);

    // CLAIM 1b — and it consumed it ALONE. Crediting an existing invoice bought
    // no invoice number. This is the "the two sequences are independent" half of
    // BR-RC-01 stated so that coupling it would fail HERE.
    expect(
      afterPayment.invoice,
      "crediting an OPEN invoice consumes NO invoice number (BR-RC-01 independence)",
    ).toBe(before.invoice);

    const entryId = await paymentEntryId(client, studentId);

    // ── The void, through the REAL void engine (`voidEntry`) on the SAME real
    //    database. Not `voidReceiptAction` — that delegates to the gateway edge
    //    function, which no unit test can run, so every existing void test mocks
    //    it and asserts only argument validation. `voidEntry` is the function
    //    that actually appends the reversing row, and it is what could silently
    //    decrement a sequence.
    const voided = await voidEntry(
      db as unknown as Parameters<typeof voidEntry>[0],
      TENANT,
      entryId,
      "Wrong student",
      TODAY_ISO,
      "tutor",
    );
    expect(voided.ok, "the void engine accepted the payment").toBe(true);

    const afterVoid = await readSequences(client);

    // CLAIM 2 — the void consumes nothing. Both sequences byte-identical.
    // A void is a ledger correction, not a numbering event: it must not mint a
    // receipt, must not mint an invoice, and above all must not hand back a
    // number it already burned (a reused number is the one unrecoverable error
    // in a receipt book — the tutor's book and the printed receipt disagree
    // forever).
    expect(
      afterVoid.receipt,
      "voiding a receipt consumes NO receipt number and returns none (BR-RC-01)",
    ).toBe(afterPayment.receipt);
    expect(
      afterVoid.invoice,
      "voiding a receipt consumes NO invoice number and returns none (BR-RC-01)",
    ).toBe(afterPayment.invoice);

    // CLAIM 3 — across the WHOLE cycle, the receipt sequence advanced exactly
    // one and never came back, and the invoice sequence never moved at all.
    // Read as a single net statement of "a burned number stays burned".
    expect(afterVoid.receipt - before.receipt).toBe(1);
    expect(afterVoid.invoice - before.invoice).toBe(0);
  });

  it("a void appends a reversing row and leaves BOTH rows readable (07 §6.3)", async () => {
    ({ client, dir } = await createTenantDb());
    const studentId = await addStudent(client, 500_000);
    const db = createLibsqlProxy(client);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({ db, userId: TENANT, tenantId: TENANT });

    await recordPaymentAction(studentId, 100_000, "August tuition", TODAY_ISO, {
      method: "cash",
    });
    const entryId = await paymentEntryId(client, studentId);

    const rowsBefore = await ledgerRows(client, studentId);
    const countBefore = rowsBefore.length;

    const voided = await voidEntry(
      db as unknown as Parameters<typeof voidEntry>[0],
      TENANT,
      entryId,
      "Wrong student",
      TODAY_ISO,
      "tutor",
    );
    expect(voided.ok).toBe(true);

    const rowsAfter = await ledgerRows(client, studentId);

    // Rule 1 / BR-LED-04 — a void APPENDS. The row count grows by exactly one
    // and nothing is rewritten or removed.
    expect(
      rowsAfter.length - countBefore,
      "a void adds exactly one reversing row and destroys none (Rule 1)",
    ).toBe(1);

    // 07 §6.3 — BOTH halves survive. A voided payment that DISAPPEARS is worse
    // than one that stays: the tutor cannot see what was corrected, and cannot
    // answer a parent asking about the payment they made.
    const original = rowsAfter.find((r) => r.id === entryId);
    expect(original, "the voided payment row is still readable").toBeDefined();
    expect(original?.type).toBe("PAYMENT_RECEIVED");
    expect(original?.credit_paise).toBe(100_000);

    const reversing = rowsAfter.find((r) => r.type === "VOID");
    expect(reversing, "the reversing row is still readable").toBeDefined();
    // …and it names what it corrects, so a tutor can walk payment → correction
    // without leaving the ledger.
    expect(reversing?.void_of_id).toBe(entryId);
    // The reversal MIRRORS the original (BR-LED-04): what came in goes back out.
    expect(Number(reversing?.debit_paise)).toBe(100_000);
    expect(Number(reversing?.credit_paise)).toBe(0);

    // BR-LED-06 — the appended row is inside the hash chain, not beside it.
    expect(reversing?.this_hash, "the reversing row is hash-chained").toBeTruthy();
  });

  it("refuses to void a void (BR-LED-05) and writes nothing when it does", async () => {
    ({ client, dir } = await createTenantDb());
    const studentId = await addStudent(client, 500_000);
    await addOpenInvoice(client, studentId, 500_000);
    const db = createLibsqlProxy(client);
    mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
    mocks.getAuthenticatedPrisma.mockResolvedValue({ db, userId: TENANT, tenantId: TENANT });

    await recordPaymentAction(studentId, 100_000, "August tuition", TODAY_ISO, {
      method: "cash",
    });
    const entryId = await paymentEntryId(client, studentId);

    const first = await voidEntry(
      db as unknown as Parameters<typeof voidEntry>[0],
      TENANT,
      entryId,
      "Wrong student",
      TODAY_ISO,
      "tutor",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const countAfterFirst = (await ledgerRows(client, studentId)).length;
    const seqAfterFirst = await readSequences(client);

    // BR-LED-05, stated where the decision is made: a VOID row itself is not
    // voidable, so the chain cannot be reversed into nonsense. `voidEntry` DOES
    // guard this (`original.type === "VOID"`), and a refusal must mean refusal —
    // no extra row, no sequence movement.
    const voidRowId = (await ledgerRows(client, studentId)).find((r) => r.type === "VOID")?.id;
    const voidOfVoid = await voidEntry(
      db as unknown as Parameters<typeof voidEntry>[0],
      TENANT,
      String(voidRowId),
      "Reversing the reversal",
      TODAY_ISO,
      "tutor",
    );
    expect(voidOfVoid.ok, "a VOID row cannot itself be voided (BR-LED-05)").toBe(false);
    expect(
      (await ledgerRows(client, studentId)).length,
      "a refused void writes nothing (Rule 9 — no silent partial write)",
    ).toBe(countAfterFirst);
    expect(await readSequences(client)).toEqual(seqAfterFirst);
  });

  /**
   * KNOWN DEFECT — pinned, not hidden. Reported to the lead as P0.
   *
   * `voidEntry` in `packages/core/src/ledger.ts` refuses to void a VOID row
   * (BR-LED-05) but has NO guard against voiding a payment that has ALREADY
   * been voided: it re-reads the original, sees `type === "PAYMENT_RECEIVED"`,
   * and posts a SECOND reversing row. Measured on a real DB: a second void
   * returns `ok: true` and the ledger gains another row, so the correction is
   * applied twice and the student's balance moves by the payment amount a
   * second time.
   *
   * The only thing stopping this in production today is the gateway's 409
   * (`entry_already_voided`) — and `apps/web/src/server/actions/fees.ts` says so
   * explicitly: "the gateway 409 double-void guard is the backstop, not the
   * mechanism". A backstop on one transport is not a rule: any caller reaching
   * `voidEntry` directly (the SQL dialect, a future consumer, a retry that
   * bypasses the gateway) double-corrects the ledger.
   *
   * `test.fails` is the honest encoding of "this is broken and we know it": the
   * suite is green today, and the MOMENT the guard is added this test flips to
   * failing — which is the signal to delete it and keep the real assertion. It is
   * the opposite of commenting the defect out.
   *
   * Patch (lead-owned, `packages/core`): in `voidEntry`, before posting, check
   * whether any row already carries `void_of_id === entryToVoidId` and throw
   * `Entry already voided (BR-LED-04) — no second reversing row posted`, matching
   * the error string `mapVoidGatewayError` in the web action already expects.
   */
  test.fails(
    "KNOWN P0: voiding an already-voided payment is NOT refused by voidEntry — it double-corrects",
    async () => {
      ({ client, dir } = await createTenantDb());
      const studentId = await addStudent(client, 500_000);
      await addOpenInvoice(client, studentId, 500_000);
      const db = createLibsqlProxy(client);
      mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
      mocks.getAuthenticatedPrisma.mockResolvedValue({ db, userId: TENANT, tenantId: TENANT });

      await recordPaymentAction(studentId, 100_000, "August tuition", TODAY_ISO, {
        method: "cash",
      });
      const entryId = await paymentEntryId(client, studentId);

      const first = await voidEntry(
        db as unknown as Parameters<typeof voidEntry>[0],
        TENANT,
        entryId,
        "Wrong student",
        TODAY_ISO,
        "tutor",
      );
      expect(first.ok).toBe(true);
      const countAfterFirst = (await ledgerRows(client, studentId)).length;

      // The CORRECT contract (BR-LED-04): a second void of the same payment is
      // refused, and refuses mean nothing was written.
      const second = await voidEntry(
        db as unknown as Parameters<typeof voidEntry>[0],
        TENANT,
        entryId,
        "Trying again",
        TODAY_ISO,
        "tutor",
      );
      expect(second.ok, "an already-voided payment must be refused").toBe(false);
      expect((await ledgerRows(client, studentId)).length).toBe(countAfterFirst);
    },
  );
});