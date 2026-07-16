import { getPrismaClient } from "../src/db";
import { postLedgerEntry } from "../../../packages/core/src/ledger";
import { randomBytes } from "crypto";

/**
 * Gateway seed/provision script.
 *
 * Modes:
 *   --init [tenantId]   Bootstrap an EMPTY tutor DB: insert Setting (with a
 *                       random tenantSecret) + AppState. No demo data. This is
 *                       what runs for a real tutor after provisionTutorDb hands
 *                       back a new tenantId. Idempotent (upsert).
 *   --demo              Seed demo data for the local-dev tenant (batch,
 *                       students + ledger via postLedgerEntry so hashes match
 *                       reconcileLedger). Dev-only; gated so it never runs
 *                       automatically in production.
 *   (none)              In production, does nothing unless --demo/--init given.
 *                       In dev, defaults to --demo for convenience.
 *
 * Implements: AGENTS.md §2 (append-only ledger, integer paise). Demo ledger
 * rows are posted through packages/core postLedgerEntry so the hash chain
 * matches the runtime verify command.
 */

const db = getPrismaClient(
  process.env.DATABASE_URL || "file:./dev.db",
  process.env.DB_TOKEN || ""
);

const TENANT = "local-dev";

function parseArgs() {
  const argv = process.argv.slice(2);
  const isProd = process.env.NODE_ENV === "production";
  const wantDemo = argv.includes("--demo") || process.env.SEED_DEMO === "true";
  const initIdx = argv.indexOf("--init");
  const initTenant = initIdx !== -1 ? argv[initIdx + 1] : process.env.INIT_TENANT;
  return { isProd, wantDemo, initTenant };
}

async function runInit(tenantId: string) {
  const now = new Date().toISOString();
  const tenantSecret = randomBytes(32).toString("hex");

  await db.setting.upsert({
    where: { tenantId },
    create: { tenantId, tenantSecret, createdAt: now },
    update: { updatedAt: now },
  });

  await db.appState.upsert({
    where: { tenantId },
    create: { tenantId, schemaVersion: 1, createdAt: now },
    update: { updatedAt: now },
  });

  console.log(`[init] tutor DB bootstrapped: tenantId=${tenantId}`);
}

type DemoLedgerRow = {
  studentId: string;
  type: "FEE_CHARGED" | "PAYMENT_RECEIVED" | "DISCOUNT_GRANTED" | "REFUND_ISSUED";
  debitPaise: number;
  creditPaise: number;
  description: string;
  occurredOn: string;
};

async function runDemo() {
  const now = new Date().toISOString();

  // Setting for the dev tenant (fixed secret so demo + verify stay in sync).
  await db.setting.upsert({
    where: { tenantId: TENANT },
    create: {
      tenantId: TENANT,
      instituteName: "Cosmic Tuitions",
      currencyCode: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      invoicePrefix: "INV-",
      receiptPrefix: "RCP-",
      tenantSecret: "seed-secret-local-dev",
      createdAt: now,
    },
    update: { updatedAt: now },
  });

  // Idempotent re-seed: clear prior demo data (children before parents).
  await db.ledgerEntry.deleteMany({ where: { tenantId: TENANT } });
  await db.invoice.deleteMany({ where: { tenantId: TENANT } });
  await db.studentEnrollment.deleteMany({ where: { tenantId: TENANT } });
  await db.feeScheduleItem.deleteMany({ where: { tenantId: TENANT } });
  await db.student.deleteMany({ where: { tenantId: TENANT } });
  await db.batch.deleteMany({ where: { tenantId: TENANT } });

  const genesisBatch = "batch-gen-001";
  await db.batch.upsert({
    where: { id: genesisBatch },
    create: {
      id: genesisBatch,
      tenantId: TENANT,
      name: "Genesis",
      subject: "All",
      schedule: "Mon-Fri",
      createdAt: now,
      updatedAt: now,
    },
    update: { updatedAt: now },
  });

  const students = [
    { id: "student-s-001", firstName: "Aarav", lastName: "Sharma", bal: 50000 },
    { id: "student-s-002", firstName: "Diya", lastName: "Patel", bal: 0 },
    { id: "student-s-003", firstName: "Kabir", lastName: "Nair", bal: 90000 },
  ] as const;

  for (const s of students) {
    await db.student.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        tenantId: TENANT,
        firstName: s.firstName,
        lastName: s.lastName,
        dupKey: s.id,
        admissionDate: "2025-04-01",
        status: "active",
        feeModel: "postpaid",
        baseFeePaise: 150000,
        balancePaise: s.bal,
        createdAt: now,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
  }

  const demoLedger: DemoLedgerRow[] = [
    { studentId: "student-s-001", type: "FEE_CHARGED", debitPaise: 150000, creditPaise: 0, description: "Term fee (Jun 2025)", occurredOn: "2025-06-05T10:00:00.000Z" },
    { studentId: "student-s-001", type: "PAYMENT_RECEIVED", debitPaise: 0, creditPaise: 100000, description: "Part payment", occurredOn: "2025-07-01T10:00:00.000Z" },
    { studentId: "student-s-002", type: "FEE_CHARGED", debitPaise: 120000, creditPaise: 0, description: "Term fee (Jun 2025)", occurredOn: "2025-06-05T10:00:00.000Z" },
    { studentId: "student-s-002", type: "PAYMENT_RECEIVED", debitPaise: 0, creditPaise: 120000, description: "Full payment", occurredOn: "2025-06-20T10:00:00.000Z" },
    { studentId: "student-s-003", type: "FEE_CHARGED", debitPaise: 180000, creditPaise: 0, description: "Term fee (Jun 2025)", occurredOn: "2025-06-05T10:00:00.000Z" },
    { studentId: "student-s-003", type: "PAYMENT_RECEIVED", debitPaise: 0, creditPaise: 90000, description: "Part payment", occurredOn: "2025-07-10T10:00:00.000Z" },
  ];

  for (const row of demoLedger) {
    const res = await postLedgerEntry(db, {
      tenantId: TENANT,
      studentId: row.studentId,
      type: row.type,
      debitPaise: row.debitPaise,
      creditPaise: row.creditPaise,
      description: row.description,
      occurredOn: row.occurredOn,
      source: "seed",
    });
    if (!res.ok) {
      throw new Error(`ledger post failed for ${row.studentId}/${row.type}: ${res.error}`);
    }
  }

  // Demo invoices (tamperHash is demo-only; verify targets the ledger chain).
  const invoices = [
    { id: "inv-001", studentId: "student-s-001", seq: 1, amountPaise: 150000, balancePaise: 50000 },
    { id: "inv-002", studentId: "student-s-002", seq: 2, amountPaise: 120000, balancePaise: 0 },
    { id: "inv-003", studentId: "student-s-003", seq: 3, amountPaise: 180000, balancePaise: 90000 },
  ] as const;

  for (const inv of invoices) {
    await db.invoice.upsert({
      where: { id: inv.id },
      create: {
        id: inv.id,
        tenantId: TENANT,
        number: `INV-${String(inv.seq).padStart(4, "0")}`,
        studentId: inv.studentId,
        issueDate: "2025-06-05",
        dueDate: "2025-06-20",
        subtotal: inv.amountPaise,
        discount: 0,
        extraCharges: 0,
        total: inv.amountPaise,
        status: inv.balancePaise === 0 ? "paid" : "partial",
        tamperHash: "seed",
        createdAt: now,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
  }

  console.log(`[demo] seeded local-dev tenant: 3 students, 6 ledger entries, 3 invoices`);
}

async function main() {
  const { isProd, wantDemo, initTenant } = parseArgs();

  if (initTenant) {
    await runInit(initTenant);
    return;
  }

  if (wantDemo) {
    if (isProd) {
      throw new Error("--demo is disabled in production; seed demo data only in dev");
    }
    await runDemo();
    return;
  }

  if (isProd) {
    console.log("[seed] production run with no --init/--demo flag: nothing to do");
    return;
  }

  // Dev convenience default.
  await runDemo();
}

main()
  .catch((e) => {
    console.error("seed failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
