// Implements: 02_Core_Logic.md §10 (Notification Engine — in-app bell +
// feed; v1 has no push/email/SMS), AGENTS.md §7.3 (real SQLite via
// `prisma db push`, never mocked).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { enqueueNotification, flushNotifications } from "./notification";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `notif-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "notif-test-"));
  TEST_DB = join(tmpDir, "notif-test.db").replace(/\\/g, "/");
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

describe("enqueueNotification (02 §10 — bell + feed rows)", () => {
  it("stores a minimal notification with null optionals and null readAt", async () => {
    const tenantId = await seedTenant();
    await enqueueNotification(prisma, tenantId, "reminder", "Fee due");

    const rows = await prisma.notification.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId,
      category: "reminder",
      title: "Fee due",
      body: null,
      refType: null,
      refId: null,
      readAt: null,
    });
  });

  it.each([
    ["reminder"],
    ["ledger"],
    ["attendance"],
    ["system"],
  ] as Array<["reminder" | "ledger" | "attendance" | "system"]>)(
    "stores category %s with body + refs",
    async (category) => {
      const tenantId = await seedTenant();
      await enqueueNotification(
        prisma,
        tenantId,
        category,
        "Title",
        "Body text",
        "students",
        "stu-1",
      );

      const rows = await prisma.notification.findMany({ where: { tenantId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        category,
        body: "Body text",
        refType: "students",
        refId: "stu-1",
      });
    },
  );
});

describe("flushNotifications (marks the bell read)", () => {
  it("sets readAt on unread rows and is idempotent", async () => {
    const tenantId = await seedTenant();
    await enqueueNotification(prisma, tenantId, "system", "One");
    await enqueueNotification(prisma, tenantId, "system", "Two");

    await flushNotifications(prisma, tenantId);

    const afterFirst = await prisma.notification.findMany({ where: { tenantId } });
    expect(afterFirst).toHaveLength(2);
    for (const row of afterFirst) expect(row.readAt).toBeInstanceOf(Date);
    const firstReadAts = afterFirst.map((r) => r.readAt?.getTime());

    await flushNotifications(prisma, tenantId);

    const afterSecond = await prisma.notification.findMany({ where: { tenantId } });
    // Already-read rows are untouched by the second flush (where readAt: null).
    expect(afterSecond.map((r) => r.readAt?.getTime())).toEqual(firstReadAts);
  });

  it("leaves other tenants' notifications unread", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    await enqueueNotification(prisma, tenantA, "system", "A");
    await enqueueNotification(prisma, tenantB, "system", "B");

    await flushNotifications(prisma, tenantA);

    const bRow = await prisma.notification.findFirstOrThrow({ where: { tenantId: tenantB } });
    expect(bRow.readAt).toBeNull();
    const aRow = await prisma.notification.findFirstOrThrow({ where: { tenantId: tenantA } });
    expect(aRow.readAt).toBeInstanceOf(Date);
  });

  it("resolves cleanly when there is nothing to flush", async () => {
    const tenantId = await seedTenant();
    await expect(flushNotifications(prisma, tenantId)).resolves.toBeUndefined();
  });
});
