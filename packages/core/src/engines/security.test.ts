// Implements: 02_Core_Logic.md §12 (Security Engine — argon2id PIN gate),
// 10_Security.md §3.3–§3.4 (6-digit PIN, argon2id m=64MiB t=3 p=2),
// 12_Business_Rules.md BR-SEC-01 (auto-lock/unlock),
// 14_Edge_Cases.md EC-SEC-01 (brute-force ladder) + EC-SEC-02 (fallback),
// AGENTS.md §7.2 (auth lockout row) + §7.3 (real SQLite via `prisma db push`,
// never mocked).
//
// The two SPEC tests below assert the ladder (02 §12.4 / EC-SEC-01 /
// AGENTS §7.2: 5 fails → 30s lockout; 10 fails → 5min; 15 fails → wipe local
// cache + `pin_lockout_wipe` audit). Findings FIND-SEC-01 / FIND-SEC-02,
// fixed in ./security.ts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { execSync } from "child_process";
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { verifyPin, isLockedOut, setPin, expirePinLockoutForTests } from "./security";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, "../../../../");
const SCHEMA = resolve(REPO, "prisma/schema.prisma");

const PIN = "123456";
const WRONG_PIN = "000000";

let TEST_DB: string;
let prisma: PrismaClient;
let tmpDir: string;

async function seedTenant(secret = randomUUID()): Promise<string> {
  const tenantId = `sec-${randomUUID()}`;
  await prisma.setting.create({
    data: { tenantId, tenantSecret: secret, createdAt: new Date() },
  });
  await prisma.appState.create({
    data: { tenantId, schemaVersion: 1, createdAt: new Date() },
  });
  return tenantId;
}

async function failPin(tenantId: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    await expect(verifyPin(prisma, tenantId, WRONG_PIN)).resolves.toBe(false);
  }
}

// Drives `falses` recorded failures through interim lockouts: on a `locked`
// throw, expire the lock (in-memory timer + DB row, attempts preserved) and
// retry the same attempt. Needed once the ladder locks at 5/10 — a plain
// loop would throw on the 6th call instead of reaching 15.
async function failPinThroughLocks(tenantId: string, falses: number): Promise<void> {
  let done = 0;
  let guard = 0;
  while (done < falses) {
    guard += 1;
    if (guard > falses * 4 + 10) {
      throw new Error("failPinThroughLocks did not converge");
    }
    try {
      await expect(verifyPin(prisma, tenantId, WRONG_PIN)).resolves.toBe(false);
      done += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/locked/i.test(message)) throw err;
      expirePinLockoutForTests(tenantId);
      await prisma.appState.update({
        where: { tenantId },
        data: { appLockState: "unlocked", appLockUntil: null },
      });
    }
  }
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "sec-test-"));
  TEST_DB = join(tmpDir, "sec-test.db").replace(/\\/g, "/");
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

describe("setPin + verifyPin (10_Security.md §3.3–§3.4)", () => {
  it("stores an argon2id hash (m=64MiB, t=3, p=2) and verifies the PIN", async () => {
    const tenantId = await seedTenant();
    await setPin(prisma, tenantId, PIN);

    const setting = await prisma.setting.findUniqueOrThrow({ where: { tenantId } });
    // argon2 encodes params alphabetically (m, p, t) — assert each value.
    expect(setting.pinHash).toMatch(/^\$argon2id\$v=\d+\$/);
    expect(setting.pinHash).toContain("m=65536");
    expect(setting.pinHash).toContain("t=3");
    expect(setting.pinHash).toContain("p=2");

    await expect(verifyPin(prisma, tenantId, PIN)).resolves.toBe(true);
  }, 120000);

  it("rejects a wrong PIN without locking on the first failures", async () => {
    const tenantId = await seedTenant();
    await setPin(prisma, tenantId, PIN);

    await expect(verifyPin(prisma, tenantId, WRONG_PIN)).resolves.toBe(false);
    await expect(isLockedOut(prisma, tenantId)).resolves.toBe(false);
  }, 120000);

  it("returns false for an unknown tenant (typed false, never throws)", async () => {
    await expect(verifyPin(prisma, `ghost-${randomUUID()}`, PIN)).resolves.toBe(false);
  });

  it("returns false when no PIN is set", async () => {
    const tenantId = await seedTenant();
    await expect(verifyPin(prisma, tenantId, PIN)).resolves.toBe(false);
  });

  it("resets the failure count after a successful unlock (EC-SEC-01 cumulative reset)", async () => {
    const tenantId = await seedTenant();
    await setPin(prisma, tenantId, PIN);

    await failPin(tenantId, 2);
    await expect(verifyPin(prisma, tenantId, PIN)).resolves.toBe(true);
    await expect(verifyPin(prisma, tenantId, WRONG_PIN)).resolves.toBe(false);
    await expect(isLockedOut(prisma, tenantId)).resolves.toBe(false);
  }, 120000);
});

describe("DB-backed lock state (BR-SEC-01 — app_state lock)", () => {
  it("honours a future appLockUntil and auto-unlocks after expiry", async () => {
    const tenantId = await seedTenant();
    await setPin(prisma, tenantId, PIN);

    await prisma.appState.update({
      where: { tenantId },
      data: { appLockState: "locked", appLockUntil: new Date(Date.now() + 60000) },
    });
    await expect(isLockedOut(prisma, tenantId)).resolves.toBe(true);
    await expect(verifyPin(prisma, tenantId, PIN)).rejects.toThrow(/locked/);

    await prisma.appState.update({
      where: { tenantId },
      data: { appLockState: "locked", appLockUntil: new Date(Date.now() - 1000) },
    });
    await expect(isLockedOut(prisma, tenantId)).resolves.toBe(false);
    const state = await prisma.appState.findUniqueOrThrow({ where: { tenantId } });
    expect(state.appLockState).toBe("unlocked");
    expect(state.appLockUntil).toBeNull();
    await expect(verifyPin(prisma, tenantId, PIN)).resolves.toBe(true);
  }, 120000);
});

describe("brute-force lockout — current engine behaviour", () => {
  it("locks after 15 consecutive failures and rejects verification while locked", async () => {
    const tenantId = await seedTenant();
    await setPin(prisma, tenantId, PIN);

    // Ladder locks at 5 (30s) and 10 (5min) on the way to 15 (wipe + lock),
    // so drive through the interim lockouts; the end state is unchanged.
    await failPinThroughLocks(tenantId, 15);

    await expect(isLockedOut(prisma, tenantId)).resolves.toBe(true);
    await expect(verifyPin(prisma, tenantId, PIN)).rejects.toThrow(/locked/);
    const state = await prisma.appState.findUniqueOrThrow({ where: { tenantId } });
    expect(state.appLockState).toBe("locked");
    expect(state.appLockUntil).toBeInstanceOf(Date);
  }, 180000);
});

describe("brute-force lockout — SPEC pins (EC-SEC-01 / 02 §12.4 / BR-SEC-03)", () => {
  it(
    "FIND-SEC-01: 5 consecutive failures trigger a 30s lockout",
    async () => {
      const tenantId = await seedTenant();
      await setPin(prisma, tenantId, PIN);

      await failPin(tenantId, 5);

      // Spec: 5 fails → 30-second lockout.
      await expect(isLockedOut(prisma, tenantId)).resolves.toBe(true);
    },
    180000,
  );

  it(
    "FIND-SEC-02: 15 consecutive failures wipe the local cache + audit pin_lockout_wipe",
    async () => {
      const tenantId = await seedTenant();
      await setPin(prisma, tenantId, PIN);
      const studentId = randomUUID();
      await prisma.student.create({
        data: {
          id: studentId,
          tenantId,
          firstName: "Cache",
          admissionDate: "2026-09-01",
          dupKey: `${tenantId}:${studentId}`,
          createdAt: new Date(),
        },
      });

      await failPinThroughLocks(tenantId, 15);

      // Spec (EC-SEC-01): 15 fails → wipe local cache, audit the wipe.
      await expect(
        prisma.student.count({ where: { tenantId } }),
      ).resolves.toBe(0);
      await expect(
        prisma.auditLog.count({
          where: { tenantId, action: "pin_lockout_wipe" },
        }),
      ).resolves.toBeGreaterThan(0);
    },
    180000,
  );
});
