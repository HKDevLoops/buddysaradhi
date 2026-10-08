// Implements: docs/rfc/004-multi-device-network-contract.md C4 + K4;
// 12_Business_Rules.md BR-SYN-03 (a stale `base_updated_at` never silently wins —
// CAS is the enforcement: typed 409 + the fresh row, never an LWW overwrite).
//
// ── WHAT BUG THIS FILE EXISTS FOR, AND WHY `cas.test.ts` DID NOT CATCH IT ─────
//
// `cas.test.ts` proves the CAS *rejects* a stale base and accepts a fresh one. It
// hands every call the same hand-written `T1`. That is the gap: it never asks
// whether the client can OBTAIN a fresh base, which is the half of compare-and-
// swap that actually broke in the product.
//
// Both write paths stamp `updated_at = now`, so immediately after a successful
// save the client's base is one write BEHIND the server's. The actions used to
// return `{ success: true }` and nothing else, so the client had no way to
// advance. The measured consequence, not a hypothetical: a tutor who edited the
// Profile card twice in a row got
//
//     CONFLICT: settings changed elsewhere
//
// on their OWN second edit — the stale-write guard firing against the very edit
// it exists to protect. The fix completes the swap on SUCCESS as well
// (`SettingsWriteResult.updatedAt`, read back from the row).
//
// These tests exercise that as a SEQUENCE, not a set of independent calls: write
// once with the base the client had, take the base the action returned, write
// again. Revert `updatedAt` from either action's success shape and the
// consecutive tests fail. The genuinely-superseded case is asserted in the same
// sequence, because a CAS that accepts everything is not a CAS either — a fix
// that "solves" the false conflict by ignoring the base would pass the first two
// tests and silently destroy another device's edit.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/server/get-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/get-db")>();
  return {
    ...actual,
    getAuthenticatedDb: vi.fn(),
    getAuthenticatedPrisma: vi.fn(),
    gatewayPatch: vi.fn(),
  };
});

import type { Client as LibsqlClient } from "@libsql/client";
import { getAuthenticatedDb, getAuthenticatedPrisma, gatewayPatch, createLibsqlProxy } from "@/server/get-db";
import { updateSettingAction, updateSettingsBatchAction } from "./settings";

const mockedGetDb = vi.mocked(getAuthenticatedDb);
const mockedGetPrisma = vi.mocked(getAuthenticatedPrisma);
const mockedGatewayPatch = vi.mocked(gatewayPatch);

type Row = Record<string, unknown>;

const TENANT = "t-cas-consecutive";

/**
 * A real file-backed libSQL, because the whole claim under test is about
 * `updated_at` as the DATABASE stores it — a hand-rolled fake could agree with a
 * broken implementation by construction (§7.3: never mock the storage the
 * behaviour lives in).
 */
async function createRealDb(): Promise<{ client: Client; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), "cas-consecutive-"));
  const client = createClient({ url: `file:${join(dir, "test.db")}` });
  await client.execute(
    "CREATE TABLE settings (id TEXT, tenant_id TEXT PRIMARY KEY, institute_name TEXT, institute_phone TEXT, locale TEXT, currency_code TEXT, tenant_secret TEXT, pin_hash TEXT, created_at TEXT, updated_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE sync_outbox (id TEXT PRIMARY KEY, tenant_id TEXT, table_name TEXT, row_id TEXT, op TEXT CHECK(op IN ('insert','update','soft_delete')), payload TEXT, created_at TEXT)",
  );
  await client.execute(
    "CREATE TABLE audit_log (id TEXT PRIMARY KEY, tenant_id TEXT, actor TEXT, action TEXT, ref_type TEXT, ref_id TEXT, metadata TEXT, created_at TEXT)",
  );
  await client.execute({
    sql: "INSERT INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at) VALUES (?,?,?,?,?)",
    args: [TENANT, "Original Institute", "s3cr3t", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  });
  return { client, dir };
}

/** The proxy the action is wired to, so a test can read the row the action wrote. */
let db: ReturnType<typeof createLibsqlProxy>;
let cleanup: Array<() => Promise<void> | void> = [];

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  const made = await createRealDb();
  db = createLibsqlProxy(made.client);
  cleanup = [
    async () => {
      await made.client.close();
    },
    () => {
      rmSync(made.dir, { recursive: true, force: true });
    },
  ];
  mockedGetDb.mockResolvedValue({ client: made.client, userId: TENANT, tenantId: TENANT });
  mockedGetPrisma.mockResolvedValue({ db, userId: TENANT, tenantId: TENANT });
  // Gateway unreachable, so the local-fallback write path runs. That is the path
  // that stamps `updated_at` itself, which is exactly where the base has to
  // advance; the gateway path is covered by cas.test.ts's 409 mapping cases.
  mockedGatewayPatch.mockResolvedValue({ success: false, error: "Gateway 503: service unavailable" });
});

afterEach(async () => {
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      // Best-effort teardown: the file handle may already be gone.
    }
  }
  cleanup = [];
});

/** The base a client legitimately holds: what the row says right now. */
async function currentBase(): Promise<string> {
  const row = await db.setting.findFirst({ where: { tenantId: TENANT } });
  const raw = (row as { updatedAt?: unknown } | null)?.updatedAt;
  if (typeof raw !== "string") throw new Error("no readable updated_at on the settings row");
  return raw;
}

describe("settings CAS — a tutor's OWN consecutive saves", () => {
  it("the second save of a Profile batch is NOT refused as CONFLICT", async () => {
    // Save #1 — the base the tutor's screen was rendered from.
    const first = await updateSettingsBatchAction(
      { instituteName: "First Edit" },
      { base_updated_at: await currentBase() },
    );
    expect(first.success, "the first save goes through").toBe(true);
    if (first.success !== true) return;

    // The base the NEXT write must present, as the server reports it. This is the
    // value the fix added; before it, `first.updatedAt` did not exist and the
    // client silently kept its pre-save base.
    expect(
      typeof first.updatedAt,
      "a successful settings write returns the base the next write must present",
    ).toBe("string");

    // Save #2 — the tutor's own second edit, immediately after. This is the exact
    // sequence that produced "CONFLICT: settings changed elsewhere" on the tutor's
    // own edit.
    const second = await updateSettingsBatchAction(
      { instituteName: "Second Edit" },
      { base_updated_at: first.updatedAt as string },
    );
    expect(
      second,
      `the tutor's own second consecutive save was refused: ${JSON.stringify(second)}`,
    ).toMatchObject({ success: true });
    const row = await db.setting.findFirst({ where: { tenantId: TENANT } });
    expect((row as { instituteName?: unknown }).instituteName).toBe("Second Edit");
  });

  it("the single-field path completes the swap too", async () => {
    const first = await updateSettingAction("institutePhone", "+919876543210", {
      base_updated_at: await currentBase(),
    });
    expect(first.success).toBe(true);
    if (first.success !== true) return;
    expect(typeof first.updatedAt).toBe("string");

    const second = await updateSettingAction("institutePhone", "+919876543211", {
      base_updated_at: first.updatedAt as string,
    });
    expect(
      second,
      `the second single-field save was refused: ${JSON.stringify(second)}`,
    ).toMatchObject({ success: true });
  });

  it("three in a row still work: the base advances on every write", async () => {
    let base = await currentBase();
    const names = ["Edit One", "Edit Two", "Edit Three"];
    for (const name of names) {
      const res = await updateSettingsBatchAction({ instituteName: name }, { base_updated_at: base });
      expect(res, `"${name}" was refused: ${JSON.stringify(res)}`).toMatchObject({ success: true });
      if (res.success !== true) return;
      expect(typeof res.updatedAt, `"${name}" returned no new base`).toBe("string");
      base = res.updatedAt as string;
    }
    const row = await db.setting.findFirst({ where: { tenantId: TENANT } });
    expect((row as { instituteName?: unknown }).instituteName).toBe("Edit Three");
  });

  it("a genuinely SUPERSEDED base is still refused — the fix did not disarm the guard", async () => {
    // The tutor edits on device A. Device B, still holding the pre-edit row,
    // tries to write. That base is stale for real and must be rejected.
    const stale = await currentBase();
    const first = await updateSettingsBatchAction({ instituteName: "Device A Wins" }, {
      base_updated_at: stale,
    });
    expect(first.success).toBe(true);

    const raced = await updateSettingsBatchAction({ instituteName: "Device B Loses" }, {
      base_updated_at: stale,
    });
    expect(raced, "a stale base must still be refused").toMatchObject({
      success: false,
      code: "CONFLICT",
      error: "CONFLICT: settings changed elsewhere",
    });

    // Nothing was written by the loser, and it is told what the truth is.
    const row = await db.setting.findFirst({ where: { tenantId: TENANT } });
    expect((row as { instituteName?: unknown }).instituteName).toBe("Device A Wins");
    expect((raced as { serverRow?: { updatedAt?: unknown } }).serverRow?.updatedAt).toBe(
      (first as { updatedAt?: unknown }).updatedAt,
    );
  });

  it("a rejected stale write leaves NO replication or audit row for an attempt that never happened", async () => {
    const stale = await currentBase();
    await updateSettingsBatchAction({ instituteName: "Device A" }, { base_updated_at: stale });
    const outboxAfter = await db.syncOutbox.count({ where: { tenantId: TENANT } });
    const auditAfter = await db.auditLog.count({ where: { tenantId: TENANT } });

    const raced = await updateSettingsBatchAction({ instituteName: "Device B" }, {
      base_updated_at: stale,
    });
    expect(raced).toMatchObject({ code: "CONFLICT" });
    expect(await db.syncOutbox.count({ where: { tenantId: TENANT } })).toBe(outboxAfter);
    expect(await db.auditLog.count({ where: { tenantId: TENANT } })).toBe(auditAfter);
  });

  it("the returned base is the ROW's own timestamp, not the request's clock", async () => {
    // A guessed or client-invented base would either manufacture a false CONFLICT
    // on the next write or, worse, re-present a stale one and lose a genuine
    // conflict. The base must be read back from storage.
    const res = await updateSettingsBatchAction({ instituteName: "Read Back" }, {
      base_updated_at: await currentBase(),
    });
    expect(res.success).toBe(true);
    if (res.success !== true) return;
    expect(res.updatedAt).toBe(await currentBase());
    expect(res.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
  });
});
