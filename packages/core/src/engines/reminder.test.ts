// Implements: 02_Core_Logic.md §7 (Reminder Engine — data-driven dues;
// current v1 counts active students with a positive ledger balance),
// 12_Business_Rules.md BR-M-01 (integer paise balances),
// AGENTS.md §2 Rule 1 (seed ledger rows via postLedgerEntry — never
// hand-inserted) + §7.3 (real SQLite via `prisma db push`, never mocked).
//
// NOTE (observation OBS-2): 02 §7 describes a full tick/snooze/fire engine;
// this module is a count stub (in-code TODO to integrate the notification
// engine). These tests pin the CURRENT count contract.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry } from "../ledger";
import { processReminders } from "./reminder";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `reminder-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

async function seedStudent(tenantId: string, status = "active"): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName: "Rem",
      lastName: "Student",
      status,
      admissionDate: "2026-09-01",
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

async function postBalance(
  tenantId: string,
  studentId: string,
  debitPaise: number,
  creditPaise: number,
): Promise<void> {
  const res = await postLedgerEntry(prisma, {
    tenantId,
    studentId,
    type: creditPaise > 0 ? "PAYMENT_RECEIVED" : "FEE_CHARGED",
    debitPaise,
    creditPaise,
    occurredOn: new Date().toISOString(),
    source: "manual",
  });
  if (!res.ok) throw res.error;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "reminder-test-"));
  TEST_DB = join(tmpDir, "reminder-test.db").replace(/\\/g, "/");
  const DATABASE_URL = `file:${TEST_DB}`;
  const runner = process.platform === "win32" ? "npx.cmd" : "npx";
  execSync(`${runner} prisma db push --schema "${SCHEMA}" --accept-data-loss`, {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL },
  });
  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
  await prisma.$connect();
}, 60000);

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

describe("processReminders due-fee count (02 §7 — data-driven, actionable)", () => {
  it("counts active students whose latest balance is positive", async () => {
    const tenantId = await seedTenant();
    const owing = await seedStudent(tenantId);
    await postBalance(tenantId, owing, 50000, 0);

    await expect(processReminders(prisma, tenantId)).resolves.toBe(1);
  });

  it("excludes settled, untouched and inactive students", async () => {
    const tenantId = await seedTenant();

    const owing = await seedStudent(tenantId);
    await postBalance(tenantId, owing, 50000, 0);

    const settled = await seedStudent(tenantId);
    await postBalance(tenantId, settled, 50000, 0);
    await postBalance(tenantId, settled, 0, 50000);

    await seedStudent(tenantId); // no ledger entries at all

    const inactive = await seedStudent(tenantId, "inactive");
    await postBalance(tenantId, inactive, 90000, 0);

    await expect(processReminders(prisma, tenantId)).resolves.toBe(1);
  });

  it("is scoped to the requesting tenant", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();

    const a = await seedStudent(tenantA);
    await postBalance(tenantA, a, 10000, 0);
    const b = await seedStudent(tenantB);
    await postBalance(tenantB, b, 20000, 0);
    const b2 = await seedStudent(tenantB);
    await postBalance(tenantB, b2, 30000, 0);

    await expect(processReminders(prisma, tenantA)).resolves.toBe(1);
    await expect(processReminders(prisma, tenantB)).resolves.toBe(2);
  });

  it("returns 0 for a fresh tenant (typed number, never null)", async () => {
    const tenantId = await seedTenant();
    await expect(processReminders(prisma, tenantId)).resolves.toBe(0);
  });
});
