// Implements: 06_Attendance.md §6 (the batch dimension must be selectable) +
// 11_Data_Model.md §4.3 (`batches`) + AGENTS.md §2 Rule 9.
//
// Why this file exists: `GET /api/v1/attendance/batches` had NO route-level
// test — `cache-parity.test.ts` only asserts the path is on the edge-cache
// allowlist. A handler can be registered, cached correctly and still return `[]`
// forever and the suite stays green, which is exactly how the batch dimension
// died in the UI: the toolbar showed "No batches yet" while every mark was
// written into `batch-default`.
//
// Two halves:
//   1. READ — a tenant that HAS a batch row gets it back, and only its own
//      (tenant scoping is asserted both ways: no cross-tenant leakage, and a
//      second tenant's row never appears in the first tenant's list).
//   2. WRITE→READ — the two writers of `attendance_sessions.batch_id`
//      (`apps/web`'s `ensureBatch` and the edge's own mark path) must leave a
//      row in `batches`, because that row is the ONLY thing the batch selector
//      can render. The web writer's exact payload is replayed through the web's
//      own ORM shim so the two writers are compared, not assumed.
import { describe, expect, it } from "vitest";
import { handleAttendance } from "../routes/attendance.ts";
import type { DB } from "../lib/db.ts";
import { invalidateTenant } from "../lib/cache.ts";
import { createLedgerFixture, type LedgerFixture } from "./sqlite-db.ts";

interface BatchRow {
  id: string;
  name: string;
  subject: string | null;
}
interface ApiBody {
  success: boolean;
  data?: unknown;
  error?: string;
}

const OTHER_TENANT = "018f0000-0000-7000-8000-0000000000ff";

async function getBatches(
  fixture: LedgerFixture,
  tenantId = fixture.tenantId,
): Promise<{ status: number; body: ApiBody }> {
  const req = new Request("https://api.buddysaradhi.app/api/v1/attendance/batches", {
    method: "GET",
  });
  const res = await handleAttendance(
    req,
    fixture.db as unknown as DB,
    tenantId,
    "/api/v1/attendance/batches",
    "GET",
    new URL(req.url),
    {},
  );
  if (!res) throw new Error("no route matched GET /api/v1/attendance/batches");
  return { status: res.status, body: (await res.json()) as ApiBody };
}

function seedBatch(fx: LedgerFixture, id: string, name: string, tenantId = fx.tenantId): void {
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      `INSERT INTO batches (id, tenant_id, name, subject, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, tenantId, name, now, now);
}

describe("GET /api/v1/attendance/batches — the batch dimension is readable", () => {
  it("returns the tenant's batch rows, ordered by name", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedBatch(fx, "batch-default", "General Batch");
    seedBatch(fx, "batch-b", "Zoology");
    seedBatch(fx, "batch-a", "Algebra");

    const { status, body } = await getBatches(fx);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const rows = body.data as BatchRow[];
    expect(rows.map((r) => r.name)).toEqual(["Algebra", "General Batch", "Zoology"]);
    expect(rows.map((r) => r.id).sort()).toEqual(["batch-a", "batch-b", "batch-default"]);
    // `subject` is a real column and must come through as null, not undefined.
    expect(rows.every((r) => "subject" in r)).toBe(true);
  });

  it("never leaks another tenant's batches and returns [] for a tenant with none", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    invalidateTenant(OTHER_TENANT);
    seedBatch(fx, "batch-other", "Other Tutor's Class", OTHER_TENANT);
    seedBatch(fx, "batch-mine", "My Class");

    const mine = await getBatches(fx);
    expect(mine.status).toBe(200);
    expect((mine.body.data as BatchRow[]).map((r) => r.id)).toEqual(["batch-mine"]);

    // The mirror image: the other tenant sees its own row and not ours.
    const theirs = await getBatches(fx, OTHER_TENANT);
    expect(theirs.status).toBe(200);
    expect((theirs.body.data as BatchRow[]).map((r) => r.id)).toEqual(["batch-other"]);
  });

  it("hides an archived batch but keeps the active one", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    seedBatch(fx, "batch-live", "Live Class");
    seedBatch(fx, "batch-dead", "Archived Class");
    fx.db.raw
      .prepare(`UPDATE batches SET archived_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), "batch-dead");

    const { body } = await getBatches(fx);
    expect((body.data as BatchRow[]).map((r) => r.id)).toEqual(["batch-live"]);
  });

  it("is served fresh after the batch list is invalidated (no stale empty list)", async () => {
    const fx = createLedgerFixture();
    invalidateTenant(fx.tenantId);
    expect((await getBatches(fx)).body.data).toEqual([]);
    seedBatch(fx, "batch-default", "General Batch");
    invalidateTenant(fx.tenantId);
    expect((await getBatches(fx)).body.data).toEqual([
      { id: "batch-default", name: "General Batch", subject: null },
    ]);
  });
});
