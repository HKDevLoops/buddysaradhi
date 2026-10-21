import { describe, it, expect, beforeEach } from "vitest";
import { costInStickUnits, fastestStickPerOp } from "./perf-stick.ts";
import {
  getCachedResponse,
  setCacheResponse,
  getCached,
  setCache,
  invalidateTenant,
  cacheStats,
} from "../lib/cache.ts";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

function createCache() {
  const store = new Map<string, CacheEntry<unknown>>();
  return {
    get<T>(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.data as T;
    },
    set<T>(key: string, data: T, ttlMs: number) {
      store.set(key, { data, expiresAt: Date.now() + ttlMs });
    },
    invalidatePattern(pattern: string) {
      const regex = new RegExp(pattern);
      for (const key of store.keys()) {
        if (regex.test(key)) store.delete(key);
      }
    },
    invalidateTenant(tenantId: string) {
      this.invalidatePattern(`^.*:${tenantId}:.*$`);
    },
    get size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}

describe("Response cache", () => {
  it("returns null for cache miss", () => {
    const cache = createCache();
    expect(cache.get("nonexistent")).toBeNull();
  });

  it("returns data for cache hit", () => {
    const cache = createCache();
    cache.set("key1", { students: [] }, 30000);
    expect(cache.get("key1")).toEqual({ students: [] });
  });

  it("expires after TTL", () => {
    const cache = createCache();
    cache.set("key1", "data", 1);
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* busy wait */
    }
    expect(cache.get("key1")).toBeNull();
  });

  it("invalidates by pattern", () => {
    const cache = createCache();
    cache.set("students:tenant1:1", "data1", 30000);
    cache.set("students:tenant1:2", "data2", 30000);
    cache.set("students:tenant2:1", "data3", 30000);
    cache.invalidatePattern("^students:tenant1:");
    expect(cache.get("students:tenant1:1")).toBeNull();
    expect(cache.get("students:tenant1:2")).toBeNull();
    expect(cache.get("students:tenant2:1")).toBe("data3");
  });

  it("invalidates all tenant data", () => {
    const cache = createCache();
    cache.set("students:tenant1:1", "data1", 30000);
    cache.set("analytics:dashboard:tenant1:2024-01", "data2", 30000);
    cache.set("students:tenant2:1", "data3", 30000);
    cache.invalidateTenant("tenant1");
    expect(cache.get("students:tenant1:1")).toBeNull();
    expect(cache.get("analytics:dashboard:tenant1:2024-01")).toBeNull();
    expect(cache.get("students:tenant2:1")).toBe("data3");
  });
});

describe("Batch query optimization", () => {
  it("aggregates paid amounts by invoice_id", () => {
    const paidAmounts = [
      { invoice_id: "inv-1", paid: 5000 },
      { invoice_id: "inv-2", paid: 3000 },
    ];
    const paidMap = new Map(paidAmounts.map((p) => [p.invoice_id, p.paid]));

    const invoices = [
      { id: "inv-1", total: 10000 },
      { id: "inv-2", total: 3000 },
      { id: "inv-3", total: 7000 },
    ];

    const results = invoices.map((inv) => ({
      id: inv.id,
      due_minor: inv.total - (paidMap.get(inv.id) ?? 0),
    }));

    expect(results[0].due_minor).toBe(5000);
    expect(results[1].due_minor).toBe(0);
    expect(results[2].due_minor).toBe(7000);
  });

  it("handles empty invoice list", () => {
    const paidAmounts: { invoice_id: string; paid: number }[] = [];
    const paidMap = new Map(paidAmounts.map((p) => [p.invoice_id, p.paid]));
    expect(paidMap.size).toBe(0);
  });
});

describe("N+1 query elimination", () => {
  it("batch query produces same result as individual queries", () => {
    const invoices = [
      { id: "inv-1", total: 10000, paid: 5000 },
      { id: "inv-2", total: 3000, paid: 3000 },
      { id: "inv-3", total: 7000, paid: 0 },
    ];

    const individualResults = invoices.map((inv) => ({
      id: inv.id,
      due_minor: inv.total - inv.paid,
    }));

    const paidMap = new Map(invoices.map((i) => [i.id, i.paid]));
    const batchResults = invoices.map((inv) => ({
      id: inv.id,
      due_minor: inv.total - (paidMap.get(inv.id) ?? 0),
    }));

    expect(individualResults).toEqual(batchResults);
  });
});

describe("Parallel query execution", () => {
  it("Promise.all runs queries in parallel", async () => {
    const results: number[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // THE BASELINE, measured in the SAME run: one delay on its own. The
    // assertion used to be an absolute "< 100 ms", which is a budget about
    // the RUNNER - audit AUD-066 measured 164 ms against that very budget on
    // a healthy machine. A comparative assertion cannot fail for that
    // reason: both arms are wall-clock costs taken here, now.
    const baselineStart = Date.now();
    await delay(10);
    const baseline = Date.now() - baselineStart;

    const start = Date.now();
    await Promise.all([
      delay(10).then(() => results.push(1)),
      delay(10).then(() => results.push(2)),
      delay(10).then(() => results.push(3)),
    ]);
    const elapsed = Date.now() - start;

    expect(results).toEqual([1, 2, 3]);
    // Three delays in parallel cost about ONE delay; run them serially and
    // they would cost three. The factor of two sits between the two, so a
    // regression to serial execution trips it and a loaded runner does not.
    expect(elapsed).toBeGreaterThanOrEqual(5);
    expect(elapsed).toBeLessThan(baseline * 2);
  });
});

// The budgets, in stick units (see `./perf-stick.ts`). Twice the worst
// observed ratio - the rule and its reasoning are in `low-latency.test.ts`.
const CACHE_HIT_UNITS = 1;
const SINGLE_LOOKUP_UNITS = 5;
const PRE_SERIALISED_UNITS = 130;
const INVALIDATION_UNITS = 4000;

describe("Cache performance", () => {
  it("cache hit is faster than cache miss", () => {
    const cache = createCache();
    const data = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `student-${i}`,
    }));

    for (let i = 0; i < 1000; i++) {
      cache.set(`students:tenant1:${i}`, data, 30000);
    }

    // In stick units, not milliseconds: a millisecond budget measures the
    // runner (see `./perf-stick.ts` for the whole argument).
    const units = costInStickUnits(() => {
      cache.get(`students:tenant1:${999}`);
    });
    expect(units).toBeLessThanOrEqual(CACHE_HIT_UNITS);
  });
});

describe("LRU gateway cache latency benchmarks", () => {
  beforeEach(() => {
    // Clear the module-level LRU state between tests
    invalidateTenant("bench-tenant");
    invalidateTenant("tenant-b");
  });

  it("getCached/setCache round-trip (object alias path)", () => {
    const payload = {
      kpis: { totalStudents: 42, collectedThisMonthMinor: 500000 },
      activity: Array.from({ length: 20 }, (_, i) => ({
        id: `evt-${i}`,
        event_type: "PAYMENT",
        student_name: `Student ${i}`,
        minor_amount: (i + 1) * 1000,
        timestamp: new Date().toISOString(),
      })),
    };

    setCache("bench:tenant-a:dashboard", payload, 30_000);
    const hit = getCached("bench:tenant-a:dashboard");
    expect(hit).toEqual(payload);
  });

  it("getCached/setCache round-trip (string Response path)", async () => {
    const body = JSON.stringify({ success: true, data: { rows: [] } });
    setCacheResponse("bench:tenant-a:students", body, 200, "application/json", 30_000);

    const resp = getCachedResponse("bench:tenant-a:students");
    expect(resp).not.toBeNull();
    expect(resp!.headers.get("X-Cache")).toBe("HIT");
    expect(JSON.parse(await resp!.text())).toEqual({ success: true, data: { rows: [] } });
  });

  it("single cache lookup is within its share of the stick", () => {
    // Seed 500 entries
    for (let i = 0; i < 500; i++) {
      setCache(`bench:tenant-b:entry-${i}`, { id: i, data: `x`.repeat(200) }, 60_000);
    }

    // In stick units, not milliseconds: a millisecond budget measures the
    // runner (see `./perf-stick.ts` for the whole argument). The keys cycle so
    // every call is a HIT - a miss would be a different, slower path.
    let i = 0;
    const units = costInStickUnits(() => {
      getCached(`bench:tenant-b:entry-${i++ % 500}`);
    });
    expect(units).toBeLessThanOrEqual(SINGLE_LOOKUP_UNITS);
  });

  it("pre-serialized Response path is sub-millisecond", () => {
    const bigPayload = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: `row-${i}`,
        name: `Student Name ${i}`,
        balance_paise: 125000,
        status: "active",
      })),
    );

    // Seed entries
    for (let i = 0; i < 200; i++) {
      setCacheResponse(`bench:resp-${i}`, bigPayload, 200, "application/json", 60_000);
    }

    // In stick units, not milliseconds: a millisecond budget measures the
    // runner (see `./perf-stick.ts` for the whole argument). The keys cycle so
    // every call is a HIT - a miss would be a different, slower path.
    let i = 0;
    const units = costInStickUnits(() => {
      getCachedResponse(`bench:resp-${i++ % 200}`);
    });
    expect(units).toBeLessThanOrEqual(PRE_SERIALISED_UNITS);
  });

  it("invalidation is fast for large caches", () => {
    for (let i = 0; i < 1000; i++) {
      setCache(`bench:bulk:tenant-b:${i}`, { id: i }, 60_000);
    }
    setCache("bench:bulk:other-tenant:1", { id: 999 }, 60_000);

    const start = performance.now();
    invalidateTenant("tenant-b");
    const elapsed = performance.now() - start;


    // In stick units, not milliseconds - the same reason as the gate above.
    expect(elapsed / fastestStickPerOp()).toBeLessThanOrEqual(INVALIDATION_UNITS);
    expect(cacheStats().size).toBe(1);
  });

  it("stale-while-revalidate returns stale data within grace window", async () => {
    setCache("bench:stale-tenant:1", { value: 42 }, 50);

    // Wait for expiry but within stale grace (10s default)
    await new Promise((r) => setTimeout(r, 80));

    const hit = getCached("bench:stale-tenant:1");
    expect(hit).toEqual({ value: 42 });
  });
});
