// Implements: 10_Security.md §7 (a tenant-scoped read endpoint that cannot be
// made to stop is not scoped) + 17_API_Gateway_System.md §4 (GraphQL is
// rate-limited per REQUEST, so the cost of one request must itself be bounded) +
// AGENTS.md §2 Rule 9 (a refused query names its limit; it is never silently
// truncated).
//
// WHAT EACH TEST HERE FAILS AGAINST (F-17). The pre-fix `execLocal` was:
//
//   const top = tokenizeSelection(queryBody(query));           // no limits
//   for (const f of top) {                                     // sequential
//     const value = await resolver({ ...f.args, ...variables }, ctx);
//     data[f.name] = project(f, value);
//   }
//
// which is ~30 000 repeated `students` fields → ~60 000 serialised SQLite round
// trips in one request, behind a rate limiter consulted once before any of it
// began, with `tokenizeSelection` recursing on `{` with no ceiling.
//
// ── A PRE-EXISTING PARSER DEFECT THESE TESTS DELIBERATELY WORK AROUND ─────────
//
// `tokenizeSelection` checks `s[i] === "{"` immediately after parsing a name or
// an argument list, WITHOUT skipping the whitespace a real client writes:
//
//   students(tenantId: "t") { items { id } }
//                    ↑ after the arg list, s[i] is a SPACE, not "{"
//
// So a field with arguments never has its selection set attached: the `{…}` block
// is parsed as SIBLING fields with an empty name, and `project` is handed an
// empty selection and therefore returns the whole raw object. That is a
// pre-existing over-fetch (the response carries every column, not the requested
// ones) and it is NOT this file's defect to fix — it changes the response shape
// every client sees. It is reported, not patched.
//
// The tests below are written so they hold under EITHER behaviour: every query
// used for the cap/dedup/concurrency assertions is FLAT (no sub-selection), so
// the empty-name sibling is the only artefact and it costs no resolver call. The
// depth assertions are built both with and without spaces after the field name,
// so the ceiling is exercised through the intended path and the accidental one.
import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/db.ts", () => ({
  oneRow: async (db: never, sql: string, args: unknown[] = []) => {
    const res = await (db as unknown as { execute: (s: unknown) => Promise<{ rows: unknown[] }> })
      .execute({ sql, args });
    return res.rows[0] ?? null;
  },
  allRows: async (db: never, sql: string, args: unknown[] = []) => {
    const res = await (db as unknown as { execute: (s: unknown) => Promise<{ rows: unknown[] }> })
      .execute({ sql, args });
    return res.rows ?? [];
  },
}));

import {
  execLocal,
  MAX_SELECTION_DEPTH,
  MAX_TOP_LEVEL_FIELDS,
  GraphQLLimitError,
} from "../graphql/executor.ts";

const TENANT = "tenant-1";

interface CountedDb {
  execute: (stmt: { sql: string; args?: unknown[] }) => Promise<{ rows: unknown[] }>;
  /** Every SQL string this request actually sent. */
  statements: string[];
  /** High-water mark of concurrent in-flight statements. 1 == fully serialised. */
  maxInFlight: () => number;
}

/**
 * A DB that COUNTS rather than answers. `students` issues two statements per
 * call (`resolvers.ts:71-74` — the page and the count), so `statements.length`
 * is the honest measure of how many round trips a query cost.
 *
 * `maxInFlight` is a concurrency probe, not a timing measurement: it records how
 * many `execute` calls were open at the same moment. Sequential execution pins it
 * at 1; concurrent execution pushes it above 1. That makes the concurrency test
 * deterministic rather than flaky.
 */
function countedDb(): CountedDb {
  let inFlight = 0;
  let peak = 0;
  const statements: string[] = [];
  return {
    statements,
    maxInFlight: () => peak,
    execute: (stmt) => {
      statements.push(stmt.sql);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      // Yield to the microtask queue so a sibling `execute` can start before
      // this one finishes — that is what makes "concurrent" observable.
      return Promise.resolve().then(() => {
        inFlight -= 1;
        return { rows: [] };
      });
    },
  };
}

// SAFETY: the executor's `ctx.db` is the `DB` marker type from lib/db.ts; the
// helpers below satisfy it structurally (they implement `execute`), exactly as
// the pre-existing `graphql.test.ts` mock does.
type ExecCtx = Parameters<typeof execLocal>[2];
const ctx = (db: unknown): ExecCtx => ({ db, tenantId: TENANT } as unknown as ExecCtx);

/** A top-level field with arguments and NO sub-selection — flat, so the
 *  pre-existing parser defect above cannot add an empty-name sibling. */
const STUDENTS = `students(tenantId: "${TENANT}")`;
const LEDGER = `ledgerEntries(tenantId: "${TENANT}")`;

/** Repeat one flat field N times, the exact shape of the amplification attack. */
function repeated(field: string, times: number): string {
  return `{ ${Array.from({ length: times }, () => field).join(" ")} }`;
}

describe("F-17 / the limits are declared, not implicit", () => {
  it("caps top-level fields and selection depth", () => {
    // Quoted rather than assumed: if either number moves without the reasoning
    // being revisited, this goes red rather than the cap silently shifting
    // under a shipped client.
    expect(MAX_TOP_LEVEL_FIELDS).toBe(16);
    expect(MAX_SELECTION_DEPTH).toBe(8);
    // `graphql/schema.ts` declares 4 root fields and is 3 deep from `Query`.
    // Both caps must leave headroom, or the executor refuses its own schema.
    expect(MAX_TOP_LEVEL_FIELDS).toBeGreaterThanOrEqual(4);
    expect(MAX_SELECTION_DEPTH).toBeGreaterThanOrEqual(3);
  });

  it("the refusal is a typed error carrying a stable leading code", () => {
    const err = new GraphQLLimitError("QUERY_TOO_COMPLEX: x");
    // `lib/errors.ts` `sanitizeError` and the web's `extractServerCode` both key
    // off a leading `CODE: ` — so the code must come first, every time.
    expect(err.name).toBe("GraphQLLimitError");
    expect(err.message).toMatch(/^[A-Z][A-Z0-9_]{2,}: /);
  });
});

describe("F-17 / an excessive top-level-field count is REFUSED", () => {
  it("rejects 200 repeated fields — the amplification attack, sampled", async () => {
    const db = countedDb();
    const res = await execLocal(repeated(STUDENTS, 200), {}, ctx(db));

    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.message).toMatch(/^QUERY_TOO_COMPLEX: /);
    expect(res.errors?.[0]?.message).toContain(String(MAX_TOP_LEVEL_FIELDS));
    // No `data` key at all: a refusal must never be readable as a partial
    // success with fields missing.
    expect(res.data).toBeUndefined();
    // And it cost nothing — the refusal happens inside the tokenizer, before a
    // statement is built. Pre-fix this was 200 fields × 2 statements = 400
    // serialised round trips.
    expect(db.statements).toHaveLength(0);
  });

  it("accepts exactly the cap and refuses one more", async () => {
    const atCap = await execLocal(repeated("health", MAX_TOP_LEVEL_FIELDS), {}, ctx(countedDb()));
    expect(atCap.errors).toBeUndefined();

    const overCap = await execLocal(repeated("health", MAX_TOP_LEVEL_FIELDS + 1), {}, ctx(countedDb()));
    expect(overCap.errors).toBeDefined();
    expect(overCap.data).toBeUndefined();
  });
});

describe("F-17 / an excessive selection depth is REFUSED", () => {
  it("rejects 40 levels of nesting, written the way a client writes it", async () => {
    // A FIXED literal depth rather than one derived from the exported constant,
    // so lowering the constant cannot make this test agree with a weakened
    // check. The constant has its own test above.
    let nested = "id";
    for (let i = 0; i < 40; i += 1) nested = `students { ${nested} }`;
    const db = countedDb();
    const res = await execLocal(`{ ${nested} }`, {}, ctx(db));

    expect(res.errors).toBeDefined();
    expect(res.errors?.[0]?.message).toMatch(/^QUERY_TOO_DEEP: /);
    expect(res.errors?.[0]?.message).toContain(String(MAX_SELECTION_DEPTH));
    expect(res.data).toBeUndefined();
    expect(db.statements).toHaveLength(0);
  });

  it("rejects the same nesting written without a space, i.e. the intended path", async () => {
    // `students{…}` puts `{` immediately after the name, which is the path the
    // tokenizer was written for. Asserted separately so the ceiling is proven
    // through both routes the parser can take.
    let nested = "id";
    for (let i = 0; i < 40; i += 1) nested = `students{${nested}}`;
    const res = await execLocal(`{${nested}}`, {}, ctx(countedDb()));
    expect(res.errors?.[0]?.message).toMatch(/^QUERY_TOO_DEEP: /);
  });

  it("accepts the declared schema's own depth", async () => {
    // Query.students → StudentPage.items → Student.name is depth 3, the
    // deepest path `graphql/schema.ts` can express. It must never be refused.
    const res = await execLocal(
      `{ students(tenantId: "${TENANT}") { items { id name } total page pageSize } }`,
      {},
      ctx(countedDb()),
    );
    expect(res.errors).toBeUndefined();
    expect(res.data).toHaveProperty("students");
  });
});

describe("F-17 / repeated identical top-level fields run the resolver ONCE", () => {
  it("10 identical `students` fields cost 2 statements, not 20", async () => {
    const db = countedDb();
    const res = await execLocal(repeated(STUDENTS, 10), {}, ctx(db));

    expect(res.errors).toBeUndefined();
    // Asserted by COUNTING, not assumed: `students` issues the page statement
    // and the count statement (`resolvers.ts:71-74`), so one execution is 2
    // statements and 10 executions would be 20.
    expect(db.statements.length).toBe(2);
  });

  it("returns the key once for the repeated field", async () => {
    const res = await execLocal(repeated(STUDENTS, 4), {}, ctx(countedDb()));
    expect(res.errors).toBeUndefined();
    expect(res.data).toHaveProperty("students");
    expect(Object.keys(res.data ?? {}).filter((k) => k !== "")).toEqual(["students"]);
  });

  it("does NOT de-duplicate fields whose arguments differ", async () => {
    const db = countedDb();
    await execLocal(
      `{ students(tenantId: "${TENANT}", page: 1) students(tenantId: "${TENANT}", page: 2) }`,
      {},
      ctx(db),
    );
    // Two different pages are two different reads — and the SQL TEXT is
    // identical for both, so this only passes if the resolver genuinely ran
    // twice. Collapsing them would serve page 1's rows for page 2: a wrong
    // answer, not a fast one.
    expect(db.statements.length).toBe(4);
  });

  it("de-duplicates `health`, which costs no statement", async () => {
    const db = countedDb();
    const res = await execLocal(repeated("health", 5), {}, ctx(db));
    expect(res.errors).toBeUndefined();
    expect(res.data?.health).toBe("ok");
    expect(db.statements).toHaveLength(0);
  });

  it("de-duplicates fields that agree once `$var` is resolved", async () => {
    const db = countedDb();
    const query = `{ students(tenantId: $who) students(tenantId: $who) }`;
    const res = await execLocal(query, { who: TENANT }, ctx(db));
    expect(res.errors).toBeUndefined();
    // The key is built from the EFFECTIVE arguments, so two occurrences naming
    // the same variable share one call.
    expect(db.statements.length).toBe(2);
  });
});

describe("F-17 / independent resolvers run CONCURRENTLY", () => {
  it("two different fields are in flight at the same time", async () => {
    const db = countedDb();
    await execLocal(`{ ${STUDENTS} ${LEDGER} }`, {}, ctx(db));

    // Four statements total — two per resolver. Serialised, the high-water mark
    // is exactly 1; concurrent, it reaches 2.
    expect(db.statements.length).toBe(4);
    expect(db.maxInFlight()).toBeGreaterThan(1);
  });

  it("a single field is still one resolver, and its own two statements stay ordered", async () => {
    const db = countedDb();
    await execLocal(`{ ${STUDENTS} }`, {}, ctx(db));
    expect(db.statements.length).toBe(2);
    // `resolvers.students` awaits the page before issuing the count
    // (`resolvers.ts:71-74`), so a SINGLE field's two statements are sequential.
    // Concurrency was added BETWEEN resolvers, not inside one — this asserts
    // that boundary rather than leaving it accidental.
    expect(db.maxInFlight()).toBe(1);
  });
});

describe("F-17 / a resolver failure still THROWS, in field order", () => {
  it("a tenant mismatch rejects rather than returning a 200-shaped refusal", async () => {
    // Unchanged contract: `graphql.test.ts` asserts this shape, and Rule 9
    // forbids converting a real failure into a quiet envelope.
    await expect(
      execLocal(`{ settings(tenantId: "other-tenant") }`, {}, ctx(countedDb())),
    ).rejects.toThrow("forbidden: tenant mismatch");
  });

  it("rethrows the FIRST field's failure in field order, not the fastest one", async () => {
    // Field 1 rejects slowly, field 2 rejects immediately. Sequential execution
    // always reported field 1; concurrency must not change which error a query
    // surfaces. The two messages are distinct precisely so this can be told
    // apart from "whoever rejected first".
    let firstCall = true;
    const db = {
      execute: (stmt: { sql: string }) => {
        if (stmt.sql.includes("ledger_entries")) {
          return Promise.reject(new Error("boom-ledger"));
        }
        if (firstCall) {
          firstCall = false;
          return new Promise<{ rows: unknown[] }>((_resolve, reject) => {
            setTimeout(() => reject(new Error("boom-settings")), 15);
          });
        }
        return Promise.reject(new Error("boom-ledger"));
      },
    };
    await expect(
      execLocal(`{ settings(tenantId: "${TENANT}") ${LEDGER} }`, {}, ctx(db)),
    ).rejects.toThrow("boom-settings");
  });

  it("one failing field does not become an unhandled rejection", async () => {
    // The settle step wraps each resolver individually; without it, a sibling
    // still in flight when the first one rejects would surface as a process-level
    // unhandledRejection in the edge isolate.
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(
        execLocal(
          `{ settings(tenantId: "other-tenant") ${LEDGER} }`,
          {},
          ctx(countedDb()),
        ),
      ).rejects.toThrow("forbidden: tenant mismatch");
      // One macrotask is enough for an unhandled rejection to be reported.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seen).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("F-17 / `$var` in an argument position resolves (M-13)", () => {
  it("a variable named in the QUERY satisfies the resolver's tenant guard", async () => {
    const db = countedDb();
    // Pre-fix, `parseArgs` was called with `{}`, so `args.tenantId` was
    // `undefined` and this query threw: a variable had to be passed as a
    // top-level variable named `tenantId` to work at all.
    const res = await execLocal(`{ students(tenantId: $who) }`, { who: TENANT }, ctx(db));
    expect(res.errors).toBeUndefined();
    expect(res.data).toHaveProperty("students");
    expect(db.statements.length).toBe(2);
  });

  it("a variable resolving to the WRONG tenant is still refused", async () => {
    // The point of the fix: the guard must read the argument the query wrote.
    await expect(
      execLocal(`{ settings(tenantId: $who) }`, { who: "other-tenant" }, ctx(countedDb())),
    ).rejects.toThrow("forbidden: tenant mismatch");
  });

  it("an inline literal is unaffected — same answer as before the fix", async () => {
    const res = await execLocal(`{ settings(tenantId: "${TENANT}") }`, {}, ctx(countedDb()));
    expect(res.errors).toBeUndefined();
    expect(res.data).toHaveProperty("settings");
  });

  it("the legacy shape still works: a top-level variable named like the argument", async () => {
    // `{...f.args, ...variables}` is retained, because it is the only shape some
    // existing callers use. It is no longer the ONLY shape that works.
    const res = await execLocal(`{ settings }`, { tenantId: TENANT }, ctx(countedDb()));
    expect(res.errors).toBeUndefined();
    expect(res.data).toHaveProperty("settings");
  });
});
