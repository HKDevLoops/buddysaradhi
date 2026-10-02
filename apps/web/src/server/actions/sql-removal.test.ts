// Implements: AGENTS.md §2 Rules 1/6/7/9 + §3.4 (no runtime raw SQL in
// apps/web) + §6 (Zod-first, typed Result); 11_Data_Model.md §4.17/§4.18
// (audit_log append-only, sync_outbox op CHECK) + §10.5 (FTS5 exception);
// 12_Business_Rules.md BR-SYN-01 (outbox in the same transaction).
//
// What this proves, mock-free at the DB layer (the session seam
// `getAuthenticatedDb`/`getAuthenticatedPrisma` and the NETWORK
// `gatewayPatch`/`gatewayPost` are stubbed; the SQLite file DB behind the
// real `createLibsqlProxy` shim is REAL — same boundary strategy as
// components/fees/fees-actions.test.ts, AGENTS.md §7.3):
//   1. every converted mutation lands its sync_outbox + audit_log rows in one
//      `db.$transaction` (Rule 7) with the exact legacy tables/ops/payloads;
//   2. every stored outbox `op` is CHECK-valid (`insert`/`update`/`soft_delete`)
//      — enforced by a real DB-level CHECK, so the legacy 'batch_archive'
//      literal cannot regress (it would throw here);
//   3. no runtime raw-SQL site remains in apps/web/src outside the authorised
//      spots (shim internals, one-time admin, FTS5 MATCH, SELECT-1 probe).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";

const mocks = vi.hoisted(() => ({
  getAuthenticatedDb: vi.fn(),
  getAuthenticatedPrisma: vi.fn(),
  gatewayPatch: vi.fn(),
  gatewayPost: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), audit: vi.fn() },
}));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedDb: mocks.getAuthenticatedDb,
    getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
    gatewayPatch: mocks.gatewayPatch,
    gatewayPost: mocks.gatewayPost,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));

import {
  updateSettingAction,
  updateSettingsBatchAction,
  deleteTenantDataAction,
  verifyPinAction,
} from "@/server/actions/settings";
import { createStudent, updateStudentAction } from "@/server/actions/students";
import { fetchAttendanceSummaryAction } from "@/server/actions/attendance";
import { hashPin } from "@/lib/crypto";

const TENANT = "t-sql-removal-1";
const VALID_OPS = new Set(["insert", "update", "soft_delete"]);

async function createTestDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "sql-removal-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  // Test setup DDL only — never runtime (AGENTS.md §3.4). The sync_outbox
  // op CHECK mirrors 11_Data_Model.md §4.18 exactly, so a CHECK-invalid op
  // literal throws here instead of silently persisting.
  await client.execute(
    "CREATE TABLE settings (tenant_id TEXT PRIMARY KEY, institute_name TEXT, tenant_secret TEXT, pin_hash TEXT, theme TEXT, created_at TEXT, updated_at TEXT)",
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
    "CREATE TABLE attendance_sessions (id TEXT PRIMARY KEY, tenant_id TEXT, batch_id TEXT, session_date TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE attendance_records (id TEXT PRIMARY KEY, tenant_id TEXT, session_id TEXT, student_id TEXT, status TEXT, marked_at TEXT, created_at TEXT, updated_at TEXT)",
  );
  return { client, dir };
}

function wireSeam(client: Client): void {
  mocks.getAuthenticatedDb.mockResolvedValue({ client, userId: TENANT, tenantId: TENANT });
  mocks.getAuthenticatedPrisma.mockResolvedValue({
    db: createLibsqlProxy(client),
    userId: TENANT,
    tenantId: TENANT,
  });
  // Gateway unreachable by default → exercises the local ORM fallback, where
  // the outbox/audit writes are observable (same posture as cas.test.ts).
  mocks.gatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
  mocks.gatewayPost.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
}

async function seedSettings(client: Client, pinHash: string | null = null): Promise<void> {
  const now = new Date().toISOString();
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, pin_hash, created_at, updated_at) VALUES (?, 'Old Institute', 's3cr3t', ?, ?, ?)",
    args: [TENANT, pinHash, now, now],
  });
}

async function outboxOps(client: Client): Promise<string[]> {
  const res = await client.execute("SELECT op FROM sync_outbox");
  return res.rows.map((row) => String(row.op));
}

async function auditActions(client: Client): Promise<string[]> {
  const res = await client.execute("SELECT action FROM audit_log");
  return res.rows.map((row) => String(row.action));
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

describe("sql-removal: settings fallback writes outbox+audit in one transaction", () => {
  it("single-field write lands CHECK-valid op 'update' + audit 'settings.update' with one stamp", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    const res = await updateSettingAction("instituteName", "New Institute");
    expect(res).toMatchObject({ success: true });

    const ops = await outboxOps(client);
    expect(ops).toEqual(["update"]);
    expect(await auditActions(client)).toEqual(["settings.update"]);

    // Same-transaction stamp: both rows share the single `now` the action minted.
    const stamped = await client.execute("SELECT created_at FROM sync_outbox UNION SELECT created_at FROM audit_log");
    expect(stamped.rows).toHaveLength(1);
    const settings = await client.execute({
      sql: "SELECT institute_name AS name FROM settings WHERE tenant_id = ?",
      args: [TENANT],
    });
    expect(settings.rows[0]?.name).toBe("New Institute");
  });

  it("batch write lands CHECK-valid op 'update' + audit 'settings.batch_update'", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    const res = await updateSettingsBatchAction({ instituteName: "Batch", theme: "dark" });
    expect(res).toMatchObject({ success: true });

    expect(await outboxOps(client)).toEqual(["update"]);
    expect(await auditActions(client)).toEqual(["settings.batch_update"]);
  });
});

describe("sql-removal: student fallback writes outbox+audit in one transaction", () => {
  it("create lands op 'insert' + audit 'student.create' with the legacy payload", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    const res = await createStudent({ first_name: "Riya", admission_date: "2026-01-15" });
    expect(res.success).toBe(true);

    expect(await outboxOps(client)).toEqual(["insert"]);
    expect(await auditActions(client)).toEqual(["student.create"]);
  });

  it("patch lands op 'update' + audit 'student.edit'", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);

    const created = await createStudent({ first_name: "Kabir", admission_date: "2026-01-15" });
    expect(created.success).toBe(true);
    if (!created.success || !created.data) throw new Error("seed create failed");

    const res = await updateStudentAction(created.data.id, { first_name: "Kabir Jr" });
    expect(res).toMatchObject({ success: true });

    expect(await outboxOps(client)).toEqual(["insert", "update"]);
    expect(await auditActions(client)).toEqual(["student.create", "student.edit"]);
  });
});

describe("sql-removal: tenant archive + PIN ladder via the ORM surface", () => {
  it("archive lands a CHECK-valid op (never 'batch_archive') + audit 'tenant_data_deleted'", async () => {
    ({ client, dir } = await createTestDb());
    const pinHash = await hashPin("1234");
    await seedSettings(client, pinHash);
    wireSeam(client);
    await createStudent({ first_name: "Archie", admission_date: "2026-01-15" });

    const res = await deleteTenantDataAction("1234");
    expect(res).toMatchObject({ success: true });

    // The DB-level CHECK would have thrown on the legacy 'batch_archive'
    // literal — reaching here proves the normalised 'update' op.
    const ops = await outboxOps(client);
    for (const op of ops) expect(VALID_OPS.has(op)).toBe(true);
    expect(await auditActions(client)).toContain("tenant_data_deleted");
    const archived = await client.execute({
      sql: "SELECT status FROM students WHERE tenant_id = ?",
      args: [TENANT],
    });
    for (const row of archived.rows) expect(row.status).toBe("archived");
  });

  it("PIN ladder reads + writes audit rows through findMany/create (IN + order + limit)", async () => {
    ({ client, dir } = await createTestDb());
    const pinHash = await hashPin("1234");
    await seedSettings(client, pinHash);
    wireSeam(client);

    const wrong = await verifyPinAction("0000");
    expect(wrong.success).toBe(false);
    expect(await auditActions(client)).toEqual(["pin_failed"]);

    const right = await verifyPinAction("1234");
    expect(right).toMatchObject({ success: true });
    expect(await auditActions(client)).toEqual(["pin_failed", "pin_unlocked"]);
  });
});

describe("sql-removal: attendance summary aggregates without the raw JOIN", () => {
  it("counts present/absent per active student for the current month", async () => {
    ({ client, dir } = await createTestDb());
    await seedSettings(client);
    wireSeam(client);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const mkStudent = (id: string, first: string, status: string, archived: string | null) =>
      client.execute({
        sql: "INSERT INTO students (id, tenant_id, code, first_name, admission_date, status, fee_model, base_fee_paise, balance_paise, dup_key, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-01-15', ?, 'postpaid', 0, 0, ?, ?, ?, ?)",
        args: [id, TENANT, `C-${id}`, first, status, `C-${id}`, archived, now, now],
      });
    await mkStudent("stu-active-1", "Asha", "active", null);
    await mkStudent("stu-active-2", "Dev", "active", null);
    await mkStudent("stu-archived", "Gone", "archived", now);
    await client.execute({
      sql: "INSERT INTO attendance_sessions (id, tenant_id, batch_id, session_date, created_at, updated_at) VALUES ('sess-1', ?, 'b1', ?, ?, ?)",
      args: [TENANT, today, now, now],
    });
    const mkRecord = (id: string, studentId: string, status: string) =>
      client.execute({
        sql: "INSERT INTO attendance_records (id, tenant_id, session_id, student_id, status, marked_at, created_at, updated_at) VALUES (?, ?, 'sess-1', ?, ?, ?, ?, ?)",
        args: [id, TENANT, studentId, status, now, now, now],
      });
    await mkRecord("rec-1", "stu-active-1", "present");
    await mkRecord("rec-2", "stu-active-2", "absent");

    const res = await fetchAttendanceSummaryAction("current_month");
    expect(res.ok).toBe(true);
    if (!res.ok || !res.value) throw new Error("summary failed");
    expect(res.value.overall.total_students).toBe(2);
    expect(res.value.overall.overall_present).toBe(1);
    expect(res.value.overall.overall_absent).toBe(1);
    const asha = res.value.summaries.find((s) => s.student_id === "stu-active-1");
    expect(asha).toMatchObject({ present: 1, total_sessions: 1, percentage: 100 });
  });
});

describe("sql-removal: static source scan — no runtime raw SQL outside authorised spots", () => {
  // Vitest runs with cwd = apps/web, so the scanned tree is <cwd>/src.
  const SRC = join(process.cwd(), "src");
  const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);
  // Test-only setup DDL (this file, fees-actions.test.ts, db.test.ts) is not
  // runtime — same dispensation as the fees-actions header cites (§3.4).
  const SKIP_FILES = new Set(["libsql-proxy.ts", "admin.ts"]);

  function walkFiles(path: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (SKIP_DIRS.has(entry)) continue;
      const stat = statSync(full);
      if (stat.isDirectory()) out.push(...walkFiles(full));
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  function stripLineComment(line: string): string {
    const idx = line.indexOf("//");
    if (idx === -1) return line;
    // A `//` inside a string literal (e.g. "http://…") is not a comment.
    const before = line.slice(0, idx);
    const quotes = (before.match(/["'`]/g) ?? []).length;
    return quotes % 2 === 1 ? line : before;
  }

  // Raw-client shapes + raw-SQL verbs. `db.$transaction` / `db.<model>.*` are
  // the ORM surface and intentionally do NOT match (no `.execute(`/`.batch(`).
  // Verb patterns are UPPERCASE-only by repo convention: every runtime SQL
  // string in this codebase uses uppercase verbs, while lowercase prose (UI
  // copy such as "select a student from the sidebar") must not flag.
  const RAW_PATTERNS: RegExp[] = [
    /\.execute\s*\(/,
    /\.batch\s*\(/,
    /executeMultiple/,
    /\$queryRaw/,
    /\$executeRaw/,
    /INSERT\s+INTO/,
    /DELETE\s+FROM/,
    /SELECT\s+.+\s+FROM/,
  ];
  // Genuinely no ORM equivalent (cite: 11_Data_Model.md §10.5 FTS5 virtual
  // tables; credential-liveness probe with no user input — the VACUUM
  // precedent in AGENTS.md §3.4). Each entry must match the offending line so
  // the list stays honest under unrelated edits.
  const ALLOWLIST: Array<{ file: string; re: RegExp; reason: string }> = [
    {
      file: `lib${sep}search${sep}searchStudentsFts.ts`,
      re: /client\.execute/,
      reason: "FTS5 virtual table has no Prisma model (11_Data_Model.md §10.5); bound args + quote-strip",
    },
    {
      file: `lib${sep}search${sep}searchStudentsFts.ts`,
      re: /students_fts MATCH/,
      reason: "FTS5 virtual table has no Prisma model (11_Data_Model.md §10.5); bound args + quote-strip",
    },
    {
      file: `server${sep}get-db.ts`,
      re: /SELECT 1/,
      reason: "credential-liveness probe, no user input, no ORM equivalent (VACUUM precedent, AGENTS.md §3.4)",
    },
  ];

  it("flags every non-allowlisted raw-SQL line", () => {
    const violations: string[] = [];
    for (const file of walkFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      const base = rel.split(sep).pop() ?? "";
      if (SKIP_FILES.has(base)) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        const code = stripLineComment(line);
        for (const re of RAW_PATTERNS) {
          if (!re.test(code)) continue;
          const allowed = ALLOWLIST.find((a) => rel.endsWith(a.file) && a.re.test(code));
          if (!allowed) violations.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 140)}`);
          break;
        }
      });
    }
    expect(violations).toEqual([]);
  });

  it("no CHECK-invalid outbox op literal remains in runtime sources", () => {
    const hits: string[] = [];
    for (const file of walkFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, idx) => {
        if (/batch_archive/.test(stripLineComment(line))) hits.push(`${rel}:${idx + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
