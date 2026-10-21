// Implements: 12_Business_Rules.md BR-CALC-10 ("Collected for a period =
// Σ(credit_paise where type='PAYMENT_RECEIVED') − Σ(debit_paise where
// type='REFUND_ISSUED') over the period's date range. **Voided entries
// excluded.**") and BR-RPT-04 [CRITICAL] ("balance_due = Σ(charges,
// type≠VOID, reverses IS NULL) − Σ(credits, type≠VOID, reverses IS NULL)").
//
// THE DEFECT (audit AUD-013). The Dashboard's "Collected This Month" summed
// every `PAYMENT_RECEIVED` row in the window. A row whose receipt was VOIDED
// still satisfies `type = 'PAYMENT_RECEIVED'` and still carries
// `void_of_id = NULL` — because the VOID row is the later row that points BACK
// at it. So a voided payment counted as cash in, and a refund never came out.
// The two headline money tiles disagreed with each other and with the ledger.
//
// Runs the REAL `handleAnalytics` and the REAL `createPrismaOrm` against
// in-memory SQLite carrying the gateway's own DDL (AGENTS.md §7.3 — never mock
// the DB). Every expected value is a worked-example literal, never recomputed
// with the same expression the code under test uses.
//
// DATES MATTER: `collectedThisMonthMinor` is the CURRENT calendar month, so
// every payment here is dated inside October 2026 (today = 2026-10-04). The
// invoice is dated September so it is genuinely overdue.
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { handleAnalytics } from "../routes/analytics.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000e1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000e2";

// "Today" for every test in this file.
const NOW_ISO = "2026-10-04T09:00:00.000Z";

const STUDENT = "018f0000-0000-7000-8000-00000000c001";
const INVOICE = "018f0000-0000-7000-8000-00000000c101";
const PAYMENT = "018f0000-0000-7000-8000-00000000c201";
const SECOND_PAYMENT = "018f0000-0000-7000-8000-00000000c204";
const VOID_ROW = "018f0000-0000-7000-8000-00000000c202";
const REFUND = "018f0000-0000-7000-8000-00000000c203";

const NOW = "2026-10-04T00:00:00.000Z";

interface Kpis {
  collectedThisMonthMinor: number;
  dueTillDateMinor: number;
  overdueMinor: number;
  dueInPeriodMinor: number;
}

interface DashboardPayload {
  kpis: Kpis;
}

let db: SqliteGatewayDb;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW_ISO));
  db = new SqliteGatewayDb();
  seed(db);
  invalidateTenant(TENANT);
  invalidateTenant(OTHER_TENANT);
});

afterAll(() => {
  vi.useRealTimers();
});

/**
 * One student, one open invoice of 100000 paise due 2026-09-01 (so it is
 * overdue on 2026-10-04), and one payment of 100000 received 2026-10-02 —
 * inside the collected-this-month window.
 */
function seed(f: SqliteGatewayDb): void {
  const now = NOW;
  f.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, archived_at,
                           balance_paise, admission_date, fee_model, base_fee_paise, dup_key, created_at, updated_at)
     VALUES (?, ?, 'S-001', 'Aarav', 'Sharma', 'active', null, 0, '2026-01-04', 'postpaid', 100000, 'S-001', ?, ?)`,
  ).run(STUDENT, TENANT, now, now);

  f.raw.prepare(
    `INSERT INTO invoices (id, tenant_id, number, student_id, issue_date, due_date,
                           subtotal, discount, extra_charges, total, status, tamper_hash, created_at, updated_at)
     VALUES (?, ?, 'INV-000001', ?, '2026-09-01', '2026-09-01', 100000, 0, 0, 100000, 'unpaid', 'hash', ?, ?)`,
  ).run(INVOICE, TENANT, STUDENT, now, now);

  insertPayment(f, PAYMENT, 100000, "2026-10-02");
}

/** A payment inside the collected-this-month window. */
function insertPayment(f: SqliteGatewayDb, id: string, creditPaise: number, occurredOn: string): void {
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'PAYMENT_RECEIVED', 0, ?, 0, 'Payment received', 'RCP-000001', ?, 'gateway', ?, ?)`,
  ).run(id, TENANT, STUDENT, INVOICE, creditPaise, occurredOn, NOW, NOW);
}

/**
 * The VOID row in PRODUCTION shape (apps/gateway/routes/ledger.ts:1019-1035):
 * it carries `void_of_id` = the id of the row it reverses and does NOT carry
 * `invoice_id`. That is why "has this credit been reversed?" can only be
 * answered by a reverse lookup.
 */
function insertVoid(f: SqliteGatewayDb): void {
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'VOID', 100000, 0, 100000, 'VOID: wrong amount', 'RCP-000001', '2026-10-03', 'gateway', ?, ?, ?)`,
  ).run(VOID_ROW, TENANT, STUDENT, PAYMENT, NOW, NOW);
}

/** A refund issued in the period: money that left the tutor's hands. */
function insertRefund(f: SqliteGatewayDb, debitPaise: number): void {
  f.raw.prepare(
    `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type, debit_paise, credit_paise,
                                 balance_after_paise, description, receipt_no, occurred_on, source, void_of_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'REFUND_ISSUED', ?, 0, 0, 'Refund issued', NULL, '2026-10-03', 'gateway', NULL, ?, ?)`,
  ).run(REFUND, TENANT, STUDENT, debitPaise, NOW, NOW);
}

async function dashboard(f: SqliteGatewayDb): Promise<DashboardPayload> {
  const path = "/api/v1/analytics/dashboard";
  const url = new URL(`https://api.buddysaradhi.app${path}`);
  const res = await handleAnalytics(
    new Request(url, { method: "GET" }),
    // SAFETY: SqliteGatewayDb satisfies `SqlHandle`, the only capability the
    // route uses; `DB` is the libsql client marker it structurally replaces.
    f as unknown as DB,
    TENANT,
    path,
    "GET",
    url,
    {},
  );
  if (!res) throw new Error("handleAnalytics did not match GET /api/v1/analytics/dashboard");
  const body = (await res.json()) as { success: boolean; data?: DashboardPayload };
  if (!body.success || !body.data) {
    throw new Error(`dashboard failed: ${JSON.stringify(body)}`);
  }
  return body.data;
}

describe("BR-CALC-10 — collected excludes voided payments and subtracts refunds", () => {
  it("a live payment counts as collected", async () => {
    const { kpis } = await dashboard(db);
    expect(kpis.collectedThisMonthMinor).toBe(100000);
  });

  it("AUD-013: a VOIDED payment does NOT count as collected", async () => {
    insertVoid(db);
    const { kpis } = await dashboard(db);
    // Before the fix this was 100000 — the dashboard said the tutor had
    // collected money they had given back.
    expect(kpis.collectedThisMonthMinor).toBe(0);
  });

  it("AUD-013: a voided payment stops netting off the invoice's outstanding", async () => {
    const before = await dashboard(db);
    // The payment settles the invoice, so before the void the invoice is not
    // overdue; after the void the ₹1,000 is owed again.
    expect(before.kpis.overdueMinor).toBe(0);

    insertVoid(db);
    const after = await dashboard(db);
    expect(after.kpis.overdueMinor).toBe(100000);
  });

  it("AUD-013: a refund is SUBTRACTED from collected (BR-CALC-10)", async () => {
    insertRefund(db, 30000);
    const { kpis } = await dashboard(db);
    // 100000 collected − 30000 refunded.
    expect(kpis.collectedThisMonthMinor).toBe(70000);
  });

  it("a void excludes only the reversed payment — the other one still counts", async () => {
    insertVoid(db);
    insertPayment(db, SECOND_PAYMENT, 50000, "2026-10-03");
    const { kpis } = await dashboard(db);
    // The voided 100000 is gone; the live 50000 is still collected. This is
    // what proves the exclusion is TARGETED rather than a blanket wipe of the
    // period's payments.
    expect(kpis.collectedThisMonthMinor).toBe(50000);
  });
});
