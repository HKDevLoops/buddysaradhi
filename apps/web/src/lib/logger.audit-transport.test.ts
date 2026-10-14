// Implements: AGENTS.md §2 Rule 9 (no silent failures) + Rule 7 / BR-SEC-03
// (an audit row is part of the record of a sensitive event, so losing one must
// be impossible to do quietly); 10_Security.md §8 (the audit POST is the sink
// that PERSISTS, so it is the one that must not drop rows on the floor).
//
// THE DEFECT. Both sinks did `void fetch(...).catch(() => {})`. The browser
// branch's comment said "swallow network errors here"; the server branch's said
// "best-effort". Both were `void`, so an audit row could be lost with no retry,
// no signal and no counter — and because the caller gets its normal success
// return either way, the loss is indistinguishable from a delivered write. That
// is the definition of a silent failure.
//
// WHAT IS ASSERTED HERE:
//   1. a transient failure is RETRIED and can still land (no retry → this fails);
//   2. a permanent failure is GIVEN UP ON LOUDLY — `console.error` + a counter —
//      and `log.audit` still does not throw into its caller;
//   3. the retry budget is BOUNDED (3 attempts), not an unbounded retry storm;
//   4. a non-retryable status (404/405 — a misconfigured route, which is what
//      `/api/v1/audit-log` actually is today) is NOT retried, because retrying
//      a 404 is load that can never succeed;
//   5. the happy path is untouched: one 204 → one POST, zero failures.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditTransportFailures, flushAuditTransport, log, resetAuditTransport } from "./logger";

const AUDIT_PATH = "/api/v1/audit-log";

type FetchAttempt = { url: string; body: string };

let attempts: FetchAttempt[] = [];
let errors: string[] = [];

beforeEach(() => {
  attempts = [];
  errors = [];
  resetAuditTransport();
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(async () => {
  // Never leave a queued row (or a pending retry timer) behind for the next file.
  await flushAuditTransport();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(handler: (attempt: number) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const n = attempts.length;
      attempts.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : "",
      });
      return Promise.resolve(handler(n));
    }),
  );
}

const ok = () => new Response(null, { status: 204 });

describe("F-30.2 — an audit row is never dropped in silence", () => {
  it("delivers a healthy audit row exactly once and reports nothing", async () => {
    stubFetch(() => ok());
    log.audit("fee_void_receipt_posted", "Void reversing entry posted", { voidId: "v1" });
    await flushAuditTransport();

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.url).toBe(AUDIT_PATH);
    expect(auditTransportFailures()).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("RETRIES a transient 503 and still lands the row", async () => {
    stubFetch((n) => (n === 0 ? new Response(null, { status: 503 }) : ok()));
    log.audit("cas_conflict_settings", "Settings CAS mismatch", { status: 409 });
    await flushAuditTransport();

    // Two POSTs — the old code made exactly one and never knew it had failed.
    expect(attempts).toHaveLength(2);
    expect(attempts.every((a) => a.url === AUDIT_PATH)).toBe(true);
    expect(attempts[1]?.body).toContain("cas_conflict_settings");
    expect(auditTransportFailures()).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it("RETRIES a network rejection and still lands the row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const n = attempts.length;
        attempts.push({
          url: String(input),
          body: typeof init?.body === "string" ? init.body : "",
        });
        return n === 0
          ? Promise.reject(new Error("fetch failed"))
          : Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    log.audit("pin_failed", "Wrong PIN", {});
    await flushAuditTransport();

    expect(attempts).toHaveLength(2);
    expect(auditTransportFailures()).toBe(0);
  });

  it("GIVES UP LOUDLY on a persistent failure instead of swallowing it", async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    expect(() => log.audit("ledger_void", "Void reversing entry posted", {})).not.toThrow();
    await flushAuditTransport();

    // Visible, counted, and naming the row that was lost.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join("\n")).toContain("[audit_transport_failed]");
    expect(errors.join("\n")).toContain("ledger_void");
    expect(auditTransportFailures()).toBe(1);
  });

  it("bounds the retry budget at 3 attempts — a retry storm is not a fix", async () => {
    stubFetch(() => new Response(null, { status: 503 }));
    log.audit("ledger_void", "Void reversing entry posted", {});
    await flushAuditTransport();

    expect(attempts).toHaveLength(3);
    expect(auditTransportFailures()).toBe(1);
  });

  it("does NOT retry a non-retryable status (a 404 route cannot start working)", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    log.audit("logout_completed", "Signed out", {});
    await flushAuditTransport();

    expect(attempts).toHaveLength(1);
    expect(errors.join("\n")).toContain("[audit_transport_failed]");
    expect(auditTransportFailures()).toBe(1);
  });

  it("reports each lost row separately, so a failure count is a real count", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    log.audit("first_lost", "one", {});
    await flushAuditTransport();
    log.audit("second_lost", "two", {});
    await flushAuditTransport();

    expect(auditTransportFailures()).toBe(2);
  });

  it("never re-enters itself: the failure report does not queue another audit row", async () => {
    stubFetch(() => new Response(null, { status: 404 }));
    log.audit("ledger_void", "Void reversing entry posted", {});
    await flushAuditTransport();

    // Exactly one POST. If `reportAuditLoss` routed back through `log.error`/
    // `log.audit` the queue would grow forever and this would not settle.
    expect(attempts).toHaveLength(1);
  });

  it("starts every row's POST immediately — an audit row must not queue behind another", async () => {
    // This is a pre-existing contract, not a nicety: `logger.test.ts` asserts that
    // two synchronous `log.audit` calls have both POSTed before either resolves.
    stubFetch(() => ok());
    for (const i of [1, 2, 3, 4, 5]) log.audit(`burst_${i}`, "m", { i });
    // No flush yet: all five are already in flight.
    expect(attempts).toHaveLength(5);
    await flushAuditTransport();

    expect(attempts.map((a) => a.body)).toEqual([
      expect.stringContaining('"burst_1"'),
      expect.stringContaining('"burst_2"'),
      expect.stringContaining('"burst_3"'),
      expect.stringContaining('"burst_4"'),
      expect.stringContaining('"burst_5"'),
    ]);
    expect(auditTransportFailures()).toBe(0);
  });

  it("bounds the pending set: a dead transport cannot grow it without limit", async () => {
    // Every attempt hangs, so nothing ever retires and the pending set is the only
    // thing keeping this bounded. Same discipline as the rate limiter's ceiling
    // (F-29): an unbounded pending set is an unbounded-growth leak.
    // A gate the stub can never pass on its own — TS cannot narrow a bare `let`
    // assigned from inside a Promise executor, so it lives on an object.
    const gate: { open: () => void } = { open: () => undefined };
    const held = new Promise<void>((resolve) => {
      gate.open = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        attempts.push({ url: AUDIT_PATH, body: "" });
        return held.then(() => new Response(null, { status: 204 }));
      }),
    );

    for (let i = 0; i < 260; i++) log.audit(`flood_${i}`, "m", { i });

    // Snapshot BEFORE draining, so a failed assertion can never strand the
    // transport holding 260 unresolved promises.
    const postsIssued = attempts.length;
    const overflowReports = errors.filter((e) => e.includes("queue_overflow")).length;
    const failuresAtOverflow = auditTransportFailures();

    gate.open();
    await flushAuditTransport();

    // 260 rows offered, only 200 slots: the 60 oldest were dropped and each drop
    // was REPORTED. The posts still went out (an in-flight attempt is not
    // recalled) — what is bounded is how long the transport remembers them.
    expect(postsIssued).toBe(260);
    expect(overflowReports).toBe(60);
    expect(failuresAtOverflow).toBe(60);
    // And the transport is empty again, not merely quiet.
    await expect(flushAuditTransport()).resolves.toBeUndefined();
  });
});
