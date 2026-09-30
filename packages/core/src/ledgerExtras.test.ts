// Implements: 12_Business_Rules.md BR-LED-04 (void = reversing VOID row),
// BR-LED-05 (a VOID cannot itself be voided), BR-LED-06 (hash chain),
// AGENTS.md §2 Rules 1 + 9 (append-only; typed errors, never swallowed) +
// §7.3 (real SQLite via `prisma db push`, never mocked).
//
// Covers the `ledger.ts` paths the existing `ledger.test.ts` leaves cold:
// pure helpers (`computeHash`, `buildEntryPayload` key order,
// `nextCreatedAtIso` monotonicity) plus the void-error branches, empty-ledger
// reads, and partial-balance void restoration.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import {
  postLedgerEntry,
  voidEntry,
  computeBalance,
  reconcileLedger,
  computeHash,
  buildEntryPayload,
  nextCreatedAtIso,
} from "./ledger";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

const TENANT = "ledger-extras-tenant";

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(tenantId = TENANT): Promise<void> {
  await prisma.setting.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      tenantSecret: randomUUID(),
      createdAt: new Date(),
    },
  });
}

async function makeStudent(tenantId = TENANT): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName: "Extra",
      lastName: "Student",
      admissionDate: "2026-09-01",
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

async function postFee(
  studentId: string,
  debitPaise: number,
  creditPaise = 0,
  tenantId = TENANT,
): Promise<string> {
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
  return res.value;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ledger-extras-"));
  TEST_DB = join(tmpDir, "ledger-extras.db").replace(/\\/g, "/");
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

describe("computeHash (BR-LED-06 chain primitive)", () => {
  it("is deterministic and 64-hex", () => {
    const h = computeHash("prev", "payload", "2026-09-15T00:00:00.000Z", "secret");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHash("prev", "payload", "2026-09-15T00:00:00.000Z", "secret")).toBe(h);
  });

  it("differs with vs without a predecessor (genesis vs chained)", () => {
    const genesis = computeHash(null, "payload", "2026-09-15T00:00:00.000Z", "secret");
    const chained = computeHash("prev", "payload", "2026-09-15T00:00:00.000Z", "secret");
    expect(genesis).not.toBe(chained);
  });

  it("is sensitive to every input", () => {
    const base = computeHash("p", "pay", "t", "s");
    expect(computeHash("q", "pay", "t", "s")).not.toBe(base);
    expect(computeHash("p", "pay2", "t", "s")).not.toBe(base);
    expect(computeHash("p", "pay", "t2", "s")).not.toBe(base);
    expect(computeHash("p", "pay", "t", "s2")).not.toBe(base);
  });
});

describe("buildEntryPayload (BR-LED-06 — key order is load-bearing)", () => {
  it("serialises fields in the canonical contract order", () => {
    expect(
      buildEntryPayload({
        id: "id-1",
        studentId: "stu-1",
        type: "FEE_CHARGED",
        debitPaise: 100000,
        creditPaise: 0,
        balanceAfterPaise: 100000,
        occurredOn: "2026-09-15",
      }),
    ).toBe(
      '{"id":"id-1","studentId":"stu-1","type":"FEE_CHARGED",' +
        '"debitPaise":100000,"creditPaise":0,' +
        '"balanceAfterPaise":100000,"occurredOn":"2026-09-15"}',
    );
  });

  it("matches a manual JSON.stringify of the contract order (both dialects hash this)", () => {
    const entry = {
      id: randomUUID(),
      studentId: randomUUID(),
      type: "PAYMENT_RECEIVED",
      debitPaise: 0,
      creditPaise: 40000,
      balanceAfterPaise: 60000,
      occurredOn: "2026-09-16",
    };
    expect(buildEntryPayload(entry)).toBe(JSON.stringify(entry));
    expect(createHash("sha256").update(buildEntryPayload(entry)).digest("hex")).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

describe("nextCreatedAtIso (BR-LED-06 + 07 §9.6 strictly-monotonic clock)", () => {
  it("never repeats or goes backwards across rapid calls", () => {
    const stamps = Array.from({ length: 100 }, () => nextCreatedAtIso());
    const sorted = [...stamps].sort();
    expect(stamps).toEqual(sorted);
    expect(new Set(stamps).size).toBe(100);
  });

  it("emits valid ISO-8601 timestamps", () => {
    const iso = nextCreatedAtIso();
    expect(new Date(iso).toISOString()).toBe(iso);
  });
});

describe("empty-ledger reads (Rule 9 — honest zeroes, not nulls)", () => {
  it("computeBalance is 0 when a student has no entries", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    await expect(computeBalance(prisma, TENANT, studentId)).resolves.toBe(0);
  });

  it("reconcileLedger succeeds vacuously on an empty chain", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    const res = await reconcileLedger(prisma, TENANT, studentId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe(true);
  });

  it("reconcileLedger returns a typed Err when tenant settings are missing", async () => {
    const res = await reconcileLedger(prisma, `ghost-${randomUUID()}`, randomUUID());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/Tenant settings not found/);
  });
});

describe("voidEntry error branches (BR-LED-04/05, Rule 9)", () => {
  it("returns Err for an unknown entry id (nothing written)", async () => {
    await seedTenant();
    const before = await prisma.ledgerEntry.count({ where: { tenantId: TENANT } });
    const res = await voidEntry(
      prisma,
      TENANT,
      randomUUID(),
      "no such entry",
      new Date().toISOString(),
      "test-actor",
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/not found/);
    expect(await prisma.ledgerEntry.count({ where: { tenantId: TENANT } })).toBe(before);
  });

  it("refuses to void a VOID entry (BR-LED-05)", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    const entryId = await postFee(studentId, 150000);

    const first = await voidEntry(
      prisma,
      TENANT,
      entryId,
      "wrong amount",
      new Date().toISOString(),
      "test-actor",
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await voidEntry(
      prisma,
      TENANT,
      first.value,
      "void the void",
      new Date().toISOString(),
      "test-actor",
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toMatch(/Cannot void a void/);
  });

  it("returns Err when the tenant secret is gone mid-void (fail-closed)", async () => {
    const tenantId = `void-nosecret-${randomUUID()}`;
    await seedTenant(tenantId);
    const studentId = await makeStudent(tenantId);
    const entryId = await postFee(studentId, 50000, 0, tenantId);

    await prisma.setting.delete({ where: { tenantId } });

    const res = await voidEntry(
      prisma,
      tenantId,
      entryId,
      "secret deleted",
      new Date().toISOString(),
      "test-actor",
    );
    expect(res.ok).toBe(false);
  });
});

describe("voidEntry partial-balance restoration (BR-LED-04 mirror rule)", () => {
  it("voiding a payment restores the exact prior balance and stays reconcilable", async () => {
    await seedTenant();
    const studentId = await makeStudent();
    await postFee(studentId, 100000);
    const paymentId = await postFee(studentId, 0, 30000);
    expect(await computeBalance(prisma, TENANT, studentId)).toBe(70000);

    const voided = await voidEntry(
      prisma,
      TENANT,
      paymentId,
      "duplicate payment",
      new Date().toISOString(),
      "test-actor",
    );
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;

    const voidRow = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: voided.value },
    });
    expect(voidRow.type).toBe("VOID");
    expect(voidRow.debitPaise).toBe(30000);
    expect(voidRow.creditPaise).toBe(0);
    expect(voidRow.voidOfId).toBe(paymentId);

    expect(await computeBalance(prisma, TENANT, studentId)).toBe(100000);
    const rec = await reconcileLedger(prisma, TENANT, studentId);
    expect(rec.ok).toBe(true);
  });
});
