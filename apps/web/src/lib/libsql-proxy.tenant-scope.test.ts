// Implements: docs/rfc/rfc-009-010-ratification.md §3A Option 1 (PHASE 4 —
// tenant auto-scope at the proxy boundary) + docs/adr/0007-tenant-autoscope-proxy.md.
//
// Why this file exists: `createLibsqlProxy(client)` used to take no tenant
// and the proxy body contained zero `tenant_id` predicates, so isolation
// rested on ~142 call sites each remembering the filter. This suite pins the
// structural guarantee on a real libSQL file DB (AGENTS.md §7.3 — never mock
// the ledger path; the proxy IS the backstop every call site flows through):
//
//   1. AUTO-SCOPE — a tenant predicate in `where` is injected when absent.
//   2. MISMATCH-THROW — a caller-supplied foreign tenant id throws fail-closed.
//   3. STRICT-THROW — an absent/empty `where` on a tenant table throws.
//   4. ESCAPE HATCH — `allowUnscopedTenantAccess` permits the deliberate probe.
//   5. TX INHERITANCE — `$transaction` carries the bound tenant.
//   6. GLOBALS UNAFFECTED — tables without a `tenant_id` column never scoped.
//   7. CROSS-TENANT INVISIBILITY — tenant B's rows are unreadable/unwritable
//      from tenant A's proxy.
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLibsqlProxy, TenantScopeError } from "./libsql-proxy";

const TENANT_A = "t_scope_A";
const TENANT_B = "t_scope_B";

let dir: string;
let client: Client;

function now(): string {
  return new Date().toISOString();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "buddysaradhi-proxy-scope-"));
  client = createClient({ url: `file:${join(dir, "tenant.db")}` });
  await client.executeMultiple(`
    CREATE TABLE students (
      id            TEXT PRIMARY KEY,
      tenant_id     TEXT NOT NULL,
      first_name    TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );
    CREATE TABLE student_tags (
      student_id TEXT NOT NULL,
      tag_id     TEXT NOT NULL,
      PRIMARY KEY (student_id, tag_id)
    );
    CREATE TABLE admin_users (
      id         TEXT PRIMARY KEY,
      username   TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const t = now();
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["a1", TENANT_A, "Shared", "active", t, t],
  });
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["a2", TENANT_A, "Asha", "active", t, t],
  });
  await client.execute({
    sql: `INSERT INTO students (id, tenant_id, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    args: ["b1", TENANT_B, "Shared", "active", t, t],
  });
  await client.execute({
    sql: `INSERT INTO student_tags (student_id, tag_id) VALUES (?, ?)`,
    args: ["a1", "tag-1"],
  });
  await client.execute({
    sql: `INSERT INTO admin_users (id, username, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    args: ["admin-1", "operator", "hashed", t, t],
  });
});

afterEach(async () => {
  try {
    await Promise.resolve(client.close());
  } catch {
    // Best-effort: libSQL may already be closed.
  }
  // Windows keeps the libSQL handle open for a beat after `close()` — same
  // retry pattern as `libsql-proxy.transactions.test.ts`.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
});

function scopeCodeOf(err: unknown): string {
  if (err instanceof TenantScopeError) return err.code;
  return `NOT_A_TENANT_SCOPE_ERROR: ${err instanceof Error ? err.message : String(err)}`;
}

describe("tenant auto-scope — injection", () => {
  it("findMany without a tenant claim returns only the bound tenant's rows", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const rows = await db.student.findMany({ where: { status: "active" } });
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("findFirst without a tenant claim resolves within the bound tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    // "Shared" exists in BOTH tenants — the injected predicate picks A's.
    const row = await db.student.findFirst({ where: { firstName: "Shared" } });
    expect(row?.id).toBe("a1");
  });

  it("count without a tenant claim counts only the bound tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_B);
    await expect(db.student.count({ where: { status: "active" } })).resolves.toBe(1);
  });

  it("updateMany without a tenant claim touches only the bound tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const res = await db.student.updateMany({
      where: { status: "active" },
      data: { status: "archived" },
    });
    expect(res.count).toBe(2);
    // B's row is verified straight from the driver: asking the A-bound proxy
    // for B's tenant — even with the hatch — must throw (proven below), so
    // the hatch is never a read-around for an explicit foreign claim.
    const rawB = await client.execute({ sql: `SELECT status AS s FROM students WHERE id = 'b1'`, args: [] });
    expect(String(rawB.rows[0]?.s)).toBe("active");
  });

  it("create without a tenant id lands the row in the bound tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const t = now();
    const created = await db.student.create({
      data: { id: "a3", firstName: "NoTenantGiven", createdAt: t, updatedAt: t },
    });
    expect(created.tenantId).toBe(TENANT_A);
    const raw = await client.execute({ sql: `SELECT tenant_id AS c FROM students WHERE id = 'a3'`, args: [] });
    expect(String(raw.rows[0]?.c)).toBe(TENANT_A);
  });

  it("a matching caller-supplied tenant claim passes through unchanged", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const rows = await db.student.findMany({ where: { tenantId: TENANT_A, status: "active" } });
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("tenant auto-scope — mismatch throws fail-closed", () => {
  it("reads naming another tenant throw", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const foreign = { tenantId: TENANT_B };
    await expect(db.student.findMany({ where: foreign })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.findFirst({ where: foreign })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.findUnique({ where: foreign })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.count({ where: foreign })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.student.aggregate({ where: foreign, _count: true }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.student.groupBy({ by: ["status"], where: foreign }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    try {
      await db.student.findMany({ where: foreign });
      expect.unreachable("mismatched tenant read must throw");
    } catch (err) {
      expect(scopeCodeOf(err)).toBe("TENANT_SCOPE_MISMATCH");
    }
  });

  it("writes naming another tenant throw and write nothing", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const t = now();
    await expect(
      db.student.create({ data: { id: "evil", tenantId: TENANT_B, firstName: "Evil", createdAt: t, updatedAt: t } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.student.updateMany({ where: { tenantId: TENANT_B, id: "b1" }, data: { firstName: "Hijacked" } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.student.deleteMany({ where: { tenantId: TENANT_B } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    await expect(
      db.student.upsert({
        where: { tenantId: TENANT_B, id: "b1" },
        create: { id: "b1", tenantId: TENANT_B, firstName: "B", createdAt: t, updatedAt: t },
        update: { firstName: "B2" },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    const check = await client.execute({ sql: `SELECT COUNT(*) AS c FROM students WHERE id = 'evil'`, args: [] });
    expect(Number(check.rows[0]?.c)).toBe(0);
  });

  it("an update payload that would move a row across tenants throws", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    await expect(
      db.student.update({ where: { tenantId: TENANT_A, id: "a1" }, data: { tenantId: TENANT_B } }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    try {
      await db.student.update({ where: { tenantId: TENANT_A, id: "a1" }, data: { tenantId: TENANT_B } });
      expect.unreachable("cross-tenant move must throw");
    } catch (err) {
      expect(scopeCodeOf(err)).toBe("TENANT_SCOPE_MISMATCH");
    }
    // An equal-tenant claim in the update payload is harmless and allowed
    // (the attendance upsert spells it that way).
    await expect(
      db.student.update({ where: { tenantId: TENANT_A, id: "a1" }, data: { tenantId: TENANT_A, firstName: "Asha" } }),
    ).resolves.toBeDefined();
  });

  it("snake_case tenant claims are honoured the same as camelCase", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    await expect(db.student.findMany({ where: { tenant_id: TENANT_B } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    const rows = await db.student.findMany({ where: { tenant_id: TENANT_A, status: "active" } });
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });
});

describe("tenant auto-scope — strict on empty where", () => {
  it("absent/empty predicates on a tenant table throw instead of scanning every tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    await expect(db.student.findMany()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.findMany({})).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.findMany({ where: {} })).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.findFirst()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.count()).rejects.toBeInstanceOf(TenantScopeError);
    await expect(db.student.deleteMany()).rejects.toBeInstanceOf(TenantScopeError);
    try {
      await db.student.findMany({ where: {} });
      expect.unreachable("unscoped full-table read must throw");
    } catch (err) {
      expect(scopeCodeOf(err)).toBe("TENANT_SCOPE_UNSCOPED");
    }
  });
});

describe("tenant auto-scope — escape hatch", () => {
  it("the hatch permits the deliberate cross-tenant existence probe", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    // The ensureBatch shape: look up a row by id alone, across tenants.
    const foreign = await db.student.findFirst({
      where: { id: "b1" },
      allowUnscopedTenantAccess: true,
    });
    expect(foreign?.id).toBe("b1");
    const all = await db.student.findMany({ allowUnscopedTenantAccess: true });
    expect(all.map((r) => r.id).sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("the hatch does not override an explicit conflicting tenant claim", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    await expect(
      db.student.findMany({ where: { tenantId: TENANT_B }, allowUnscopedTenantAccess: true }),
    ).rejects.toBeInstanceOf(TenantScopeError);
  });
});

describe("tenant auto-scope — transactions inherit the tenant", () => {
  it("a cross-tenant create inside the transaction throws and rolls everything back", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const t = now();
    await expect(
      db.$transaction(async (tx) => {
        await tx.student.create({
          data: { id: "tx-ghost", tenantId: TENANT_A, firstName: "Ghost", createdAt: t, updatedAt: t },
        });
        await tx.student.create({
          data: { id: "tx-evil", tenantId: TENANT_B, firstName: "Evil", createdAt: t, updatedAt: t },
        });
      }),
    ).rejects.toBeInstanceOf(TenantScopeError);
    const check = await client.execute({
      sql: `SELECT COUNT(*) AS c FROM students WHERE id IN ('tx-ghost', 'tx-evil')`,
      args: [],
    });
    expect(Number(check.rows[0]?.c)).toBe(0);
  });

  it("reads and tenant-less creates inside the transaction are scoped to the bound tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const t = now();
    const seen = await db.$transaction(async (tx) => {
      await tx.student.create({
        data: { id: "tx-a", firstName: "TxA", createdAt: t, updatedAt: t },
      });
      return tx.student.findMany({ where: { status: "active" } });
    });
    // a1, a2 (seeded) + tx-a (created without a tenant claim, auto-scoped).
    expect(seen.map((r) => r.id).sort()).toEqual(["a1", "a2", "tx-a"]);
    const raw = await client.execute({ sql: `SELECT tenant_id AS c FROM students WHERE id = 'tx-a'`, args: [] });
    expect(String(raw.rows[0]?.c)).toBe(TENANT_A);
  });
});

describe("tenant auto-scope — global tables unaffected", () => {
  it("the join table works with no tenant predicate and no hatch", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const rows = await db.studentTag.findMany({ where: { studentId: "a1" } });
    expect(rows).toHaveLength(1);
    const deleted = await db.studentTag.deleteMany({ where: { studentId: "a1" } });
    expect(deleted.count).toBe(1);
  });

  it("operator and bookkeeping tables read without a tenant", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    const admin = await db.adminUser.findFirst({ where: { username: "operator" } });
    expect(admin?.id).toBe("admin-1");
    const admins = await db.adminUser.findMany({});
    expect(admins).toHaveLength(1);
  });

  it("a tenant claim on a global table throws instead of emitting bad SQL", async () => {
    const db = createLibsqlProxy(client, TENANT_A);
    await expect(db.studentTag.findMany({ where: { tenantId: TENANT_A } })).rejects.toBeInstanceOf(
      TenantScopeError,
    );
    try {
      await db.studentTag.findMany({ where: { tenantId: TENANT_A } });
      expect.unreachable("tenant predicate on a global table must throw");
    } catch (err) {
      expect(scopeCodeOf(err)).toBe("TENANT_SCOPE_ON_GLOBAL");
    }
  });
});

describe("tenant auto-scope — cross-tenant invisibility", () => {
  it("tenant B's rows are unreadable and unwritable from tenant A's proxy", async () => {
    const dbA = createLibsqlProxy(client, TENANT_A);
    // Scoped lookup for a foreign id: predicate ANDs to nothing.
    await expect(dbA.student.findFirst({ where: { tenantId: TENANT_A, id: "b1" } })).resolves.toBeNull();
    // Writes against the foreign row report zero rows, never an error that
    // leaks existence — and the row is unchanged.
    const updated = await dbA.student.updateMany({
      where: { tenantId: TENANT_A, id: "b1" },
      data: { firstName: "Hijacked" },
    });
    expect(updated.count).toBe(0);
    const deleted = await dbA.student.deleteMany({ where: { tenantId: TENANT_A, id: "b1" } });
    expect(deleted.count).toBe(0);
    const raw = await client.execute({ sql: `SELECT first_name AS n FROM students WHERE id = 'b1'`, args: [] });
    expect(String(raw.rows[0]?.n)).toBe("Shared");
  });
});

describe("tenant auto-scope — legacy unbound proxies", () => {
  it("the single-arg form keeps legacy passthrough (tests + un-migrated paths)", async () => {
    const db = createLibsqlProxy(client);
    const all = await db.student.findMany({});
    expect(all.map((r) => r.id).sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("binding to an empty tenant id throws instead of scoping to nothing", () => {
    expect(() => createLibsqlProxy(client, "")).toThrow(TenantScopeError);
  });
});
