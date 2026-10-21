// Implements: GW-10 (audit 2026-10-21 §2.18 — "No connect timeout on the
// tenant-database dial - a dead host holds the request open") + 10_Security.md
// §8 (a typed error, never a hang) + AGENTS.md §2 Rule 9 (no silent failures).
//
// The tenant database's location is CALLER-SUPPLIED (`x-db-url`), so a host
// that accepts the TCP connection and then never answers held the whole
// request open until the platform's own limit. `@libsql/client` exposes no
// timeout for a REMOTE database — its only `timeout` option is documented as a
// busy timeout for local `file:` databases ("remote clients ignore it") — so
// the bound has to live in the gateway's own statement layer (`lib/sql.ts`
// `run()`), which is exactly where this test pins it.
//
// The negative control for this file is the whole point of it: against the
// pre-fix `run()` — which awaited `db.execute` with no bound — the first test
// HANGS until the vitest timeout and the file fails.

import { describe, expect, it } from "vitest";
import {
  run,
  STATEMENT_TIMEOUT_MS,
  StatementTimeoutError,
  type SqlHandle,
} from "../lib/sql.ts";

/** A handle whose `execute` never settles — the dead host, in miniature. */
function stalledHandle(): SqlHandle {
  return {
    execute: () => new Promise<never>(() => {}),
  };
}

describe("GW-10 — a statement cannot hold the request open past its budget", () => {
  it("the default budget is 8 s — the same budget the schema heal's pipeline POST uses", () => {
    expect(STATEMENT_TIMEOUT_MS).toBe(8000);
  });

  it("a statement that never answers is abandoned with a typed error", async () => {
    const started = Date.now();
    await expect(run(stalledHandle(), "SELECT 1", [], 25)).rejects.toThrow(
      /TENANT_DB_TIMEOUT/,
    );
    // The caller stopped waiting: the error arrives in the budget, not later.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("the error is a StatementTimeoutError carrying the budget it blew", async () => {
    const err = await run(stalledHandle(), "SELECT 1", [], 25).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatementTimeoutError);
    expect((err as StatementTimeoutError).timeoutMs).toBe(25);
    // The message names the failure and nothing about the database or the
    // tenant (10_Security.md §8 — no secret, no PII in an error).
    expect((err as Error).message).not.toMatch(/select/i);
  });

  it("a statement that answers in time is unaffected", async () => {
    const handle: SqlHandle = {
      execute: () => Promise.resolve({ rows: [{ id: "1" }], rowsAffected: 1 }),
    };
    const res = await run(handle, "SELECT id FROM students", [], 5000);
    expect(res.rows).toEqual([{ id: "1" }]);
    expect(res.rowsAffected).toBe(1);
  });

  it("a statement that FAILS still surfaces its own error — the budget never masks it", async () => {
    const handle: SqlHandle = {
      execute: () =>
        Promise.reject(new Error("SQLITE_CONSTRAINT: FOREIGN KEY constraint failed")),
    };
    await expect(run(handle, "SELECT 1", [], 5000)).rejects.toThrow(
      /FOREIGN KEY constraint failed/,
    );
  });

  it("a statement that fails AFTER the budget is not an unhandled rejection", async () => {
    // The abandoned statement may still fail later. If nothing handled that
    // rejection, Deno would kill the isolate on an unhandled rejection — so the
    // budget must leave a handler attached to the promise it gave up on.
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const handle: SqlHandle = {
        execute: () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error("late failure")), 60);
          }),
      };
      await expect(run(handle, "SELECT 1", [], 20)).rejects.toThrow(/TENANT_DB_TIMEOUT/);
      // Give the late rejection time to land.
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
