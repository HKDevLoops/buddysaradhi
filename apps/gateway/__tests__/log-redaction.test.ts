// Implements: 10_Security.md §8 (no secret, credential or card number in a log)
// + AGENTS.md Rule 3 (no telemetry) + Rule 9 (no silent failure).
//
// The previous suite (`log.test.ts`) re-implemented the logger LOCALLY and never
// imported `lib/log.ts`, so the redaction patterns — the one part of that module
// with any security value — were never executed by a single assertion. This file
// imports the real `redact` and pins both directions: what MUST be eaten, and
// what must NOT.
import { describe, it, expect } from "vitest";
import { redact, sanitizeLogData } from "../lib/log.ts";

// Luhn-valid test PANs, one per issuer family the gateway would plausibly see.
const VISA_16 = "4111111111111111";
const VISA_16_SPACED = "4111 1111 1111 1111";
const VISA_16_DASHED = "4111-1111-1111-1111";
const VISA_13 = "4222222222222";
const MASTERCARD_16 = "5555555555554444";
const MASTERCARD_2SERIES = "2223000048410010";
const AMEX_15 = "378282246310005";
const AMEX_SPACED = "3782 822463 10005";
const DISCOVER_16 = "6011111111111117";
const RUPAY_16 = "6521490000000000";

describe("real card numbers are redacted", () => {
  const MUST_REDACT: Array<[string, string]> = [
    ["Visa 16", VISA_16],
    ["Visa 16, space grouped", VISA_16_SPACED],
    ["Visa 16, dash grouped", VISA_16_DASHED],
    ["Visa 13", VISA_13],
    ["Mastercard 51-55", MASTERCARD_16],
    ["Mastercard 2-series", MASTERCARD_2SERIES],
    ["American Express 15", AMEX_15],
    ["American Express, space grouped", AMEX_SPACED],
    ["Discover", DISCOVER_16],
    ["RuPay", RUPAY_16],
  ];

  for (const [label, pan] of MUST_REDACT) {
    it(`${label} is redacted`, () => {
      expect(redact(pan)).toBe("[REDACTED]");
    });

    it(`${label} is redacted inside a log line`, () => {
      const out = redact(`payment accepted for card ${pan} at 12:04`);
      expect(out).not.toContain(pan);
      expect(out.replace(/[\s-]/g, "")).toContain("[REDACTED]");
    });
  }

  it("redacts two cards in one line independently", () => {
    const out = redact(`from ${VISA_16} to ${AMEX_15}`);
    expect(out).not.toContain(VISA_16);
    expect(out).not.toContain(AMEX_15);
    expect(out.match(/\[REDACTED\]/g)).toHaveLength(2);
  });
});

describe("the over-broad pattern is gone: non-card numbers survive", () => {
  // Each of these WAS `[REDACTED]` under the old `(?:\d{4}[- ]){3}\d{4}` rule.
  // A redaction that eats harmless ids while a real PAN in another format walks
  // through teaches a reader that the log is safe when it is not.
  const MUST_SURVIVE: Array<[string, string]> = [
    ["a 16-digit sequential run", "1234567890123456"],
    ["a 16-digit run starting 9", "9876543210987654"],
    ["a 16-digit nanosecond timestamp", "1767225600123456"],
    ["a UUID-shaped tenant id", "018f0000-0000-7000-8000-000000000001"],
    ["a Turso-style group id", "gmqwdnvbfnwpzpctwvho00000001"],
    ["a 13-digit epoch millis", "1767225600123"],
    ["an 11-digit libsql id", "12345678901"],
  ];

  for (const [label, value] of MUST_SURVIVE) {
    it(`${label} is left intact`, () => {
      expect(redact(value)).toBe(value);
    });
  }

  it("a non-card run is not redacted even when dash-grouped like a card", () => {
    const value = "1234-5678-9012-3456";
    expect(redact(value)).toBe(value);
  });

  it("a 16-digit run whose Luhn checksum fails is not redacted", () => {
    // Real cards fail Luhn ~90% of the time; an id that is 16 digits long is
    // far more likely to be an id. The issuer prefix check is the second gate.
    const notLuhn = "1234567890123456";
    expect(redact(notLuhn)).toBe(notLuhn);
  });

  it("a 19-digit run is not a card unless Luhn-valid AND correctly prefixed", () => {
    expect(redact("1234567890123456789")).toBe("1234567890123456789");
  });

  it("an ISO date is never mistaken for a card, an SSN, or a phone number", () => {
    for (const d of ["2026-01-04", "2026-12-31", "2026-10-04"]) {
      expect(redact(d)).toBe(d);
    }
  });

  it("a HTTP status line is not eaten", () => {
    expect(redact("status=500 durationMs=12")).toBe("status=500 durationMs=12");
  });
});

describe("the other redactions are kept", () => {
  it("passwords, secrets, tokens and keys", () => {
    expect(redact("password: hunter2")).not.toContain("hunter2");
    expect(redact("secret=abc123")).not.toContain("abc123");
    expect(redact("api_key: sk-live-9f8a")).not.toContain("sk-live-9f8a");
    expect(redact("x-db-token=eyJhbGciOi")).not.toContain("eyJhbGciOi");
    expect(redact("authorization: Bearer eyJhbGciOiJIUzI1")).not.toContain("eyJhbGciOiJIUzI1");
  });
  it("email addresses", () => {
    expect(redact("tutor kabir@example.com logged in")).not.toContain("kabir@example.com");
  });

  it("a Bearer credential is eaten whole, not just the scheme word", () => {
    // The `key: value` pattern stops at the first space, so `authorization:
    // Bearer <jwt>` used to log the JWT verbatim. Asserted explicitly: the
    // token itself must be gone, not merely the word "Bearer".
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig";
    const out = redact(`authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("eyJhbGciOi");
    expect(redact(`Bearer ${jwt}`)).toBe("[REDACTED]");
  });

  it("SSNs in their canonical dashed and dotted forms", () => {
    expect(redact("ssn 123-45-6789 on file")).not.toContain("123-45-6789");
    expect(redact("ssn 123.45.6789 on file")).not.toContain("123.45.6789");
  });

  it("Indian mobile numbers, with and without a +91 prefix", () => {
    expect(redact("parent 9876543210 called")).not.toContain("9876543210");
    expect(redact("parent +919876543210 called")).not.toContain("919876543210");
  });

  it("a 10-digit run starting 1-5 is NOT treated as a phone number", () => {
    // Ambiguity resolved toward leaving data in: a numeric id that happens to
    // start 1-5 stays readable.
    expect(redact("ref 1234567890")).toBe("ref 1234567890");
  });

  it("libsql URLs and credential-bearing URLs", () => {
    expect(redact("db libsql://tenant-abc.turso.io")).not.toContain("turso.io");
    expect(redact("https://user:pw@example.com/x")).not.toContain("user:pw");
  });

  it("redaction is order-independent enough that a PAN inside a longer line still goes", () => {
    const out = redact(`took ${VISA_16} from kabir@example.com and ${MASTERCARD_16} from 9876543210`);
    expect(out).not.toContain(VISA_16);
    expect(out).not.toContain(MASTERCARD_16);
    expect(out).not.toContain("kabir@example.com");
    expect(out).not.toContain("9876543210");
  });
});

describe("sanitizeLogData — the log-entry wrapper", () => {
  it("redacts string values", () => {
    const out = sanitizeLogData({ message: `card ${VISA_16} declined` });
    expect(String(out.message)).not.toContain(VISA_16);
  });

  it("collapses objects to [OBJECT] so a payload is never dumped", () => {
    expect(sanitizeLogData({ payload: { card: VISA_16 } }).payload).toBe("[OBJECT]");
  });

  it("passes numbers and booleans through untouched (no float coercion)", () => {
    const out = sanitizeLogData({ amountPaise: 123456, ok: true, nothing: null });
    expect(out.amountPaise).toBe(123456);
    expect(out.ok).toBe(true);
    expect(out.nothing).toBeNull();
  });

  it("truncates a very long line", () => {
    const out = sanitizeLogData({ message: "x".repeat(900) });
    expect(String(out.message).length).toBe(503);
    expect(String(out.message).endsWith("...")).toBe(true);
  });

  it("a 10k-character overflow line is not returned whole", () => {
    const out = sanitizeLogData({ message: `${VISA_16} ${"y".repeat(10_000)}` });
    expect(String(out.message).length).toBeLessThanOrEqual(503);
  });
});
