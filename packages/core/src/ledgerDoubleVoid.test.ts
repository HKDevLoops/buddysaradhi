// Implements: 12_Business_Rules.md BR-LED-04 ("a double-void is a conflict,
// not a second reversing row") and BR-CALC-* invoice attribution.
//
// ─────────────────────────────────────────────────────────────────────────────
// F-07. `voidEntry` COULD DOUBLE-CORRECT.
//
// The only guard was `original.type === "VOID"`, which refuses voiding a VOID.
// It did NOT refuse voiding a payment that had already been voided: on the
// second attempt `original.type` is still PAYMENT_RECEIVED, so the guard
// passes and a SECOND mirroring row is posted. The books then read as though
// the money were owed to the tutor — original credit + two debits.
//
// Already known in-repo as a test NAME with no assertion behind it:
// apps/web/src/components/fees/void-sequence.test.ts:431 —
//   "KNOWN P0: voiding an already-voided payment is NOT refused by voidEntry
//    — it double-corrects"
// Latent while nothing called it. The gateway's void route and the web's

// void action both call voidEntry, so it is reachable.

// calls voidEntry, so it is now reachable.
//
// These tests run against a REAL SQLite database (AGENTS.md §7.3 — a mocked DB
// cannot tell you whether a trigger fires), using the same fixture pattern as
// ledger.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdirSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { PrismaClient } from "@prisma/client";
import { postLedgerEntry, voidEntry, computeBalance } from "./ledger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TENANT = "f07-tenant";
const OTHER = "f07-other-tenant";

const REPO = resolve(__dirname, "../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let DATABASE_URL: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(tenantId = TENANT) {
  await prisma.setting.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
}

async function makeStudent(tenantId = TENANT) {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName: "F07",
      lastName: "Student",
      admissionDate: new Date().toISOString(),
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

/** Create a real invoice row. `ledger_entries.invoice_id` is a FK, so a test
 *  that wants an attributed payment needs an invoice to attribute it TO — a
 *  bare randomUUID() fails the constraint, not the code under test. */
async function makeInvoice(studentId: string, total: number, tenantId = TENANT) {
  const id = randomUUID();
  await prisma.invoice.create({
    data: {
      id,
      tenantId,
      number: `INV-${id.slice(0, 8)}`,
      studentId,
      issueDate: new Date().toISOString(),
      subtotal: total,
      total,
      tamperHash: `unverified-legacy:${id}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  return id;
}

/** Post a PAYMENT_RECEIVED (credit) row and return its id. */
async function postPayment(
  sid: string,
  creditPaise: number,
  invoiceId: string | null = null,
  tenantId = TENANT,
): Promise<string> {
  const res = await postLedgerEntry(prisma as never, {
    tenantId,
    studentId: sid,
    type: "PAYMENT_RECEIVED",
    debitPaise: 0,
    creditPaise,
    description: "test payment",
    invoiceId,
    occurredOn: new Date().toISOString(),
    source: "manual",
  });
  if (!res.ok) throw res.error;
  return res.value;
}

function voidIt(entryId: string, reason = "r", tenantId = TENANT) {
  return voidEntry(
    prisma as never,
    tenantId,
    entryId,
    reason,
    new Date().toISOString(),
    "test-actor",
  );
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "f07-"));
  TEST_DB = join(tmpDir, "f07.db").replace(/\\/g, "/");
  DATABASE_URL = `file:${TEST_DB}`;
  const runner = "bunx"; // Package manager migrated pnpm -> bun: `npx(.cmd)` resolves binaries through `.bin/*.cmd` shims, which bun's native launcher layout does not create. `bunx` resolves from the workspace lockfile instead.
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
      /* best-effort */
    }
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    /* ignore */
  }
}, 30000);

beforeEach(async () => {
  await seedTenant(TENANT);
  await seedTenant(OTHER);
});

describe("F-07 / voidEntry refuses a double-void (BR-LED-04)", () => {
  it("a second void of the SAME payment is refused, not applied", async () => {
    const studentId = await makeStudent();
    const paymentId = await postPayment(studentId, 150000);

    const first = await voidIt(paymentId, "wrong amount");
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The regression: pre-fix this SUCCEEDED and posted a second reversing row.
    const second = await voidIt(paymentId, "wrong amount again");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toMatch(/already been voided/);
  });

  it("exactly ONE reversing row exists after a refused double-void", async () => {
    const studentId = await makeStudent();
    const paymentId = await postPayment(studentId, 90000);
    await voidIt(paymentId);
    await voidIt(paymentId);
    const voids = await prisma.ledgerEntry.findMany({
      where: { tenantId: TENANT, voidOfId: paymentId },
    });
    expect(voids).toHaveLength(1);
  });

  it("the balance nets to zero once, not to a phantom debt to the tutor", async () => {
    const studentId = await makeStudent();
    const before = await computeBalance(prisma, TENANT, studentId);
    const paymentId = await postPayment(studentId, 150000);
    await voidIt(paymentId);
    await voidIt(paymentId);
    const after = await computeBalance(prisma, TENANT, studentId);
    // One payment + one void -> back to `before`. A second void would have
    // left the student appearing to owe 150000 MORE.
    expect(after).toBe(before);
  });

  it("two DISTINCT payments can each be voided independently", async () => {
    // The guard must key on the entry, not blanket-refuse.
    const studentId = await makeStudent();
    const a = await postPayment(studentId, 10000);
    const b = await postPayment(studentId, 20000);
    expect((await voidIt(a)).ok).toBe(true);
    expect((await voidIt(b)).ok).toBe(true);
  });
});

describe("F-07 / the reversing row carries invoiceId (per-invoice attribution)", () => {
  it("voiding an invoice-attributed payment keeps the invoice link", async () => {
    // Every `creditedForInvoice` filters over rows matched ON invoice_id
    // (feesFlow.ts:412). Voiding without copying the link left the invoice's
    // credited total unchanged, so the invoice still read `paid` while the
    // balance had already moved.
    const studentId = await makeStudent();
    const invoiceId = await makeInvoice(studentId, 120000);
    const paymentId = await postPayment(studentId, 120000, invoiceId);

    const res = await voidIt(paymentId, "reversal");
    expect(res.ok).toBe(true);

    const voidRow = await prisma.ledgerEntry.findFirst({
      where: { tenantId: TENANT, voidOfId: paymentId },
    });
    expect(voidRow).not.toBeNull();
    expect(voidRow?.invoiceId).toBe(invoiceId);
  });

  it("a payment with no invoice voids with a null invoiceId", async () => {
    const studentId = await makeStudent();
    const paymentId = await postPayment(studentId, 40000, null);
    await voidIt(paymentId);
    const voidRow = await prisma.ledgerEntry.findFirst({
      where: { tenantId: TENANT, voidOfId: paymentId },
    });
    expect(voidRow?.invoiceId).toBeNull();
  });
});

describe("F-07 / the pre-existing guards still hold", () => {
  it("still refuses to void a VOID (BR-LED-05)", async () => {
    const studentId = await makeStudent();
    const paymentId = await postPayment(studentId, 10000);
    const first = await voidIt(paymentId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await voidIt(first.value, "void the void");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toMatch(/Cannot void a void/);
  });

  it("still refuses an unknown entry", async () => {
    const res = await voidIt(randomUUID());
    expect(res.ok).toBe(false);
  });

  it("does not let one tenant void another tenant's payment", async () => {
    const otherStudent = await makeStudent(OTHER);
    const otherPayment = await postPayment(otherStudent, 60000, null, OTHER);
    // Scoped lookup: the entry belongs to OTHER, so this must not find it.
    const res = await voidIt(otherPayment, "r", TENANT);
    expect(res.ok).toBe(false);
  });
});