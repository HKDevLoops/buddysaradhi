// Implements: docs/rfc/003-saas-overhaul.md workstream C (cache + batching regression);
// web/02_State_and_Data_Flow.md §5 (server cache hierarchy);
// 12_Business_Rules.md BR-SYN-01..04; 02_Core_Logic.md §9.
//
// Scoped to server/queries/** per the workstream boundary: cache behaviour
// (TTL, tenant isolation, invalidation, non-cacheable guard, timeout) plus the
// ledger fan-out count (2 sequential gateway trips → 1 concurrent wave).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/server/get-db", () => ({
  gatewayGet: vi.fn(),
}));

// Import AFTER the mock is registered.
import { gatewayGet } from "@/server/get-db";
import {
  DEFAULT_REFERENCE_TTL_MS,
  QUERY_TIMEOUT_MS,
  getCached,
  invalidateTenant,
  toTypedQueryError,
  withQueryTimeout,
} from "../cache";
import { getStudentFeesOverview } from "./ledger";
import type { StudentInvoiceRow, StudentLedgerRow } from "./ledger";

const mockedGatewayGet = vi.mocked(gatewayGet);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function ledgerRow(id: string): StudentLedgerRow {
  return {
    id,
    tenant_id: "t-fanout",
    student_id: "stu-fanout",
    type: "PAYMENT_RECEIVED",
    debit: 0,
    credit: 50000,
    balance_after: 0,
    method: null,
    description: null,
    occurred_on: "2026-01-05",
    invoice_id: null,
    receipt_no: "RCT-2026-000001",
    reverses_entry_id: null,
    this_hash: null,
  };
}

function invoiceRow(id: string): StudentInvoiceRow {
  return {
    id,
    tenant_id: "t-fanout",
    number: "INV-2026-000001",
    student_id: "stu-fanout",
    issue_date: "2026-01-01",
    due_date: null,
    subtotal: 50000,
    total: 50000,
    status: "paid",
    paid_amount_minor: 50000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCached reference cache", () => {
  it("serves repeat reads from cache within the TTL (one loader call)", async () => {
    let calls = 0;
    const loader = async (): Promise<string> => {
      calls += 1;
      return "settings-payload";
    };
    const first = await getCached("t-ttl-hit", "settings:singleton", loader);
    const second = await getCached("t-ttl-hit", "settings:singleton", loader);
    expect(first).toBe("settings-payload");
    expect(second).toBe("settings-payload");
    expect(calls).toBe(1);
  });

  it("reloads after TTL expiry", async () => {
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return calls;
    };
    await getCached("t-ttl-exp", "settings:singleton", loader, 40);
    await sleep(70);
    const second = await getCached("t-ttl-exp", "settings:singleton", loader, 40);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("isolates tenants: same key never leaks across tenantIds", async () => {
    const loaderA = async (): Promise<string> => "tenant-a-settings";
    const loaderB = async (): Promise<string> => "tenant-b-settings";
    const [a, b] = await Promise.all([
      getCached("t-iso-a", "settings:singleton", loaderA),
      getCached("t-iso-b", "settings:singleton", loaderB),
    ]);
    expect(a).toBe("tenant-a-settings");
    expect(b).toBe("tenant-b-settings");
    // Second reads must not re-run loaders nor cross over.
    const [a2, b2] = await Promise.all([
      getCached("t-iso-a", "settings:singleton", loaderA),
      getCached("t-iso-b", "settings:singleton", loaderB),
    ]);
    expect(a2).toBe("tenant-a-settings");
    expect(b2).toBe("tenant-b-settings");
  });

  it("invalidateTenant clears one tenant (or one prefix) and leaves others warm", async () => {
    let aCalls = 0;
    let bCalls = 0;
    let batchCalls = 0;
    const loaderA = async (): Promise<string> => {
      aCalls += 1;
      return `a-${aCalls}`;
    };
    const loaderB = async (): Promise<string> => {
      bCalls += 1;
      return `b-${bCalls}`;
    };
    const loaderBatches = async (): Promise<string> => {
      batchCalls += 1;
      return `batches-${batchCalls}`;
    };
    await getCached("t-inv-a", "settings:singleton", loaderA);
    await getCached("t-inv-b", "settings:singleton", loaderB);
    await getCached("t-inv-a", "attendance:batches", loaderBatches);

    const removed = invalidateTenant("t-inv-a", "settings:");
    expect(removed).toBe(1);
    // Prefixed entry reloads; unprefixed same-tenant entry stays warm; other tenant untouched.
    await getCached("t-inv-a", "settings:singleton", loaderA);
    await getCached("t-inv-a", "attendance:batches", loaderBatches);
    await getCached("t-inv-b", "settings:singleton", loaderB);
    expect(aCalls).toBe(2);
    expect(batchCalls).toBe(1);
    expect(bCalls).toBe(1);

    expect(invalidateTenant("t-inv-a")).toBeGreaterThanOrEqual(1);
    expect(invalidateTenant("t-inv-b")).toBe(1);
  });

  it("dedups concurrent loads: one loader call per key (in-flight single-flight)", async () => {
    let calls = 0;
    const gate = deferred<string>();
    const loader = async (): Promise<string> => {
      calls += 1;
      return gate.promise;
    };
    const pending = Promise.all([
      getCached("t-dedup", "attendance:batches", loader),
      getCached("t-dedup", "attendance:batches", loader),
      getCached("t-dedup", "attendance:batches", loader),
    ]);
    await sleep(10);
    expect(calls).toBe(1);
    gate.resolve("batches-payload");
    const settled = await pending;
    expect(settled).toEqual(["batches-payload", "batches-payload", "batches-payload"]);
  });

  it("fails closed on missing tenantId and on ledger/balance keys", async () => {
    await expect(getCached("", "settings:singleton", async () => "x")).rejects.toThrow(
      "VALIDATION",
    );
    await expect(
      getCached("t-guard", "ledger:stu-1", async () => "x"),
    ).rejects.toThrow("VALIDATION");
    await expect(
      getCached("t-guard", "balance:stu-1", async () => "x"),
    ).rejects.toThrow("VALIDATION");
  });

  it("stays size-bounded: oldest entries evict past the cap", async () => {
    const loads = new Map<string, number>();
    const tenant = "t-lru";
    for (let i = 0; i < 510; i += 1) {
      const key = `probe:${i}`;
      await getCached(tenant, key, async () => {
        loads.set(key, (loads.get(key) ?? 0) + 1);
        return key;
      });
    }
    // The earliest key was evicted (reloads); the latest key is still warm (no reload).
    await getCached(tenant, "probe:0", async () => {
      loads.set("probe:0", (loads.get("probe:0") ?? 0) + 1);
      return "probe:0";
    });
    await getCached(tenant, "probe:509", async () => {
      loads.set("probe:509", (loads.get("probe:509") ?? 0) + 1);
      return "probe:509";
    });
    expect(loads.get("probe:0")).toBe(2);
    expect(loads.get("probe:509")).toBe(1);
    invalidateTenant(tenant);
  });

  it("exposes the free-tier budget constants", () => {
    expect(DEFAULT_REFERENCE_TTL_MS).toBe(63_000);
    expect(QUERY_TIMEOUT_MS).toBe(12_000);
  });
});

describe("withQueryTimeout fail-fast bound", () => {
  it("passes fast values through untouched", async () => {
    await expect(withQueryTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects a stalled query with a typed UPSTREAM error (never hangs)", async () => {
    const stalled = new Promise<string>(() => {});
    const failure = await withQueryTimeout(stalled, 30).then(
      () => "resolved-unexpectedly",
      (err: unknown) => toTypedQueryError(err),
    );
    expect(failure.startsWith("UPSTREAM:")).toBe(true);
  });
});

describe("toTypedQueryError taxonomy", () => {
  it("passes already-typed codes through untouched", () => {
    expect(toTypedQueryError(new Error("CREDENTIALS_EXPIRED: refresh or re-provision"))).toBe(
      "CREDENTIALS_EXPIRED: refresh or re-provision",
    );
  });

  it("maps lock/duplicate shapes to CONFLICT", () => {
    expect(toTypedQueryError(new Error("Session is locked. Unlock it to edit."))).toMatch(
      /^CONFLICT:/,
    );
  });

  it("maps transport shapes to UPSTREAM without echoing raw driver text", () => {
    const typed = toTypedQueryError(new Error("fetch failed: secret-driver-detail-xyz"));
    expect(typed.startsWith("UPSTREAM:")).toBe(true);
    expect(typed).not.toContain("secret-driver-detail-xyz");
  });
});

describe("getStudentFeesOverview fan-out", () => {
  it("requests ledger + invoices concurrently (1 wave, not 2 sequential trips)", async () => {
    const ledgerGate = deferred<{ success: true; data: StudentLedgerRow[] }>();
    const invoiceGate = deferred<{ success: true; data: StudentInvoiceRow[] }>();
    // SAFETY: test-only mock — deferred gateway envelopes typed by path below.
    mockedGatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/ledger") return ledgerGate.promise;
      return invoiceGate.promise;
    }) as unknown as typeof gatewayGet);

    const pending = getStudentFeesOverview("stu-fanout-wave");
    await sleep(10);
    // Both legs must be in flight before either resolves — proves Promise.all.
    const paths = mockedGatewayGet.mock.calls.map((call) => call[0]);
    expect(paths).toContain("/api/v1/ledger");
    expect(paths).toContain("/api/v1/ledger/invoices");

    ledgerGate.resolve({ success: true, data: [ledgerRow("le-1")] });
    invoiceGate.resolve({ success: true, data: [invoiceRow("inv-1")] });
    const result = await pending;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ledger).toHaveLength(1);
      expect(result.data.invoices).toHaveLength(1);
    }
  });

  it("surfaces a single-leg failure as typed UPSTREAM (never raw gateway text)", async () => {
    // SAFETY: test-only mock — static envelopes, no network.
    mockedGatewayGet.mockImplementation((async (path: string) => {
      if (path === "/api/v1/ledger") {
        return { success: false, error: "Gateway 500: raw-driver-boom" };
      }
      return { success: true, data: [] };
    }) as unknown as typeof gatewayGet);

    const result = await getStudentFeesOverview("stu-fanout-fail");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.startsWith("UPSTREAM:")).toBe(true);
      expect(result.error).not.toContain("raw-driver-boom");
    }
  });
});
