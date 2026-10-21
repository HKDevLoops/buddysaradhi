// Implements: 08_Settings.md §6.2.12 (the Diagnostics integrity check writes
// `audit_log` `integrity_check` with pass/fail counts, and a mismatch is
// reported rather than hidden); 12_Business_Rules.md BR-LED-06 (the hash
// chain is verified), BR-LED-02 + BR-RPT-04 (the running balance must
// reconcile); 10_Security.md §9.1 LEDGER-3 (the running-balance
// reconciliation), §9.4 (`ledger_integrity_violation` with the offending
// ids), §8.2 (the audited actions); RFC-010 §4.3 (audit metadata names the
// field, never the value); AGENTS.md §2 Rule 9 (a failure is stated),
// §3.4 (ORM only — no raw SQL at runtime), §7.3 (never mock the DB).
//
// WHY THIS TEST IS THE POINT OF FINDING 1.13. `reconcileLedger` — the
// function that would catch a tampered or drifted ledger — had ZERO
// production call sites: every hit in the repo was a comment, a spec quote, a
// doc or a test. This action is that call site, and this test drives it
// against a REAL ledger.
//
// The DB is real (a file-backed libSQL) and the ledger rows are hashed with
// the PRODUCTION hash construction (`buildEntryPayload` + `computeHash`), so
// the reconciler verifies exactly the bytes the app writes — a test double
// would prove nothing about it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { buildEntryPayload, computeHash } from "@buddysaradhi/core";

const mocks = vi.hoisted(() => ({
  getAuthenticatedDb: vi.fn(),
  getAuthenticatedPrisma: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedDb: mocks.getAuthenticatedDb,
    getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
  };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import { runLedgerIntegrityCheckAction } from "@/server/actions/diagnostics";

const TENANT = "t-diagnostics-1";
const SECRET = "diagnostics-secret";
const STUDENT = "student-diag-1";

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "diagnostics-integrity-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, tenant_secret TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, first_name TEXT, last_name TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, invoice_id TEXT, type TEXT, debit_paise INTEGER, credit_paise INTEGER, balance_after_paise INTEGER, description TEXT, prev_hash TEXT, this_hash TEXT, void_of_id TEXT, occurred_on TEXT, source TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  return { client, dir };
}

function wireSeam(client: Client): void {
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
}

async function seedTenantAndStudent(client: Client): Promise<void> {
  const now = "2026-09-01T10:00:00.000Z";
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, tenant_secret, created_at, updated_at) VALUES (?, ?, ?, ?)",
    args: [TENANT, SECRET, now, now],
  });
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, first_name, last_name, created_at, updated_at) VALUES (?, ?, 'Asha', 'Rao', ?, ?)",
    args: [STUDENT, TENANT, now, now],
  });
}

/**
 * Two chained ledger rows written the way the app writes them: the payload is
 * built by `buildEntryPayload` and hashed by `computeHash`, so the reconciler
 * sees the same bytes it would see in production.
 */
async function seedLedger(client: Client, tamperBalance = false): Promise<void> {
  const firstAt = "2026-09-01T10:00:00.000Z";
  const secondAt = "2026-09-02T10:00:00.000Z";
  const firstPayload = buildEntryPayload({
    id: "entry-1",
    studentId: STUDENT,
    type: "FEE_CHARGED",
    debitPaise: 100000,
    creditPaise: 0,
    balanceAfterPaise: 100000,
    occurredOn: "2026-09-01",
  });
  const firstHash = computeHash(null, firstPayload, firstAt, SECRET);
  const secondPayload = buildEntryPayload({
    id: "entry-2",
    studentId: STUDENT,
    type: "PAYMENT_RECEIVED",
    debitPaise: 0,
    creditPaise: 100000,
    balanceAfterPaise: 0,
    occurredOn: "2026-09-02",
  });
  const secondHash = computeHash(firstHash, secondPayload, secondAt, SECRET);

  await client.execute({
    sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type,
            debit_paise, credit_paise, balance_after_paise, description, prev_hash, this_hash,
            void_of_id, occurred_on, source, created_at, updated_at)
          VALUES ('entry-1', ?, ?, NULL, 'FEE_CHARGED', 100000, 0, 100000, 'Fee', NULL, ?, NULL,
            '2026-09-01', 'manual', ?, ?)`,
    args: [TENANT, STUDENT, firstHash, firstAt, firstAt],
  });
  await client.execute({
    sql: `INSERT INTO ledger_entries (id, tenant_id, student_id, invoice_id, type,
            debit_paise, credit_paise, balance_after_paise, description, prev_hash, this_hash,
            void_of_id, occurred_on, source, created_at, updated_at)
          VALUES ('entry-2', ?, ?, NULL, 'PAYMENT_RECEIVED', 0, 100000, ?, 'Cash', ?, ?, NULL,
            '2026-09-02', 'manual', ?, ?)`,
    args: [
      TENANT,
      STUDENT,
      tamperBalance ? 999 : 0,
      firstHash,
      secondHash,
      secondAt,
      secondAt,
    ],
  });
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
    /* Best-effort: libSQL may already be closed. */
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated per test.
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined as unknown as string; // SAFETY: reset between tests; recreated per test.
  }
});

describe("Diagnostics → the ledger integrity check (08 §6.2.12)", () => {
  it("a clean ledger is reported as agreeing, and the check is audited", async () => {
    ({ client, dir } = await createTestDb());
    await seedTenantAndStudent(client);
    await seedLedger(client);
    wireSeam(client);

    const res = await runLedgerIntegrityCheckAction();

    expect(res.success).toBe(true);
    if (res.success !== true) return;
    expect(res.failures).toEqual([]);
    expect(res.studentsChecked).toBe(1);
    expect(res.entriesChecked).toBe(2);

    // 08 §6.2.12 — the run is audited with pass/fail counts.
    const audit = await client.execute(
      "SELECT metadata FROM audit_log WHERE action = 'integrity_check'",
    );
    expect(audit.rows).toHaveLength(1);
    const metadata = JSON.parse(String(audit.rows[0]?.metadata ?? "{}")) as {
      passed?: boolean;
      students_checked?: number;
      students_failed?: number;
    };
    expect(metadata.passed).toBe(true);
    expect(metadata.students_checked).toBe(1);
    expect(metadata.students_failed).toBe(0);

    // No violation row when the books agree.
    const violations = await client.execute(
      "SELECT id FROM audit_log WHERE action = 'ledger_integrity_violation'",
    );
    expect(violations.rows).toHaveLength(0);
  });

  it("a tampered ledger is reported, named, and audited as a violation", async () => {
    ({ client, dir } = await createTestDb());
    await seedTenantAndStudent(client);
    await seedLedger(client, true);
    wireSeam(client);

    const res = await runLedgerIntegrityCheckAction();

    expect(res.success).toBe(true);
    if (res.success !== true) return;
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]?.studentId).toBe(STUDENT);
    // The tutor is told WHICH student, in their own words.
    expect(res.failures[0]?.studentName).toBe("Asha Rao");
    expect(res.failures[0]?.kind).toBe("balance");
    // The forensic detail is the reconciler's own sentence, verbatim.
    expect(res.failures[0]?.reason).toMatch(/Balance mismatch at entry entry-2/);

    // 10 §9.4 (2) — one row with the offending ids.
    const violations = await client.execute(
      "SELECT metadata FROM audit_log WHERE action = 'ledger_integrity_violation'",
    );
    expect(violations.rows).toHaveLength(1);
    const metadata = JSON.parse(String(violations.rows[0]?.metadata ?? "{}")) as {
      offending_student_ids?: string[];
    };
    expect(metadata.offending_student_ids).toEqual([STUDENT]);
  });

  it("the audit metadata carries NO student name (RFC-010 §4.3)", async () => {
    ({ client, dir } = await createTestDb());
    await seedTenantAndStudent(client);
    await seedLedger(client, true);
    wireSeam(client);

    await runLedgerIntegrityCheckAction();

    const audit = await client.execute("SELECT metadata FROM audit_log");
    for (const row of audit.rows) {
      expect(String(row.metadata ?? "")).not.toContain("Asha");
      expect(String(row.metadata ?? "")).not.toContain("Rao");
    }
  });

  it("a check that cannot run says so, and writes nothing (Rule 9)", async () => {
    ({ client, dir } = await createTestDb());
    await seedTenantAndStudent(client);
    await seedLedger(client);
    wireSeam(client);
    // The tenant's settings row is gone: the reconciler cannot hash anything
    // without the pepper (10 §10, fail-closed).
    await client.execute("DELETE FROM settings WHERE tenant_id = ?", [TENANT]);

    const res = await runLedgerIntegrityCheckAction();

    expect(res.success).toBe(false);
    if (res.success !== false) return;
    expect(res.error).toMatch(/could not run/i);
    // A check that did not run is not a passing check: no audit row claims it.
    const audit = await client.execute("SELECT id FROM audit_log");
    expect(audit.rows).toHaveLength(0);
  });
});
