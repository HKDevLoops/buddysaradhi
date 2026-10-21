// Implements: 2.7 (a failed schema heal must NOT be swallowed - the request
// proceeds against an unhealed database otherwise), Rule 9 (no silent
// failures).
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/log.ts", () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));

import { ensureSelfRepairingSchema } from "../lib/schema.ts";
import type { DB } from "../lib/db.ts";

/** A DB whose every statement fails - the shape of an unhealable tenant. */
function brokenDb(): DB {
  const fail = (): Promise<never> =>
    Promise.reject(new Error("no such table: ledger_entries"));
  return {
    execute: fail,
    batch: fail,
    transaction: fail,
    close: async () => {},
  } as unknown as DB;
}

describe("2.7 - a failed schema heal is loud, never swallowed", () => {
  it("the heal REFUSES rather than leaving the caller on an unhealed database", async () => {
    const db = brokenDb();
    await expect(
      ensureSelfRepairingSchema(db, "tenant-heal-fail", "libsql://x.invalid", "token"),
    ).rejects.toThrow(/SCHEMA_HEAL_FAILED/);
  });

  it("the error names the tenant, so the failure is diagnosable", async () => {
    const db = brokenDb();
    await expect(
      ensureSelfRepairingSchema(db, "tenant-heal-fail-2", "libsql://x.invalid", "token"),
    ).rejects.toThrow(/tenant-heal-fail-2/);
  });

  it("a failed heal is not cached - the next request retries it", async () => {
    const db = brokenDb();
    const first = ensureSelfRepairingSchema(db, "tenant-heal-fail-3", "libsql://x.invalid", "token");
    await expect(first).rejects.toThrow(/SCHEMA_HEAL_FAILED/);
    // The in-flight entry is dropped in `finally`, so a retry really runs the
    // heal again rather than replaying the rejection.
    const second = ensureSelfRepairingSchema(db, "tenant-heal-fail-3", "libsql://x.invalid", "token");
    await expect(second).rejects.toThrow(/SCHEMA_HEAL_FAILED/);
    expect(second).not.toBe(first);
  });
});
