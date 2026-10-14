// Implements: AGENTS.md §6.1 (Zod at every boundary — a value that never passed
// validation must never reach the ORM) + 11_Data_Model.md §1 (every `id` is a
// UUID) + Rule 9 (no silent failures) + Rule 7 / 12_Business_Rules.md BR-SYN-02
// (the outbox payload describes the row that was actually written).
//
// The audited defect (F-18): `POST /api/v1/students` read
// `const id = body.id ?? crypto.randomUUID()` from the RAW pre-Zod object —
// bypassing the allowlist (`STUDENT_CREATE_SCHEMA` has no `id` key, so Zod
// strips one) and then writing it anyway. `stmtInsertStudent` validates with
// `IdSchema` = `z.string().min(1).max(128)` (lib/sql.ts:283), which bounds a
// bound parameter and does NOT assert identity. Every read/write path for a
// student validates the id as a UUID (`parsePathId` in routes/students.ts,
// routes/ledger.ts:57, routes/attendance.ts:201), so a student created with a
// non-UUID id was permanently unreachable: undeletable, unpayable, uninvoiceable,
// and invisible to every screen that fetches by id.
//
// Runs the REAL handler against real in-memory SQLite carrying the gateway's own
// DDL (AGENTS.md §7.3) — the assertion is end-to-end reachability, which only a
// real database can answer.
import { describe, expect, it } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const ORIGIN = "https://api.buddysaradhi.app";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ApiBody {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  details?: string;
}

// SAFETY: `SqliteGatewayDb` structurally satisfies `SqlHandle` (lib/sql.ts),
// the only capability a route uses at runtime; `DB` is the libsql marker it
// replaces.
function asDb(db: SqliteGatewayDb): DB {
  return db as unknown as DB;
}

async function call(
  db: SqliteGatewayDb,
  method: string,
  pathWithQuery: string,
  body?: Record<string, unknown>,
): Promise<{ status: number; body: ApiBody }> {
  const url = new URL(`${ORIGIN}${pathWithQuery}`);
  const req = new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      // RFC-004 C1 — fail-closed on keyless mutations: each test intent is a
      // distinct user intent, so each mints its own key.
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleStudents(req, asDb(db), TENANT, url.pathname, method, url, {});
  if (!res) throw new Error(`no route matched ${method} ${pathWithQuery}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function rows(db: SqliteGatewayDb, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return db.query(sql, args);
}

describe("F-18 — the student id is minted server-side, never read from the request", () => {
  it("ignores a caller-supplied id and creates a UUID-addressable student", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);

    const res = await call(db, "POST", "/api/v1/students", {
      first_name: "Riya",
      id: "not-a-uuid",
    });
    expect(res.status).toBe(201);

    const id = String(res.body.data?.id ?? "");
    // The supplied value never became the primary key…
    expect(id).not.toBe("not-a-uuid");
    // …and what did is a UUID, which is what every read path requires.
    expect(id).toMatch(UUID_RE);

    const stored = rows(db, "SELECT id, first_name FROM students WHERE tenant_id = ?", [TENANT]);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(id);
    expect(stored[0]?.first_name).toBe("Riya");
    // The caller's string is nowhere in the table — no unreachable row.
    expect(rows(db, "SELECT id FROM students WHERE id = 'not-a-uuid'")).toHaveLength(0);

    db.close();
  });

  it("the created student is REACHABLE — GET/PATCH/DELETE all accept its id", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);

    const created = await call(db, "POST", "/api/v1/students", {
      first_name: "Kabir",
      id: "not-a-uuid",
    });
    const id = String(created.body.data?.id ?? "");
    expect(id).toMatch(UUID_RE);

    // The pre-fix failure mode, stated as the test: the id every other route
    // validates as a UUID must name a real row.
    const read = await call(db, "GET", `/api/v1/students/${id}`);
    expect(read.status).toBe(200);
    expect((read.body.data as { id: string }).id).toBe(id);

    const edited = await call(db, "PATCH", `/api/v1/students/${id}`, { grade: "10" });
    expect(edited.status).toBe(200);

    const deleted = await call(db, "DELETE", `/api/v1/students/${id}`);
    expect(deleted.status).toBe(200);
    expect(rows(db, "SELECT id FROM students WHERE id = ?", [id])).toHaveLength(0);

    db.close();
  });

  it("a valid-UUID caller-supplied id is ignored too, so posting the same body twice cannot collide", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);

    const body = { first_name: "Neha", id: "018f0000-0000-7000-8000-00000000abcd" };
    const first = await call(db, "POST", "/api/v1/students", body);
    // The pre-fix symptom: the second post hit the PRIMARY KEY and collapsed to
    // an opaque constraint error (a 500), because the client chose the id.
    const second = await call(db, "POST", "/api/v1/students", body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(String(first.body.data?.id)).not.toBe(String(second.body.data?.id));
    expect(rows(db, "SELECT id FROM students WHERE tenant_id = ?", [TENANT])).toHaveLength(2);

    db.close();
  });

  it("the outbox payload describes the row that was actually written (BR-SYN-02)", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);

    const res = await call(db, "POST", "/api/v1/students", {
      first_name: "Diya",
      id: "not-a-uuid",
    });
    const id = String(res.body.data?.id ?? "");

    const outbox = rows(
      db,
      "SELECT row_id, payload FROM sync_outbox WHERE table_name = 'students' AND op = 'insert'",
    );
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.row_id).toBe(id);
    // The payload is the row: a replay must not recreate the caller's id.
    const payload = JSON.parse(String(outbox[0]?.payload)) as Record<string, unknown>;
    expect(payload.id).toBe(id);
    expect(payload.id).not.toBe("not-a-uuid");

    db.close();
  });
});