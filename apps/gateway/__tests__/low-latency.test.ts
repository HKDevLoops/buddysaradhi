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
import { BATCH, BATCHES, costInStickUnits, fastestPerOp, stick } from "./perf-stick.ts";

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



/**
 * Per-operation cost in milliseconds, measured as the p95 across `BATCHES`
 * batches of `BATCH` operations. One warm-up batch is discarded so JIT
 * compilation and first-touch allocation are not attributed to the code.
 *
 * Exported so the outlier policy below can be asserted directly — the flake this
 * fixes was invisible precisely because nothing pinned what the aggregator does
 * with one bad sample.
 *
 * Note the op runs `BATCHES + 1` times: the warm-up batch's *timing* is
 * discarded, not its execution. A caller counting invocations must expect
 * `BATCH * (BATCHES + 1)`.
 */
export function p95PerOp(op: () => void, batches = BATCHES): number {
  const perOp: number[] = [];
  for (let b = 0; b < batches + 1; b++) {
    const start = performance.now();
    for (let i = 0; i < BATCH; i++) op();
    const elapsed = performance.now() - start;
    if (b > 0) perOp.push(elapsed / BATCH); // skip the warm-up batch
  }
  perOp.sort((a, b) => a - b);
  // `ceil(0.95 * n) - 1`, NOT `floor(0.95 * n)`. With the old BATCHES = 7 the
  // floor index was 6 — the MAXIMUM of 7 samples — so this "p95" was really "the
  // worst batch", and a single scheduler preemption out of seven failed a code
  // path that takes ~200ns. That is the remaining source of the flake: batching
  // shrinks the noise but cannot remove it, and a percentile that resolves to the
  // maximum samples it. The ceiling form is the standard nearest-rank p95, so the
  // single worst batch is excluded while a regression that slows EVERY batch
  // (the only kind that is real) still trips the budget by a wide margin.
  return perOp[Math.ceil(perOp.length * 0.95) - 1]!;
}

// ─── The budgets, in stick units ─────────────────────────────────────────
//
// Each is the measured cost of the operation expressed in multiples of the
// stick, with headroom for a loaded runner but well under the 10x a genuine
// regression would cost. They are RATIOS, so a slow runner moves both sides
// and the verdict holds - which is the whole point (see `costInStickUnits`).

//
// THE BUDGET RULE (and why it is 2x, not 3x).
//
// A budget has to satisfy two requirements at once:
//
//   1. it must NOT trip on a healthy machine, so it has to clear the WORST
//      ratio any machine produces, times the headroom for a loaded runner;
//   2. it MUST trip on a genuine regression, so it has to sit below the
//      multiple a regression costs.
//
// With the stick's own cross-machine spread measured at 1.2x-2.3x, the two
// meet at TWICE the worst observed ratio: a three-times regression is then
// 1.5x over the budget on the machine the budget was calibrated on, and the
// runner's noise (1.3x) stays comfortably under it.
//
// MEASURED (the worst of four runs, 2026-10-21, on the calibration machine
// and on a second one): security checks 33.8 | URL validation 7.4 | path
// validation 3.6 | warm cache 2.3 | response cache 28.1 | tenant invalidation
// 1761 | body validation 2.1 | header validation 4.2 | ok 100.1 | fail 57.6 |
// okCached 46.4 | securityFail 59.0. Each budget is twice the worst observed.
//
// WHAT THE INSTRUMENT CANNOT SEE, STATED PLAINLY. The stick costs about 0.6
// microseconds, so an operation that costs a few tens of nanoseconds - a
// cache HIT on a warm map - measures as a fraction of one unit and its ratio
// has no resolution left to spare. A three-times regression of THAT
// operation is not detectable. The instrument's floor is the stick's own
// resolution; below it, the gate is a smoke test, not a budget. The negative
// control in `perf-negative-control.test.ts` pins the instrument's floor so
// it cannot be mistaken for a budget.

const SECURITY_CHECKS_UNITS = 68;
const URL_VALIDATION_UNITS = 15;
const PATH_VALIDATION_UNITS = 7;
const WARM_CACHE_UNITS = 5;
const RESPONSE_CACHE_UNITS = 56;
const INVALIDATION_UNITS = 3500;
const BODY_VALIDATION_UNITS = 4;
const HEADER_VALIDATION_UNITS = 8;
const OK_UNITS = 200;
const FAIL_UNITS = 115;
const OK_CACHED_UNITS = 93;
const SECURITY_FAIL_UNITS = 118;
const IP_RATE_LIMIT_UNITS = 5;
/** How many times `p95PerOp` actually invokes its op. */
// The ABBA interleave runs the candidate twice per batch (see
// `costInStickUnits`), so the candidate is invoked twice per batch.
const P95_INVOCATIONS = BATCH * (BATCHES + 1) * 2;

// ─── Gateway cold-start latency ────────────────────────────────────────

describe("Gateway cold-start simulation", () => {
  it("all security checks cost at most SECURITY_CHECKS_UNITS stick units", () => {
    const req = new Request("https://example.com/api/v1/students?search=test", {
      method: "GET",
      headers: { authorization: "Bearer test-token" },
    });

    expect(costInStickUnits(() => {
      runSecurityChecks(req);
    })).toBeLessThanOrEqual(SECURITY_CHECKS_UNITS);
  });

  it("URL validation costs at most URL_VALIDATION_UNITS stick units", () => {
    const req = new Request("https://example.com/api/v1/students?page=7&limit=20");
    expect(costInStickUnits(() => {
      validateUrl(req);
    })).toBeLessThanOrEqual(URL_VALIDATION_UNITS);
  });

  it("path validation costs at most PATH_VALIDATION_UNITS stick units", () => {
    const paths = ["/api/v1/students", "/api/v1/attendance", "/api/v1/analytics/dashboard"];
    let i = 0;
    expect(costInStickUnits(() => {
      validatePath(paths[i++ % paths.length] as string);
    })).toBeLessThanOrEqual(PATH_VALIDATION_UNITS);
  });
});

// ─── Cache response latency ────────────────────────────────────────────

describe("Cache response latency", () => {
  const KEY_PREFIX = "latency-test";

  beforeEach(() => {
    invalidateTenant("latency-test");
  });

  it("warm cache GET costs at most WARM_CACHE_UNITS", () => {
    const payload = { kpis: { totalStudents: 100 }, activity: [] };
    setCache(`${KEY_PREFIX}:warm:1`, payload, 30_000);
    expect(costInStickUnits(() => {
      getCached(`${KEY_PREFIX}:warm:1`);
    })).toBeLessThanOrEqual(WARM_CACHE_UNITS);
  });

  it("Response cache round-trip costs at most RESPONSE_CACHE_UNITS", () => {
    const body = JSON.stringify({ students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) });
    setCacheResponse(`${KEY_PREFIX}:resp:1`, body, 200, "application/json", 30_000);

    let hits = 0;
    const units = costInStickUnits(() => {
      if (getCachedResponse(`${KEY_PREFIX}:resp:1`) !== null) hits++;
    });
    // Every single call must have been a hit - a cache that started missing
    // would make this faster and meaningless.
    expect(hits).toBe(P95_INVOCATIONS);
    expect(units).toBeLessThanOrEqual(RESPONSE_CACHE_UNITS);
  });

  it("tenant invalidation costs at most INVALIDATION_UNITS stick units", () => {
    // LRU cache caps at 512 entries
    for (let i = 0; i < 512; i++) {
      setCache(`${KEY_PREFIX}:bulk:${i}`, { id: i }, 60_000);
    }
    // Different tenant prefix — should survive invalidation
    setCache("other-tenant:1", { id: 999 }, 60_000);

    // The invalidation is ONE operation over 512 entries, so it is timed
    // against the stick measured in the same run rather than per-op. It is
    // repeated and the median taken, because a single-shot measurement on a
    // shared runner is the scheduler's to decide.
    const stickCost = fastestPerOp(stick);
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 512; j++) {
        setCache(`${KEY_PREFIX}:bulk:${j}`, { id: j }, 60_000);
      }
      // Re-seeded too: the cache is LRU-capped at 512 entries, so the other
      // tenant's entry has to be the NEWEST to survive the seed.
      setCache("other-tenant:1", { id: 999 }, 60_000);
      const start = performance.now();
      invalidateTenant(KEY_PREFIX);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const elapsed = samples[Math.floor(samples.length / 2)] ?? 0;

    expect(elapsed / stickCost).toBeLessThanOrEqual(INVALIDATION_UNITS);
    // Only the other-tenant entry survives
    expect(cacheStats().size).toBe(1);
  });
});

// ─── Security function latency ─────────────────────────────────────────

describe("Security function latency", () => {
  it("request body validation costs at most BODY_VALIDATION_UNITS for 1KB payloads", () => {
    const smallBody = JSON.stringify({ name: "Test Student", grade: "10" });
    expect(costInStickUnits(() => {
      validateRequestBody(smallBody);
    })).toBeLessThanOrEqual(BODY_VALIDATION_UNITS);
  });

  it("header validation costs at most HEADER_VALIDATION_UNITS", () => {
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

    expect(costInStickUnits(() => {
      validateHeaders(req);
    })).toBeLessThanOrEqual(HEADER_VALIDATION_UNITS);
  });
});

// ─── Response construction latency ─────────────────────────────────────

describe("Response construction latency", () => {
  it("ok() costs at most OK_UNITS", () => {
    const data = { students: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `S${i}` })) };
    expect(costInStickUnits(() => {
      ok(data);
    })).toBeLessThanOrEqual(OK_UNITS);
  });

  it("fail() costs at most FAIL_UNITS", () => {
    // fail() runs sanitizeError() with 4 regex replacements + json() — more
    // expensive than ok().  Threshold matches ok()'s to avoid CI flakiness.
    expect(costInStickUnits(() => {
      fail("not found", 404);
    })).toBeLessThanOrEqual(FAIL_UNITS);
  });

  it("okCached() costs at most OK_CACHED_UNITS", () => {
    const body = JSON.stringify({ success: true, data: { rows: [] } });
    expect(costInStickUnits(() => {
      okCached(body, "public, max-age=30");
    })).toBeLessThanOrEqual(OK_CACHED_UNITS);
  });

  it("securityFail() costs at most SECURITY_FAIL_UNITS", () => {
    // Budget matches fail()'s 0.5, not okCached()'s 0.2: securityFail() builds
    // the full security-header set plus a request id per call, which is the
    // fail()-shaped cost profile, not the okCached() one. The 0.2 budget was
    // aspirational and measured 0.353ms under a 44-file parallel run — a red
    // run for a code path that had not changed. 0.5 keeps ~40% headroom over
    // the worst observed contention while a genuine 10x regression (~2-3.5ms)
    // still trips it by a wide margin (F-34).
    expect(costInStickUnits(() => {
      securityFail(403, "req-123");
    })).toBeLessThanOrEqual(SECURITY_FAIL_UNITS);
  });
});

// ─── IP rate limit throughput ───────────────────────────────────────────

describe("IP rate limit throughput", () => {
  it("checkIpRateLimit handles 10,000 calls within IP_RATE_LIMIT_UNITS stick units", () => {
    // The cost of 10,000 calls, in stick units: the same conversion as every
    // other gate here, so a loaded runner cannot redden it.
    const stickCost = fastestPerOp(stick);
    const start = performance.now();
    for (let i = 0; i < 10_000; i++) {
      checkIpRateLimit(`throughput-ip-${i % 100}`);
    }
    const elapsed = performance.now() - start;
    expect(elapsed / (10_000 * stickCost)).toBeLessThanOrEqual(IP_RATE_LIMIT_UNITS);
  });
});

describe("the p95 aggregator's outlier policy (the flake, made visible)", () => {
  // A wall-clock budget test is only trustworthy if it can tell "our code got
  // slower" from "the OS descheduled the runner". This pins that line, because
  // the failure it prevents was invisible: with BATCHES = 7 and a floor index,
  // `p95` resolved to the MAXIMUM of 7 samples, so ONE preempted batch failed a
  // path that takes ~200ns, intermittently and only under load.
  //
  // Every assertion below is RELATIVE — each compares two measurements taken in
  // the same run, so they experience the same scheduler. An absolute threshold
  // would be load-sensitive and would itself become the flake this file exists to
  // eliminate; that mistake was made here first and cost a red run.
  //
  // The op is a busy-wait whose duration the test controls, so these are real
  // measurements of a real duration rather than mocks.

  /** Burns roughly `ms` milliseconds, so a batch has a known cost. */
  function busy(ms: number): () => void {
    return () => {
      const until = performance.now() + ms;
      while (performance.now() < until) { /* deliberate spin */ }
    };
  }

  // TIMING ARITHMETIC — read this before changing any number below.
  //
  // These two tests spin on the wall clock, so their cost is not a budget you
  // can assume; it is the sum of their own busy-waits. At the durations this
  // file originally used — clean = 1ms, outlier = 50ms — the first test cost
  // 21 × 200 × 1ms = 4,200ms, plus 21 × (199 × 1ms + 50ms) = 5,229ms, i.e.
  // ~9.4 seconds against a 5,000ms default timeout. It could not pass anywhere.
  // The durations are therefore scaled down while every RATIO the assertions
  // depend on is preserved exactly: the outlier stays 50x a clean batch, and
  // the regression case stays 20x. Because both assertions are relative (they
  // compare two measurements taken in the same run), scaling the absolute
  // spin down changes how long the suite takes and nothing about what it
  // asserts — total cost falls from ~13.8s to ~3.7s with the thresholds
  // untouched. Shrinking further would start measuring clock granularity
  // rather than the aggregator, which is the mistake this file exists to undo.
  const CLEAN_MS = 0.2;
  const OUTLIER_MS = CLEAN_MS * 50;
  const CHEAP_MS = 0.02;
  const SLOW_MS = CHEAP_MS * 20;

  it("excludes a single pathological batch — the shape of an OS preemption", () => {
    const uniform = p95PerOp(busy(CLEAN_MS), 20);

    let call = 0;
    // Every batch is clean except one, which is 50x the others — the shape of
    // a single preemption in an otherwise clean run.
    const withOutlier = p95PerOp(() => {
      call += 1;
      busy(call === BATCH ? OUTLIER_MS : CLEAN_MS)();
    }, 20);

    // The outlier batch costs ~1.25x a clean batch once amortised over its 200
    // ops. Had the percentile resolved to the maximum — which it did, when
    // BATCHES was 7 and the floor index landed on 6 — `withOutlier` would carry
    // that cost and fail the <0.5ms budgets that guard this codebase. Excluded,
    // the figure stays at the uniform cost.
    expect(withOutlier).toBeLessThan(uniform * 3);
  });

  it("still reports uniform cost — the shape of a real regression", () => {
    // The counterpart that matters: a slowdown affecting EVERY batch is what a
    // genuine regression looks like, and it must NOT be smoothed away.
    const cheap = p95PerOp(busy(CHEAP_MS), 20);
    const slow = p95PerOp(busy(SLOW_MS), 20);
    // 20x more work per op must show up as a clearly larger measurement even when
    // the machine is busy, because both numbers were taken under the same load.
    expect(slow).toBeGreaterThan(cheap * 4);
  });
});
