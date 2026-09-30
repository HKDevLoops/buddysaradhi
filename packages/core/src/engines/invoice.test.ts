// Implements: 12_Business_Rules.md BR-LED-03 (monotonic gap-tolerant
// numbering, pad-6), BR-M-01 (integer paise), BR-SYN-01 (sync_outbox in the
// same transaction), 07_Fees_and_Payments.md §10.3 BR-FEE-05 (canonical tamper
// hash) + BR-FEE-06 (discount units), 14_Edge_Cases.md EC-F-01 (half-to-even)
// + EC-SEC-03 (tamper mismatch), AGENTS.md §2 Rules 6 + 7 + §7.3 (real SQLite
// via `prisma db push`, never mocked).
//
// Resolved 2026-09-30 via 22_Redundancy_Audit.md P16 (scope-split, pending
// human ratification): BR-FEE-01 governs division sites (half-to-even),
// BR-M-05 governs the display step + instalment splits. FIND-INV-02 fixed in
// ./invoice.ts via paiseDivHalfEven; pin is a normal test now.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { generateBatchInvoices } from "./invoice";
import { computeInvoiceTamperHash } from "../tamper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `batch-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

async function seedStudent(tenantId: string): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName: "Batch",
      lastName: "Student",
      admissionDate: "2026-09-01",
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

async function seedBatch(tenantId: string, id: string): Promise<void> {
  await prisma.batch.create({
    data: { id, tenantId, name: id, createdAt: new Date() },
  });
}

async function seedFeePlan(
  tenantId: string,
  studentId: string,
  overrides: { batchId?: string; baseAmount?: number; discountType?: string; discountValue?: number; isActive?: number } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.feePlan.create({
    data: {
      id,
      tenantId,
      studentId,
      batchId: overrides.batchId ?? null,
      model: "postpaid",
      cycle: "monthly",
      baseAmount: overrides.baseAmount ?? 100000,
      startDate: "2026-09-01",
      discountType: overrides.discountType ?? null,
      discountValue: overrides.discountValue ?? null,
      isActive: overrides.isActive ?? 1,
      createdAt: new Date(),
    },
  });
  return id;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "invoice-test-"));
  TEST_DB = join(tmpDir, "invoice-test.db").replace(/\\/g, "/");
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

describe("generateBatchInvoices filtering (07 §4 batch run)", () => {
  it("returns [] when no active fee plans exist", async () => {
    const tenantId = await seedTenant();
    await expect(
      generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      }),
    ).resolves.toEqual([]);
  });

  it("throws a typed error when tenant settings are missing (Rule 9, never silent)", async () => {
    const tenantId = `nosettings-${randomUUID()}`;
    const studentId = randomUUID();
    // Fee plan without a settings row: setting lookup must fail closed.
    await prisma.student.create({
      data: {
        id: studentId,
        tenantId,
        firstName: "Ghost",
        admissionDate: "2026-09-01",
        dupKey: `${tenantId}:${studentId}`,
        createdAt: new Date(),
      },
    });
    await seedFeePlan(tenantId, studentId);

    await expect(
      generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      }),
    ).rejects.toThrow(/Settings not found/);
  });

  it("processes only the requested batch and skips inactive plans", async () => {
    const tenantId = await seedTenant();
    await seedBatch(tenantId, "B1");
    await seedBatch(tenantId, "B2");
    const s1 = await seedStudent(tenantId);
    const s2 = await seedStudent(tenantId);
    const s3 = await seedStudent(tenantId);
    await seedFeePlan(tenantId, s1, { batchId: "B1" });
    await seedFeePlan(tenantId, s2, { batchId: "B2" });
    await seedFeePlan(tenantId, s3, { batchId: "B1", isActive: 0 });

    const results = await generateBatchInvoices(prisma, {
      tenantId,
      batchId: "B1",
      dueDate: "2026-10-01",
      issueDate: "2026-09-15",
      periodLabel: "Sep 2026",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ studentId: s1, status: "success" });
  });
});

describe("generateBatchInvoices money + numbering (BR-M-01, BR-LED-03, Rule 7)", () => {
  it("assigns monotonic pad-6 numbers and persists the sequence", async () => {
    const tenantId = await seedTenant();
    const s1 = await seedStudent(tenantId);
    const s2 = await seedStudent(tenantId);
    await seedFeePlan(tenantId, s1, { baseAmount: 100000 });
    await seedFeePlan(tenantId, s2, { baseAmount: 50000 });

    const results = await generateBatchInvoices(prisma, {
      tenantId,
      dueDate: "2026-10-01",
      issueDate: "2026-09-15",
      periodLabel: "Sep 2026",
    });

    expect(results).toHaveLength(2);
    for (const r of results) expect(r.status).toBe("success");

    const invoices = await prisma.invoice.findMany({
      where: { tenantId },
      orderBy: { number: "asc" },
    });
    expect(invoices.map((i) => i.number)).toEqual(["INV-000001", "INV-000002"]);
    // Sequence allocation follows the plan fetch order, so assert totals as
    // a set: one 100000 invoice and one 50000 invoice, gap-free numbers.
    expect(invoices.map((i) => i.total).sort((a, b) => a - b)).toEqual([50000, 100000]);
    for (const inv of invoices) {
      expect(inv.status).toBe("unpaid");
      expect(inv.tamperHash).toMatch(/^[0-9a-f]{64}$/);
    }

    const setting = await prisma.setting.findUniqueOrThrow({ where: { tenantId } });
    expect(setting.nextInvoiceSeq).toBe(3);

    // Rule 7: every invoice create queued its outbox row in the same tx.
    expect(
      await prisma.syncOutbox.count({
        where: { tenantId, tableName: "invoices", status: "pending" },
      }),
    ).toBe(2);
  });

  it("applies fixed discounts in integer paise", async () => {
    const tenantId = await seedTenant();
    const s1 = await seedStudent(tenantId);
    await seedFeePlan(tenantId, s1, {
      baseAmount: 100000,
      discountType: "fixed",
      discountValue: 15000,
    });

    const [result] = await generateBatchInvoices(prisma, {
      tenantId,
      dueDate: "2026-10-01",
      issueDate: "2026-09-15",
      periodLabel: "Sep 2026",
    });
    expect(result?.status).toBe("success");

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: result?.invoiceId } });
    expect(inv.subtotal).toBe(100000);
    expect(inv.discount).toBe(15000);
    expect(inv.total).toBe(85000);
  });

  it("applies basis-point discounts exactly (no float dust)", async () => {
    const tenantId = await seedTenant();
    const s1 = await seedStudent(tenantId);
    await seedFeePlan(tenantId, s1, {
      baseAmount: 100000,
      discountType: "percent",
      discountValue: 1000, // 10% in basis points (BR-FEE-06)
    });

    const [result] = await generateBatchInvoices(prisma, {
      tenantId,
      dueDate: "2026-10-01",
      issueDate: "2026-09-15",
      periodLabel: "Sep 2026",
    });
    expect(result?.status).toBe("success");

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: result?.invoiceId } });
    expect(inv.discount).toBe(10000);
    expect(inv.total).toBe(90000);
  });

  it("isolates per-student failures: one collision errors, the rest succeed, seq still advances", async () => {
    const tenantId = await seedTenant();
    const s1 = await seedStudent(tenantId);
    const s2 = await seedStudent(tenantId);
    await seedFeePlan(tenantId, s1, { baseAmount: 10000 });
    await seedFeePlan(tenantId, s2, { baseAmount: 20000 });

    // Decoy occupies the first sequence number the batch will claim.
    await prisma.invoice.create({
      data: {
        id: randomUUID(),
        tenantId,
        number: "INV-000001",
        studentId: s2,
        issueDate: "2026-09-15",
        subtotal: 1,
        total: 1,
        tamperHash: "decoy",
        createdAt: new Date(),
      },
    });

    const results = await generateBatchInvoices(prisma, {
      tenantId,
      dueDate: "2026-10-01",
      issueDate: "2026-09-15",
      periodLabel: "Sep 2026",
    });

    expect(results).toHaveLength(2);
    const ok = results.filter((r) => r.status === "success");
    const failed = results.filter((r) => r.status === "error");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(String(failed[0]?.error)).toMatch(/UNIQUE|constraint/i);

    // Gap-tolerant sequence: consumed numbers stay consumed (BR-LED-03).
    const setting = await prisma.setting.findUniqueOrThrow({ where: { tenantId } });
    expect(setting.nextInvoiceSeq).toBe(3);
  });
});

describe("batch writer vs canonical invoice contract — SPEC pins", () => {
  it(
    "FIND-INV-01: batch tamper_hash equals the canonical §10 formula (10_Security.md §10 / 07 BR-FEE-05 / EC-SEC-03)",
    async () => {
      const tenantId = await seedTenant();
      const s1 = await seedStudent(tenantId);
      await seedFeePlan(tenantId, s1, { baseAmount: 100000 });

      const [result] = await generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      });
      expect(result?.status).toBe("success");

      const inv = await prisma.invoice.findUniqueOrThrow({
        where: { id: result?.invoiceId },
      });
      const setting = await prisma.setting.findUniqueOrThrow({ where: { tenantId } });
      const stored = await prisma.invoice.findUniqueOrThrow({
        where: { id: result?.invoiceId },
        select: { issueDate: true },
      });

      // Canonical: sha256(number|student_id|total|issue_date|tenant_secret).
      expect(inv.tamperHash).toBe(
        computeInvoiceTamperHash(
          {
            number: inv.number,
            studentId: inv.studentId,
            totalPaise: inv.total,
            issueDate: stored.issueDate,
          },
          setting.tenantSecret,
        ),
      );
    },
  );

  it(
    "FIND-INV-02: fractional-paise discounts round half-to-even (EC-F-01 / BR-FEE-01)",
    async () => {
      const tenantId = await seedTenant();
      const s1 = await seedStudent(tenantId);
      // 10% = 1000bps of 125555 = 12555.5 paise → half-to-even = 12556 → total 112999.
      await seedFeePlan(tenantId, s1, {
        baseAmount: 125555,
        discountType: "percent",
        discountValue: 1000,
      });

      const [result] = await generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      });
      expect(result?.status).toBe("success");

      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: result?.invoiceId } });
      expect(inv.discount).toBe(12556);
      expect(inv.total).toBe(112999);
    },
  );

  it(
    "FIND-INV-03: percent discounts are basis points, 1000 = 10% (07 §10.3 BR-FEE-06)",
    async () => {
      const tenantId = await seedTenant();
      const s1 = await seedStudent(tenantId);
      await seedFeePlan(tenantId, s1, {
        baseAmount: 100000,
        discountType: "percent",
        discountValue: 1000, // 10% in basis points
      });

      const [result] = await generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      });
      expect(result?.status).toBe("success");

      // Spec: 10% off 100000 = 90000.
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: result?.invoiceId } });
      expect(inv.total).toBe(90000);
    },
  );

  it(
    "FIND-INV-04: every batch invoice mutation writes an audit_log row (Rule 7 / 02 §13 AP-13)",
    async () => {
      const tenantId = await seedTenant();
      const s1 = await seedStudent(tenantId);
      await seedFeePlan(tenantId, s1, { baseAmount: 100000 });

      const [result] = await generateBatchInvoices(prisma, {
        tenantId,
        dueDate: "2026-10-01",
        issueDate: "2026-09-15",
        periodLabel: "Sep 2026",
      });
      expect(result?.status).toBe("success");

      // Rule 7 / AP-13: the batch path writes sync_outbox + audit_log rows
      // in the same transaction as the invoice.
      expect(await prisma.auditLog.count({ where: { tenantId } })).toBeGreaterThan(0);
    },
  );
});
