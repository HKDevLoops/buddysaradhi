// Implements: 05_Students.md §6.1 / §10 (roster mutations); web/02_State_and_Data_Flow.md §5
// (server cache hierarchy — a mutation must invalidate what it made stale);
// AGENTS.md §2 Rule 9; 12_Business_Rules.md BR-SYN-01..04.
//
// Defect 3: `invalidateTenant` was called from EXACTLY ONE line in
// server/actions/students.ts — line 469, on the offline-fallback path of
// createStudent, and only `if (batch !== undefined)`. So:
//   - `updateStudentAction` (both the gateway path and the local fallback) never
//     invalidated, so `search:student-candidates` served the OLD NAME for up to
//     63s;
//   - `deleteStudentAction` never invalidated, so a deleted student stayed
//     searchable in the roster toolbar and the ⌘K palette for up to 63s;
//   - a gateway-committed create never invalidated, so a student who exists in
//     the database was absent from the roster cache for up to 63s;
//   - a create with NO batch name invalidated nothing at all.
//
// These tests use the REAL server/cache.ts (no `invalidateTenant` mock) and
// assert the observable consequence: after a successful mutation, the roster
// read runs its loader again. Only the session and network seams are stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPrisma: vi.fn(),
  gatewayPost: vi.fn(),
  gatewayPatch: vi.fn(),
  gatewayDelete: vi.fn(),
  revalidatePath: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/logger", () => ({ log: mocks.log }));
vi.mock("@/server/get-db", () => ({
  getAuthenticatedPrisma: mocks.getAuthenticatedPrisma,
  gatewayPost: mocks.gatewayPost,
  gatewayPatch: mocks.gatewayPatch,
  gatewayDelete: mocks.gatewayDelete,
}));

import {
  createStudent,
  deleteStudentAction,
  updateStudentAction,
} from "@/server/actions/students";
import { getCached, invalidateTenant } from "@/server/cache";

const TENANT = "t-students-cache-invalidation";
const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const CANDIDATES_KEY = "search:student-candidates";
const BATCHES_KEY = "attendance:batches";

/** Loader that records how many times the ROSTOR was actually read from source. */
function rosterSpy(initialName: string): { loader: () => Promise<{ name: string }>; calls: () => number } {
  let calls = 0;
  return {
    loader: async () => {
      calls += 1;
      return { name: initialName };
    },
    calls: () => calls,
  };
}

let db: {
  student: { findFirst: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  db = {
    student: {
      findFirst: vi.fn(async () => ({
        id: STUDENT_ID,
        code: "S-0001",
        firstName: "Asha",
        lastName: "Menon",
        status: "active",
        feeModel: "postpaid",
        baseFeePaise: 100000,
        dupKey: "dup-1",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        student: { updateMany: db.student.updateMany, create: vi.fn() },
        batch: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "batch-1" })) },
        studentEnrollment: { create: vi.fn() },
        syncOutbox: { create: vi.fn() },
        auditLog: { create: vi.fn() },
      });
    }),
  };
  mocks.getAuthenticatedPrisma.mockImplementation(async () => ({
    db,
    userId: TENANT,
    tenantId: TENANT,
  }));
  mocks.gatewayPatch.mockImplementation(async () => ({
    success: true,
    data: { id: STUDENT_ID, first_name: "Asha", last_name: "Renamed" },
  }));
  mocks.gatewayDelete.mockImplementation(async () => ({ success: true, data: { ok: true } }));
  mocks.gatewayPost.mockImplementation(async () => ({
    success: true,
    data: { id: STUDENT_ID, first_name: "Asha", last_name: "Menon" },
  }));
  invalidateTenant(TENANT);
});

describe("updateStudentAction invalidation (defect 3)", () => {
  it("gateway-committed rename invalidates the roster cache", async () => {
    const roster = rosterSpy("Asha Menon");
    expect(await getCached(TENANT, CANDIDATES_KEY, roster.loader)).toEqual({ name: "Asha Menon" });
    expect(await getCached(TENANT, CANDIDATES_KEY, roster.loader)).toEqual({ name: "Asha Menon" });
    expect(roster.calls()).toBe(1);

    const result = await updateStudentAction(STUDENT_ID, { last_name: "Renamed" });

    expect(result.success).toBe(true);
    // The roster must be re-read: serving "Asha Menon" after the rename is the
    // defect this test exists to prevent.
    expect(await getCached(TENANT, CANDIDATES_KEY, roster.loader)).toEqual({ name: "Asha Menon" });
    expect(roster.calls()).toBe(2);
  });

  it("local-fallback rename invalidates the roster cache too", async () => {
    mocks.gatewayPatch.mockImplementation(async () => ({ success: false, error: "UPSTREAM: offline" }));
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);

    const result = await updateStudentAction(STUDENT_ID, { last_name: "Renamed" });

    expect(result.success).toBe(true);
    expect(db.$transaction).toHaveBeenCalled();
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(2);
  });

  it("a REJECTED write (stale CAS base) leaves the cache untouched — nothing was written", async () => {
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);

    const result = await updateStudentAction(
      STUDENT_ID,
      { last_name: "Renamed" },
      { base_updated_at: "2020-01-01T00:00:00.000Z" },
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("CONFLICT");
    // No write happened, so no invalidation is correct — and the cached roster
    // stays valid.
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);
  });
});

describe("deleteStudentAction invalidation (defect 3)", () => {
  it("a gateway-committed delete invalidates the roster cache", async () => {
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);

    const result = await deleteStudentAction(STUDENT_ID);

    expect(result).toEqual({ success: true });
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(2);
  });

  it("a FAILED delete leaves the roster cache intact", async () => {
    mocks.gatewayDelete.mockImplementation(async () => ({
      success: false,
      error: "CONFLICT: record changed elsewhere",
    }));
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);

    const result = await deleteStudentAction(STUDENT_ID);

    expect(result.success).toBe(false);
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);
  });

  it("rejects a non-UUID id before touching the gateway or the cache", async () => {
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);

    const result = await deleteStudentAction("not-a-uuid");

    expect(result).toEqual({ success: false, error: "Invalid student id" });
    expect(mocks.gatewayDelete).not.toHaveBeenCalled();
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);
  });
});

describe("createStudent invalidation (defect 3)", () => {
  const validPayload = {
    first_name: "Asha",
    last_name: "Menon",
    admission_date: "2026-01-01",
  };

  it("a GATEWAY-committed create invalidates the roster cache", async () => {
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);

    const result = await createStudent(validPayload);

    expect(result.success).toBe(true);
    expect(mocks.gatewayPost).toHaveBeenCalled();
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(2);
  });

  it("a create with NO batch name invalidates the roster cache (the old guard skipped it)", async () => {
    // The old call site was `if (batch !== undefined) invalidateTenant(...)` —
    // a create without a batch (the common case) invalidated nothing.
    const roster = rosterSpy("Asha Menon");
    const batches = vi.fn(async () => ["existing-batch"]);
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    await getCached(TENANT, BATCHES_KEY, batches);

    const result = await createStudent(validPayload);

    expect(result.success).toBe(true);
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(2);
  });

  it("a create that auto-creates a batch still invalidates the batch list", async () => {
    mocks.gatewayPost.mockImplementation(async () => ({ success: false, error: "UPSTREAM: offline" }));
    const batches = vi.fn(async () => ["batch-one"]);
    await getCached(TENANT, BATCHES_KEY, batches);
    expect(batches).toHaveBeenCalledTimes(1);

    // Offline fallback path: the batch auto-create must still drop `attendance:`.
    const result = await createStudent(validPayload, "Brand New Batch");

    expect(result.success).toBe(true);
    expect(db.$transaction).toHaveBeenCalled();
    expect(await getCached(TENANT, BATCHES_KEY, batches)).toEqual(["batch-one"]);
    expect(batches).toHaveBeenCalledTimes(2);
  });

  it("a REJECTED payload (Zod) invalidates nothing", async () => {
    const roster = rosterSpy("Asha Menon");
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);

    const result = await createStudent({ first_name: "" });

    expect(result.success).toBe(false);
    expect(mocks.gatewayPost).not.toHaveBeenCalled();
    await getCached(TENANT, CANDIDATES_KEY, roster.loader);
    expect(roster.calls()).toBe(1);
  });
});