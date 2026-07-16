import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execFileSync } from "child_process";
import { existsSync, unlinkSync, mkdirSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { getPrismaClient } from "../../../apps/gateway/src/db";
import { PrismaClient } from "../../../apps/gateway/src/prisma";
import {
  postLedgerEntry,
  voidEntry,
  computeBalance,
  reconcileLedger,
} from "./ledger";

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TENANT = "test-tenant";

const REPO = resolve(__dirname, "../../../"); // packages/core/src -> repo root
const SCHEMA = resolve(REPO, "apps/gateway/prisma/schema.prisma");

let TEST_DB: string;
let DATABASE_URL: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant() {
  await prisma.setting.upsert({
    where: { tenantId: TENANT },
    update: {},
    create: {
      tenantId: TENANT,
      tenantSecret: randomUUID(),
      createdAt: new Date(),
    },
  });
}

async function makeStudent() {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId: TENANT,
      firstName: "Test",
      lastName: "Student",
      admissionDate: new Date().toISOString(),
      dupKey: `${TENANT}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "ledger-test-"));
  TEST_DB = join(tmpDir, "ledger-test.db").replace(/\\/g, "/");
  DATABASE_URL = `file:${TEST_DB}`;
  execFileSync(
    "bun",
    [
      "x",
      "prisma",
      "db",
      "push",
      "--schema",
      SCHEMA,
      "--skip-generate",
      "--accept-data-loss",
    ],
    {
      stdio: "ignore",
      env: { ...process.env, DATABASE_URL },
    },
  );
  prisma = getPrismaClient(DATABASE_URL, "");
});

afterAll(async () => {
  await prisma.$disconnect();
  await new Promise((r) => setTimeout(r, 100));
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    const p = TEST_DB + ext;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      // best-effort cleanup; libsql may still hold the handle briefly
    }
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    // ignore
  }
});

describe("postLedgerEntry", () => {
  it("posts a chained fee entry and updates the running balance", async () => {
    await seedTenant();
    const studentId = await makeStudent();

    const posted = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 150000,
      creditPaise: 0,
      description: "Tuition",
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(posted.ok).toBe(true);
    const entryId = posted.ok ? posted.value : "";

    const entry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: entryId },
    });
    expect(entry.prevHash).toBeNull();
    expect(entry.balanceAfterPaise).toBe(150000);
    expect(await computeBalance(prisma, TENANT, studentId)).toBe(150000);

    const payment = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: 150000,
      description: "Paid",
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(payment.ok).toBe(true);

    const paymentEntry = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: payment.ok ? payment.value : "" },
    });
    expect(paymentEntry.prevHash).toBe(entry.thisHash);
    expect(paymentEntry.balanceAfterPaise).toBe(0);
    expect(await computeBalance(prisma, TENANT, studentId)).toBe(0);

    const reconciled = await reconcileLedger(prisma, TENANT, studentId);
    expect(reconciled.ok).toBe(true);
    expect(reconciled.ok && reconciled.value).toBe(true);
  });

  it("rejects negative paise", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    const res = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: -100,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
  });

  it("rejects non-integer paise", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    const res = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 100.5,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
  });

  it("throws when the tenant setting is missing", async () => {
    const studentId = await makeStudent();
    const res = await postLedgerEntry(prisma, {
      tenantId: "ghost-tenant",
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 100,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
    });
    expect(res.ok).toBe(false);
  });
});

describe("reconcileLedger tamper detection", () => {
  it("detects a corrupted hash without touching the amount (hash mismatch)", async () => {
    await seedTenant();
    const studentId = await makeStudent();

    const a = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 150000,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(a.ok).toBe(true);
    const b = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 50000,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(b.ok).toBe(true);
    const secondId = b.ok ? b.value : "";

    expect((await reconcileLedger(prisma, TENANT, studentId)).ok).toBe(true);

    // Tamper ONLY the stored hash; amount + balanceAfterPaise stay internally consistent.
    await prisma.ledgerEntry.update({
      where: { id: secondId },
      data: { thisHash: "deadbeef".repeat(8) },
    });

    const after = await reconcileLedger(prisma, TENANT, studentId);
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(String(after.error)).toMatch(/hash mismatch/i);
    }
  });

  it("detects a corrupted amount and reports balance mismatch before hash mismatch", async () => {
    await seedTenant();
    const studentId = await makeStudent();

    const a = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 150000,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(a.ok).toBe(true);
    const b = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 50000,
      creditPaise: 0,
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(b.ok).toBe(true);
    const secondId = b.ok ? b.value : "";

    expect((await reconcileLedger(prisma, TENANT, studentId)).ok).toBe(true);

    // Tamper with the amount WITHOUT recomputing the hash or balance. The balance
    // check must fire before the hash check (ordering invariant).
    await prisma.ledgerEntry.update({
      where: { id: secondId },
      data: { debitPaise: 99999 },
    });

    const after = await reconcileLedger(prisma, TENANT, studentId);
    expect(after.ok).toBe(false);
    if (!after.ok) {
      const msg = String(after.error);
      expect(msg).toMatch(/balance mismatch/i);
      expect(msg).not.toMatch(/hash mismatch/i);
    }
  });
});

describe("voidEntry", () => {
  it("creates a reversing entry and restores the balance to zero", async () => {
    await seedTenant();
    const studentId = await makeStudent();

    const posted = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 150000,
      creditPaise: 0,
      description: "Tuition",
      occurredOn: new Date().toISOString(),
      source: "manual",
    });
    expect(posted.ok).toBe(true);
    const entryId = posted.ok ? posted.value : "";
    expect(await computeBalance(prisma, TENANT, studentId)).toBe(150000);

    const voided = await voidEntry(
      prisma,
      TENANT,
      entryId,
      "entered wrong amount",
      new Date().toISOString(),
      "test-actor",
    );
    expect(voided.ok).toBe(true);
    const voidId = voided.ok ? voided.value : "";

    const voidEntryRow = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: voidId },
    });
    expect(voidEntryRow.type).toBe("VOID");
    expect(voidEntryRow.debitPaise).toBe(0);
    expect(voidEntryRow.creditPaise).toBe(150000);
    expect(voidEntryRow.voidOfId).toBe(entryId);

    // Net effect of fee + void is zero.
    expect(await computeBalance(prisma, TENANT, studentId)).toBe(0);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "ledger_void", tenantId: TENANT },
    });
    expect(audit).not.toBeNull();

    expect((await reconcileLedger(prisma, TENANT, studentId)).ok).toBe(true);
  });
});
