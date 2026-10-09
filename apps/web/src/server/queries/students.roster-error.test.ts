// Implements: AGENTS.md §2 Rule 9 (a refusal must be typed; raw driver text must not
// reach the caller); 10_Security.md §8; RFC-003 G-ERR taxonomy (lib/app-errors.ts is
// the dispatcher, so the code has to survive the hop).
//
// THE DEFECT. `getStudents` returned
//   `…and would return a wrong roster. Cause: ${res.error}`
// and `fetchStudentsAction` (server/actions/students.ts:36) hands that string straight
// to the browser, where StudentsClient renders it as the failure reason. `res.error` is
// `Gateway ${status}: ${await res.text()}` from server/get-db.ts — the upstream body,
// verbatim. So a driver leak shipped to the client on every roster outage, inside a
// sentence that a tutor was asked to read.
//
// WHAT IS ASSERTED: the roster failure is a fixed, non-interpolated sentence; the raw
// cause is still on the server log (Rule 9 = no silent failures, not no log); and the
// envelope still classifies to the code the tutor needs for recovery.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { gatewayGet, getAuthenticatedDb, logError } = vi.hoisted(() => ({
  gatewayGet: vi.fn(),
  getAuthenticatedDb: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/server/get-db", () => ({
  gatewayGet,
  getAuthenticatedDb,
  createLibsqlProxy: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  auditAction: vi.fn(),
}));

import { toAppErrorState } from "@/lib/app-errors";
import { getStudents } from "./students";
import type { StudentFilters } from "@/types/students";

const FILTERS: StudentFilters = {
  status: [],
  batchIds: [],
  feeModels: [],
  tagIds: [],
  balanceRange: "all",
  admittedInLast: "all",
} as StudentFilters;

function read(): Promise<{ success: boolean; error?: string }> {
  return getStudents(FILTERS, "", 1, 50, { col: "name", dir: "asc" }) as Promise<{
    success: boolean;
    error?: string;
  }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStudents — roster failure is fixed, typed and non-interpolated", () => {
  const LEAKY = [
    "Gateway 500: SQLITE_ERROR: no such table: students (SQLITE_CANTOPEN)",
    "Gateway 500: libsql://buddysaradhi-acme-xyz.aws-ap-south-1.turso.io rejected the token",
    "Gateway 400: {\"db_token\":\"eyJhbGciOiJIUzI1NiJ9.payload.sig\"}",
    "Gateway 500: select * from students where tenant_id = 'uuid' — no such column",
    "SQLITE_CONSTRAINT_UNIQUE: UNIQUE constraint failed: students.dup_key",
  ];

  it.each(LEAKY)("never interpolates the raw gateway/driver string (%#)", async (raw) => {
    gatewayGet.mockResolvedValueOnce({ success: false, error: raw });

    const out = await read();
    expect(out.success).toBe(false);
    const wire = out.error ?? "";

    expect(wire).not.toContain(raw);
    for (const marker of [
      "SQLITE",
      "libsql",
      "turso",
      "select *",
      "UNIQUE constraint",
      "Bearer",
      "eyJ",
      "Cause:",
    ]) {
      expect(wire.toLowerCase(), marker).not.toContain(marker.toLowerCase());
    }
  });

  it("still records the full cause server-side", async () => {
    const raw = "Gateway 500: SQLITE_ERROR: no such table: students";
    gatewayGet.mockResolvedValueOnce({ success: false, error: raw });

    await read();
    expect(logError).toHaveBeenCalledWith("get_students_gateway_failed_no_fallback", raw, {
      page: 1,
      pageSize: 50,
      sortCol: "name",
      sortDir: "asc",
    });
  });

  // The recovery affordance is the reason this is not just "internal server error":
  // a tutor whose credentials expired must still be routed to re-login, and one whose
  // database is unprovisioned must still be routed to re-provision.
  it.each([
    ["DB_NOT_PROVISIONED: User database is not yet provisioned.", "DB_NOT_PROVISIONED", "provision"],
    ["CREDENTIALS_EXPIRED: Database credentials expired or rejected.", "CREDENTIALS_EXPIRED", "re-login"],
    ["AUTH_REQUIRED: No session — sign in again.", "AUTH_REQUIRED", "re-login"],
    ["Gateway 401: CREDENTIALS_EXPIRED: Turso pipeline HTTP 401", "CREDENTIALS_EXPIRED", "re-login"],
    ["Gateway 503: DB_NOT_PROVISIONED", "DB_NOT_PROVISIONED", "provision"],
    ["UPSTREAM: Credential probe timed out or the database is unreachable.", "UPSTREAM", "retry"],
    ["CONFLICT: record changed elsewhere (locked session or duplicate) — refresh and retry", "CONFLICT", "retry"],
  ] as const)("keeps the dispatch code for %s", async (raw, code, action) => {
    gatewayGet.mockResolvedValueOnce({ success: false, error: raw });

    const out = await read();
    const state = toAppErrorState(out.error);
    expect(state.code).toBe(code);
    expect(state.action).toBe(action);
  });

  it("falls back to the module's canonical typed error when nothing is recognisable", async () => {
    gatewayGet.mockResolvedValueOnce({ success: false, error: "zzz-unmapped-upstream-text" });

    const out = await read();
    expect(out.success).toBe(false);
    expect(toAppErrorState(out.error).code).toBe("UPSTREAM");
    expect(out.error).toMatch(/^UPSTREAM: /);
  });

  it("still returns the honest empty roster on success (no behaviour change on the happy path)", async () => {
    gatewayGet.mockResolvedValueOnce({
      success: true,
      data: { students: [], total: 0 },
    });

    const out = (await read()) as { success: boolean; data?: { students: unknown[]; total: number }; error?: string };
    expect(out.success).toBe(true);
    expect(out.data?.total).toBe(0);
    expect(out.error).toBeUndefined();
  });
});