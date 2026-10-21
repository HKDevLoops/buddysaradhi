// Implements: 12_Business_Rules.md BR-LED-06 (the chain of one student is a
// TOTAL order) and 11_Data_Model.md §8.1 (the verification walk), as decided
// on 2026-10-21 (docs/audit/REMEDIATION-PLAN-2026-10-21.md row 1.15).
//
// THE DEFECT THIS FILE PINS. The chain's rows were ordered by `created_at`,
// and three writers broke a same-millisecond tie three different ways: the
// ORM dialect by whatever the database returned, the libsql dialect by
// whatever SQLite returned, and the gateway by `rowid`. A reader that broke
// the tie by `id` therefore disagreed with the writer about which row came
// first - and the reconciler said "CHAIN BROKEN" on a ledger nobody had
// touched. A false "your books are corrupt" is worse than no check at all.
//
// THE DECISION. The chain is a LINKED LIST: each row's `prev_hash` names its
// predecessor, so the links ARE the order. The reader walks the links, and a
// writer extends the chain at its tip and gives the new row a `created_at`
// strictly greater than the tip's (the per-chain logical clock), so the
// timestamp order and the link order are the same order. Two rows sharing a
// millisecond can then never be ordered wrongly, and a fork - two rows
// claiming the same predecessor - is an integrity violation rather than an
// ordering artefact.
//
// A real file-backed SQLite database, never a mock (AGENTS.md §7.3).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, readFileSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import {
  buildEntryPayload,
  computeHash,
  nextChainCreatedAtIso,
  postLedgerEntry,
  reconcileLedger,
} from "./ledger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TENANT = "chain-order-tenant";
const REPO = resolve(__dirname, "../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let DATABASE_URL: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantSecret = randomUUID();
  await prisma.setting.upsert({
    where: { tenantId: TENANT },
    update: { tenantSecret },
    create: { tenantId: TENANT, tenantSecret, createdAt: new Date() },
  });
  return tenantSecret;
}

async function makeStudent(): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId: TENANT,
      firstName: "Chain",
      lastName: "Order",
      admissionDate: new Date().toISOString(),
      dupKey: `${TENANT}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

/**
 * Append one row to a student's chain with a REAL hash, exactly the way a
 * writer would - so the fixture is a chain, not a pile of rows.
 */
async function appendChainedRow(options: {
  studentId: string;
  tenantSecret: string;
  id: string;
  createdAt: string;
  prevHash: string | null;
  debitPaise: number;
  creditPaise: number;
  balanceAfterPaise: number;
}): Promise<string> {
  const payload = buildEntryPayload({
    id: options.id,
    studentId: options.studentId,
    type: "FEE_CHARGED",
    debitPaise: options.debitPaise,
    creditPaise: options.creditPaise,
    balanceAfterPaise: options.balanceAfterPaise,
    occurredOn: "2026-10-21",
  });
  const thisHash = computeHash(
    options.prevHash,
    payload,
    options.createdAt,
    options.tenantSecret,
  );
  await prisma.ledgerEntry.create({
    data: {
      id: options.id,
      tenantId: TENANT,
      studentId: options.studentId,
      type: "FEE_CHARGED",
      debitPaise: options.debitPaise,
      creditPaise: options.creditPaise,
      balanceAfterPaise: options.balanceAfterPaise,
      prevHash: options.prevHash,
      thisHash,
      occurredOn: "2026-10-21",
      source: "manual",
      createdAt: new Date(options.createdAt),
      updatedAt: new Date(options.createdAt),
    },
  });
  return thisHash;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "chain-order-"));
  TEST_DB = join(tmpDir, "chain-order.db").replace(/\\/g, "/");
  DATABASE_URL = `file:${TEST_DB}`;
  execSync(`bunx prisma db push --schema "${SCHEMA}" --accept-data-loss`, {
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
      /* best-effort cleanup */
    }
  }
  try {
    rmdirSync(tmpDir);
  } catch {
    /* ignore */
  }
}, 30000);

describe("the chain order is TOTAL (BR-LED-06, row 1.15)", () => {
  it("does not call an untouched ledger 'chain broken' when two rows share a millisecond", async () => {
    const tenantSecret = await seedTenant();
    const studentId = await makeStudent();
    const sameMillisecond = "2026-10-21T10:00:00.000Z";

    // The ids are chosen so that a reader that broke the tie by `id` would
    // order the SECOND row FIRST - the exact shape of the false alarm.
    const firstId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const secondId = "00000000-0000-4000-8000-000000000000";

    const firstHash = await appendChainedRow({
      studentId,
      tenantSecret,
      id: firstId,
      createdAt: sameMillisecond,
      prevHash: null,
      debitPaise: 100000,
      creditPaise: 0,
      balanceAfterPaise: 100000,
    });
    await appendChainedRow({
      studentId,
      tenantSecret,
      id: secondId,
      createdAt: sameMillisecond,
      prevHash: firstHash,
      debitPaise: 50000,
      creditPaise: 0,
      balanceAfterPaise: 150000,
    });

    const res = await reconcileLedger(prisma, TENANT, studentId);
    expect(
      res.ok,
      `two rows in the same millisecond must not read as tampering: ${
        res.ok ? "" : String((res as { error: Error }).error?.message)
      }`,
    ).toBe(true);
  });

  it("gives a new row a created_at strictly greater than the chain tip's", () => {
    // The per-chain logical clock: a writer's row is always after the tip.
    const tip = "2026-10-21T10:00:00.000Z";
    const bumped = nextChainCreatedAtIso(tip);
    expect(Date.parse(bumped)).toBeGreaterThan(Date.parse(tip));
    // A tip that is already in the past is left alone - the wall clock wins.
    expect(Date.parse(nextChainCreatedAtIso("2000-01-01T00:00:00.000Z"))).toBeGreaterThan(
      Date.parse("2000-01-01T00:00:00.000Z"),
    );
    // A genesis row (no tip) takes the wall clock.
    expect(nextChainCreatedAtIso(null)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps the chain's timestamps strictly increasing across two writes", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    const first = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 1000,
      creditPaise: 0,
      occurredOn: "2026-10-21",
    });
    const second = await postLedgerEntry(prisma, {
      tenantId: TENANT,
      studentId,
      type: "FEE_CHARGED",
      debitPaise: 2000,
      creditPaise: 0,
      occurredOn: "2026-10-21",
    });
    expect(first.ok && second.ok).toBe(true);
    const rows = await prisma.ledgerEntry.findMany({
      where: { tenantId: TENANT, studentId },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length).toBe(2);
    expect(rows[0]!.createdAt.getTime()).toBeLessThan(rows[1]!.createdAt.getTime());
    expect((await reconcileLedger(prisma, TENANT, studentId)).ok).toBe(true);
  });

  it("treats a fork - two rows claiming the same predecessor - as an integrity violation", async () => {    const tenantSecret = await seedTenant();
    const studentId = await makeStudent();
    const sameMillisecond = "2026-10-21T11:00:00.000Z";
    const genesisHash = await appendChainedRow({
      studentId,
      tenantSecret,
      id: "11111111-1111-4111-8111-111111111111",
      createdAt: sameMillisecond,
      prevHash: null,
      debitPaise: 1000,
      creditPaise: 0,
      balanceAfterPaise: 1000,
    });
    // Two rows both claim the genesis row as their predecessor.
    await appendChainedRow({
      studentId,
      tenantSecret,
      id: "22222222-2222-4222-8222-222222222222",
      createdAt: sameMillisecond,
      prevHash: genesisHash,
      debitPaise: 100,
      creditPaise: 0,
      balanceAfterPaise: 1100,
    });
    await appendChainedRow({
      studentId,
      tenantSecret,
      id: "33333333-3333-4333-8333-333333333333",
      createdAt: sameMillisecond,
      prevHash: genesisHash,
      debitPaise: 200,
      creditPaise: 0,
      balanceAfterPaise: 1200,
    });

    const res = await reconcileLedger(prisma, TENANT, studentId);
    expect(res.ok, "a fork must be reported, not silently picked between").toBe(false);
    if (!res.ok) {
      expect(String(res.error)).toMatch(/fork/i);
    }
  });

  it("the spec states the order the code implements", () => {
    // A spec that still describes a timestamp order would send the next agent
    // back to the bug: the rule and the implementation have to name the same
    // thing (BR-LED-06 + 11_Data_Model.md §8.1).
    const rules = readFileSync(resolve(REPO, "12_Business_Rules.md"), "utf8");
    const brLed06 = rules
      .split("\n")
      .find((row) => row.startsWith("|**BR-LED-06**"));
    expect(brLed06, "BR-LED-06 must exist in 12_Business_Rules.md").toBeDefined();
    expect(brLed06).toContain("nextChainCreatedAtIso");
    expect(brLed06).toContain("walk the chain by its links");
    expect(brLed06).toContain("fork");

    const dataModel = readFileSync(resolve(REPO, "11_Data_Model.md"), "utf8");
    expect(dataModel).toContain("The chain's order (BR-LED-06, amended 2026-10-21)");
  });
});
