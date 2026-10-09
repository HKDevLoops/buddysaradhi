// Implements: 10_Security.md §8 (no secret, credential, PIN, email or card number
// in a log line) + AGENTS.md §2 Rule 9 (the logger must not leak by accident).
//
// This suite is the contract for BOTH sinks: `apps/gateway/lib/log.ts` (which
// re-exports `redact`/`sanitizeLogData` from here through its edge vendored copy)
// and `apps/web/src/lib/logger.ts` (which runs `redactLogContext` over every
// entry before the `console.*` line and before the `/api/v1/audit-log` POST).
import { describe, it, expect } from "vitest";
import {
  MAX_LOG_DEPTH,
  MAX_LOG_STRING,
  REDACTED,
  isSensitiveLogKey,
  redact,
  redactLogContext,
  redactLogValue,
  sanitizeLogData,
} from "./redact";

const VISA_16 = "4111111111111111";
const AMEX_15 = "378282246310005";
const TENANT_UUID = "018f0000-0000-7000-8000-000000000001";
const STUDENT_UUID = "3f7c9a52-6b1e-4d0a-9c33-8b2f5e7a1d44";

describe("redact — the string rules (gateway parity)", () => {
  it("eats a whole bearer credential, not just the scheme word", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig";
    const out = redact(`authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("eyJhbGciOi");
    expect(redact(`Bearer ${jwt}`)).toBe(REDACTED);
  });

  it("eats credentials named by a key/value pair", () => {
    expect(redact("password: hunter2")).not.toContain("hunter2");
    expect(redact("secret=abc123")).not.toContain("abc123");
    expect(redact("api_key: sk-live-9f8a")).not.toContain("sk-live-9f8a");
    expect(redact("x-db-token=eyJhbGciOi")).not.toContain("eyJhbGciOi");
  });

  it("eats an email address and a real PAN", () => {
    expect(redact("tutor kabir@example.com logged in")).not.toContain("kabir@example.com");
    expect(redact(`card ${VISA_16} declined`)).not.toContain(VISA_16);
    expect(redact(`card ${AMEX_15} declined`)).not.toContain(AMEX_15);
  });

  it("eats an SSN, an Indian mobile and a credential-bearing URL", () => {
    expect(redact("ssn 123-45-6789 on file")).not.toContain("123-45-6789");
    expect(redact("parent 9876543210 called")).not.toContain("9876543210");
    expect(redact("db libsql://tenant-abc.turso.io")).not.toContain("turso.io");
    expect(redact("https://user:pw@example.com/x")).not.toContain("user:pw");
  });

  it("leaves ids, dates and non-card digit runs alone", () => {
    // A UUID is preserved as a STRING here on purpose — it is the context gate's
    // job to decide whether a UUID is a correlation id or an opaque handle, and
    // it does that by key name. The gateway's stdout line has no key, so this
    // layer stays shape-only.
    expect(redact(TENANT_UUID)).toBe(TENANT_UUID);
    expect(redact("1234567890123456")).toBe("1234567890123456");
    expect(redact("2026-01-04")).toBe("2026-01-04");
    expect(redact("status=500 durationMs=12")).toBe("status=500 durationMs=12");
  });
});

describe("sanitizeLogData — the gateway's flat entry sanitizer", () => {
  it("redacts and bounds string values", () => {
    const out = sanitizeLogData({ message: `card ${VISA_16} declined`, blob: "y".repeat(10_000) });
    expect(String(out.message)).not.toContain(VISA_16);
    expect(String(out.blob).length).toBe(MAX_LOG_STRING + 3);
    expect(String(out.blob).endsWith("...")).toBe(true);
  });

  it("collapses objects so a payload is never dumped", () => {
    expect(sanitizeLogData({ payload: { card: VISA_16 } }).payload).toBe("[OBJECT]");
  });

  it("passes numbers, booleans and null through untouched", () => {
    const out = sanitizeLogData({ amountPaise: 123456, ok: true, nothing: null });
    expect(out.amountPaise).toBe(123456);
    expect(out.ok).toBe(true);
    expect(out.nothing).toBeNull();
  });
});

describe("gate 1 — a context key that names a credential drops its value whole", () => {
  const MUST_REDACT: Array<[string, string]> = [
    ["E2E_PASSWORD", "hunter2"],
    ["instituteEmail", "kabir@example.com"],
    ["accessToken", "eyJhbGciOiJIUzI1NiJ9"],
    ["refresh_token", "rt_9f8a7b6c"],
    ["pin", "135790"],
    ["dbToken", "eyJTdXJzbyI6InR1cnNvIn0"],
    ["x-db-url", "libsql://tenant-abc.turso.io"],
    ["authorization", "Bearer eyJhbGciOiJIUzI1NiJ9"],
    ["sessionSecret", "s3cr3t"],
    ["signingKey", "-----BEGIN PRIVATE KEY-----"],
    ["parentPhone", "9876543210"],
    ["cardLast4Hint", "1111"],
  ];

  for (const [key, value] of MUST_REDACT) {
    it(`${key} is redacted regardless of the value's shape`, () => {
      expect(isSensitiveLogKey(key)).toBe(true);
      const out = redactLogContext({ [key]: value });
      expect(out[key]).toBe(REDACTED);
      expect(JSON.stringify(out)).not.toContain(value);
    });
  }

  it("redacts a credential nested inside an otherwise-safe object", () => {
    const out = redactLogContext({ detail: { studentId: STUDENT_UUID, E2E_PASSWORD: "hunter2" } });
    expect(JSON.stringify(out)).not.toContain("hunter2");
  });
});

describe("gate 2 — a bare UUID is an opaque handle unless the key says it is a correlation id", () => {
  it("a UUID under an ordinary key is dropped", () => {
    const out = redactLogContext({ opaqueHandle: TENANT_UUID });
    expect(out.opaqueHandle).toBe(REDACTED);
    expect(JSON.stringify(out)).not.toContain(TENANT_UUID);
  });

  it("a UUID under a correlation-id key survives verbatim", () => {
    // These are the identifiers the audit row exists to join on (`LogContext`:
    // "ids, counts, status codes"). Redacting them would delete the audit trail's
    // entire purpose, so they are allow-listed BY KEY, not by shape.
    const out = redactLogContext({
      studentId: STUDENT_UUID,
      tenantId: TENANT_UUID,
      entryIdToVoid: STUDENT_UUID,
      sessionId: TENANT_UUID,
    });
    expect(out.studentId).toBe(STUDENT_UUID);
    expect(out.tenantId).toBe(TENANT_UUID);
    expect(out.entryIdToVoid).toBe(STUDENT_UUID);
    expect(out.sessionId).toBe(TENANT_UUID);
  });
});

describe("gate 3 — a secret pasted into a safe key is still eaten", () => {
  it("redacts a credential embedded in a free-text value", () => {
    const out = redactLogContext({ reason: "reset with password: hunter2", path: "/api/v1/audit-log" });
    expect(String(out.reason)).not.toContain("hunter2");
    expect(out.path).toBe("/api/v1/audit-log");
  });

  it("redacts an email and a PAN embedded in a free-text value", () => {
    const out = redactLogContext({ detail: `owner kabir@example.com paid with ${VISA_16}` });
    expect(String(out.detail)).not.toContain("kabir@example.com");
    expect(String(out.detail)).not.toContain(VISA_16);
  });
});

describe("legitimate context survives intact", () => {
  it("counts, booleans, null, enums and status codes are untouched", () => {
    const context = {
      studentId: STUDENT_UUID,
      amountMinor: 30000,
      excessPaise: 0,
      cacheHit: true,
      dryRun: false,
      missing: null,
      status: 409,
      method: "PATCH",
      path: "/api/v1/settings",
      field: "instituteName",
      batch_created: true,
    };
    expect(redactLogContext(context)).toEqual(context);
  });

  it("a non-UUID opaque reference (a Turso shard id) survives", () => {
    const out = redactLogContext({ shard: "gmqwdnvbfnwpzpctwvho00000001" });
    expect(out.shard).toBe("gmqwdnvbfnwpzpctwvho00000001");
  });

  it("an array of safe values is preserved element-wise", () => {
    const out = redactLogContext({ ids: [STUDENT_UUID, TENANT_UUID] });
    expect(out.ids).toEqual([REDACTED, REDACTED]);
  });
});

describe("structural safety — a log call must never become the crash (Rule 9)", () => {
  it("a cyclic context is cut, not thrown", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const out = redactLogContext(cyclic);
    expect(out.name).toBe("loop");
    expect(JSON.stringify(out)).toContain("[CIRCULAR]");
  });

  it("nesting deeper than MAX_LOG_DEPTH is cut", () => {
    let deep: Record<string, unknown> = { value: "bottom" };
    for (let i = 0; i < MAX_LOG_DEPTH + 2; i++) deep = { child: deep };
    expect(JSON.stringify(redactLogValue(deep))).toContain("[MAX_DEPTH]");
  });

  it("values JSON.stringify would throw on are made serialisable", () => {
    const out = redactLogContext({
      big: 9007199254740993n,
      fn: () => undefined,
      sym: Symbol("s"),
      when: new Date("2026-01-04T00:00:00.000Z"),
      err: new Error("password: hunter2"),
      map: new Map([["k", "v"]]),
      nan: Number.NaN,
    });
    expect(() => JSON.stringify(out)).not.toThrow();
    expect(out.big).toBe("9007199254740993");
    expect(out.when).toBe("2026-01-04T00:00:00.000Z");
    expect(String((out.err as { message: string }).message)).not.toContain("hunter2");
    expect(out.nan).toBe(REDACTED);
  });

  it("a very long value is bounded", () => {
    const out = redactLogContext({ detail: "z".repeat(10_000) });
    expect(String(out.detail).length).toBe(MAX_LOG_STRING + 3);
  });

  it("an undefined context becomes an empty object, never a crash", () => {
    expect(redactLogContext(undefined)).toEqual({});
  });
});