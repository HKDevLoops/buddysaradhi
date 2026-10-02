// Implements: docs/design/overhaul-plan.md §3 ("local candidates only: the tutor's own DB
// through the ORM shim, bounded and cached — no gateway call while typing"); the three
// properties W1 gates on: no gateway hop, a minimal non-financial projection, and an
// applied tenant filter. AGENTS.md §2 Rule 2 (no gateway while typing), §3.4 ORM-ONLY,
// Rule 9 (typed failure, no driver text leaked).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findMany, gatewayGet, tenantId } = vi.hoisted(() => ({
  findMany: vi.fn(),
  gatewayGet: vi.fn(() => {
    throw new Error("gatewayGet must never be called from the search candidate query");
  }),
  tenantId: "tenant-search-0001",
}));

vi.mock("@/server/get-db", () => ({
  getAuthenticatedPrisma: vi.fn(async () => ({
    db: { student: { findMany } },
    userId: tenantId,
    tenantId,
  })),
  gatewayGet,
}));

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getSearchCandidates } from "./search";
import { invalidateTenant } from "@/server/cache";

const ALLOWED_COLUMNS = ["id", "firstName", "lastName", "code", "phone", "status"];

const ROW = {
  id: "stu-1",
  firstName: "Asha",
  lastName: "Menon",
  code: "STU-0001",
  phone: "9876543210",
  status: "active",
};

beforeEach(() => {
  vi.clearAllMocks();
  invalidateTenant(tenantId);
  findMany.mockResolvedValue([ROW]);
});

describe("getSearchCandidates", () => {
  it("reads the tutor's own database and never calls the gateway", async () => {
    const result = await getSearchCandidates();

    expect(result.success).toBe(true);
    expect(gatewayGet).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("applies the tenant filter", async () => {
    await getSearchCandidates();

    const args = findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(args.where).toEqual({ tenantId });
  });

  it("selects only the allow-listed, non-financial columns", async () => {
    await getSearchCandidates();

    const args = findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };
    expect(Object.keys(args.select).sort()).toEqual([...ALLOWED_COLUMNS].sort());
    const selected = JSON.stringify(args.select).toLowerCase();
    for (const forbidden of ["balance", "paise", "fee", "due", "amount", "invoice"]) {
      expect(selected).not.toContain(forbidden);
    }
  });

  it("returns the allow-listed fields and nothing else", async () => {
    findMany.mockResolvedValue([
      { ...ROW, balancePaise: 123456, baseFeePaise: 500000, email: "a@b.c" },
    ]);

    const result = await getSearchCandidates();

    expect(Object.keys(result.data?.[0] ?? {}).sort()).toEqual(
      ["code", "first_name", "id", "last_name", "phone", "status"].sort(),
    );
    expect(JSON.stringify(result.data)).not.toContain("123456");
    expect(JSON.stringify(result.data)).not.toContain("a@b.c");
  });

  it("maps the ORM's camelCase row onto the shared snake_case contract", async () => {
    const result = await getSearchCandidates();

    expect(result.data).toEqual([
      {
        id: "stu-1",
        first_name: "Asha",
        last_name: "Menon",
        code: "STU-0001",
        phone: "9876543210",
        status: "active",
      },
    ]);
  });

  it("bounds the candidate set", async () => {
    await getSearchCandidates();

    const args = findMany.mock.calls[0]?.[0] as { take: number; orderBy: Record<string, string> };
    expect(args.take).toBe(2000);
    expect(args.orderBy).toEqual({ lastName: "asc" });
  });

  it("serves a second read from the tenant cache", async () => {
    await getSearchCandidates();
    await getSearchCandidates();

    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("returns a typed error and no rows when the read fails", async () => {
    findMany.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));

    const result = await getSearchCandidates();

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.error).toBe("CONFLICT: record changed elsewhere (locked session or duplicate) — refresh and retry");
    expect(result.error).not.toContain("SQLITE");
  });
});