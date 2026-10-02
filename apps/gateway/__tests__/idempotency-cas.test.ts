// Implements: docs/rfc/004-multi-device-network-contract.md kill-test matrix
// K1–K4, K6 (gateway duties: RFC-004 §3) + 17_API_Gateway_System.md §3
// (request lifecycle) + AGENTS.md §7.3 (real in-memory SQLite via
// ./sqlite-db.ts — never a mocked DB; concurrent tests use real parallel
// promises).
//
// The dispatch helper below exercises the REAL middleware precondition
// (`enforceIdempotencyPrecondition`, the same function index.ts calls) plus the
// REAL route handlers, so replay/CAS behaviour is tested end-to-end at the
// gateway layer (auth + edge cache are index.ts concerns, out of scope here).
import { describe, expect, it } from "vitest";
import type { DB } from "../lib/db.ts";
import type { SqlHandle } from "../lib/sql.ts";
import {
  enforceIdempotencyPrecondition,
  findStoredIdempotentResponse,
  idempotencyRoute,
  purgeExpiredIdempotencyKeys,
  storeIdempotentResponse,
} from "../lib/idempotency.ts";
import { handleLedger } from "../routes/ledger.ts";
import { handleSettings } from "../routes/settings.ts";
import { handleStudents, type RouteHandler } from "../routes/students.ts";
import {
  createLedgerFixture,
  type LedgerFixture,
} from "./sqlite-db.ts";

interface ApiEnvelope {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  server_row?: Record<string, unknown>;
  details?: string;
}

function asDb(fixture: LedgerFixture): DB {
  // SAFETY: the SQLite fixture satisfies `SqlHandle` (lib/sql.ts), the only
  // capability the routes use — same cast as ledger-routes.test.ts.
  return fixture.db as unknown as DB;
}

function asHandle(fixture: LedgerFixture): SqlHandle {
  // SAFETY: same structural-substitution rationale as `asDb` above.
  return fixture.db as unknown as SqlHandle;
}

let keyCounter = 0;
/** Fresh client-minted intent UUIDs (RFC-004 C1 — one per user intent). */
function newKey(): string {
  keyCounter += 1;
  return `018f0000-0000-7000-9000-${String(keyCounter).padStart(12, "0")}`;
}

async function mutate(
  fixture: LedgerFixture,
  handler: RouteHandler,
  path: string,
  method: string,
  body: Record<string, unknown>,
  opts: { key?: string; tenantId?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const tenantId = opts.tenantId ?? fixture.tenantId;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.key !== undefined) headers["Idempotency-Key"] = opts.key;
  const req = new Request(`https://api.buddysaradhi.app${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  // The REAL middleware precondition (same function index.ts runs).
  const pre = await enforceIdempotencyPrecondition(
    req,
    asHandle(fixture),
    tenantId,
    idempotencyRoute(method, path),
  );
  if (pre) return pre;
  const res = await handler(req, asDb(fixture), tenantId, path, method, new URL(req.url), {});
  if (!res) throw new Error(`no route matched ${method} ${path}`);
  return res;
}

async function envelope(res: Response): Promise<ApiEnvelope> {
  // SAFETY: every gateway response is the `{ success, ... }` contract shape.
  return (await res.json()) as ApiEnvelope;
}

function countRows(fixture: LedgerFixture, table: string, tenantId?: string): number {
  const tenant = tenantId ?? fixture.tenantId;
  const rows = fixture.db.query(`SELECT COUNT(*) AS c FROM ${table} WHERE tenant_id = ?`, [tenant]);
  return Number(rows[0]?.c ?? 0);
}

/** Seed a second tenant (own settings row + student) into the same fixture DB. */
function seedSecondTenant(
  fixture: LedgerFixture,
  tenantId: string,
  studentId: string,
): void {
  const now = new Date().toISOString();
  fixture.db.raw
    .prepare(
      `INSERT INTO settings (tenant_id, institute_name, tenant_secret, created_at, updated_at)
       VALUES (?, 'Second Tuition', 'second-tenant-secret', ?, ?)`,
    )
    .run(tenantId, now, now);
  fixture.db.raw
    .prepare(
      `INSERT INTO students (id, tenant_id, first_name, admission_date, status, dup_key, balance_paise, created_at, updated_at)
       VALUES (?, ?, 'Meera', '2026-01-04', 'active', 'S-002', 0, ?, ?)`,
    )
    .run(studentId, tenantId, now, now);
}

describe("RFC-004 C1 guards — fail-closed key requirement", () => {
  it("a mutation without an Idempotency-Key is 400 VALIDATION (reads never need keys)", async () => {
    const f = createLedgerFixture();
    const res = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 10000,
    });
    expect(res.status).toBe(400);
    const guardBody = await envelope(res);
    expect(guardBody.error).toBe("VALIDATION");
    expect(guardBody.details ?? "").toContain("Idempotency-Key");
    expect(countRows(f, "ledger_entries")).toBe(0);
  });

  it("a malformed Idempotency-Key is 400 VALIDATION with no effect", async () => {
    const f = createLedgerFixture();
    const res = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 10000,
    }, { key: "not-a-uuid" });
    expect(res.status).toBe(400);
    const malformedBody = await envelope(res);
    expect(malformedBody.error).toBe("VALIDATION");
    expect(malformedBody.details ?? "").toContain("UUID");
    expect(countRows(f, "ledger_entries")).toBe(0);
  });
});

describe("RFC-004 K1 — double-submit same key (payment + void)", () => {
  it("double-click record-payment: 1 ledger row, 1 receipt, 2nd response byte-identical", async () => {
    const f = createLedgerFixture();
    const key = newKey();
    const body = { studentId: f.studentId, amount: 10000 };
    const r1 = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, { key });
    expect(r1.status).toBe(200);
    const t1 = await r1.text();
    expect(t1).toContain("RCP-000001");

    const r2 = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, { key });
    expect(r2.status).toBe(200);
    expect(await r2.text()).toBe(t1);
    expect(r2.headers.get("X-Idempotent-Replayed")).toBe("true");

    expect(countRows(f, "ledger_entries")).toBe(1);
    expect(countRows(f, "receipts")).toBe(1);
    expect(countRows(f, "idempotency_keys")).toBe(1);
  });

  it("double-submit void: 1 VOID row, 2nd response byte-identical", async () => {
    const f = createLedgerFixture();
    const pay = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 10000,
    }, { key: newKey() });
    expect(pay.status).toBe(200);
    const entryRows = f.db.query(
      "SELECT id FROM ledger_entries WHERE tenant_id = ? AND type = 'PAYMENT_RECEIVED'",
      [f.tenantId],
    );
    const entryId = String(entryRows[0]?.id);

    const key = newKey();
    const v1 = await mutate(f, handleLedger, "/api/v1/ledger/void", "POST", {
      entryId,
      reason: "duplicate charge",
    }, { key });
    expect(v1.status).toBe(200);
    const t1 = await v1.text();

    const v2 = await mutate(f, handleLedger, "/api/v1/ledger/void", "POST", {
      entryId,
      reason: "duplicate charge",
    }, { key });
    expect(v2.status).toBe(200);
    expect(await v2.text()).toBe(t1);

    const voids = f.db.query(
      "SELECT COUNT(*) AS c FROM ledger_entries WHERE tenant_id = ? AND type = 'VOID'",
      [f.tenantId],
    );
    expect(Number(voids[0]?.c ?? 0)).toBe(1);
  });
});

describe("RFC-004 K2 — replay after simulated abort (concurrent same-key race)", () => {
  it("two in-flight POSTs with one key: 1 effect, both 200, bodies identical", async () => {
    const f = createLedgerFixture();
    const key = newKey();
    const body = { studentId: f.studentId, amount: 25000 };
    // Real parallel promises against the serialising fixture: both pre-checks
    // miss, one transaction wins, the loser rolls back and replays (K2's
    // handover-abort shape — the first response was "lost", the retry
    // replays it).
    const [r1, r2] = await Promise.all([
      mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, { key }),
      mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, { key }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(await r1.text()).toBe(await r2.text());
    expect(countRows(f, "ledger_entries")).toBe(1);
    expect(countRows(f, "receipts")).toBe(1);
  });
});

describe("RFC-004 K3 — same intent from two sessions, key scope", () => {
  it("web + mobile echo one key concurrently: 1 effect, identical responses", async () => {
    const f = createLedgerFixture();
    const key = newKey();
    const body = { studentId: f.studentId, amount: 7500 };
    const [web, mobile] = await Promise.all([
      mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, {
        key,
        headers: { "X-Request-Id": "web-session-1" },
      }),
      mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", body, {
        key,
        headers: { "X-Request-Id": "mobile-session-9" },
      }),
    ]);
    expect(web.status).toBe(200);
    expect(mobile.status).toBe(200);
    expect(await web.text()).toBe(await mobile.text());
    expect(countRows(f, "ledger_entries")).toBe(1);
  });

  it("same key on a DIFFERENT tenant is a different intent (scope = tenant+route+key)", async () => {
    const f = createLedgerFixture();
    const tenant2 = "018f0000-0000-7000-8000-0000000000b2";
    const student2 = "018f0000-0000-7000-8000-0000000000c3";
    seedSecondTenant(f, tenant2, student2);
    const key = newKey();
    const r1 = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: f.studentId,
      amount: 10000,
    }, { key });
    const r2 = await mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
      studentId: student2,
      amount: 10000,
    }, { key, tenantId: tenant2 });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Per-tenant sequences: each tenant mints its own RCP-000001.
    expect(await r1.text()).toContain("RCP-000001");
    expect(await r2.text()).toContain("RCP-000001");
    expect(countRows(f, "ledger_entries", f.tenantId)).toBe(1);
    expect(countRows(f, "ledger_entries", tenant2)).toBe(1);
  });
});

describe("RFC-004 K4 — CAS mismatch 409 + match-through write", () => {
  it("settings: stale base → 409 + safe server_row with NO write; fresh base writes; absent base is legacy LWW", async () => {
    const f = createLedgerFixture();
    const before = f.db.query("SELECT updated_at, institute_name FROM settings WHERE tenant_id = ?", [
      f.tenantId,
    ])[0];
    const freshBase = String(before?.updated_at);

    const stale = await mutate(f, handleSettings, "/api/v1/settings", "PATCH", {
      instituteName: "Hacked Tuition",
      base_updated_at: "2000-01-01T00:00:00.000Z",
    }, { key: newKey() });
    expect(stale.status).toBe(409);
    const staleBody = await envelope(stale);
    expect(staleBody.error ?? "").toContain("CONFLICT");
    expect(staleBody.server_row).toBeDefined();
    // Safe-projected: no secrets leave the gateway (10_Security.md §1).
    expect("tenant_secret" in (staleBody.server_row ?? {})).toBe(false);
    expect("tenantSecret" in (staleBody.server_row ?? {})).toBe(false);
    expect("pin_hash" in (staleBody.server_row ?? {})).toBe(false);
    // NO write happened.
    const still = f.db.query("SELECT updated_at, institute_name FROM settings WHERE tenant_id = ?", [
      f.tenantId,
    ])[0];
    expect(still?.institute_name).toBe(before?.institute_name);
    expect(still?.updated_at).toBe(before?.updated_at);

    const match = await mutate(f, handleSettings, "/api/v1/settings", "PATCH", {
      instituteName: "Sharma Tuition",
      base_updated_at: freshBase,
    }, { key: newKey() });
    expect(match.status).toBe(200);
    expect((await envelope(match)).data?.instituteName).toBe("Sharma Tuition");

    const legacy = await mutate(f, handleSettings, "/api/v1/settings", "PATCH", {
      instituteName: "Legacy Tuition",
    }, { key: newKey() });
    expect(legacy.status).toBe(200);
    expect((await envelope(legacy)).data?.instituteName).toBe("Legacy Tuition");
  });

  it("students: stale base → 409 + server_row; fresh base writes; absent base is legacy LWW", async () => {
    const f = createLedgerFixture();
    const row = f.db.query("SELECT updated_at FROM students WHERE tenant_id = ? AND id = ?", [
      f.tenantId,
      f.studentId,
    ])[0];
    const freshBase = String(row?.updated_at);
    const path = `/api/v1/students/${f.studentId}`;

    const stale = await mutate(f, handleStudents, path, "PATCH", {
      firstName: "Stale",
      base_updated_at: "2000-01-01T00:00:00.000Z",
    }, { key: newKey() });
    expect(stale.status).toBe(409);
    const staleBody = await envelope(stale);
    expect(staleBody.error ?? "").toContain("CONFLICT");
    expect(staleBody.server_row?.id).toBe(f.studentId);

    const match = await mutate(f, handleStudents, path, "PATCH", {
      firstName: "Aarav",
      lastName: "Sharma",
      baseUpdatedAt: freshBase,
    }, { key: newKey() });
    expect(match.status).toBe(200);

    const legacy = await mutate(f, handleStudents, path, "PATCH", {
      lastName: "Legacy",
    }, { key: newKey() });
    expect(legacy.status).toBe(200);
    expect((await envelope(legacy)).data?.lastName).toBe("Legacy");
  });

  it("non-string base_updated_at is 400 VALIDATION (never silently ignored)", async () => {
    const f = createLedgerFixture();
    const res = await mutate(f, handleSettings, "/api/v1/settings", "PATCH", {
      instituteName: "X",
      // SAFETY: intentionally wrong shape — the contract requires a string.
      base_updated_at: 12345 as unknown as string,
    }, { key: newKey() });
    expect(res.status).toBe(400);
    const invalidBaseBody = await envelope(res);
    expect(invalidBaseBody.error).toBe("VALIDATION");
    expect(invalidBaseBody.details ?? "").toContain("base_updated_at");
  });
});

describe("RFC-004 K6 — sequence storm (10 concurrent receipts, distinct keys)", () => {
  it("10 unique monotonic numbers, no dupes, no gaps-from-rollback", async () => {
    const f = createLedgerFixture();
    const bodies = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        mutate(f, handleLedger, "/api/v1/ledger/payment", "POST", {
          studentId: f.studentId,
          amount: 1000 * (i + 1),
        }, { key: newKey() }).then((res) => {
          expect(res.status).toBe(200);
          return envelope(res);
        }),
      ),
    );
    const numbers = bodies.map((b) => String((b.data as Record<string, unknown>)?.receiptNo));
    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `RCP-${String(i + 1).padStart(6, "0")}`),
    );
    expect(countRows(f, "ledger_entries")).toBe(10);
    expect(countRows(f, "receipts")).toBe(10);
    const seq = f.db.query("SELECT next_receipt_seq FROM settings WHERE tenant_id = ?", [
      f.tenantId,
    ])[0];
    expect(Number(seq?.next_receipt_seq)).toBe(11);
  });
});

describe("RFC-004 C1 TTL — 24h sweep without a scheduler", () => {
  it("expired rows are lazily deleted on read (miss) and purged opportunistically", async () => {
    const f = createLedgerFixture();
    const handle = asHandle(f);
    const route = "POST /api/v1/ledger/payment";
    // A fresh row survives.
    await storeIdempotentResponse(handle, f.tenantId, route, newKey(), 200, `{"ok":1}`);
    // Two expired rows, planted directly (created 25h ago).
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    for (const k of [newKey(), newKey()]) {
      f.db.raw
        .prepare(
          `INSERT INTO idempotency_keys (tenant_id, route, "key", response_code, response_body, created_at)
           VALUES (?, ?, ?, 200, '{}', ?)`,
        )
        .run(f.tenantId, route, k, old);
    }
    expect(countRows(f, "idempotency_keys")).toBe(3);

    // Lazy delete-on-read: the expired row reads as a MISS and is gone.
    const expiredKey = String(
      f.db.query(
        `SELECT "key" AS k FROM idempotency_keys WHERE tenant_id = ? AND created_at = ? LIMIT 1`,
        [f.tenantId, old],
      )[0]?.k,
    );
    expect(await findStoredIdempotentResponse(handle, f.tenantId, route, expiredKey)).toBeNull();
    expect(countRows(f, "idempotency_keys")).toBe(2);

    // Opportunistic purge removes the other expired row, keeps the fresh one.
    await purgeExpiredIdempotencyKeys(handle, f.tenantId);
    expect(countRows(f, "idempotency_keys")).toBe(1);
  });
});
