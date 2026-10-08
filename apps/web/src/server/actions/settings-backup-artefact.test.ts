// Implements: 09_Backup_and_Import_Export.md §3 (what a backup carries) + §5
// (restore fidelity) + §11 (the AES-256-GCM envelope); 08_Settings.md §6.2.7
// (the success card states what went into the file) + §9.6 step 6 (the
// `backup_create` audit row); AGENTS.md §2 Rules 7/8/9 and §7.3 (a REAL
// file-backed libSQL, only the session seam stubbed — never a mocked DB, because
// the whole claim under test is "these rows are in the file").
//
// ── WHAT BUG THIS FILE EXISTS FOR ───────────────────────────────────────────
//
// Before this test the suite asserted only what the success CARD said. Nothing
// anywhere compared the backup's stated counts to the artefact itself, so a
// backup that silently dropped a table passed every existing check: the card
// printed the counts of the tables the action happened to read, and the omission
// was invisible. That is exactly what happened — `createBackupAction` read
// settings / students / ledger / invoices / audit and NOT receipts, attendance or
// batches, so a restore of this tenant's file would have dropped all 12 of its
// receipts with no failing test, no console error and no word on screen.
//
// The fix is to stop trusting the card. Every test here DECRYPTS the returned
// blob with the production `decryptBackup` (same Argon2id KDF, same AES-256-GCM
// envelope, Rule 8) and compares the parsed payload against the rows the test
// actually seeded. Revert the action to its old five-table `Promise.all` and every
// `carries` assertion below fails.
//
// ── AND WHY `null` IS ITS OWN CASE ─────────────────────────────────────────
//
// `[]` means "this tutor has no receipts". `null` means "this build could not read
// receipts". A restore that conflates them destroys data it never looked at, so a
// tenant whose schema lacks a table must be reported, not silently given an empty
// array and not failed with no file at all. The last test pins that distinction
// because it is the one that would otherwise rot back into `[]`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { decryptBackup } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  gatewayPatch: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
  invalidateTenant: vi.fn(),
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma, gatewayPatch: mocks.gatewayPatch };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
vi.mock("@/server/cache", () => ({ invalidateTenant: mocks.invalidateTenant }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createBackupAction, setPinAction } from "@/server/actions/settings";

const TENANT = "t-backup-artefact";
const PASS = "correct horse battery staple";
const T0 = "2026-03-01T00:00:00.000Z";

/** Row counts the seed writes, kept here so the test states its own fixtures. */
const SEED = {
  students: 3,
  ledger: 7,
  invoices: 5,
  receipts: 12,
  attendanceSessions: 4,
  attendanceRecords: 26,
  batches: 2,
} as const;

/**
 * Every table the backup is contracted to carry, as `payload key → seeded count`.
 *
 * The QA tenant that produced the real measurement holds 12 receipts, and this is
 * the number that made the omission visible; a unit test cannot count a live
 * tenant, so it seeds its own and states the count. What transfers is the
 * property, not the number: a table with rows in the database is a table with rows
 * in the file.
 */
const CONTRACT = [
  ["students", SEED.students],
  ["ledger", SEED.ledger],
  ["invoices", SEED.invoices],
  ["receipts", SEED.receipts],
  ["attendanceSessions", SEED.attendanceSessions],
  ["attendanceRecords", SEED.attendanceRecords],
  ["batches", SEED.batches],
] as const;

type BackupPayload = Record<string, unknown> & { version: number; tenantId: string };

async function createTestDb(withAttendance = true): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "backup-artefact-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test-setup DDL only — never runtime (AGENTS.md §3.4). Named explicitly rather
  // than inherited from another lane's fixture, because the whole point is that
  // this schema has the tables the old action never read.
  await client.execute(
    "CREATE TABLE settings (id TEXT, tenant_id TEXT PRIMARY KEY, institute_name TEXT, institute_address TEXT, institute_phone TEXT, institute_email TEXT, tenant_secret TEXT, pin_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, status TEXT, base_fee_paise INTEGER, balance_paise INTEGER, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, tutor_id TEXT, name TEXT, subject TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, type TEXT, amount_paise INTEGER, occurred_on TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, number TEXT, total_paise INTEGER, status TEXT, issue_date TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE receipts (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, invoice_id TEXT, number TEXT, amount_paise INTEGER, method TEXT, issued_at TEXT, created_at TEXT)",
  );
  if (withAttendance) {
    await client.execute(
      "CREATE TABLE attendance_sessions (id TEXT PRIMARY KEY, tenant_id TEXT, batch_id TEXT, session_date TEXT, locked_at TEXT, created_at TEXT, updated_at TEXT)",
    );
    await client.execute(
      "CREATE TABLE attendance_records (id TEXT PRIMARY KEY, tenant_id TEXT, session_id TEXT, student_id TEXT, status TEXT, marked_at TEXT, created_at TEXT, updated_at TEXT)",
    );
  }

  // Test-setup DDL/insert only. `args` is typed `InValue[]` rather than
  // `unknown[]` because libSQL's `execute` overload is the one place an
  // untyped array stops compiling — and a fixture that does not typecheck is a
  // fixture whose column order can silently drift from its values.
  type SeedValue = string | number;
  const insert = async (
    table: string,
    cols: string,
    n: number,
    extra: (i: number) => SeedValue[] = () => [],
  ): Promise<void> => {
    for (let i = 0; i < n; i += 1) {
      const values: SeedValue[] = [`${table}-${i}`, TENANT, ...extra(i)];
      const placeholders = values.map(() => "?").join(",");
      await client.execute({
        sql: `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`,
        args: values,
      });
    }
  };

  await insert("students", "id, tenant_id, code, first_name, status, created_at, updated_at", SEED.students, (i) => [
    `S-${i}`,
    `Student ${i}`,
    "active",
    T0,
    T0,
  ]);
  await insert("batches", "id, tenant_id, tutor_id, name, subject, created_at, updated_at", SEED.batches, (i) => [
    TENANT,
    `Batch ${i}`,
    "Mathematics",
    T0,
    T0,
  ]);
  await insert("ledger_entries", "id, tenant_id, student_id, type, amount_paise, occurred_on, created_at", SEED.ledger, (i) => [
    "stu-0",
    i % 2 === 0 ? "FEE_CHARGED" : "PAYMENT_RECEIVED",
    10000 + i,
    "2026-03-01",
    T0,
  ]);
  await insert("invoices", "id, tenant_id, student_id, number, total_paise, status, issue_date, created_at", SEED.invoices, (i) => [
    "stu-0",
    `INV-${String(i).padStart(6, "0")}`,
    10000,
    "unpaid",
    "2026-03-01",
    T0,
  ]);
  // THE ROW THAT PROVES THE POINT. Twelve receipts, each one a number a tutor
  // handed a parent. Under the old five-table action this table was never read,
  // so none of them reached the file.
  await insert(
    "receipts",
    "id, tenant_id, student_id, invoice_id, number, amount_paise, method, issued_at, created_at",
    SEED.receipts,
    (i) => ["stu-0", "inv-0", `RCP-${String(i).padStart(6, "0")}`, 10000, "cash", T0, T0],
  );
  if (withAttendance) {
    await insert("attendance_sessions", "id, tenant_id, batch_id, session_date, created_at, updated_at", SEED.attendanceSessions, (i) => [
      "batch-0",
      `2026-03-0${i + 1}`,
      T0,
      T0,
    ]);
    await insert("attendance_records", "id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at", SEED.attendanceRecords, (i) => [
      "att-sessions-0",
      "stu-0",
      i % 3 === 0 ? "absent" : "present",
      T0,
      T0,
      T0,
    ]);
  }
  return { client, dir };
}

let client: Client | undefined;
let dir: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gatewayPatch.mockResolvedValue({ success: true });
});

afterEach(async () => {
  try {
    if (client) await client.close();
  } catch {
    // libSQL may already be closed.
  }
  client = undefined;
  // Windows keeps the WAL/SHM handles for a moment after `close()`, so a single
  // `rmSync` is an EPERM. Retrying is the same teardown the existing settings
  // suite uses; it is not a way of hiding a real failure, because a directory
  // that never becomes removable still throws on the last attempt.
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    dir = undefined;
  }
});

/** Runs the real action and returns the DECRYPTED artefact, never the card. */
async function createAndDecrypt(withAttendance = true): Promise<{
  payload: BackupPayload;
  counts: Record<string, number | null>;
  bytes: number;
}> {
  const made = await createTestDb(withAttendance);
  client = made.client;
  dir = made.dir;
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(made.client),
    userId: TENANT,
    tenantId: TENANT,
  });
  await setPinAction("135790");

  const res = await createBackupAction(PASS, "135790", "EXPORT");
  expect(res.success, `the backup was refused: ${res.success ? "" : res.error}`).toBe(true);
  if (res.success !== true) throw new Error("unreachable: the expect above failed");

  const encoded = res.data.blobUrl.replace(/^data:application\/octet-stream;base64,/, "");
  const plaintext = await decryptBackup(encoded, PASS);
  return {
    payload: JSON.parse(plaintext) as BackupPayload,
    counts: res.data.counts as unknown as Record<string, number | null>,
    bytes: Buffer.byteLength(encoded, "base64"),
  };
}

describe("createBackupAction — the ARTEFACT, not the card", () => {
  it("carries every seeded row of every contracted table, receipts included", async () => {
    const { payload } = await createAndDecrypt();

    // The file is a real envelope, not a stub: Rule 8 (AES-256-GCM + Argon2id).
    expect(payload.version).toBe(1);
    expect(payload.tenantId).toBe(TENANT);

    for (const [key, expected] of CONTRACT) {
      const rows = payload[key];
      // SAFETY: the assertion immediately below is the narrowing, and it is the
      // point of the test — a missing or non-array key must fail, not pass.
      expect(Array.isArray(rows), `${key} is an array in the file, not absent`).toBe(true);
      expect(Array.isArray(rows) ? rows.length : -1, `${key} row count in the FILE`).toBe(expected);
    }
  });

  it("carries the audit trail, so the backup is verifiable and not merely present", async () => {
    const { payload } = await createAndDecrypt();
    const audit = payload.audit;
    expect(Array.isArray(audit)).toBe(true);
    // `setPinAction` wrote `pin.update` before the backup ran, so the trail is
    // non-empty by construction and a restore can prove what happened.
    expect(Array.isArray(audit) ? audit.length : 0).toBeGreaterThan(0);
  });

  it("the counts the CARD prints are the counts the FILE holds — same source, no restating", async () => {
    const { payload, counts } = await createAndDecrypt();
    // This is the assertion that was missing from the entire suite: the number
    // shown to the tutor and the number of rows in the artefact cannot disagree.
    for (const [key, expected] of CONTRACT) {
      const rows = payload[key];
      expect(counts[key], `${key} count printed on the card`).toBe(
        Array.isArray(rows) ? rows.length : null,
      );
      expect(counts[key], `${key} count printed on the card`).toBe(expected);
    }
  });

  it("states receipts: the QA tenant's 12 receipts are the rows that were being dropped", async () => {
    const { payload, counts } = await createAndDecrypt();
    expect(counts.receipts).toBe(SEED.receipts);
    expect(Array.isArray(payload.receipts) ? payload.receipts.length : -1).toBe(12);
  });

  it("the audit row records the same counts the card printed", async () => {
    const made = await createTestDb();
    client = made.client;
    dir = made.dir;
    mocks.getAuthenticatedPrisma.mockResolvedValue({
      db: createLibsqlProxy(made.client),
      userId: TENANT,
      tenantId: TENANT,
    });
    await setPinAction("135790");
    const res = await createBackupAction(PASS, "135790", "EXPORT");
    expect(res.success).toBe(true);
    if (res.success !== true) return;

    const audit = await made.client.execute({
      sql: "SELECT metadata FROM audit_log WHERE action = 'backup_create'",
      args: [],
    });
    expect(audit.rows).toHaveLength(1);
    const metadata = JSON.parse(String(audit.rows[0]?.metadata)) as {
      counts: Record<string, number | null>;
    };
    for (const [key, expected] of CONTRACT) {
      expect(metadata.counts[key], `backup_create audit count for ${key}`).toBe(expected);
    }
    expect(metadata.counts.receipts).toBe(SEED.receipts);
  });
});

describe("createBackupAction — a table the tenant does not have", () => {
  it("records `null` and still produces a file; it does NOT claim an empty table", async () => {
    // This is the fail-open-vs-silent-loss decision, pinned. The attendance tables
    // are absent from this tenant's schema.
    const { payload, counts } = await createAndDecrypt(false);

    // Present, with every row.
    expect(counts.receipts).toBe(SEED.receipts);
    expect(counts.students).toBe(SEED.students);

    // Absent: `null`, meaning "this build could not read it" — never `[]`, which
    // would assert the tutor has no attendance, and never a thrown refusal that
    // leaves them with no file and no reason.
    expect(payload.attendanceSessions, "unavailable is null, never []").toBeNull();
    expect(payload.attendanceRecords).toBeNull();
    expect(counts.attendanceSessions).toBeNull();
    expect(counts.attendanceRecords).toBeNull();

    // And the reason was recorded, not swallowed (Rule 9).
    expect(mocks.log.warn).toHaveBeenCalledWith(
      "backup_table_unavailable",
      expect.stringContaining("attendance_sessions"),
    );
  });
});