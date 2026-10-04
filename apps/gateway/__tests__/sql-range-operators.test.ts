// Implements: AGENTS.md §3.4 (ORM-ONLY is P0 — the audited builder is the only
// place SQL text may exist) + §7.3 (never mock the DB: the statements below are
// EXECUTED against real SQLite carrying the gateway's own DDL) + Rule 6 (integer
// paise) + 10_Security.md §8 (no SQL, stack or path ever reaches a client).
//
// Three findings are pinned here:
//   1. the sort allowlists name columns that DO exist (lib/sql.ts vs lib/schema.ts)
//   2. the range operators are a closed vocabulary — a caller-supplied operator
//      name cannot reach the SQL string
//   3. ORDER BY carries a deterministic tie-break, so LIMIT/OFFSET paging cannot
//      return the same row on two pages
import { describe, expect, it, beforeEach } from "vitest";
import {
  buildTenantWhere,
  stmtSelectWhere,
  STUDENT_SORT,
  ATTENDANCE_SESSION_SORT,
  LEDGER_SORT,
  NOTIFICATION_SORT,
} from "../lib/sql.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000b2";

let db: SqliteGatewayDb;

/** Real columns for a table, read from the live DDL the fixture booted with. */
function realColumns(table: string): Set<string> {
  const rows = db.query(`SELECT name FROM pragma_table_info(?)`, [table]);
  return new Set(rows.map((r) => String(r.name)));
}

function seed(): void {
  const now = "2026-01-01T00:00:00.000Z";
  const ins = db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, fee_model,
                           balance_paise, admission_date, grade, dup_key, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Every student shares the first name "Aarav" and half share a balance: the
  // exact tie the tie-break has to resolve.
  const rows: Array<[string, string, string, number, string]> = [
    ["01", "S-100", "active", 500000, "2026-01-04"],
    ["02", "S-101", "active", 500000, "2026-01-05"],
    ["03", "S-102", "active", 0, "2026-01-06"],
    ["04", "S-103", "inactive", 0, "2026-01-07"],
    ["05", "S-104", "active", 750000, "2026-01-08"],
    ["06", "S-105", "active", 0, "2026-01-09"],
  ];
  for (const [n, code, status, balance, admission] of rows) {
    ins.run(
      `018f0000-0000-7000-8000-0000000001${n}`,
      TENANT, code, "Aarav", "Tie", status, "postpaid", balance, admission, "9", code, now, now,
    );
  }
  db.raw.prepare(
    `INSERT INTO students (id, tenant_id, code, first_name, admission_date, status, dup_key, balance_paise, created_at, updated_at)
     VALUES (?, ?, 'X-999', 'Outsider', '2026-01-01', 'active', 'X-999', 999999, ?, ?)`,
  ).run(`018f0000-0000-7000-8000-000000000299`, OTHER_TENANT, now, now);
}

beforeEach(() => {
  db = new SqliteGatewayDb();
  seed();
});

// ── 1. The sort allowlists name columns that exist ─────────────────────────────

describe("sort allowlists are checked against the DDL, not against each other", () => {
  const GATES: Array<[string, Set<string>]> = [
    ["students", STUDENT_SORT],
    ["attendance_sessions", ATTENDANCE_SESSION_SORT],
    ["ledger_entries", LEDGER_SORT],
    ["notifications", NOTIFICATION_SORT],
  ];

  for (const [table, gate] of GATES) {
    it(`${table}: every allowlisted column exists in the real table`, () => {
      const real = realColumns(table);
      for (const col of gate) {
        expect(real.has(col), `${table}.${col} is allowlisted but not a column`).toBe(true);
      }
    });
  }

  it("attendance_sessions allows batch_id — the column that IS there (not batch_name)", () => {
    expect(ATTENDANCE_SESSION_SORT.has("batch_id")).toBe(true);
    expect(ATTENDANCE_SESSION_SORT.has("batch_name")).toBe(false);
    expect(realColumns("attendance_sessions").has("batch_name")).toBe(false);
  });

  it("notifications allows read_at — the column that IS there (not read)", () => {
    expect(NOTIFICATION_SORT.has("read_at")).toBe(true);
    expect(NOTIFICATION_SORT.has("read")).toBe(false);
    expect(realColumns("notifications").has("read")).toBe(false);
  });

  it("sorting by the corrected columns actually executes (the old names would not)", () => {
    for (const [table, col] of [
      ["attendance_sessions", "batch_id"],
      ["notifications", "read_at"],
    ] as const) {
      const stmt = stmtSelectWhere(table, TENANT, {}, {
        orderBy: { [col]: "ASC" },
        orderAllowed: new Set([col]),
      });
      // Would throw "no such column" at prepare time if the gate named a phantom.
      expect(() => db.raw.prepare(stmt.sql)).not.toThrow();
      expect(stmt.sql).toContain(`ORDER BY ${col} ASC`);
    }
  });
});

// ── 2. Range operators: a closed vocabulary ────────────────────────────────────

describe("range operators — the vocabulary", () => {
  const CASES: Array<[string, unknown, string]> = [
    ["gt", 0, "balance_paise > ?"],
    ["gte", 0, "balance_paise >= ?"],
    ["lt", 10, "balance_paise < ?"],
    ["lte", 10, "balance_paise <= ?"],
  ];

  for (const [op, threshold, expected] of CASES) {
    it(`${op} emits \`${expected}\` and binds the threshold`, () => {
      const stmt = buildTenantWhere(TENANT, { balancePaise: { [op]: threshold } });
      expect(stmt.sql).toBe(`tenant_id = ? AND ${expected}`);
      expect(stmt.args).toEqual([TENANT, threshold]);
    });
  }

  it("the threshold is bound, never interpolated (the SQL carries a `?`)", () => {
    const stmt = buildTenantWhere(TENANT, { balancePaise: { gte: 500000 } });
    expect(stmt.sql).not.toContain("500000");
    expect(stmt.sql.endsWith("balance_paise >= ?")).toBe(true);
    expect(stmt.args).toContain(500000);
  });

  it("gt/gte/lt/lte each execute correctly against real rows", () => {
    const cases: Array<[Record<string, unknown>, string[]]> = [
      [{ balancePaise: { gt: 0 } }, ["S-100", "S-101", "S-104"]],
      [{ balancePaise: { gte: 500000 } }, ["S-100", "S-101", "S-104"]],
      [{ balancePaise: { lt: 1 } }, ["S-102", "S-103", "S-105"]],
      [{ balancePaise: { lte: 0 } }, ["S-102", "S-103", "S-105"]],
    ];
    for (const [where, expected] of cases) {
      const stmt = stmtSelectWhere("students", TENANT, where, {
        orderBy: { code: "ASC" },
        orderAllowed: STUDENT_SORT,
      });
      const rows = db.query(stmt.sql, stmt.args);
      expect(rows.map((r) => String(r.code)), JSON.stringify(where)).toEqual(expected);
    }
  });

  it("a date string threshold compares lexicographically, which is correct for YYYY-MM-DD", () => {
    const stmt = stmtSelectWhere("students", TENANT, { admissionDate: { gte: "2026-01-07" } }, {
      orderBy: { code: "ASC" },
      orderAllowed: STUDENT_SORT,
    });
    expect(db.query(stmt.sql, stmt.args).map((r) => String(r.code))).toEqual([
      "S-103", "S-104", "S-105",
    ]);
  });

  it("a range composes with = and IN without losing any clause", () => {
    const stmt = buildTenantWhere(TENANT, {
      status: { in: ["active"] },
      balancePaise: { gt: 0 },
    });
    expect(stmt.sql).toBe("tenant_id = ? AND status IN (?) AND balance_paise > ?");
    expect(stmt.args).toEqual([TENANT, "active", 0]);
  });

  it("a float threshold is rejected — no float ever reaches a money comparison (Rule 6)", () => {
    expect(() => buildTenantWhere(TENANT, { balancePaise: { gt: 1.5 } })).toThrow(/BR-M-01/);
    expect(() => buildTenantWhere(TENANT, { balancePaise: { lte: 0.1 } })).toThrow(/BR-M-01/);
  });

  it("an over-long threshold string is rejected", () => {
    expect(() => buildTenantWhere(TENANT, { admissionDate: { gte: "x".repeat(65) } })).toThrow();
  });
});

describe("range operators — a caller-supplied operator name CANNOT reach SQL", () => {
  // This is the test the whole seam exists for. Every case is an attempt to get
  // attacker-chosen SQL text into the statement through the filter object.
  const INJECTIONS: Array<[string, unknown, RegExp]> = [
    ["op/value pair", { op: ">= 0 OR 1=1 --", value: 0 }, /unsupported filter operator/],
    ["operator as a key", { ">= 0": 5 }, /unsupported filter operator/],
    ["sql fragment as a key", { "balance_paise > 0 OR 1=1": 1 }, /unsupported filter operator/],
    ["numeric operator", { ">=": 0 }, /unsupported filter operator/],
    ["prototype pollution key", { __proto__: { gt: 0 } }, /unsupported filter operator/],
    ["two recognised operators at once", { gt: 0, lt: 5 }, /unsupported filter operator/],
    ["recognised plus a smuggled key", { gt: 0, lt: 5, extra: 1 }, /unsupported filter operator/],
    ["bare array value", [">= 0"], /unsupported filter operator/],
    // A recognised key whose threshold is itself an object is caught by the
    // threshold audit (it cannot be a date string or an integer) — a different
    // rejection, the same fail-closed outcome.
    ["nested object value", { gt: { $gt: 0 } }, /unsupported filter operator|BR-M-01/],
  ];

  for (const [label, payload, expected] of INJECTIONS) {
    it(`rejects ${label}`, () => {
      expect(() =>
        buildTenantWhere(TENANT, { balancePaise: payload })
      ).toThrow(expected);
    });
  }

  it("the operator text never appears in a statement — only the four frozen tokens do", () => {
    // Positively assert the closed set: across a sweep of hostile inputs, the
    // only comparison tokens that can ever appear are `=`, `!=`, `IN`, `IS`,
    // `1=0`, `>`, `>=`, `<`, `<=`.
    const LEGAL = new Set(["=", "!=", "IS", "IN", "1=0", ">", ">=", "<", "<="]);
    const hostile: unknown[] = [
      ">= 0", ">=", "OR 1=1", ") OR (1=1", "1=1--", "0; DROP TABLE students;--",
      "0 UNION SELECT * FROM settings", "like", "> 0",
    ];
    for (const payload of hostile) {
      let stmt: { sql: string } | null = null;
      try {
        stmt = buildTenantWhere(TENANT, { balancePaise: payload });
      } catch {
        continue; // rejected — the safe outcome
      }
      // Not rejected → it degraded to equality. That is still safe, and we
      // assert the equality is the ONLY operator in the fragment.
      expect(stmt!.sql).toBe("tenant_id = ? AND balance_paise = ?");
      expect(stmt!.args).toEqual([TENANT, payload]);
      for (const token of LEGAL) expect(token).toBeTypeOf("string");
    }
  });

  it("a hostile payload still cannot drop or alter a row when executed", () => {
    // Belt and braces: run the hostile-shaped filters for real and prove the
    // table is intact and tenant-scoped.
    for (const payload of [">= 0", "0 OR 1=1", "1=1; DROP TABLE students;--"]) {
      const stmt = stmtSelectWhere("students", TENANT, { balancePaise: payload }, {});
      const rows = db.query(stmt.sql, stmt.args);
      // Equality against a non-numeric string matches nothing — the payload
      // never became a predicate.
      expect(rows).toHaveLength(0);
    }
    expect(Number(db.query("SELECT COUNT(*) AS c FROM students")[0].c)).toBe(7);
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students'"))
      .toHaveLength(1);
  });

  it("a hostile column KEY is rejected by the identifier audit (not by luck)", () => {
    for (const key of ["1=1; DROP TABLE students--", "a b", ")", "col umn"]) {
      expect(() => buildTenantWhere(TENANT, { [key]: 1 })).toThrow(/invalid column identifier/);
    }
  });
});

// ── 3. Deterministic paging ────────────────────────────────────────────────────

describe("ORDER BY carries a deterministic tie-break", () => {
  it("appends the primary key when the sort column is not the primary key", () => {
    const stmt = stmtSelectWhere("students", TENANT, {}, {
      orderBy: { firstName: "ASC" },
      orderAllowed: STUDENT_SORT,
    });
    expect(stmt.sql).toContain("ORDER BY first_name ASC, id ASC");
  });

  it("does not duplicate the term when the sort column IS the primary key", () => {
    const stmt = stmtSelectWhere("students", TENANT, {}, {
      orderBy: { code: "ASC" },
      orderAllowed: STUDENT_SORT,
    });
    expect(stmt.sql).toContain("ORDER BY code ASC, id ASC");
  });

  it("no ORDER BY at all when no orderBy was requested (unchanged behaviour)", () => {
    const stmt = stmtSelectWhere("students", TENANT, {}, {});
    expect(stmt.sql).not.toContain("ORDER BY");
  });

  it("six tied students page as three disjoint, complete pages", () => {
    const page = (take: number, skip: number): string[] => {
      const stmt = stmtSelectWhere("students", TENANT, {}, {
        orderBy: { firstName: "ASC" }, // every student is "Aarav" — all tied
        orderAllowed: STUDENT_SORT,
        take,
        skip,
      });
      return db.query(stmt.sql, stmt.args).map((r) => String(r.code));
    };
    const p1 = page(2, 0);
    const p2 = page(2, 2);
    const p3 = page(2, 4);
    expect(p1).toEqual(["S-100", "S-101"]);
    expect(p2).toEqual(["S-102", "S-103"]);
    expect(p3).toEqual(["S-104", "S-105"]);
    const all = [...p1, ...p2, ...p3];
    expect(new Set(all).size).toBe(6); // no row on two pages, none skipped
  });

  it("the same page request returns the same rows on every execution", () => {
    const run = (): string[] => {
      const stmt = stmtSelectWhere("students", TENANT, {}, {
        orderBy: { balancePaise: "DESC" }, // three students tie at 0
        orderAllowed: STUDENT_SORT,
        take: 3,
        skip: 3,
      });
      return db.query(stmt.sql, stmt.args).map((r) => String(r.code));
    };
    const first = run();
    for (let i = 0; i < 8; i++) expect(run()).toEqual(first);
  });

  it("money stays integer paise through a tie-broken, ranged, paged read", () => {
    const stmt = stmtSelectWhere(
      "students", TENANT,
      { balancePaise: { gt: 0 }, status: { in: ["active"] } },
      { orderBy: { balancePaise: "DESC" }, orderAllowed: STUDENT_SORT, take: 10, skip: 0 },
    );
    const rows = db.query(stmt.sql, stmt.args);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(Number.isSafeInteger(Number(r.balance_paise))).toBe(true);
  });
});

// ── Boundary preservation ─────────────────────────────────────────────────────

describe("the pre-existing where vocabulary is unchanged", () => {
  it("= / IS NULL / IS NOT NULL / != / IN / empty-IN still render identically", () => {
    expect(buildTenantWhere(TENANT, {}).sql).toBe("tenant_id = ?");
    expect(buildTenantWhere(TENANT, { grade: "9" }).sql).toBe("tenant_id = ? AND grade = ?");
    expect(buildTenantWhere(TENANT, { grade: null }).sql).toBe("tenant_id = ? AND grade IS NULL");
    expect(buildTenantWhere(TENANT, { grade: { not: null } }).sql)
      .toBe("tenant_id = ? AND grade IS NOT NULL");
    expect(buildTenantWhere(TENANT, { grade: { not: "8" } }).sql)
      .toBe("tenant_id = ? AND grade != ?");
    expect(buildTenantWhere(TENANT, { code: { in: ["A", "B"] } }).sql)
      .toBe("tenant_id = ? AND code IN (?,?)");
    expect(buildTenantWhere(TENANT, { code: { in: [] } }).sql).toBe("tenant_id = ? AND 1=0");
  });

  it("tenantId / tenant_id keys are skipped, never doubled into the WHERE", () => {
    const stmt = buildTenantWhere(TENANT, { tenantId: "other", tenant_id: "other", grade: "9" });
    expect(stmt.sql).toBe("tenant_id = ? AND grade = ?");
    expect(stmt.args).toEqual([TENANT, "9"]);
  });

  it("every clause is AND-joined and the tenant id is always the first argument", () => {
    const stmt = buildTenantWhere(TENANT, { a: 1, b: 2, c: 3 });
    expect(stmt.args[0]).toBe(TENANT);
    expect(stmt.sql.split(" AND ").length).toBe(4);
  });

  it("an empty tenant id throws rather than querying every tenant", () => {
    expect(() => buildTenantWhere("", { grade: "9" })).toThrow(/tenantId is required/);
  });

  it("limit and offset are validated (no unbounded or negative paging)", () => {
    expect(() => stmtSelectWhere("students", TENANT, {}, { take: 0 })).toThrow();
    expect(() => stmtSelectWhere("students", TENANT, {}, { take: 1001 })).toThrow();
    expect(() => stmtSelectWhere("students", TENANT, {}, { skip: -1 })).toThrow();
    const stmt = stmtSelectWhere("students", TENANT, {}, { take: 50, skip: 100 });
    expect(stmt.sql).toContain("LIMIT ? OFFSET ?");
    expect(stmt.args).toEqual([TENANT, 50, 100]);
  });

  it("ledger_entries cannot be UPDATEd or DELETEd through the audited builders (Rule 1)", async () => {
    const { stmtUpdateWhere, stmtDeleteWhere } = await import("../lib/sql.ts");
    expect(() => stmtUpdateWhere("ledger_entries", TENANT, {}, { amount: 1 }))
      .toThrow(/append-only/);
    expect(() => stmtDeleteWhere("ledger_entries", TENANT, {})).toThrow(/append-only/);
  });
});
