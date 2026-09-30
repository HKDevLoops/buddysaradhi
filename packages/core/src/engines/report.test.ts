// Implements: 02_Core_Logic.md §11 (Report Engine — computed on demand from
// `ledger_entries` + `attendance_records`; CSV render incl. RFC 4180
// escaping), 12_Business_Rules.md BR-M-01 (paise in, formatted INR out),
// AGENTS.md §7.3 (real SQLite via `prisma db push`, never mocked).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../ledger";
import { generateReport } from "./report";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `report-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

async function seedStudent(
  tenantId: string,
  firstName: string,
  lastName: string | null = null,
): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName,
      lastName,
      admissionDate: "2026-09-01",
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

async function seedSession(tenantId: string, sessionDate: string): Promise<string> {
  const batchId = randomUUID();
  await prisma.batch.create({
    data: { id: batchId, tenantId, name: "Batch", createdAt: new Date() },
  });
  const sessionId = randomUUID();
  await prisma.attendanceSession.create({
    data: { id: sessionId, tenantId, batchId, sessionDate, createdAt: new Date() },
  });
  return sessionId;
}

async function markAttendance(
  tenantId: string,
  sessionId: string,
  studentId: string,
  status: string,
): Promise<void> {
  await prisma.attendanceRecord.create({
    data: {
      id: randomUUID(),
      tenantId,
      sessionId,
      studentId,
      status,
      markedAt: new Date(),
      createdAt: new Date(),
    },
  });
}

async function postEntry(
  tenantId: string,
  studentId: string,
  type: "FEE_CHARGED" | "PAYMENT_RECEIVED",
  debitPaise: number,
  creditPaise: number,
): Promise<void> {
  const res = await postLedgerEntry(prisma, {
    tenantId,
    studentId,
    type,
    debitPaise,
    creditPaise,
    occurredOn: new Date().toISOString(),
    source: "manual",
  });
  if (!res.ok) throw res.error;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "report-test-"));
  TEST_DB = join(tmpDir, "report-test.db").replace(/\\/g, "/");
  const DATABASE_URL = `file:${TEST_DB}`;
  const runner = process.platform === "win32" ? "npx.cmd" : "npx";
  execSync(`${runner} prisma db push --schema "${SCHEMA}" --accept-data-loss`, {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL },
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
}, 90000);

afterAll(async () => {
  if (prisma) await prisma.$disconnect().catch(() => {});
  await new Promise((r) => setTimeout(r, 100));
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    const p = TEST_DB + ext;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort cleanup
    }
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    // ignore
  }
}, 30000);

describe("generateReport attendance CSV (02 §11 — on demand from attendance_records)", () => {
  it("renders the header plus one row per record in the date window", async () => {
    const tenantId = await seedTenant();
    const aarav = await seedStudent(tenantId, "Aarav", "Sharma");
    const diya = await seedStudent(tenantId, "Diya", null);
    const sept = await seedSession(tenantId, "2026-09-15");
    const oct = await seedSession(tenantId, "2026-10-05");
    await markAttendance(tenantId, sept, aarav, "present");
    await markAttendance(tenantId, sept, diya, "absent");
    await markAttendance(tenantId, oct, aarav, "present");

    const csv = await generateReport(prisma, {
      tenantId,
      type: "attendance",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });

    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Date,Student,Status");
    expect(lines).toHaveLength(3); // header + 2 September rows
    expect(csv).toContain('"2026-09-15","Aarav Sharma","present"');
    expect(csv).toContain('"2026-09-15","Diya","absent"');
    expect(csv).not.toContain("2026-10-05");
  });

  it("RFC 4180-escapes quotes and commas in student names", async () => {
    const tenantId = await seedTenant();
    const tricky = await seedStudent(tenantId, 'Ann "Bea"', "Jr, Sr");
    const sessionId = await seedSession(tenantId, "2026-09-20");
    await markAttendance(tenantId, sessionId, tricky, "present");

    const csv = await generateReport(prisma, { tenantId, type: "attendance" });

    expect(csv).toContain('"Ann ""Bea"" Jr, Sr"');
  });

  it("renders a header-only CSV when nothing falls in the window", async () => {
    const tenantId = await seedTenant();
    const csv = await generateReport(prisma, {
      tenantId,
      type: "attendance",
      startDate: "2030-01-01",
      endDate: "2030-12-31",
    });
    expect(csv).toBe("Date,Student,Status\n");
  });
});

describe("generateReport fees CSV (02 §11 — on demand from ledger_entries)", () => {
  it("renders paise as INR with 2 decimals (BR-M-01 display rule)", async () => {
    const tenantId = await seedTenant();
    const aarav = await seedStudent(tenantId, "Aarav", "Sharma");
    await postEntry(tenantId, aarav, "FEE_CHARGED", 150000, 0);
    await postEntry(tenantId, aarav, "PAYMENT_RECEIVED", 0, 40000);

    const csv = await generateReport(prisma, {
      tenantId,
      type: "fees",
      startDate: "2000-01-01",
      endDate: "2100-01-01",
    });

    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("Date,Student,Type,Amount (INR)");
    expect(lines).toHaveLength(3);
    expect(csv).toContain('"FEE_CHARGED","1500.00"');
    expect(csv).toContain('"PAYMENT_RECEIVED","400.00"');
    expect(csv).toContain('"Aarav Sharma"');
  });

  it("renders a header-only CSV outside the created window", async () => {
    const tenantId = await seedTenant();
    const s = await seedStudent(tenantId, "Aarav", null);
    await postEntry(tenantId, s, "FEE_CHARGED", 1000, 0);

    const csv = await generateReport(prisma, {
      tenantId,
      type: "fees",
      startDate: "2100-01-02",
      endDate: "2100-12-31",
    });
    expect(csv).toBe("Date,Student,Type,Amount (INR)\n");
  });

  it("returns an empty string for an unknown report type", async () => {
    const tenantId = await seedTenant();
    // SAFETY: intentional invalid type to pin the fallthrough branch.
    const config = { tenantId, type: "bogus" as unknown as "fees" };
    await expect(generateReport(prisma, config)).resolves.toBe("");
  });
});
