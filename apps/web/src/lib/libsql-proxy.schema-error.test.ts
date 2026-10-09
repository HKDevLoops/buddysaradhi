// Implements: AGENTS.md §3.4 (a table missing at runtime is a loud error NAMING
// THE TABLE — never a silently self-created one) + §2 Rule 9; §9.4 security
// harness task SEC-ERRLEAK-05.
//
// The schema error used to append `Original error: ${msg}` to its own message.
// libSQL embeds the failing statement and its column list in that string, and
// this message travels — action catch → `error` string → toast. The table name
// is the operator signal and stays; the statement does not. It survives on
// `cause`, so the log keeps the whole thing.
import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLibsqlProxy } from "@/lib/libsql-proxy";

const TENANT = "t-schema-err-1";

/** Windows keeps a libSQL directory locked briefly after `close()`; retry. */
async function removeTempDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/** Narrows a caught `unknown` to `Error`, failing the test if it is not one. */
function asError(thrown: unknown): Error {
  if (!(thrown instanceof Error)) {
    throw new Error(`expected a thrown Error, received ${String(thrown)}`);
  }
  return thrown;
}

describe("libsql-proxy: schema error names the table and withholds the SQL", () => {
  it("keeps the table name, drops the statement, keeps the driver text on cause", async () => {
    const dir = mkdtempSync(join(tmpdir(), "schema-err-"));
    const client = createClient({ url: `file:${join(dir, "test.db")}` });
    try {
      const db = createLibsqlProxy(client);

      // `invoices` is deliberately never created, so the read raises a genuine
      // driver error that embeds the statement it failed on.
      let thrown: unknown;
      try {
        await db.invoice.findMany({
          where: { tenantId: TENANT },
          select: { id: true, number: true, totalPaise: true, status: true, dueDate: true },
        });
      } catch (err) {
        thrown = err;
      }

      const err = asError(thrown);
      const message = err.message;

      // The intended operator signal survives (AGENTS.md §3.4).
      expect(message).toMatch(/Schema missing at runtime/);
      expect(message).toMatch(/invoices/);

      // The driver's own text does not. This build of libSQL renders a short
      // `SQLITE_ERROR: no such table: invoices` — no statement attached — but the
      // prefix alone was a driver string on a screen, and other backends (the
      // gateway's `SQLITE_CANTOPEN` shape) do append the failing statement.
      expect(message).not.toMatch(/SQLITE/i);
      expect(message).not.toMatch(/no such table/i);
      expect(message).not.toMatch(/SELECT/i);
      expect(message).not.toMatch(/Original error/i);

      // Rule 9: nothing is lost — the original driver error is still reachable
      // for the log, it is only kept off the user-visible string.
      expect(asError(err.cause).message).toMatch(/no such table: invoices/i);
    } finally {
      try {
        await client.close();
      } catch {
        // Best-effort: libSQL may already be closed.
      }
      await removeTempDir(dir);
    }
  });

  it("launders only a missing table — every other driver fault passes through", async () => {
    const dir = mkdtempSync(join(tmpdir(), "schema-err-2-"));
    const client = createClient({ url: `file:${join(dir, "test.db")}` });
    try {
      await client.execute(
        "CREATE TABLE students (id TEXT PRIMARY KEY, tenant_id TEXT, code TEXT, created_at TEXT, updated_at TEXT)",
      );
      const db = createLibsqlProxy(client);
      const now = new Date().toISOString();
      const row = { id: "s1", tenantId: TENANT, code: "A", createdAt: now, updatedAt: now };

      await db.student.create({ data: row });

      // A constraint violation is NOT a schema problem, so it must keep its own
      // identity — the fix narrows the rewrite to "no such table" and must not
      // start swallowing every other fault into one sentence.
      let thrown: unknown;
      try {
        await db.student.create({ data: row });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const err = asError(thrown);
      expect(err.message).toMatch(/UNIQUE constraint failed/i);
      expect(err.message).not.toMatch(/Schema missing at runtime/);
    } finally {
      try {
        await client.close();
      } catch {
        // Best-effort: libSQL may already be closed.
      }
      await removeTempDir(dir);
    }
  });
});