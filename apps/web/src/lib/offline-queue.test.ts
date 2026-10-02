// Implements: docs/rfc/004-multi-device-network-contract.md C3 (durable queue,
// FIFO drain with same keys) + C6 (cap, payload budget, event-driven) + K5.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  enqueueIntent,
  readQueue,
  removeIntent,
  clearQueue,
  drainQueue,
  queueKeyFor,
  resetQueueStorageForTests,
  getQueueStorageWarning,
  isQueueStorageDurable,
  QUEUE_CAP,
  type QueuedIntent,
} from "./offline-queue";

let tenantSeq = 0;
const tenants: string[] = [];

function uniqueTenant(): string {
  tenantSeq += 1;
  const tenant = `test-tenant-${tenantSeq}`;
  tenants.push(tenant);
  return tenant;
}

function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

const realLocalStorage = window.localStorage;

beforeEach(() => {
  resetQueueStorageForTests();
  Object.defineProperty(window, "localStorage", {
    value: makeMemoryStorage(),
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: realLocalStorage,
    configurable: true,
    writable: true,
  });
  for (const tenant of tenants.splice(0)) {
    try {
      realLocalStorage.removeItem(queueKeyFor(tenant));
    } catch {
      // Cleanup is best-effort; a throw here must not mask test results.
    }
  }
  vi.unstubAllGlobals();
});

describe("offline queue (RFC-004 C3/K5)", () => {
  it("scopes entries per tenant and round-trips FIFO", () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "fees.recordPayment", payload: { a: 1 }, key: "k-1" });
    enqueueIntent(tenant, { action: "fees.recordPayment", payload: { a: 2 }, key: "k-2" });
    const { items, warning } = readQueue(tenant);
    expect(warning).toBeNull();
    expect(items.map((row) => row.key)).toEqual(["k-1", "k-2"]);
    expect(readQueue(`${tenant}-other`).items).toEqual([]);
  });

  it("re-enqueueing the same key replaces in place (K1 collapse)", () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "a", payload: { n: 1 }, key: "same" });
    enqueueIntent(tenant, { action: "a", payload: { n: 2 }, key: "same" });
    const { items } = readQueue(tenant);
    expect(items).toHaveLength(1);
    expect(items[0]?.payload).toEqual({ n: 2 });
  });

  it("drains FIFO with the same keys and confirms all (K5)", async () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "a", payload: { n: 1 }, key: "q-1" });
    enqueueIntent(tenant, { action: "a", payload: { n: 2 }, key: "q-2" });
    enqueueIntent(tenant, { action: "a", payload: { n: 3 }, key: "q-3" });
    const seen: string[] = [];
    const summary = await drainQueue(tenant, (item: QueuedIntent) => {
      seen.push(item.key);
      return Promise.resolve({ success: true as const, data: item.key });
    });
    expect(seen).toEqual(["q-1", "q-2", "q-3"]);
    expect(summary).toMatchObject({ confirmed: ["q-1", "q-2", "q-3"], failed: null, remaining: 0 });
  });

  it("stops at the first failure, preserving order with bumped attempts", async () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "a", payload: {}, key: "f-1" });
    enqueueIntent(tenant, { action: "a", payload: {}, key: "f-2" });
    const seen: string[] = [];
    const summary = await drainQueue(tenant, (item: QueuedIntent) => {
      seen.push(item.key);
      if (item.key === "f-1") return Promise.resolve({ success: false as const, error: "503: down" });
      return Promise.resolve({ success: true as const, data: null });
    });
    expect(seen).toEqual(["f-1"]); // f-2 never attempted — order preserved
    expect(summary.failed?.key).toBe("f-1");
    expect(summary.remaining).toBe(2);
    expect(readQueue(tenant).items[0]?.attempts).toBe(1);
  });

  it("skips the drain while offline (never burns attempts)", async () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "a", payload: {}, key: "o-1" });
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    try {
      const invoked: string[] = [];
      const summary = await drainQueue(tenant, (item: QueuedIntent) => {
        invoked.push(item.key);
        return Promise.resolve({ success: true as const, data: null });
      });
      expect(summary.skippedOffline).toBe(true);
      expect(invoked).toEqual([]);
      expect(summary.remaining).toBe(1);
    } finally {
      Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    }
  });

  it("caps at QUEUE_CAP, drop-oldest SURFACED (never silent)", () => {
    const tenant = uniqueTenant();
    let firstDropped: string | null = null;
    for (let i = 0; i < QUEUE_CAP + 3; i += 1) {
      const res = enqueueIntent(tenant, { action: "a", payload: { i }, key: `cap-${i}` });
      if (res.ok && res.droppedOldest && firstDropped === null) firstDropped = res.droppedOldest;
    }
    expect(firstDropped).toBe("cap-0");
    const items = readQueue(tenant).items;
    expect(items).toHaveLength(QUEUE_CAP);
    expect(items[0]?.key).toBe("cap-3"); // oldest survivors stay at the head
  });

  it("rejects oversized payloads with a typed error (C6 small payloads)", () => {
    const tenant = uniqueTenant();
    const res = enqueueIntent(tenant, { action: "a", payload: { blob: "x".repeat(70000) } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/over the .* budget/);
  });

  it("rejects credential-like payload fields (no new PII in the queue)", () => {
    const tenant = uniqueTenant();
    const res = enqueueIntent(tenant, { action: "a", payload: { pin: "1234" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/credential-like/);
  });

  it("falls back to memory with a surfaced warning on quota errors", () => {
    const tenant = uniqueTenant();
    Object.defineProperty(window, "localStorage", {
      value: {
        ...makeMemoryStorage(),
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
      configurable: true,
      writable: true,
    });
    const res = enqueueIntent(tenant, { action: "a", payload: { n: 1 }, key: "mem-1" });
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/memory only/);
    expect(getQueueStorageWarning()).toMatch(/memory only/);
    expect(isQueueStorageDurable()).toBe(false);
    expect(readQueue(tenant).items.map((row) => row.key)).toEqual(["mem-1"]);
  });

  it("skips corrupt rows with a surfaced warning instead of crashing", () => {
    const tenant = uniqueTenant();
    window.localStorage.setItem(queueKeyFor(tenant), JSON.stringify([{ nope: true }]));
    const { items, warning } = readQueue(tenant);
    expect(items).toEqual([]);
    expect(warning).toMatch(/malformed/);
  });

  it("removeIntent + clearQueue (sign-out hook point)", () => {
    const tenant = uniqueTenant();
    enqueueIntent(tenant, { action: "a", payload: {}, key: "r-1" });
    enqueueIntent(tenant, { action: "a", payload: {}, key: "r-2" });
    removeIntent(tenant, "r-1");
    expect(readQueue(tenant).items.map((row) => row.key)).toEqual(["r-2"]);
    expect(clearQueue(tenant)).toEqual({ ok: true, cleared: 1 });
    expect(readQueue(tenant).items).toEqual([]);
  });

  it("requires a tenant id (typed, never silent)", () => {
    expect(enqueueIntent("", { action: "a", payload: {} }).ok).toBe(false);
    expect(readQueue("").warning).toMatch(/tenant/);
  });
});
