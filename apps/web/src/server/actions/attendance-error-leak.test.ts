// Implements: AGENTS.md §2 Rule 9 (no silent failures — and no silent LEAKS),
// §9.4 security harness task SEC-ERRLEAK-05.
//
// The six attendance catch blocks used to answer
// `error instanceof Error ? error.message : "…"`, so an arbitrary SQLite/driver
// string — complete with the failing statement — was rendered to the tutor.
// This suite pins BOTH halves of the fix, because genericising everything would
// swallow the deliberate refusals:
//
//   1. an UNEXPECTED FAULT yields the fixed generic sentence and the driver
//      text appears nowhere in the result (it still reaches `log.error`);
//   2. a DELIBERATE refusal still yields its own tutor-facing sentence.
//
// The refusal case runs against a REAL file-backed libSQL DB (§7.3 — a mocked DB
// would not exercise the transaction that raises the refusal); only the session
// seam `getAuthenticatedPrisma` is stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import { hashPin } from "@/lib/crypto";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  getAttendanceForDate: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return { ...actual, getAuthenticatedPrisma: mocks.getAuthenticatedPrisma };
});
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
vi.mock("@/server/queries/attendance", () => ({
  getAttendanceForDate: mocks.getAttendanceForDate,
}));

import {
  fetchAttendanceAction,
  fetchAttendanceSummaryAction,
  lockSessionAction,
  unlockSessionAction,
  requestHardUnlockAction,
  relockSessionAction,
} from "@/server/actions/attendance";

const TENANT = "t-errleak-1";
const PIN = "123456";

/**
 * The shape a real driver produces when a statement fails: the SQLite error
 * code, the offending column, and then the statement itself. Everything after
 * the first sentence is what must never reach a browser.
 */
const DRIVER_TEXT =
  "SQLITE_ERROR: SQLITE_CORRUPT: database disk image is malformed " +
  'SELECT "locked_at" FROM "attendance_sessions" WHERE "tenant_id" = ?';

function driverFault(): Error {
  return new Error(DRIVER_TEXT);
}

/** Asserts the result carries a generic sentence and zero driver leakage. */
function expectGeneric(error: string | undefined, generic: RegExp, action: string): void {
  expect(error).toMatch(generic);
  expect(error).not.toBe(DRIVER_TEXT);
  expect(error ?? "").not.toMatch(/SQLITE/i);
  expect(error ?? "").not.toMatch(/SELECT\s+"/i);
  expect(error ?? "").not.toMatch(/disk image|malformed/i);
  // Rule 9: the detail is not dropped, it is logged.
  const logged = mocks.log.error.mock.calls.filter(([event]) => event === action);
  expect(logged.length).toBeGreaterThan(0);
  expect(logged.some(([, message]) => String(message).includes(DRIVER_TEXT))).toBe(true);
}

/** A db seam whose first awaited call throws the driver fault. */
function faultingDb(): { db: unknown; userId: string; tenantId: string } {
  const failing = async (): Promise<never> => {
    throw driverFault();
  };
  return {
    db: {
      setting: { findFirst: failing, findUnique: failing },
      attendanceSession: { findFirst: failing, findMany: failing, update: failing },
      attendanceRecord: { findMany: failing },
      student: { findMany: failing },
      auditLog: { findMany: failing },
      batch: { findFirst: failing },
    },
    userId: TENANT,
    tenantId: TENANT,
  };
}

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "errleak-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, attendance_lock_hours INTEGER, theme TEXT, created_at TEXT, updated_at TEXT)",
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

async function seedPin(client: Client): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Test Institute', 's3cr3t', ?, ?, ?)",
    args: [TENANT, await hashPin(PIN), now, now],
  });
}

let client: Client | undefined;
let dir: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  if (client) {
    try {
      await Promise.resolve(client.close());
    } catch {
      // Best-effort: libSQL may already be closed.
    }
  }
  client = undefined;
  if (dir) {
    for (let attempt = 0; attempt < 5; attempt++) {
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

describe("unexpected faults never reach the tutor (Rule 9 / SEC-ERRLEAK-05)", () => {
  it("fetchAttendanceAction: generic sentence, no driver text", async () => {
    mocks.getAttendanceForDate.mockRejectedValue(driverFault());
    const res = await fetchAttendanceAction("2026-01-02");
    expect(res.success).toBe(false);
    expectGeneric(res.error, /Failed to fetch attendance/, "fetch_attendance_action_failed");
  });

  it("lockSessionAction: generic sentence, no driver text", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue(faultingDb());
    const res = await lockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expectGeneric(res.error, /Failed to lock session/, "lock_session_action_failed");
  });

  it("fetchAttendanceSummaryAction: generic sentence, no driver text", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue(faultingDb());
    const res = await fetchAttendanceSummaryAction("current_month");
    expect(res.ok).toBe(false);
    expectGeneric(res.error, /Failed to fetch attendance summary/, "attendance_summary_failed");
  });

  it("unlockSessionAction: generic sentence, no driver text", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue(faultingDb());
    const res = await unlockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expectGeneric(res.error, /Failed to unlock session/, "unlock_session_action_failed");
  });

  it("requestHardUnlockAction: generic sentence, no driver text", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue(faultingDb());
    const res = await requestHardUnlockAction("s1", "recorded by the tutor", PIN);
    expect(res.success).toBe(false);
    expectGeneric(res.error, /Failed to request unlock/, "request_hard_unlock_action_failed");
  });

  it("relockSessionAction: generic sentence, no driver text", async () => {
    mocks.getAuthenticatedPrisma.mockResolvedValue(faultingDb());
    const res = await relockSessionAction("s1");
    expect(res.success).toBe(false);
    expectGeneric(res.error, /Failed to re-lock session/, "relock_session_action_failed");
  });

  it("names the table but no SQL when the DB is genuinely missing one", async () => {
    // Real libSQL: a DB with no `settings` table produces a genuine driver
    // error, and the whole chain — execSafe → action catch → tutor — is walked.
    ({ client, dir } = await createTestDb());
    await client.execute("DROP TABLE settings");
    wireSeam(client);
    const res = await lockSessionAction("s1", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").not.toMatch(/SQLITE/i);
    expect(res.error ?? "").not.toMatch(/SELECT/i);
    expect(res.error ?? "").not.toMatch(/attendance_sessions/i);
  });
});

describe("deliberate refusals keep their own sentence (Rule 9)", () => {
  it("lockSessionAction still says 'Session not found.' when nothing matches", async () => {
    ({ client, dir } = await createTestDb());
    await seedPin(client);
    wireSeam(client);
    // No session row and no (date, batch) target: the typed
    // `AttendanceRefusalError` raised inside the transaction is the deliberate
    // refusal, and genericising it would tell the tutor nothing about what to do.
    const res = await lockSessionAction("missing", PIN);
    expect(res.success).toBe(false);
    expect(res.error ?? "").toMatch(/^Session not found\.$/);
    expect(res.error ?? "").not.toMatch(/Failed to lock session/);
    expect(mocks.log.warn).toHaveBeenCalledWith("lock_session_refused", "Session not found.", {
      sessionId: "missing",
    });
    // Rule 9: a refusal is not an error — nothing should reach `log.error`.
    expect(mocks.log.error).not.toHaveBeenCalled();
  });
});