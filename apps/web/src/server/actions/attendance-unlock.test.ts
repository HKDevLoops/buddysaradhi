// Implements: 06_Attendance.md §10.6 BR-ATT-07 (three-tier ladder), §10.3
// phases, §10.8 audit trail; 03_User_Flows.md §4.3 Flow 11; 10_Security.md §4;
// 08_Settings.md BR-SEC-02; AGENTS.md §2 Rules 7/9 + §7.3 (mock-free DB).
//
// What this proves, against a REAL file-backed libSQL DB (only the session
// seam `getAuthenticatedPrisma` is stubbed; gateway is untouched — these
// actions are local-first):
//   1. unlock is PIN-gated with the lock-identical taxonomy (no-PIN, format,
//      incorrect), and writes nothing on refusal;
//   2. tier routing: fresh-unlocked → "not locked"; locked/auto → window;
//      >30d → HARD_LOCKED (direct unlock disabled, 06 §10.6 Tier 3);
//   3. unlock + hard-request + relock each land outbox (CHECK-valid op) +
//      audit in one transaction (Rule 7) with a ~60-minute window;
//   4. the edit gate: in-window edits succeed and write `attendance_edit_locked`
//      per changed row; expired windows lazily write `attendance_relock`
//      (reason `unlock_window_expired`) and reject with the pre-existing
//      locked copy; relock action is an honest no-op without a window;
//   5. window math: both audit vocabularies (snake + dotted), relock
//      precedence, 60-minute boundary.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import {
  unlockSessionAction,
  requestHardUnlockAction,
  relockSessionAction,
  updateAttendanceAction,
} from "@/server/actions/attendance";
import { readUnlockWindow, hardLocked } from "@/server/attendance-window";

const TENANT = "t-unlock-1";
const PIN = "123456";
const VALID_OPS = new Set(["insert", "update", "soft_delete"]);

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "unlock-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4). Includes the lock
  // columns the unlock paths read/write, plus the CHECK mirror from
  // sql-removal.test.ts so an invalid op literal throws here.
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, attendance_lock_hours INTEGER, theme TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, first_name TEXT, last_name TEXT, admission_date TEXT, status TEXT, fee_model TEXT, base_fee_paise INTEGER, balance_paise INTEGER, dup_key TEXT, archived_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE attendance_sessions (id TEXT PRIMARY KEY, tenant_id TEXT, batch_id TEXT, session_date TEXT, locked_at TEXT, locked_by TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE attendance_records (id TEXT PRIMARY KEY, tenant_id TEXT, session_id TEXT, student_id TEXT, status TEXT, marked_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE batches (id TEXT PRIMARY KEY, tenant_id TEXT, name TEXT, created_at TEXT, updated_at TEXT)",
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

async function seedSettings(client: Client, pinHash: string | null): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', ?, ?, ?)",
    args: [TENANT, pinHash, now, now],
  });
}

async function seedSession(
  client: Client,
  id: string,
  sessionDate: string,
  lockedAt: string | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, locked_at, locked_by, created_at, updated_at) VALUES (?, ?, 'batch-default', ?, ?, ?, ?, ?)",
    args: [id, TENANT, sessionDate, lockedAt, lockedAt ? TENANT : null, now, now],
  });
}

async function seedStudent(client: Client, id: string): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO students (id, tenant_id, first_name, last_name, status, created_at, updated_at) VALUES (?, ?, 'Asha', 'K', 'active', ?, ?)",
    args: [id, TENANT, now, now],
  });
}

async function seedAudit(
  client: Client,
  action: string,
  refId: string,
  createdAt: string,
  metadata = "{}",
): Promise<void> {
  await client.execute({
    sql: "INSERT INTO audit_log (id, tenant_id, actor, action, ref_type, ref_id, metadata, created_at) VALUES (?, ?, ?, ?, 'attendance_session', ?, ?, ?)",
    args: [crypto.randomUUID(), TENANT, TENANT, action, refId, metadata, createdAt],
  });
}

async function outboxOps(client: Client): Promise<string[]> {
  const res = await client.execute("SELECT op FROM sync_outbox");
  return res.rows.map((row) => String(row.op));
}

async function auditActions(client: Client): Promise<string[]> {
  const res = await client.execute("SELECT action FROM audit_log ORDER BY created_at");
  return res.rows.map((row) => String(row.action));
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
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

describe("unlockSessionAction: PIN gate + tiers", () => {
  it("refuses without a configured PIN and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, null);
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    wireSeam(client);
    const res = await unlockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/No PIN configured/);
    expect(await auditActions(client)).toEqual([]);
    expect(await outboxOps(client)).toEqual([]);
  });

  it("refuses a wrong PIN with the lock-identical taxonomy and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    wireSeam(client);
    const res = await unlockSessionAction("s1", "999999");
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/VALIDATION.*incorrect/);
    expect(await auditActions(client)).toEqual([]);
  });

  it("refuses a fresh unlocked session as not locked", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(0), null);
    wireSeam(client);
    const res = await unlockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/not locked/);
    expect(await auditActions(client)).toEqual([]);
  });

  it("refuses a hard-locked session with HARD_LOCKED and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(45), minutesAgoIso(5));
    wireSeam(client);
    const res = await unlockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/^HARD_LOCKED/);
    expect(await auditActions(client)).toEqual([]);
    expect(await outboxOps(client)).toEqual([]);
  });

  it("unlocks a locked session: window + CHECK-valid outbox + audit in one stamp", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    wireSeam(client);
    const before = Date.now();
    const res = await unlockSessionAction("s1", PIN);
    expect(res.success).toBe(true);
    // Return types are inferred unions with widened `success: boolean`, so
    // `!res.success` cannot narrow; the `in` check discriminates instead.
    if (!("data" in res) || !res.data) throw new Error("unlock failed in test");
    const expires = new Date(res.data.window_expires_at).getTime();
    expect(expires - before).toBeGreaterThan(59 * 60_000);
    expect(expires - before).toBeLessThanOrEqual(61 * 60_000);
    expect(await auditActions(client)).toEqual(["attendance_unlock"]);
    const ops = await outboxOps(client);
    expect(ops).toEqual(["update"]);
    expect(ops.every((op) => VALID_OPS.has(op))).toBe(true);
  });

  it("returns 404-shaped failure for an unknown session", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    wireSeam(client);
    const res = await unlockSessionAction("missing", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/not found/);
  });
});

describe("requestHardUnlockAction: Tier 3 gate", () => {
  it("refuses a short reason with VALIDATION and writes nothing", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(45), minutesAgoIso(5));
    wireSeam(client);
    const res = await requestHardUnlockAction("s1", "too short", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/VALIDATION.*20 characters/);
    expect(await auditActions(client)).toEqual([]);
  });

  it("refuses a young session with NOT_HARD_LOCKED", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(5), minutesAgoIso(5));
    wireSeam(client);
    const res = await requestHardUnlockAction(
      "s1",
      "Parent disputed the 12 Aug absence record; reviewing now.",
      PIN,
    );
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/^NOT_HARD_LOCKED/);
    expect(await auditActions(client)).toEqual([]);
  });

  it("grants a hard-locked session a window and audits the request", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(45), minutesAgoIso(5));
    wireSeam(client);
    const res = await requestHardUnlockAction(
      "s1",
      "Parent disputed the 12 Aug absence record; reviewing now.",
      PIN,
    );
    expect(res.success).toBe(true);
    if (!("data" in res) || !res.data) throw new Error("request failed in test");
    expect(res.data.window_expires_at).toBeTruthy();
    expect(await auditActions(client)).toEqual(["attendance_hard_unlock_request"]);
    expect(await outboxOps(client)).toEqual(["update"]);
  });
});

describe("edit gate: windows, expiry, relock", () => {
  it("in-window edits succeed and write attendance_edit_locked per row", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const unlocked = await unlockSessionAction("s1", PIN);
    expect(unlocked.success).toBe(true);
    const edited = await updateAttendanceAction({
      session_date: daysAgoIso(2),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(edited.success).toBe(true);
    const actions = await auditActions(client);
    expect(actions).toContain("attendance_unlock");
    expect(actions).toContain("attendance_edit_locked");
    expect(actions).not.toContain("attendance_relock");
  });

  it("expired windows lazily write attendance_relock and reject with the locked copy", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    await seedStudent(client, "stu-1");
    // A grant row 61 minutes old: window lapsed, no relock row yet.
    await seedAudit(client, "attendance_unlock", "s1", minutesAgoIso(61), "{}");
    wireSeam(client);
    const edited = await updateAttendanceAction({
      session_date: daysAgoIso(2),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(edited.success).toBe(false);
    expect(edited.error ?? "").toMatch(/locked/);
    expect(await auditActions(client)).toContain("attendance_relock");
  });

  it("never-unlocked locked sessions reject without a relock row", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    await seedStudent(client, "stu-1");
    wireSeam(client);
    const edited = await updateAttendanceAction({
      session_date: daysAgoIso(2),
      batch_id: "batch-default",
      updates: [{ student_id: "stu-1", status: "present" }],
    });
    expect(edited.success).toBe(false);
    expect(edited.error ?? "").toBe("Session is locked. Unlock it to edit.");
    expect(await auditActions(client)).not.toContain("attendance_relock");
  });
});

describe("relockSessionAction", () => {
  it("is an honest no-op without an open window", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    wireSeam(client);
    const res = await relockSessionAction("s1");
    expect(res).toEqual({ success: true, relocked: false });
    expect(await auditActions(client)).toEqual([]);
  });

  it("closes an open window with attendance_relock", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client, await hashPin(PIN));
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(5));
    wireSeam(client);
    expect((await unlockSessionAction("s1", PIN)).success).toBe(true);
    const res = await relockSessionAction("s1", "app_backgrounded");
    expect(res).toEqual({ success: true, relocked: true });
    expect(await auditActions(client)).toEqual(["attendance_unlock", "attendance_relock"]);
  });
});

describe("readUnlockWindow + hardLocked units", () => {
  it("computes the 30-day hard boundary by UTC date", () => {
    const now = new Date().toISOString();
    expect(hardLocked(daysAgoIso(45), now)).toBe(true);
    expect(hardLocked(daysAgoIso(31), now)).toBe(true);
    expect(hardLocked(daysAgoIso(30), now)).toBe(false);
    expect(hardLocked(daysAgoIso(5), now)).toBe(false);
  });

  it("relock rows beat older grants and dotted spellings grant", async () => {
    ({ client, dir } = await createTestDb());
    await seedSession(client, "s1", daysAgoIso(2), minutesAgoIso(90));
    await seedAudit(client, "attendance.unlock", "s1", minutesAgoIso(30), "{}");
    const direct = createLibsqlProxy(client);
    const open = await readUnlockWindow(direct, TENANT, "s1", new Date().toISOString());
    expect(open.open).toBe(true);
    await seedAudit(client, "attendance_relock", "s1", minutesAgoIso(1), "{}");
    const closed = await readUnlockWindow(direct, TENANT, "s1", new Date().toISOString());
    expect(closed.open).toBe(false);
    expect((closed as { expiredGrant: boolean }).expiredGrant).toBe(false);
  });
});
