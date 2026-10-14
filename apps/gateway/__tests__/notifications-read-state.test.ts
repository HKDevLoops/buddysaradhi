// Implements: AGENTS.md Rule 9 (no silent failures — a handler reports what it
// actually did), Rule 7 / 12_Business_Rules.md BR-SYN-01 (every mutation writes
// `sync_outbox` + `audit_log` in the SAME transaction) + BR-SEC-03 (the audit
// row), and AGENTS.md §6.1 (Zod at every request boundary — a malformed query
// param is a typed 400, never a 500).
//
// Two audited defects are pinned here. Both were "the endpoint reported success
// for work it never did":
//
//   F-21  PATCH /api/v1/notifications/:id validated the id's SHAPE, wrote
//         NOTHING, asserted no existence, and answered `{ read: true }` for any
//         well-formed UUID — including one naming no row at all.
//   F-19.2 `?limit=` was read with `Math.min(50, parseInt(...))`, so `?limit=abc`
//         became NaN, `LimitSchema.parse(NaN)` threw out of the route, and
//         index.ts reported the caller's typo as a generic 500.
//
// Runs the REAL handler against real in-memory SQLite carrying the gateway's
// own DDL (AGENTS.md §7.3 — never mock the DB: a mock cannot tell you whether
// the `read_at` write committed or whether a Zod throw escaped the route).
import { describe, expect, it } from "vitest";
import { handleNotifications } from "../routes/notifications.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000b2";
const ORIGIN = "https://api.buddysaradhi.app";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ApiBody {
  success: boolean;
  data?: { id?: string; read?: boolean; readAt?: string } & Record<string, unknown>;
  error?: string;
  details?: string;
}

// SAFETY: `SqliteGatewayDb` structurally satisfies `SqlHandle` (lib/sql.ts),
// the only capability a route uses at runtime; `DB` is the libsql marker it
// replaces. Same substitution as every other gateway route test.
function asDb(db: SqliteGatewayDb): DB {
  return db as unknown as DB;
}

async function call(
  db: SqliteGatewayDb,
  method: string,
  pathWithQuery: string,
  body?: Record<string, unknown>,
  key?: string,
): Promise<{ status: number; body: ApiBody }> {
  const url = new URL(`${ORIGIN}${pathWithQuery}`);
  const req = new Request(url, {
    method,
    // RFC-004 C1 — fail-closed on keyless mutations: every test intent mints a
    // FRESH key unless it is deliberately replaying one.
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": key ?? crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handleNotifications(
    req,
    asDb(db),
    TENANT,
    url.pathname,
    method,
    url,
  );
  if (!res) throw new Error(`no route matched ${method} ${pathWithQuery}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

async function createNotification(
  db: SqliteGatewayDb,
  title: string,
): Promise<string> {
  const res = await call(db, "POST", "/api/v1/notifications", {
    category: "fee",
    title,
  });
  expect(res.status).toBe(201);
  const id = res.body.data?.id;
  expect(typeof id).toBe("string");
  return id as string;
}

function rows(db: SqliteGatewayDb, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return db.query(sql, args);
}

describe("F-21 — PATCH /notifications/:id marks the row read (Rule 7: outbox + audit in the same transaction)", () => {
  it("writes read_at, and does so with the outbox and audit rows in one transaction", async () => {
    const db = new SqliteGatewayDb();
    const id = await createNotification(db, "Fee due for Aarav");
    expect(rows(db, "SELECT read_at FROM notifications WHERE id = ?", [id])[0]?.read_at).toBeNull();

    const res = await call(db, "PATCH", `/api/v1/notifications/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.read).toBe(true);

    // The effect is real: the column the response claims to have written.
    const stored = rows(db, "SELECT read_at FROM notifications WHERE id = ?", [id])[0]?.read_at;
    expect(typeof stored).toBe("string");
    expect(String(stored).length).toBeGreaterThan(0);
    expect(res.body.data?.readAt).toBe(String(stored));

    // Rule 7 — the read-state change replicates and is auditable.
    const outbox = rows(
      db,
      "SELECT table_name, op, row_id, payload FROM sync_outbox WHERE table_name = 'notifications'",
    );
    expect(outbox).toHaveLength(2); // 1 create + 1 read-state update
    expect(outbox[1]?.op).toBe("update");
    expect(outbox[1]?.row_id).toBe(id);
    expect(JSON.parse(String(outbox[1]?.payload))).toMatchObject({
      id,
      read_at: String(stored),
    });
    const audit = rows(
      db,
      "SELECT action, ref_type, ref_id FROM audit_log WHERE action = 'notification.read'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.ref_type).toBe("notification");
    expect(audit[0]?.ref_id).toBe(id);

    db.close();
  });

  it("marks an ALREADY-read row without moving its original read_at", async () => {
    const db = new SqliteGatewayDb();
    const id = await createNotification(db, "Class starts soon");
    const first = await call(db, "PATCH", `/api/v1/notifications/${id}`);
    const firstAt = rows(db, "SELECT read_at FROM notifications WHERE id = ?", [id])[0]?.read_at;
    expect(String(firstAt).length).toBeGreaterThan(0);

    // A second intent (fresh key) for the same row must not re-stamp the
    // timestamp the tutor's other devices order by.
    const second = await call(db, "PATCH", `/api/v1/notifications/${id}`);
    expect(second.status).toBe(200);
    const secondAt = rows(db, "SELECT read_at FROM notifications WHERE id = ?", [id])[0]?.read_at;
    expect(secondAt).toBe(firstAt);
    expect(second.body.data?.readAt).toBe(first.body.data?.readAt);

    db.close();
  });

  it("replaying the same Idempotency-Key replays the stored bytes and writes nothing new", async () => {
    const db = new SqliteGatewayDb();
    const id = await createNotification(db, "Attendance marked");
    const key = crypto.randomUUID();

    const first = await call(db, "PATCH", `/api/v1/notifications/${id}`, undefined, key);
    const second = await call(db, "PATCH", `/api/v1/notifications/${id}`, undefined, key);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    // Exactly one read-state update — the replay re-executed nothing.
    expect(
      rows(db, "SELECT id FROM sync_outbox WHERE table_name = 'notifications' AND op = 'update'"),
    ).toHaveLength(1);

    db.close();
  });

  it("another tenant's notification is invisible: 404, and nothing written", async () => {
    const db = new SqliteGatewayDb();
    const otherTenantNotification = "018f0000-0000-7000-8000-00000000ff01";
    db.query(
      "INSERT INTO notifications (id, tenant_id, category, title, read_at, created_at) VALUES (?, ?, 'fee', 'Not yours', NULL, ?)",
      [otherTenantNotification, OTHER_TENANT, "2026-03-01T00:00:00.000Z"],
    );
    const res = await call(db, "PATCH", `/api/v1/notifications/${otherTenantNotification}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(
      rows(db, "SELECT read_at FROM notifications WHERE id = ?", [otherTenantNotification])[0]
        ?.read_at,
    ).toBeNull();
    expect(rows(db, "SELECT id FROM sync_outbox WHERE row_id = ?", [otherTenantNotification])).toHaveLength(0);
    expect(
      rows(db, "SELECT id FROM audit_log WHERE ref_id = ?", [otherTenantNotification]),
    ).toHaveLength(0);

    db.close();
  });
});

describe("F-21 — a row that does not exist is a 404, not a fabricated success (Rule 9)", () => {
  it("404s a well-formed UUID naming no row", async () => {
    const db = new SqliteGatewayDb();
    const missing = "018f0000-0000-7000-8000-0000000000ff";
    expect(missing).toMatch(UUID_RE);

    const res = await call(db, "PATCH", `/api/v1/notifications/${missing}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
    expect(res.body.success).toBe(false);

    // A 404 must leave no trace of a mutation it did not perform…
    expect(rows(db, "SELECT id FROM sync_outbox")).toHaveLength(0);
    expect(rows(db, "SELECT id FROM audit_log")).toHaveLength(0);
    // …and must not consume the idempotency key, so a retry after the row
    // exists actually executes (RFC-004 C1). The composite key is
    // (tenant_id, route, "key") — there is no `id` column (lib/schema.ts:338).
    expect(
      rows(db, 'SELECT "key" FROM idempotency_keys WHERE route LIKE ?', [
        "%/api/v1/notifications/%",
      ]),
    ).toHaveLength(0);

    db.close();
  });

  it("a 404 is NOT swallowed into a 500 by the outbox/audit fail-closed path", async () => {
    const db = new SqliteGatewayDb();
    // The 404 is thrown INSIDE the write transaction, so it must be carried out
    // as a typed 404 rather than escaping to index.ts as an unknown error.
    const res = await call(db, "PATCH", `/api/v1/notifications/018f0000-0000-7000-8000-000000000abc`);
    expect(res.status).toBe(404);
    db.close();
  });

  it("a malformed id is still a typed 400 (unchanged) and reaches no write", async () => {
    const db = new SqliteGatewayDb();
    const res = await call(db, "PATCH", "/api/v1/notifications/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("VALIDATION");
    expect(res.body.details).toContain("must be a UUID");
    expect(rows(db, "SELECT id FROM sync_outbox")).toHaveLength(0);
    db.close();
  });
});

describe("F-19.2 — ?limit= is Zod-parsed, so a bad value is a typed 400 (AGENTS.md §6.1)", () => {
  function seedNotifications(db: SqliteGatewayDb, howMany: number): void {
    for (let n = 0; n < howMany; n += 1) {
      db.query(
        "INSERT INTO notifications (id, tenant_id, category, title, read_at, created_at) VALUES (?, ?, 'system', ?, NULL, ?)",
        [
          `018f0000-0000-7000-8000-0000000000${String(n).padStart(3, "0")}`,
          TENANT,
          `Notice ${String(n).padStart(3, "0")}`,
          `2026-03-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
        ],
      );
    }
  }

  const BAD_LIMITS = [
    ["a word", "abc"],
    ["empty", ""],
    ["zero", "0"],
    ["negative", "-1"],
    ["float", "10.5"],
    ["exponent", "1e3"],
    ["whitespace", "%20"],
    ["hex", "0x10"],
    ["a bare sign", "+"],
  ] as const;

  for (const [label, raw] of BAD_LIMITS) {
    it(`?limit=${raw} is a typed 400 VALIDATION, never a 500 (${label})`, async () => {
      const db = new SqliteGatewayDb();
      // A throw escaping the handler is the pre-fix symptom: index.ts turns it
      // into a generic 500. Awaiting the handler here is the assertion.
      const res = await call(db, "GET", `/api/v1/notifications?limit=${raw}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION");
      expect(res.body.details).toContain("limit");
      db.close();
    });
  }

  it("a legitimate limit is honoured, and still clamped to the 50 ceiling", async () => {
    const db = new SqliteGatewayDb();
    seedNotifications(db, 60);

    const small = await call(db, "GET", "/api/v1/notifications?limit=5");
    expect(small.status).toBe(200);
    expect((small.body.data as unknown[]).length).toBe(5);

    const overCeiling = await call(db, "GET", "/api/v1/notifications?limit=500");
    expect(overCeiling.status).toBe(200);
    expect((overCeiling.body.data as unknown[]).length).toBe(50);

    const absent = await call(db, "GET", "/api/v1/notifications");
    expect(absent.status).toBe(200);
    // Default 20 — unchanged from the shipped default (`?? "20"`).
    expect((absent.body.data as unknown[]).length).toBe(20);
    db.close();
  });
});