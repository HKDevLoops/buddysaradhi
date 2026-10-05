// Implements: 08_Settings.md §15 SR-01 / SR-05 (backup and biometric both need
// a fresh PIN), §6.2.7 + EC-04 (passphrase floor, `.buddysaradhi` filename),
// §9.3 + EC-01 (currency locks after the first fee charge), §9.6 step 6
// (`backup_create` audit + Rule 7 outbox row in one transaction),
// §16 `AuditWriteError` fail-closed; 09_Backup_and_Import_Export.md §15.4 (a
// >100-row import is PIN-gated); AGENTS.md §2 Rules 7/8/9 + §7.3 (no mocked DB
// — a real file-backed libSQL, only the session seam stubbed).
//
// Every test below covers a defect this audit found. Each one names the file it
// used to be wrong in.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { randomUUID } from "node:crypto";
import { decryptBackup, verifyPin } from "@/lib/crypto";
import { STUDENT_IMPORT_HEADERS } from "@/lib/csv-parse";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  gatewayPatch: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
  invalidateTenant: vi.fn(),
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
    gatewayPatch: mocks.gatewayPatch,
  };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
vi.mock("@/server/cache", () => ({ invalidateTenant: mocks.invalidateTenant }));
// `revalidatePath` throws "static generation store missing" outside a Next
// request scope, which is a harness fact rather than a product one. Mocking it
// here means an import that has ALREADY committed is not reported as a failure.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  BACKUP_PASSPHRASE_MIN,
  IMPORT_PIN_REQUIRED_ABOVE_ROWS,
  backupFilename,
  createBackupAction,
  deleteTenantDataAction,
  getCurrencyLockAction,
  getDbIdentityAction,
  importStudentsAction,
  setBiometricEnabledAction,
  setPinAction,
  updateSettingAction,
  updateSettingsBatchAction,
} from "@/server/actions/settings";

const TENANT = "t-settings-audit";
const PASS = "correct horse battery staple";
const NOW = new Date().toISOString();

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "settings-audit-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test-setup DDL only — never runtime (AGENTS.md §3.4).
  await client.execute(
    "CREATE TABLE settings (id TEXT, tenant_id TEXT PRIMARY KEY, institute_name TEXT, institute_address TEXT, institute_phone TEXT, institute_email TEXT, tenant_secret TEXT, pin_hash TEXT, biometric_enabled INTEGER, currency_code TEXT, locale TEXT, timezone TEXT, default_fee_model TEXT, invoice_prefix TEXT, receipt_prefix TEXT, grace_days INTEGER, auto_invoice INTEGER, attendance_lock_hours INTEGER, default_attendance_status TEXT, holiday_list_json TEXT, session_timeout_min INTEGER, auto_archive_inactive_days INTEGER, theme TEXT, density TEXT, reduced_motion TEXT, palette TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  // Every column `importStudentsAction` writes, so the import's own insert is
  // not what fails a test here.
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, dob TEXT, gender TEXT, phone TEXT, address TEXT, school TEXT, grade TEXT, board TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, tutor_id TEXT, name TEXT, subject TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE student_enrollments (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, batch_id TEXT, joined_on TEXT, active INTEGER, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, type TEXT, amount_paise INTEGER, occurred_on TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE invoices (id TEXT PRIMARY KEY, tenant_id TEXT, student_id TEXT, number TEXT, total_paise INTEGER, status TEXT, issue_date TEXT, created_at TEXT)",
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

async function seedFeeCharge(client: Client, count = 1): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await client.execute({
      sql: "INSERT INTO ledger_entries (id, tenant_id, student_id, type, amount_paise, occurred_on, created_at) VALUES (?,?,?,?,?,?,?)",
      args: [`le-${i}`, TENANT, "stu-1", "FEE_CHARGED", 100000, "2026-01-01", "2026-01-01T00:00:00.000Z"],
    });
  }
}

async function rowsOf(client: Client, sql: string): Promise<Record<string, unknown>[]> {
  const res = await client.execute(sql);
  return res.rows as Record<string, unknown>[];
}

async function auditActions(client: Client): Promise<string[]> {
  return (await rowsOf(client, "SELECT action FROM audit_log")).map((r) => String(r.action));
}

let client: Client;
let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  // Every action under test writes locally; the gateway PATCH is only used by
  // the settings write paths, which none of these call.
  mocks.gatewayPatch.mockResolvedValue({ success: true });
});

afterEach(async () => {
  try {
    if (client) await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  client = undefined as unknown as Client; // SAFETY: reset between tests; recreated per test.
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
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

describe("backupFilename (08 §6.2.7)", () => {
  it("uses the spec's name, extension and timestamp shape", () => {
    const name = backupFilename(new Date(2026, 0, 5, 9, 7));
    expect(name).toBe("Buddysaradhi_Backup_20260105-0907.buddysaradhi");
  });

  it("zero-pads month, day, hour and minute", () => {
    const name = backupFilename(new Date(2026, 10, 2, 4, 5));
    expect(name).toMatch(/^Buddysaradhi_Backup_2026\d{4}-\d{4}\.buddysaradhi$/);
    expect(name).toContain("20261102-0405");
  });
});

describe("createBackupAction (08 SR-01, EC-04, §9.6; 09 §15.4)", () => {
  it("refuses without the typed EXPORT word and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    // The PIN setup above is the only write so far; a refused backup adds none.
    const outboxBefore = await rowsOf(client, "SELECT id FROM sync_outbox");

    const res = await createBackupAction(PASS, "135790", "export");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/EXPORT/i);
    expect(await auditActions(client)).not.toContain("backup_create");
    expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(outboxBefore.length);
  });

  it("refuses a passphrase under the spec's floor", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    const outboxBefore = await rowsOf(client, "SELECT id FROM sync_outbox");

    const short = "a".repeat(BACKUP_PASSPHRASE_MIN - 1);
    const res = await createBackupAction(short, "135790", "EXPORT");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain(String(BACKUP_PASSPHRASE_MIN));
    expect(await auditActions(client)).not.toContain("backup_create");
    expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(outboxBefore.length);
  });

  it("refuses a wrong PIN with no file and no audit row (fail-closed)", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    const outboxBefore = await rowsOf(client, "SELECT id FROM sync_outbox");

    const res = await createBackupAction(PASS, "999999", "EXPORT");
    expect(res.success).toBe(false);
    expect(await auditActions(client)).not.toContain("backup_create");
    expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(outboxBefore.length);
  });

  it("refuses when the tenant has no PIN at all", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    const res = await createBackupAction(PASS, "135790", "EXPORT");
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/PIN/i);
  });

  it("creates the file and writes the backup_create audit + outbox row in one go", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    await client.execute({
      sql: "INSERT INTO invoices (id, tenant_id, student_id, number, total_paise, status, issue_date, created_at) VALUES (?,?,?,?,?,?,?,?)",
      args: ["inv-1", TENANT, "stu-1", "INV-000001", 100000, "unpaid", "2026-01-01", "2026-01-01T00:00:00.000Z"],
    });

    const res = await createBackupAction(PASS, "135790", "EXPORT");
    expect(res.success).toBe(true);
    if (res.success !== true) return;
    expect(res.data.filename).toMatch(/^Buddysaradhi_Backup_\d{8}-\d{4}\.buddysaradhi$/);
    expect(res.data.counts.invoices).toBe(1);

    // 08 §9.6 step 6 + Rule 7: the mutation's audit and outbox rows both land.
    expect(await auditActions(client)).toContain("backup_create");
    const outbox = await rowsOf(client, "SELECT table_name FROM sync_outbox");
    expect(outbox.map((r) => String(r.table_name))).toContain("settings");

    // Rule 8: the payload is decryptable ONLY with the passphrase.
    const b64 = res.data.blobUrl.split(",")[1] ?? "";
    const plain = await decryptBackup(b64, PASS);
    const parsed = JSON.parse(plain) as { invoices: unknown[]; students: unknown[] };
    expect(parsed.invoices).toHaveLength(1);
    await expect(decryptBackup(b64, "some other passphrase entirely")).rejects.toThrow();
  });
});

describe("getCurrencyLockAction (08 §9.3, EC-01)", () => {
  it("is unlocked with no fee charge and locked with one", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);

    expect(await getCurrencyLockAction()).toMatchObject({ success: true, locked: false });

    await seedFeeCharge(client, 1);
    const locked = await getCurrencyLockAction();
    expect(locked).toMatchObject({ success: true, locked: true, feeChargeCount: 1 });
  });
});

describe("setBiometricEnabledAction (08 §9.5, SR-05)", () => {
  it("refuses a wrong PIN and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");

    const res = await setBiometricEnabledAction(false, "000000");
    expect(res.success).toBe(false);
    expect(await auditActions(client)).not.toContain("biometric_toggle");
    const rows = await rowsOf(client, "SELECT biometric_enabled FROM settings");
    expect(rows[0]?.biometric_enabled).not.toBe(0);
  });

  it("disables with the correct PIN and audits the change (Rule 7)", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");

    const res = await setBiometricEnabledAction(false, "135790");
    expect(res.success).toBe(true);
    const rows = await rowsOf(client, "SELECT biometric_enabled FROM settings");
    expect(rows[0]?.biometric_enabled).toBe(0);
    expect(await auditActions(client)).toContain("biometric_toggle");
    expect(await rowsOf(client, "SELECT table_name FROM sync_outbox")).not.toHaveLength(0);
  });
});

describe("deleteTenantDataAction (08 BR-SEC-02, §15 SR-03 gate)", () => {
  it("archives nothing on a wrong PIN", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    await client.execute({
      sql: "INSERT INTO students (id, tenant_id, code, first_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      args: ["stu-1", TENANT, "S-1", "Asha", "active", "2026-01-01", "2026-01-01"],
    });

    const res = await deleteTenantDataAction("000000");
    expect(res.success).toBe(false);
    const rows = await rowsOf(client, "SELECT status FROM students");
    expect(rows[0]?.status).toBe("active");
  });

  it("archives students on the correct PIN and audits it", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");
    await client.execute({
      sql: "INSERT INTO students (id, tenant_id, code, first_name, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
      args: ["stu-1", TENANT, "S-1", "Asha", "active", "2026-01-01", "2026-01-01"],
    });

    const res = await deleteTenantDataAction("135790");
    expect(res.success).toBe(true);
    const rows = await rowsOf(client, "SELECT status FROM students");
    expect(rows[0]?.status).toBe("archived");
    expect(await auditActions(client)).toContain("tenant_data_deleted");
  });
});

describe("importStudentsAction (09 §15.4 >100 rows needs a PIN)", () => {
  function rows(count: number): string[][] {
    return Array.from({ length: count }, (_, i) => {
      const row = new Array(STUDENT_IMPORT_HEADERS.length).fill("");
      row[STUDENT_IMPORT_HEADERS.indexOf("first_name")] = `Student ${i}`;
      row[STUDENT_IMPORT_HEADERS.indexOf("phone")] = `+9198${String(10000000 + i)}`;
      // `batch` is a required column on the import schema; "General" is the
      // same fallback the single-create path uses.
      row[STUDENT_IMPORT_HEADERS.indexOf("batch")] = "General";
      return row;
    });
  }

  it("refuses an over-threshold import with no PIN and creates nothing", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");

    const res = await importStudentsAction({
      headers: [...STUDENT_IMPORT_HEADERS],
      rows: rows(IMPORT_PIN_REQUIRED_ABOVE_ROWS + 1),
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.code).toBe("PIN_INVALID");
    expect(await rowsOf(client, "SELECT id FROM students")).toHaveLength(0);
  });

  it("refuses an over-threshold import with a wrong PIN", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");

    const res = await importStudentsAction({
      headers: [...STUDENT_IMPORT_HEADERS],
      rows: rows(IMPORT_PIN_REQUIRED_ABOVE_ROWS + 1),
      pin: "000000",
    });
    expect(res.success).toBe(false);
    expect(await rowsOf(client, "SELECT id FROM students")).toHaveLength(0);
  });

  it("does not gate an under-threshold import (09 §15.4 says no PIN)", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);

    const res = await importStudentsAction({
      headers: [...STUDENT_IMPORT_HEADERS],
      rows: rows(2),
    });
    if (!res.success) {
      throw new Error(
        `under-threshold import refused: ${res.code} ${res.error}; logs=${JSON.stringify(mocks.log.error.mock.calls)}`,
      );
    }
    // No PIN asked for below the 09 §15.4 threshold, and both rows land.
    expect(res.data.created).toBe(2);
  });

  it("accepts an over-threshold import once the correct PIN is supplied", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await setPinAction("135790");

    const res = await importStudentsAction({
      headers: [...STUDENT_IMPORT_HEADERS],
      rows: rows(IMPORT_PIN_REQUIRED_ABOVE_ROWS + 1),
      pin: "135790",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.created).toBe(IMPORT_PIN_REQUIRED_ABOVE_ROWS + 1);
    }
  });
});

describe("getDbIdentityAction (replaces the fake connection tester)", () => {
  it("reports the real row counts and the tenant id", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    await seedFeeCharge(client, 3);

    const res = await getDbIdentityAction();
    expect(res).toEqual({
      success: true,
      tenantId: TENANT,
      students: 0,
      ledgerEntries: 3,
      invoices: 0,
      settingsRows: 0,
    });
  });
});

describe("setPinAction interaction with the new gates", () => {
  it("a PIN set through the setup gate is what every gate verifies", async () => {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    expect((await setPinAction("135790")).success).toBe(true);
    const rows = await rowsOf(client, "SELECT pin_hash FROM settings");
    expect(await verifyPin("135790", String(rows[0]?.pin_hash))).toBe(true);
  });
});

/**
 * 08 §13's schema block, enforced at the boundary. The FIELD allowlist already
 * stopped `pinHash` being smuggled in; these are the cases that slipped past it
 * because a field NAME says nothing about a VALUE — and every one of them is a
 * real consequence, not a tidiness concern:
 *   - `attendanceLockHours: -5` silently disables a security control;
 *   - `graceDays: 99999` marks every invoice permanently overdue;
 *   - `invoicePrefix: '"'` ends up printed on every receipt, permanently;
 *   - `nextReceiptSeq: 1` rewinds a money sequence (BR-RC-01: never decremented).
 */
describe("setting VALUE gate (08 §13 schemas, §14 EC-17) — updateSettingAction", () => {
  async function seed(): Promise<void> {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    // Force the DIRECT-DB path (the Rule 7 offline fallback) so these assertions
    // read real rows out of a real database. With the gateway mocked as
    // succeeding — which the file's `beforeEach` does for the other suites —
    // `updateSettingAction` returns before touching the DB, and every "nothing
    // was written" claim would be vacuously true.
    mocks.gatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503" });
    await client.execute({
      sql: "INSERT INTO settings (id, tenant_id, currency_code, updated_at, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [randomUUID(), TENANT, "INR", NOW, NOW],
    });
  }

  const REJECTED: Array<[string, unknown, RegExp]> = [
    ["attendanceLockHours", -5, /greater than or equal/i],
    ["attendanceLockHours", 999, /less than or equal/i],
    ["graceDays", 99999, /less than or equal|expected/i],
    ["graceDays", -1, /greater than or equal|expected/i],
    ["invoicePrefix", '"', /alphanumeric/i],
    ["receiptPrefix", "INV ", /alphanumeric/i],
    ["sessionTimeoutMin", 0, /greater than or equal|expected/i],
    ["sessionTimeoutMin", 61, /less than or equal|expected/i],
    ["autoArchiveInactiveDays", 0, /greater than or equal|expected/i],
    ["autoArchiveInactiveDays", 366, /less than or equal|expected/i],
    ["defaultFeeModel", "barter", /expected/i],
    ["defaultAttendanceStatus", "maybe", /expected/i],
    ["currencyCode", "rupees", /three-letter|expected/i],
    ["institutePhone", "call me later", /phone number|expected/i],
    ["holidayListJson", "not json", /holiday list/i],
    ["nextReceiptSeq", 1, /maintained by the app/i],
  ];

  for (const [field, value, message] of REJECTED) {
    it(`refuses ${field} = ${JSON.stringify(value)}`, async () => {
      await seed();
      const res = await updateSettingAction(field, value);
      expect(res.success, `${field} was accepted`).toBe(false);
      expect(res.error ?? "").toMatch(message);
      // A refused write leaves NOTHING behind — no outbox, no audit row.
      expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(0);
      expect(await rowsOf(client, "SELECT id FROM audit_log")).toHaveLength(0);
    });
  }

  const ACCEPTED: Array<[string, unknown]> = [
    ["attendanceLockHours", 48],
    ["attendanceLockHours", 1],
    ["attendanceLockHours", 168],
    ["graceDays", 0],
    ["graceDays", 30],
    ["invoicePrefix", "INV-26-"],
    ["sessionTimeoutMin", 5],
    ["autoArchiveInactiveDays", 90],
    ["defaultFeeModel", "mixed"],
    ["institutePhone", "+919876543210"],
    ["holidayListJson", JSON.stringify([{ date: "2026-12-25", label: "Christmas" }])],
  ];

  for (const [field, value] of ACCEPTED) {
    it(`accepts ${field} = ${JSON.stringify(value)}`, async () => {
      await seed();
      const res = await updateSettingAction(field, value);
      expect(res.success, `${field} = ${JSON.stringify(value)} refused: ${res.error}`).toBe(true);
    });
  }

  it("currency is writable while no fee has been charged (08 §9.3, EC-01)", async () => {
    await seed();
    const res = await updateSettingAction("currencyCode", "USD");
    expect(res.success, res.error).toBe(true);
    const rows = await rowsOf(client, "SELECT currency_code FROM settings");
    expect(rows[0]?.currency_code).toBe("USD");
  });

  it("currency freezes at the first charged fee and says why", async () => {
    await seed();
    await client.execute({
      sql: "INSERT INTO ledger_entries (id, tenant_id, student_id, type, amount_paise, occurred_on, created_at) VALUES (?, ?, ?, 'FEE_CHARGED', ?, ?, ?)",
      args: [randomUUID(), TENANT, randomUUID(), 150000, "2026-09-01", NOW],
    });
    const res = await updateSettingAction("currencyCode", "USD");
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/cannot be changed once a fee has been charged/i);
    const rows = await rowsOf(client, "SELECT currency_code FROM settings");
    expect(rows[0]?.currency_code).toBe("INR");
    // Refused ⇒ no outbox row, no audit row.
    expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(0);
  });
});

describe("setting VALUE gate — updateSettingsBatchAction (a batch is not an end-run)", () => {
  async function seed(): Promise<void> {
    ({ client, dir } = await createTestDb());
    wireSeam(client);
    mocks.gatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503" });
    await client.execute({
      sql: "INSERT INTO settings (id, tenant_id, currency_code, updated_at, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [randomUUID(), TENANT, "INR", NOW, NOW],
    });
  }

  it("refuses the whole batch when one field is out of range, writing nothing", async () => {
    await seed();
    const res = await updateSettingsBatchAction({ invoicePrefix: "INV-", graceDays: 99999 });
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/graceDays/);
    const rows = await rowsOf(client, "SELECT invoice_prefix FROM settings");
    expect(rows[0]?.invoice_prefix ?? null).toBeNull();
    expect(await rowsOf(client, "SELECT id FROM sync_outbox")).toHaveLength(0);
  });

  it("the batch is held to the currency freeze too", async () => {
    await seed();
    await client.execute({
      sql: "INSERT INTO ledger_entries (id, tenant_id, student_id, type, amount_paise, occurred_on, created_at) VALUES (?, ?, ?, 'FEE_CHARGED', ?, ?, ?)",
      args: [randomUUID(), TENANT, randomUUID(), 150000, "2026-09-01", NOW],
    });
    const res = await updateSettingsBatchAction({ currencyCode: "USD", invoicePrefix: "INV-" });
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/cannot be changed/i);
  });

  it("accepts a batch whose every field is in range", async () => {
    await seed();
    const res = await updateSettingsBatchAction({ invoicePrefix: "INV-", graceDays: 7 });
    expect(res.success, res.error).toBe(true);
  });
});