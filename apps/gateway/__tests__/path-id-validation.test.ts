// Implements: AGENTS.md §6.1 ("Zod for all input validation … every server
// action, every API route") + §4.1.1 (`11_Data_Model.md` §1 — every `id` is a
// UUID) + Rule 9 (a rejected input is a typed error, never a silent pass-through)
// + 10_Security.md §8 (the error body carries no attacker-supplied value).
//
// The defect this pins: `:id` path segments were taken with
// `path.split("/").pop()!` and handed straight to `where: { id }`. `?`-bound, so
// never an injection — but an unvalidated boundary, which AGENTS.md §6.1 forbids
// and which let an arbitrary string reach the ORM.
//
// Runs the REAL handlers against real in-memory SQLite (AGENTS.md §7.3) and
// counts every statement that reaches the database handle, so "did not reach the
// ORM" is asserted rather than assumed. A test that only checked the status code
// would pass against a route that queried first and validated the answer.
import { describe, expect, it } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { handleNotifications } from "../routes/notifications.ts";
import { parsePathId } from "../routes/students.ts";
import type { DB } from "../lib/db.ts";
import { createLedgerFixture, SqliteGatewayDb, type LedgerFixture } from "./sqlite-db.ts";

interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: string;
  details?: string;
}

/** A real `SqliteGatewayDb` behind a counter. `execute` AND `transaction` are
 *  both counted because a write route opens a transaction before it writes; a
 *  rejection that opened one would have done work the assertion forbids. */
function countingHandle(db: SqliteGatewayDb): { handle: DB; calls: () => number } {
  let calls = 0;
  const handle = {
    execute(stmt: unknown) {
      calls += 1;
      return db.execute(stmt);
    },
    transaction(mode?: "write" | "read" | "deferred") {
      calls += 1;
      return db.transaction(mode);
    },
    batch(stmts: Array<{ sql: string; args?: unknown[] }>, mode?: "write" | "read") {
      calls += 1;
      return db.batch(stmts, mode);
    },
  };
  // SAFETY: `countingHandle` structurally satisfies `SqlHandle` (lib/sql.ts),
  // the only capability a route uses; `DB` is the libsql marker it replaces.
  return { handle: handle as unknown as DB, calls: () => calls };
}

async function callStudent(
  f: LedgerFixture,
  handle: DB,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      // RFC-004 C1 — every mutating route is keyless-fail-closed, and the id
      // check deliberately sits AFTER the key check, so a valid key is required
      // to reach the assertion under test.
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleStudents(
    req,
    handle,
    f.tenantId,
    path,
    method,
    new URL(req.url),
    {},
  );
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

async function callNotification(
  f: LedgerFixture,
  handle: DB,
  method: string,
  path: string,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method,
    headers: { "Idempotency-Key": crypto.randomUUID() },
  });
  const res = await handleNotifications(
    req,
    handle,
    f.tenantId,
    path,
    method,
    new URL(req.url),
  );
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

/** Every one of these is a string a caller can put in a URL path segment. */
const BAD_IDS = [
  ["plain word", "not-a-uuid"],
  ["SQL-ish", "1 OR 1=1"],
  ["injection attempt", "' OR '1'='1"],
  ["id of another row's shape", "stu-001"],
  ["uuid with a trailing space", "018f0000-0000-7000-8000-000000000002 "],
  ["uuid truncated", "018f0000-0000-7000-8000-0000000000"],
  ["unhyphenated uuid", "018f0000000070008000000000000002"],
  ["path traversal", "..%2F..%2Fsettings"],
] as const;

describe("path-segment ids are validated before they reach the ORM (AGENTS.md §6.1)", () => {
  it("GET /students/:id rejects every malformed id with a typed 400 and zero queries", async () => {
    for (const [label, bad] of BAD_IDS) {
      const f = createLedgerFixture();
      const { handle, calls } = countingHandle(f.db);
      const res = await callStudent(f, handle, "GET", `/api/v1/students/${bad}`);
      expect(res.status, `${label}: ${bad}`).toBe(400);
      expect(res.body.error, label).toBe("VALIDATION");
      expect(res.body.details, label).toContain("must be a UUID");
      expect(res.body.success, label).toBe(false);
      // The load-bearing assertion: the id never became a query parameter.
      expect(calls(), `${label}: ${bad} reached the ORM`).toBe(0);
      f.db.close();
    }
  });

  it("PATCH /students/:id rejects every malformed id before any read, write or transaction", async () => {
    for (const [label, bad] of BAD_IDS) {
      const f = createLedgerFixture();
      const { handle, calls } = countingHandle(f.db);
      const res = await callStudent(f, handle, "PATCH", `/api/v1/students/${bad}`, {
        first_name: "Renamed",
      });
      expect(res.status, `${label}: ${bad}`).toBe(400);
      expect(res.body.error, label).toBe("VALIDATION");
      expect(calls(), `${label}: ${bad} reached the ORM`).toBe(0);
      // And nothing was written, so the row is untouched (no partial effect).
      const rows = f.db.query("SELECT first_name FROM students WHERE tenant_id = ?", [
        f.tenantId,
      ]);
      expect(rows[0]?.first_name, label).toBe("Aarav");
      f.db.close();
    }
  });

  it("DELETE /students/:id rejects every malformed id before any read, write or transaction", async () => {
    for (const [label, bad] of BAD_IDS) {
      const f = createLedgerFixture();
      const { handle, calls } = countingHandle(f.db);
      const res = await callStudent(f, handle, "DELETE", `/api/v1/students/${bad}`);
      expect(res.status, `${label}: ${bad}`).toBe(400);
      expect(res.body.error, label).toBe("VALIDATION");
      expect(calls(), `${label}: ${bad} reached the ORM`).toBe(0);
      // The destructive route specifically: the row must still exist.
      expect(f.db.query("SELECT COUNT(*) AS n FROM students")[0]?.n, label).toBe(1);
      f.db.close();
    }
  });

  it("PATCH /notifications/:id rejects every malformed id and stores no idempotent response", async () => {
    for (const [label, bad] of BAD_IDS) {
      const f = createLedgerFixture();
      const { handle, calls } = countingHandle(f.db);
      const res = await callNotification(f, handle, "PATCH", `/api/v1/notifications/${bad}`);
      expect(res.status, `${label}: ${bad}`).toBe(400);
      expect(res.body.error, label).toBe("VALIDATION");
      expect(res.body.details, label).toContain("must be a UUID");
      expect(calls(), `${label}: ${bad} reached the ORM`).toBe(0);
      f.db.close();
    }
  });

  it("the 400 never echoes the offending value (10_Security.md §8)", async () => {
    const f = createLedgerFixture();
    const { handle } = countingHandle(f.db);
    const res = await callStudent(f, handle, "GET", "/api/v1/students/1 OR 1=1");
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("OR 1=1");
    // A UUID-shaped value is not secret and is never echoed either, so the
    // error body is fully determined by the schema, not by the request.
    expect(raw).toBe(
      JSON.stringify({ success: false, error: "VALIDATION", details: "id: must be a UUID" }),
    );
    f.db.close();
  });
});

describe("the valid case is unchanged — a real UUID still reaches the ORM", () => {
  it("GET /students/:id serves the row for a real UUIDv7 id", async () => {
    const f = createLedgerFixture();
    const { handle, calls } = countingHandle(f.db);
    const res = await callStudent(f, handle, "GET", `/api/v1/students/${f.studentId}`);
    expect(res.status).toBe(200);
    expect((res.body.data as { id: string }).id).toBe(f.studentId);
    expect(calls()).toBeGreaterThan(0);
    f.db.close();
  });

  it("a well-formed id naming no row is still a 404, not a 400", async () => {
    const f = createLedgerFixture();
    const { handle } = countingHandle(f.db);
    const res = await callStudent(
      f,
      handle,
      "GET",
      "/api/v1/students/018f0000-0000-7000-8000-0000000000ff",
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    f.db.close();
  });

  it("an uppercase UUID is accepted (case-insensitive identity)", () => {
    expect(parsePathId("018F0000-0000-7000-8000-000000000002").ok).toBe(true);
  });

  it("DELETE /students/:id still deletes a real UUID", async () => {
    const f = createLedgerFixture();
    const { handle, calls } = countingHandle(f.db);
    const res = await callStudent(f, handle, "DELETE", `/api/v1/students/${f.studentId}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ ok: true });
    expect(f.db.query("SELECT COUNT(*) AS n FROM students")[0]?.n).toBe(0);
    expect(calls()).toBeGreaterThan(0);
    f.db.close();
  });
});

describe("routing is unchanged for the paths that were never :id routes", () => {
  it("a trailing-slash collection path still falls through to the roster handler", async () => {
    const f = createLedgerFixture();
    const db = new SqliteGatewayDb();
    // SAFETY: same SqlHandle substitution as above.
    const res = await handleStudents(
      new Request("https://api.buddysaradhi.app/api/v1/students/", { method: "GET" }),
      db as unknown as DB,
      f.tenantId,
      "/api/v1/students/",
      "GET",
      new URL("https://api.buddysaradhi.app/api/v1/students/"),
      {},
    );
    // `path !== "/api/v1/students/"` still excludes it from the :id branch, so
    // this is `null` (no route matched) rather than a 400 for an empty id.
    expect(res).toBeNull();
    f.db.close();
    db.close();
  });
});