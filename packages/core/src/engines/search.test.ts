// Implements: 02_Core_Logic.md §8 (Search Engine — Prisma `contains`
// student search, FTS5 triggers own the index so rebuild is a no-op),
// AGENTS.md §7.3 (real SQLite via `prisma db push`, never mocked).
//
// NOTE (observation OBS-1): 02 §8.2 mandates BM25 + recency + user-weight
// ranking; this engine scores by result index with an in-code rationale
// ("ORM doesn't give rank"). These tests pin the CURRENT contract; the §8.2
// gap is reported as a finding, not a failure.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { searchAll, rebuildSearchIndex } from "./search";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `search-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

async function seedStudent(
  tenantId: string,
  firstName: string,
  extra: { lastName?: string; phone?: string; email?: string; status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await prisma.student.create({
    data: {
      id,
      tenantId,
      firstName,
      lastName: extra.lastName ?? null,
      phone: extra.phone ?? null,
      email: extra.email ?? null,
      status: extra.status ?? "active",
      admissionDate: "2026-09-01",
      dupKey: `${tenantId}:${id}`,
      createdAt: new Date(),
    },
  });
  return id;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "search-test-"));
  TEST_DB = join(tmpDir, "search-test.db").replace(/\\/g, "/");
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

describe("rebuildSearchIndex (02 §8.3 — FTS5 triggers own the index)", () => {
  it("resolves without touching the DB", async () => {
    const tenantId = await seedTenant();
    await expect(rebuildSearchIndex(prisma, tenantId)).resolves.toBeUndefined();
  });
});

describe("searchAll student matching (02 §8 — grouped student results)", () => {
  it("matches across firstName, lastName, phone and email", async () => {
    const tenantId = await seedTenant();
    const aarav = await seedStudent(tenantId, "Aarav", { lastName: "Sharma" });
    const diya = await seedStudent(tenantId, "Diya", { phone: "9810012345" });
    const kabir = await seedStudent(tenantId, "Kabir", { email: "kabir@example.in" });

    await expect(searchAll(prisma, tenantId, "Aarav")).resolves.toMatchObject([
      { id: aarav, type: "student" },
    ]);
    await expect(searchAll(prisma, tenantId, "Sharma")).resolves.toMatchObject([
      { id: aarav, type: "student" },
    ]);
    await expect(searchAll(prisma, tenantId, "9810012")).resolves.toMatchObject([
      { id: diya, type: "student" },
    ]);
    await expect(searchAll(prisma, tenantId, "kabir@example")).resolves.toMatchObject([
      { id: kabir, type: "student" },
    ]);
  });

  it("excludes inactive students and other tenants", async () => {
    const tenantId = await seedTenant();
    const otherTenant = await seedTenant();
    await seedStudent(tenantId, "ZaraInactive", { status: "inactive" });
    await seedStudent(otherTenant, "ZaraOther");

    const mine = await seedStudent(tenantId, "ZaraMine");
    const results = await searchAll(prisma, tenantId, "Zara");
    expect(results.map((r) => r.id)).toEqual([mine]);
  });

  it("caps at 10 rows with index scores in order", async () => {
    const tenantId = await seedTenant();
    for (let i = 0; i < 12; i++) {
      await seedStudent(tenantId, `CapStudent${i}`);
    }
    const results = await searchAll(prisma, tenantId, "CapStudent");
    expect(results).toHaveLength(10);
    expect(results.map((r) => r.score)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const r of results) expect(r.type).toBe("student");
  });

  it("trims title/subtitle and tolerates missing contact fields", async () => {
    const tenantId = await seedTenant();
    const id = await seedStudent(tenantId, "NoContact");
    const [result] = await searchAll(prisma, tenantId, "NoContact");
    expect(result?.id).toBe(id);
    expect(result?.title).toBe("NoContact");
    expect(result?.subtitle).toBe("");
  });

  it("returns no rows when nothing matches (typed empty, never null)", async () => {
    const tenantId = await seedTenant();
    await seedStudent(tenantId, "Someone");
    await expect(searchAll(prisma, tenantId, "zzz-no-match")).resolves.toEqual([]);
  });
});
