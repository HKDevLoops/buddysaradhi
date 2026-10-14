// Implements: 05_Students.md §Roster ("the roster control a tutor can see must be
// a control the server honours") + AGENTS.md Rule 9 (a bounded answer must be
// SAY to be bounded — a plausible wrong answer is the failure this rule exists to
// prevent) + AGENTS.md §6.1.
//
// The audited defect (F-19.1): `GET /api/v1/students?search=…` DROPPED `take`
// and `skip` entirely and read the whole filtered table, filtering the
// substring match in JavaScript, then computed `total` from that same unbounded
// array. The cost was one full-table materialisation per keystroke, growing
// with the institution and bounded by nothing.
//
// The fix bounds the read at ROSTER_SEARCH_SCAN_CAP and DISCLOSES the bound:
// when the scan window is exhausted the response carries
// `search_truncated: true`, because `total` is then a lower bound rather than
// an exact count.
//
// KNOWN LIMIT OF THE FIX (deliberate, not an oversight): an exact searched
// count needs a LIKE in the audited builder (`lib/sql.ts`), and that file is
// owned by another change. Until then the search window is the first 500 rows
// in sort order, and the response says so. This test pins the DISCLOSED
// contract, not the truncation itself as desirable.
import { describe, expect, it } from "vitest";
import { handleStudents } from "../routes/students.ts";
import { invalidateTenant } from "../lib/cache.ts";
import type { DB } from "../lib/db.ts";
import { SqliteGatewayDb } from "./sqlite-db.ts";

const TENANT = "018f0000-0000-7000-8000-0000000000a1";
const ORIGIN = "https://api.buddysaradhi.app";

/** Mirrors ROSTER_SEARCH_SCAN_CAP in routes/students.ts. A literal, not an
 *  import: the route does not export it, and the test asserts the OBSERVABLE
 *  contract (the disclosure flag) rather than the constant's identity. */
const SCAN_CAP = 500;

interface ApiBody {
  success: boolean;
  data?: {
    students: Array<{ id: string; name: string }>;
    total: number;
    search_truncated?: boolean;
  };
  error?: string;
  details?: string;
}

// SAFETY: `SqliteGatewayDb` structurally satisfies `SqlHandle` (lib/sql.ts),
// the only capability a route uses at runtime; `DB` is the libsql marker it
// replaces.
function asDb(db: SqliteGatewayDb): DB {
  return db as unknown as DB;
}

async function get(
  db: SqliteGatewayDb,
  query: string,
): Promise<{ status: number; body: ApiBody }> {
  const url = new URL(`${ORIGIN}/api/v1/students${query ? `?${query}` : ""}`);
  const res = await handleStudents(
    new Request(url, { method: "GET" }),
    asDb(db),
    TENANT,
    "/api/v1/students",
    "GET",
    url,
    {},
  );
  if (!res) throw new Error(`no route matched GET /api/v1/students?${query}`);
  return { status: res.status, body: (await res.json()) as ApiBody };
}

/** `count` students whose first name is `firstNamePrefix`. */
function seed(db: SqliteGatewayDb, firstNamePrefix: string, count: number): void {
  const now = "2026-01-01T00:00:00.000Z";
  for (let n = 0; n < count; n += 1) {
    const ordinal = String(n).padStart(4, "0");
    db.query(
      `INSERT INTO students (id, tenant_id, code, first_name, last_name, status, fee_model,
                             balance_paise, admission_date, dup_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Testcase', 'active', 'postpaid', 0, '2026-01-04', ?, ?, ?)`,
      [
        `018f0000-0000-7000-8000-${firstNamePrefix === "Other" ? "8" : "0"}${ordinal}`,
        TENANT,
        `T-${firstNamePrefix}-${ordinal}`,
        `${firstNamePrefix}${ordinal}`,
        `${firstNamePrefix}-${ordinal}`,
        now,
        now,
      ],
    );
  }
}

describe("F-19.1 — a searched roster read is bounded, and says when it is", () => {
  it("a roster larger than the scan cap returns a page and DISCLOSES the truncation", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    seed(db, "Loop", SCAN_CAP + 100); // 600 students, all matching "loop"

    const { status, body } = await get(db, "search=loop");
    expect(status).toBe(200);

    // The page itself was always bounded by pageSize; that is not the defect.
    expect(body.data?.students.length).toBe(50);
    for (const row of body.data?.students ?? []) expect(row.name).toContain("Loop");

    // The defect WAS the unbounded read behind that page, and its consequence:
    // a `total` derived from the whole table. Now `total` is a lower bound and
    // the response says so.
    expect(body.data?.total).toBe(SCAN_CAP);
    expect(body.data?.total).toBeLessThan(SCAN_CAP + 100);
    expect(body.data?.search_truncated).toBe(true);

    db.close();
  });

  it("an unsearched read is unaffected — exact total, no truncation flag, DB paged it", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    seed(db, "Plain", SCAN_CAP + 100);

    const { body } = await get(db, "");
    expect(body.data?.total).toBe(SCAN_CAP + 100);
    expect(body.data?.students.length).toBe(50);
    // Absent means "not truncated" — the flag is only present when it bites.
    expect(body.data?.search_truncated).toBeUndefined();

    db.close();
  });

  it("a roster under the cap keeps an exact searched total and sets no flag", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    seed(db, "Loop", 12);
    seed(db, "Other", 8);

    const { body } = await get(db, "search=loop");
    expect(body.data?.total).toBe(12);
    expect(body.data?.students.length).toBe(12);
    expect(body.data?.search_truncated).toBeUndefined();

    db.close();
  });

  it("a searched page beyond the cap yields fewer rows, never rows outside the window", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    seed(db, "Loop", SCAN_CAP + 100);

    // Page 11 of a 50-per-page result set starts at offset 500 — one row past
    // the scan window. The honest answer is an empty page plus the flag, not a
    // fabricated page of matches that were never scanned.
    const { status, body } = await get(db, "search=loop&page=11&pageSize=50");
    expect(status).toBe(200);
    expect(body.data?.students).toEqual([]);
    expect(body.data?.search_truncated).toBe(true);

    db.close();
  });

  it("the flag is cached with the page, so a repeat read reports the same bound", async () => {
    const db = new SqliteGatewayDb();
    invalidateTenant(TENANT);
    seed(db, "Loop", SCAN_CAP + 100);

    const first = await get(db, "search=loop");
    const second = await get(db, "search=loop");
    expect(second.body.data).toEqual(first.body.data);
    expect(second.body.data?.search_truncated).toBe(true);

    db.close();
  });
});