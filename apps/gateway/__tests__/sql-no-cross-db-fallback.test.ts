// Implements: 10_Security.md §2 (single-tenant isolation) + §14 fail-closed,
// AGENTS.md §3.4 (single-tenant is defence-in-depth, not the partitioning key)
// and §2 Rule 9 (no silent failures).
//
// WHY THIS TEST EXISTS — the defect it pins.
//
// `run()` in `apps/gateway/lib/sql.ts` used to recover from ANY `db.execute`
// failure by re-issuing the statement through `directPipelineExecute(sql, args)`.
// Called without `dbUrl`/`dbToken`, that helper resolved its target from the
// environment — `resolveTursoUrl(undefined)` → `TURSO_DATABASE_URL`,
// `resolveToken(undefined)` → `TURSO_TOKEN`.
//
// This gateway is MULTI-TENANT. A request's database arrives in the caller's
// `x-db-url`/`x-db-token`, bound by the HMAC in `lib/auth.ts`. `TURSO_DATABASE_URL`
// names a DIFFERENT database — one shared database. So the fallback did not
// retry the statement, it RE-TARGETED it: a dropped socket, a cold edge isolate
// or an 8s abort silently re-issued a tutor's write against the shared database,
// with no error, no audit row, and no `tenant_id` guarantee.
//
// This test asserts the property directly: a failing handle must NEVER produce
// a second network write to any host. If the fallback is ever reintroduced, this
// goes red.
//
// NOTE ON SCOPE: this exercises `run()` only. It is not a test of tenant
// predicates — `buildTenantWhere` and its coverage live elsewhere.

import { describe, it, expect, afterEach, vi } from "vitest";
import { run } from "../lib/sql.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_TOKEN;
  delete process.env.TURSO_AUTH_TOKEN;
});

/** A handle whose `execute` always fails the way a dead socket would. */
function brokenHandle() {
  return {
    execute: () => Promise.reject(new Error("connection reset by peer")),
  } as unknown as Parameters<typeof run>[0];
}

/** A handle carrying the commit/rollback pair, i.e. an open transaction. */
function transactionHandle() {
  return {
    execute: () => Promise.reject(new Error("UNIQUE constraint failed")),
    commit: () => {},
    rollback: () => {},
  } as unknown as Parameters<typeof run>[0];
}

describe("run() — a failing handle must not write anywhere else", () => {
  it("throws the PRIMARY error and issues no outbound request", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("should never be called")));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(run(brokenHandle(), "SELECT 1")).rejects.toThrow(
      /connection reset by peer/
    );

    // The whole point. Zero outbound writes, so there is no way for a statement
    // to land in a database other than the one the caller authenticated for.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not attempt the shared TURSO_DATABASE_URL even when it is configured", async () => {
    // Configure the exact environment that used to be silently picked up.
    process.env.TURSO_DATABASE_URL = "libsql://shared-database.invalid";
    process.env.TURSO_AUTH_TOKEN = "shared-token-value-that-is-long-enough-to-pass";

    const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}")));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(run(brokenHandle(), "INSERT INTO students (id) VALUES (?)", ["x"])).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces the primary error verbatim, with no misleading network suffix", async () => {
    // The old code reported `statement failed: <primary> (pipeline fallback:
    // <fallback>)` — a network-flavoured message that pointed the operator at
    // the network instead of at the SQL. The primary cause is now the whole
    // story.
    await expect(
      run(brokenHandle(), "SELECT * FROM ledger_entries", [])
    ).rejects.toThrow(/^connection reset by peer$/);
    await expect(
      run(brokenHandle(), "SELECT * FROM ledger_entries", [])
    ).rejects.not.toThrow(/pipeline/i);
  });

  it("still aborts an open transaction rather than escaping its atomicity", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    // Rule 7 / BR-SYN-01: a failed statement inside BEGIN must abort the
    // transaction, never be re-issued outside it.
    await expect(run(transactionHandle(), "UPDATE invoices SET status = ?", ["paid"])).rejects.toThrow(
      /UNIQUE constraint failed/
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not swallow the failure into an empty result set", async () => {
    // Rule 9: a silent `[]` here would tell the gateway "this tutor has no
    // students" when the truth is "the database was unreachable" — the exact
    // lie AGENTS.md §2 Rule 9 exists to prevent.
    await expect(run(brokenHandle(), "SELECT id FROM students")).rejects.toThrow();
  });
});

describe("run() — the happy path is unchanged", () => {
  it("returns rows from the caller's handle without any fallback", async () => {
    const ok = {
      execute: () => Promise.resolve({ rows: [{ id: "s1" }], rowsAffected: 1 }),
    } as unknown as Parameters<typeof run>[0];
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await expect(run(ok, "SELECT id FROM students WHERE tenant_id = ?", ["t1"])).resolves.toEqual({
      rows: [{ id: "s1" }],
      rowsAffected: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});