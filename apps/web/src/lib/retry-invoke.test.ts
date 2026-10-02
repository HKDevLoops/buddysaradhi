// Implements: docs/rfc/004-multi-device-network-contract.md C2 (same key every
// attempt, 4xx never retried, Retry-After honoured) + C6 (bounded waits) + K2.

import { describe, it, expect, vi } from "vitest";
import {
  invokeWithRetry,
  classifyResult,
  classifyThrown,
  extractRetryAfterMs,
  computeBackoffMs,
  type ActionResult,
} from "./retry-invoke";

function ok<T>(data: T): ActionResult<T> {
  return { success: true, data };
}

function fail(error: string): ActionResult<never> {
  return { success: false, error };
}

describe("invokeWithRetry (RFC-004 C2/K2)", () => {
  it("passes the same key through and succeeds on the first try (1 attempt)", async () => {
    const seen: string[] = [];
    const outcome = await invokeWithRetry<string>(
      (key) => {
        seen.push(key);
        return Promise.resolve(ok("done"));
      },
      { key: "key-1", sleep: () => Promise.resolve() },
    );
    expect(outcome).toEqual({ success: true, data: "done", attempts: 1, intentKey: "key-1" });
    expect(seen).toEqual(["key-1"]);
  });

  it("retries transport failures with the SAME key (K2 handover)", async () => {
    const seen: string[] = [];
    let calls = 0;
    const sleeps: number[] = [];
    const outcome = await invokeWithRetry<string>(
      (key) => {
        seen.push(key);
        calls += 1;
        if (calls < 3) return Promise.resolve(fail("UPSTREAM: timeout after 12s"));
        return Promise.resolve(ok("replayed"));
      },
      { key: "k2-key", sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, rand: () => 0 },
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) expect(outcome.data).toBe("replayed");
    expect(seen).toEqual(["k2-key", "k2-key", "k2-key"]);
    expect(sleeps).toEqual([200, 400]); // base 400 equal-jitter with rand 0
  });

  it("never retries 4xx validation/auth (1 attempt, typed error passthrough)", async () => {
    const fn = vi.fn().mockResolvedValue(fail("VALIDATION: amountPaise must be an integer"));
    const outcome = await invokeWithRetry(fn, { key: "v-key", sleep: () => Promise.resolve() });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ success: false, attempts: 1, intentKey: "v-key" });
  });

  it("never retries auth or conflict (409 needs review + a NEW key per C4)", async () => {
    for (const error of ["AUTH_REQUIRED: no session", "CONFLICT: version mismatch"]) {
      const fn = vi.fn().mockResolvedValue(fail(error));
      const outcome = await invokeWithRetry(fn, { key: "c-key", sleep: () => Promise.resolve() });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(outcome.success).toBe(false);
    }
  });

  it("honours Retry-After on 429 instead of the computed backoff", async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const outcome = await invokeWithRetry<string>(
      () => {
        calls += 1;
        if (calls === 1) return Promise.resolve(fail("429: Retry-After 2"));
        return Promise.resolve(ok("ok"));
      },
      { key: "r-key", sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }, rand: () => 0 },
    );
    expect(outcome.success).toBe(true);
    expect(sleeps).toEqual([2000]);
  });

  it("converts a thrown transport error into a retried typed error, returning the last one", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockRejectedValueOnce(new Error("fetch failed"));
    const outcome = await invokeWithRetry(fn, {
      key: "t-key",
      attempts: 3,
      sleep: () => Promise.resolve(),
      rand: () => 0,
    });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(outcome).toMatchObject({ success: false, error: "fetch failed", attempts: 3 });
  });

  it("does not retry a thrown fatal (e.g. auth) error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("AUTH_REQUIRED: expired"));
    const outcome = await invokeWithRetry(fn, { key: "a-key", sleep: () => Promise.resolve() });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcome.success).toBe(false);
  });

  it("clamps attempts to a bounded maximum (C6)", async () => {
    const fn = vi.fn().mockResolvedValue(fail("503: Service Unavailable"));
    const outcome = await invokeWithRetry(fn, {
      key: "b-key",
      attempts: 99,
      sleep: () => Promise.resolve(),
    });
    expect(fn).toHaveBeenCalledTimes(5);
    expect(outcome).toMatchObject({ attempts: 5, retryable: true });
  });

  it("rejects a missing key without invoking (fail-closed, 0 attempts)", async () => {
    const fn = vi.fn();
    const outcome = await invokeWithRetry(fn, { key: "" });
    expect(fn).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ success: false, attempts: 0 });
  });

  it("stops between attempts when aborted", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue(fail("503: Service Unavailable"));
    const outcome = await invokeWithRetry(fn, {
      key: "abort-key",
      signal: controller.signal,
      sleep: () => {
        controller.abort();
        return Promise.resolve();
      },
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(outcome.success).toBe(false);
  });
});

describe("classifyResult / classifyThrown", () => {
  it("marks transport/upstream/5xx retryable, validation/auth/conflict fatal", () => {
    expect(classifyResult("UPSTREAM: libsql connection reset")).toBe("retryable");
    expect(classifyResult("503 Service Unavailable")).toBe("retryable");
    expect(classifyResult("408 Request Timeout")).toBe("retryable");
    expect(classifyResult("VALIDATION: bad date")).toBe("fatal");
    expect(classifyResult("CONFLICT: locked")).toBe("fatal");
    expect(classifyResult("mystery text")).toBe("fatal"); // fail-closed
  });

  it("treats unclassifiable THROWN errors as retryable (never committed)", () => {
    expect(classifyThrown("mystery transport boom")).toBe("retryable");
    expect(classifyThrown("AUTH_REQUIRED: gone")).toBe("fatal");
  });
});

describe("extractRetryAfterMs", () => {
  it("parses seconds and ms forms, caps to maxDelayMs", () => {
    expect(extractRetryAfterMs("429: Retry-After 2", 5000)).toBe(2000);
    expect(extractRetryAfterMs("rate_limited retry_after_ms=1500", 5000)).toBe(1500);
    expect(extractRetryAfterMs("429: Retry-After 60", 5000)).toBe(5000);
    expect(extractRetryAfterMs("VALIDATION: bad", 5000)).toBeNull();
  });
});

describe("computeBackoffMs", () => {
  it("grows exponentially with equal jitter (deterministic under injected rand)", () => {
    expect(computeBackoffMs(0, 400, 5000, () => 0)).toBe(200);
    expect(computeBackoffMs(1, 400, 5000, () => 0)).toBe(400);
    expect(computeBackoffMs(2, 400, 5000, () => 0)).toBe(800);
    // Equal jitter: rand 0 → temp/2, rand ~1 → temp (capped at maxDelayMs).
    expect(computeBackoffMs(9, 400, 5000, () => 0)).toBe(2500);
    expect(computeBackoffMs(9, 400, 5000, () => 0.999999)).toBe(5000);
  });
});
