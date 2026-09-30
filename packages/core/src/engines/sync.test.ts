// Implements: 02_Core_Logic.md §9.1 (Sync Engine v1 stub — local-only;
// marks outbox rows sent), 12_Business_Rules.md BR-SYN-01 (v1 local-only
// stub) + BR-SYN-02 (payload immutable once written), AGENTS.md §2 Rule 9
// (no silent failures) + §7.3 (real SQLite via `prisma db push`, never
// mocked).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { pushSyncOutbox, triggerSync } from "./sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(): Promise<string> {
  const tenantId = `sync-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: randomUUID(), createdAt: new Date() },
  });
  return tenantId;
}

async function seedOutbox(
  tenantId: string,
  status: "pending" | "sent" = "pending",
): Promise<string> {
  const id = randomUUID();
  await prisma.syncOutbox.create({
    data: {
      id,
      tenantId,
      tableName: "students",
      rowId: randomUUID(),
      op: "insert",
      payload: JSON.stringify({ id, marker: "payload-bytes" }),
      status,
      createdAt: new Date(),
    },
  });
  return id;
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "sync-test-"));
  TEST_DB = join(tmpDir, "sync-test.db").replace(/\\/g, "/");
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

describe("pushSyncOutbox v1 stub (02 §9.1 / BR-SYN-01)", () => {
  it("marks pending rows sent with flushedAt, leaving payload bytes untouched (BR-SYN-02)", async () => {
    const tenantId = await seedTenant();
    const idA = await seedOutbox(tenantId);
    const idB = await seedOutbox(tenantId);
    const beforeA = await prisma.syncOutbox.findUniqueOrThrow({ where: { id: idA } });

    await pushSyncOutbox(prisma, tenantId);

    for (const id of [idA, idB]) {
      const row = await prisma.syncOutbox.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe("sent");
      expect(row.flushedAt).toBeInstanceOf(Date);
    }
    const afterA = await prisma.syncOutbox.findUniqueOrThrow({ where: { id: idA } });
    expect(afterA.payload).toBe(beforeA.payload);
  });

  it("leaves already-sent rows and other tenants alone", async () => {
    const tenantId = await seedTenant();
    const otherTenant = await seedTenant();
    const sentId = await seedOutbox(tenantId, "sent");
    const otherId = await seedOutbox(otherTenant, "pending");

    await pushSyncOutbox(prisma, tenantId);

    const sentRow = await prisma.syncOutbox.findUniqueOrThrow({ where: { id: sentId } });
    expect(sentRow.status).toBe("sent");
    expect(sentRow.flushedAt).toBeNull();

    const otherRow = await prisma.syncOutbox.findUniqueOrThrow({ where: { id: otherId } });
    expect(otherRow.status).toBe("pending");
    expect(otherRow.flushedAt).toBeNull();
  });

  it("is a no-op (not an error) when nothing is pending", async () => {
    const tenantId = await seedTenant();
    await expect(pushSyncOutbox(prisma, tenantId)).resolves.toBeUndefined();
  });
});

describe("triggerSync (02 §9.1 — drains the outbox)", () => {
  it("delegates to the outbox push", async () => {
    const tenantId = await seedTenant();
    const id = await seedOutbox(tenantId);

    await triggerSync(prisma, tenantId);

    const row = await prisma.syncOutbox.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("sent");
    expect(row.flushedAt).toBeInstanceOf(Date);
  });
});
