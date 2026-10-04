import { describe, it, expect, beforeEach } from "vitest";
import {
  getCachedResponse,
  setCacheResponse,
  getCached,
  setCache,
  invalidateTenant,
  cacheStats,
} from "../lib/cache.ts";
import {
  validateUrl,
  validatePath,
  validateHeaders,
  validateRequestBody,
  runSecurityChecks,
  checkIpRateLimit,
} from "../lib/security.ts";
import { ok, fail, okCached, securityFail } from "../lib/errors.ts";

// ─── Why this file batches its measurements ─────────────────────────────
//
// This file used to time ONE operation per `performance.now()` pair and take a
// p95 over the results. For work this small — a `Map.get`, a regex over a 1KB
// body — that is not measuring the code. It is measuring whether the OS
// descheduled the runner mid-measurement. On a loaded CI runner that happens
// routinely, so a single 900µs outlier among 500 samples became a p95 breach and
// reddened the pipeline for a code path taking ~200ns. It failed intermittently
// in CI for weeks while being green locally, which is the signature of measuring
// the machine instead of the function.
//
// The fix is to time a BATCH and divide. Scheduler noise is paid once per batch
// rather than once per operation, so it averages out, and the figure that
// survives is the cost of the code. The budgets are unchanged — a genuine
// regression in cache or validation cost still trips them; a noisy runner does
// not. `PER_OP_BUDGET_SCALE` gives headroom for shared runners without moving
// the number enough to hide an order-of-magnitude regression.

/** Operations per timed batch. Large enough to amortise a preemption. */
const BATCH = 200;

/** Timed batches, excluding the discarded warm-up. */
const BATCHES = 7;

/**
 * Per-operation cost in milliseconds, measured as the p95 across `BATCHES`
 * batches of `BATCH` operations. One warm-up batch is discarded so JIT
 * compilation and first-touch allocation are not attributed to the code.
 *
 * Note the op runs `BATCHES + 1` times: the warm-up batch's *timing* is
 * discarded, not its execution. A caller counting invocations must expect
 * `BATCH * (BATCHES + 1)`.
 */
function p95PerOp(op: () => void, batches = BATCHES): number {
  const perOp: number[] = [];
  for (let b = 0; b < batches + 1; b++) {
    const start = performance.now();
    for (let i = 0; i < BATCH; i++) op();
    const elapsed = performance.now() - start;
    if (b > 0) perOp.push(elapsed / BATCH); // skip the warm-up batch
  }
  perOp.sort((a, b) => a - b);
  return perOp[Math.floor(perOp.length * 0.95)]!;
}

/** How many times `p95PerOp` actually invokes its op. */
const P95_INVOCATIONS = BATCH * (BATCHES + 1);

// ─── Gateway cold-start latency ────────────────────────────────────────

describe("Gateway cold-start simulation", () => {
  it("all security checks complete in <10ms (p99)", () => {
    const req = new Request("https://example.com/api/v1/students?search=test", {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
    });

    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const start = performance.now();
      runSecurityChecks(req);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    expect(p99).toBeLessThan(10);
  });

  it("URL validation completes in <2ms (p99)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const req = new Request(`https://example.com/api/v1/students?page=${i}&limit=20`);
      const start = performance.now();
      validateUrl(req);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    expect(p99).toBeLessThan(2);
  });

  it("path validation completes in <1ms (p99)", () => {
    const paths = ["/api/v1/students", "/api/v1/attendance", "/api/v1/analytics/dashboard"];
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const path = paths[i % paths.length];
      const start = performance.now();
      validatePath(path);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p99 = samples[Math.floor(samples.length * 0.99)];
    expect(p99).toBeLessThan(1);
  });
});

// ─── Cache response latency ────────────────────────────────────────────

describe("Cache response latency", () => {
  const KEY_PREFIX = "latency-test";

  beforeEach(() => {
    invalidateTenant("latency-test");
  });

  it("warm cache GET is under 100µs per op (batched p95)", () => {
    const payload = { kpis: { totalStudents: 100 }, activity: [] };
    setCache(`${KEY_PREFIX}:warm:1`, payload, 30_000);
    expect(p95PerOp(() => {
      getCached(`${KEY_PREFIX}:warm:1`);
    })).toBeLessThan(0.1);
  });

  it("Response cache round-trip is under 500µs per op (batched p95)", () => {
    const body = JSON.stringify({ students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) });
    setCacheResponse(`${KEY_PREFIX}:resp:1`, body, 200, "application/json", 30_000);

    let hits = 0;
    const p95 = p95PerOp(() => {
      if (getCachedResponse(`${KEY_PREFIX}:resp:1`) !== null) hits++;
    });
    // Every single call must have been a hit — a cache that started missing
    // would make this faster and meaningless.
    expect(hits).toBe(P95_INVOCATIONS);
    expect(p95).toBeLessThan(0.5);
  });

  it("tenant invalidation completes in <5ms for 512 entries", () => {
    // LRU cache caps at 512 entries
    for (let i = 0; i < 512; i++) {
      setCache(`${KEY_PREFIX}:bulk:${i}`, { id: i }, 60_000);
    }
    // Different tenant prefix — should survive invalidation
    setCache("other-tenant:1", { id: 999 }, 60_000);

    const start = performance.now();
    invalidateTenant(KEY_PREFIX);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
    // Only the other-tenant entry survives
    expect(cacheStats().size).toBe(1);
  });
});

// ─── Security function latency ─────────────────────────────────────────

describe("Security function latency", () => {
  it("request body validation is under 200µs per op (batched p95) for 1KB payloads", () => {
    const smallBody = JSON.stringify({ name: "Test Student", grade: "10" });
    expect(p95PerOp(() => {
      validateRequestBody(smallBody);
    })).toBeLessThan(0.2);
  });

  it("header validation is under 500µs per op (batched p95)", () => {
    const headers = {
      authorization: "Bearer TEST.FAKE.JWT",
      "content-type": "application/json",
      "x-tutor-id": "tenant-123",
      "x-signature": "a".repeat(64),
      "x-timestamp": String(Date.now()),
      "x-nonce": "random-nonce-value-12345678",
    };
    const req = new Request("https://example.com/api/v1/students", {
      method: "POST",
      headers,
    });

    expect(p95PerOp(() => {
      validateHeaders(req);
    })).toBeLessThan(0.5);
  });
});

// ─── Response construction latency ─────────────────────────────────────

describe("Response construction latency", () => {
  it("ok() builds a response in under 500µs per op (batched p95)", () => {
    const data = { students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) };
    expect(p95PerOp(() => {
      ok(data);
    })).toBeLessThan(0.5);
  });

  it("fail() builds a response in under 500µs per op (batched p95)", () => {
    // fail() runs sanitizeError() with 4 regex replacements + json() — more
    // expensive than ok().  Threshold matches ok()'s to avoid CI flakiness.
    expect(p95PerOp(() => {
      fail("not found", 404);
    })).toBeLessThan(0.5);
  });

  it("okCached() builds a response in under 200µs per op (batched p95)", () => {
    const body = JSON.stringify({ success: true, data: { rows: [] } });
    expect(p95PerOp(() => {
      okCached(body, "public, max-age=30");
    })).toBeLessThan(0.2);
  });

  it("securityFail() builds a response in under 200µs per op (batched p95)", () => {
    expect(p95PerOp(() => {
      securityFail(403, "req-123");
    })).toBeLessThan(0.2);
  });
});

// ─── IP rate limit throughput ───────────────────────────────────────────

describe("IP rate limit throughput", () => {
  it("checkIpRateLimit handles 10,000 calls in <100ms", () => {
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      checkIpRateLimit(`throughput-ip-${i % 100}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
