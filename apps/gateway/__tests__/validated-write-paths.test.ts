// Implements: AGENTS.md §2 Rule 9 (typed errors, no silent failures) +
// §6.1 (Zod at every boundary) + 12_Business_Rules.md BR-SYN-02 (the outbox
// payload describes the row that was actually written).
//
// THREE defects, one species: request data crossing a trust boundary without
// validation. Each was fixed by narrowing what is stored to what was
// validated — and each has a regression test below that fails if the raw body
// is ever stored again.
//
//   F-19.2s — `GET /api/v1/sync/outbox?limit=abc`: `Math.min(500,
//             parseInt(...))` produced NaN, the audited builder's
//             `LimitSchema.parse` threw, and the ZodError escaped as a generic
//             500. Same defect class as the notifications limit (F-19.2).
//   F-20a   — `POST /api/v1/students` stored `{...body, id}` in the outbox and
//             `body` in the audit row: every unknown client key persisted into
//             tables the client can read back.
//   F-20b   — `POST /api/v1/attendance` stored the raw `body` in the outbox.
//
// Runs the REAL handlers against real in-memory SQLite carrying the gateway's
// own DDL (AGENTS.md §7.3).

import { describe, expect, it } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { handleAttendance } from "../routes/attendance.ts";
import { handleSync } from "../routes/sync.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000b2";
const ORIGIN = "https://api.buddysaradhi.app";

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

function jsonReq(method: string, pathWithQuery: string, body?: Record<string, unknown>): Request {
  return new Request(`${ORIGIN}${pathWithQuery}`, {
    method,
    headers: {
      "content-type": "application/json",
      // RFC-004 C1 — fail-closed on keyless mutations.
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function rows(db: SqliteGatewayDb, sql: string, args: unknown[] = []): Record<string, unknown>[] {
  return db.query(sql, args);
}

describe("F-19.2s / sync outbox limit is a typed 400, never a 500", () => {
  it("rejects ?limit=abc with VALIDATION, not a generic 500", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    const url = new URL(`${ORIGIN}/api/v1/sync/outbox?limit=abc`);
    const res = await handleSync(
      jsonReq("GET", "/api/v1/sync/outbox?limit=abc"),
      asDb(db),
      TENANT,
      "/api/v1/sync/outbox",
      "GET",
      url,
      {},
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    const body = (await res!.json()) as ApiBody;
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION");
  });

  it("rejects ?limit=0, ?limit=-1 and ?limit=10.5 the same way", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    for (const q of ["limit=0", "limit=-1", "limit=10.5", "limit=1e3"]) {
      const url = new URL(`${ORIGIN}/api/v1/sync/outbox?${q}`);
      const res = await handleSync(
        jsonReq("GET", `/api/v1/sync/outbox?${q}`),
        asDb(db),
        TENANT,
        "/api/v1/sync/outbox",
        "GET",
        url,
        {},
      );
      expect(res!.status).toBe(400);
    }
  });

  it("still serves legitimate limits and the default", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    for (const q of ["", "limit=5", "limit=500"]) {
      const url = new URL(`${ORIGIN}/api/v1/sync/outbox${q ? `?${q}` : ""}`);
      const res = await handleSync(
        jsonReq("GET", `/api/v1/sync/outbox${q ? `?${q}` : ""}`),
        asDb(db),
        TENANT,
        "/api/v1/sync/outbox",
        "GET",
        url,
        {},
      );
      expect(res!.status).toBe(200);
    }
  });
});

describe("F-20a / student outbox + audit rows carry validated data only", () => {
  it("an unknown client key reaches neither the outbox nor the audit row", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    const res = await handleStudents(
      jsonReq("POST", "/api/v1/students", {
        first_name: "Validated",
        smuggled: "attacker-value",
      }),
      asDb(db),
      TENANT,
      "/api/v1/students",
      "POST",
      new URL(`${ORIGIN}/api/v1/students`),
      {},
    );
    expect(res!.status).toBe(201);

    const outbox = rows(db, "SELECT payload FROM sync_outbox WHERE tenant_id = ?", [TENANT]);
    expect(outbox).toHaveLength(1);
    const payload = JSON.stringify(outbox[0].payload);
    expect(payload).not.toContain("smuggled");
    expect(payload).not.toContain("attacker-value");

    const audit = rows(db, "SELECT metadata FROM audit_log WHERE tenant_id = ?", [TENANT]);
    expect(audit.length).toBeGreaterThan(0);
    const metas = audit.map((r) => JSON.stringify(r.metadata)).join("\n");
    expect(metas).not.toContain("smuggled");
    expect(metas).not.toContain("attacker-value");
  });
});

describe("F-20b / attendance outbox carries the validated fragment", () => {
  it("an unknown client key is dropped at the schema, not stored", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    const studentId = crypto.randomUUID();
    db.query(
      "INSERT INTO students (id, tenant_id, first_name, admission_date, dup_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [studentId, TENANT, "Markable", "2026-10-01", `${TENANT}:${studentId}`, new Date().toISOString(), new Date().toISOString()],
    );
    const res = await handleAttendance(
      jsonReq("POST", "/api/v1/attendance", {
        session_date: "2026-10-14",
        updates: [{ student_id: studentId, status: "present" }],
        smuggled: "attacker-value",
      }),
      asDb(db),
      TENANT,
      "/api/v1/attendance",
      "POST",
      new URL(`${ORIGIN}/api/v1/attendance`),
      {},
    );
    expect(res!.status).toBe(200);

    const outbox = rows(db, "SELECT payload FROM sync_outbox WHERE tenant_id = ?", [TENANT]);
    expect(outbox.length).toBeGreaterThan(0);
    const payloads = outbox.map((r) => JSON.stringify(r.payload)).join("\n");
    expect(payloads).not.toContain("smuggled");
    expect(payloads).not.toContain("attacker-value");
    // …while the validated substance survives (the payload is the row).
    expect(payloads).toContain("2026-10-14");
    expect(payloads).toContain(studentId);
  });
});
