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

  it("warm cache GET is <100µs (p95)", () => {
    const payload = { kpis: { totalStudents: 100 }, activity: [] };
    setCache(`${KEY_PREFIX}:warm:1`, payload, 30_000);

    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      getCached(`${KEY_PREFIX}:warm:1`);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.1);
  });

  it("Response cache round-trip is <500µs (p95)", () => {
    const body = JSON.stringify({ students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) });
    setCacheResponse(`${KEY_PREFIX}:resp:1`, body, 200, "application/json", 30_000);

    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      const resp = getCachedResponse(`${KEY_PREFIX}:resp:1`);
      expect(resp).not.toBeNull();
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
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
  it("request body validation is <200µs (p95) for 1KB payloads", () => {
    const smallBody = JSON.stringify({ name: "Test Student", grade: "10" });
    const samples: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const start = performance.now();
      validateRequestBody(smallBody);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.2);
  });

  it("header validation is <500µs (p95)", () => {
    const headers = {
      authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
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

    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      validateHeaders(req);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.5);
  });
});

// ─── Response construction latency ─────────────────────────────────────

describe("Response construction latency", () => {
  it("ok() builds a response in <500µs (p95)", () => {
    const data = { students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) };
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      ok(data);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.5);
  });

  it("fail() builds a response in <200µs (p95)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      fail("not found", 404);
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.2);
  });

  it("okCached() builds a response in <200µs (p95)", () => {
    const body = JSON.stringify({ success: true, data: { rows: [] } });
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      okCached(body, "public, max-age=30");
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.2);
  });

  it("securityFail() builds a response in <200µs (p95)", () => {
    const samples: number[] = [];
    for (let i = 0; i < 500; i++) {
      const start = performance.now();
      securityFail(403, "req-123");
      samples.push(performance.now() - start);
    }

    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)];
    expect(p95).toBeLessThan(0.2);
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
