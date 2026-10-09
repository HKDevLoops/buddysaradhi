// Implements: RFC-003 §1 G-ERR — app-errors mapper cases (incl. digest-input safety)
// 08_Settings.md §13/§14 + AGENTS.md §2 Rule 9 — a VALUE-gate refusal must reach
// the tutor with its own reason, not as UNKNOWN.
import { describe, expect, it } from "vitest";
import { extractServerCode, toAppErrorState, validationDetail } from "./app-errors";

describe("extractServerCode", () => {
  it.each([
    ["AUTH_REQUIRED: No session", "AUTH_REQUIRED"],
    ["DB_NOT_PROVISIONED: User database is not yet provisioned.", "DB_NOT_PROVISIONED"],
    ["CREDENTIALS_EXPIRED: token no longer valid", "CREDENTIALS_EXPIRED"],
    ["NEEDS_PROVISION - account requires provisioning", "NEEDS_PROVISION"],
    ["VALIDATION: pin must be 4-8 digits", "VALIDATION"],
    ["CONFLICT: duplicate student", "CONFLICT"],
    ["UPSTREAM: gateway timeout", "UPSTREAM"],
    ["NOT_FOUND: student gone", "NOT_FOUND"],
  ] as const)("maps explicit prefix %s", (input, expected) => {
    expect(extractServerCode(input)).toBe(expected);
  });

  it("classifies heuristic text without a prefix", () => {
    expect(extractServerCode("Student not found")).toBe("NOT_FOUND");
    expect(extractServerCode("Session is locked. Unlock it to edit.")).toBe("CONFLICT");
    expect(extractServerCode("Failed to fetch")).toBe("UPSTREAM");
    expect(extractServerCode("jwt expired")).toBe("CREDENTIALS_EXPIRED");
  });

  it("returns null for empty or unclassifiable text", () => {
    expect(extractServerCode("")).toBeNull();
    expect(extractServerCode("???")).toBeNull();
  });
});

describe("toAppErrorState", () => {
  it("accepts Error objects, strings, and { success: false } envelopes", () => {
    expect(toAppErrorState(new Error("AUTH_REQUIRED: nope")).code).toBe("AUTH_REQUIRED");
    expect(toAppErrorState("DB_NOT_PROVISIONED: nope").code).toBe("DB_NOT_PROVISIONED");
    expect(toAppErrorState({ success: false, error: "Student not found" }).code).toBe(
      "NOT_FOUND",
    );
  });

  it("maps Next.js digest-only failures to a safe UPSTREAM state", () => {
    const digest = new Error("Something went wrong");
    (digest as { digest?: string }).digest = "NEXT-12345-abcdef";
    const state = toAppErrorState(digest);
    expect(state.code).toBe("UPSTREAM");
    expect(state.action).toBe("retry");
    expect(state.message).not.toContain("NEXT-12345-abcdef");
  });

  it("maps bare { digest } objects without echoing the digest", () => {
    const state = toAppErrorState({ digest: "BARE-DIGEST-999" });
    expect(state.code).toBe("UPSTREAM");
    expect(`${state.title} ${state.message}`).not.toContain("BARE-DIGEST-999");
  });

  it("never echoes raw payloads, stacks, or PII-bearing text", () => {
    const raw =
      "Error: secret=db_tok_abc123 phone=+91-98000-00000\n    at fetchStudent (stack trace here)";
    const state = toAppErrorState(new Error(raw));
    const rendered = `${state.title} ${state.message}`;
    expect(rendered).not.toContain("db_tok_abc123");
    expect(rendered).not.toContain("+91-98000-00000");
    expect(rendered).not.toContain("at fetchStudent");
    expect(rendered).not.toContain(raw);
  });

  it("falls back to a generic contact state for unknown input", () => {
    for (const input of [undefined, null, 42, {}, { success: false }]) {
      const state = toAppErrorState(input);
      expect(state.code).toBe("UNKNOWN");
      expect(state.action).toBe("contact");
    }
  });

  it("exposes the re-login / provision / retry affordances per code", () => {
    expect(toAppErrorState("AUTH_REQUIRED: x").action).toBe("re-login");
    expect(toAppErrorState("CREDENTIALS_EXPIRED: x").action).toBe("re-login");
    expect(toAppErrorState("DB_NOT_PROVISIONED: x").action).toBe("provision");
    expect(toAppErrorState("NEEDS_PROVISION: x").action).toBe("provision");
    expect(toAppErrorState("UPSTREAM: x").action).toBe("retry");
    expect(toAppErrorState("VALIDATION: x").action).toBe("retry");
    expect(toAppErrorState("CONFLICT: x").action).toBe("retry");
  });
});

/**
 * 08 §13/§14 — the value gate's refusals, verbatim. Every string below is one
 * `SETTING_VALUE_SCHEMAS` actually produces (`server/actions/settings.ts`).
 *
 * Before the audit these four fell through to UNKNOWN, so the Profile card
 * rendered "Please try again. If this keeps happening, contact support" for a
 * `null` address the tutor never touched. Rule 9 twice over: the refusal, and
 * then the silence.
 */
describe("a real settings VALUE-gate refusal is never degraded to UNKNOWN", () => {
  const REFUSALS = [
    "instituteAddress: Expected string, received null",
    "attendanceLockHours: Expected number, received string",
    "institutePhone: Use a phone number of 6 to 15 digits, optionally starting with +",
    "currencyCode: Use a three-letter currency code such as INR",
    "invoicePrefix: Prefix must be alphanumeric (letters, digits, hyphen)",
    "receiptPrefix: Prefix must be alphanumeric (letters, digits, hyphen)",
    "nextInvoiceSeq is maintained by the app and cannot be set directly.",
    "No valid settings fields",
  ] as const;

  it.each(REFUSALS)("classifies %s as VALIDATION, not UNKNOWN", (refusal) => {
    const state = toAppErrorState(new Error(refusal));
    expect(state.code, "a refusal about a value is not an unknown crash").toBe("VALIDATION");
    expect(state.code).not.toBe("UNKNOWN");
    expect(state.action).toBe("retry");
    expect(state.message).not.toMatch(/contact support/i);
  });

  it.each([
    ["instituteAddress: Expected string, received null", "Expected string, received null"],
    [
      "institutePhone: Use a phone number of 6 to 15 digits, optionally starting with +",
      "Use a phone number of 6 to 15 digits, optionally starting with +",
    ],
    ["currencyCode: Use a three-letter currency code such as INR", "Use a three-letter currency code such as INR"],
    [
      "invoicePrefix: Prefix must be alphanumeric (letters, digits, hyphen)",
      "Prefix must be alphanumeric (letters, digits, hyphen)",
    ],
  ])("surfaces the reason verbatim for %s", (refusal, expectedDetail) => {
    const state = toAppErrorState(new Error(refusal));
    expect(state.detail).toBe(expectedDetail);
    expect(state.message).toContain(expectedDetail);
  });

  it("still refuses to echo anything that is not one of our own sentences", () => {
    const hostile = [
      // A raw driver message that happens to start with a field-shaped token.
      "students: SQLITE_CONSTRAINT: NOT NULL constraint failed: students.tenant_id\n    at insertStudent (x.ts:1:1)",
      // Credential-bearing text wearing the same shape.
      "tenant: db_token=tok_live_abc123",
      // A URL, which no Zod message in this repo produces.
      "settings: Expected https://example.com/x",
    ];
    for (const raw of hostile) {
      expect(validationDetail(raw), raw).toBeNull();
    }
    const state = toAppErrorState(new Error(hostile[0]!));
    expect(state.detail).toBeUndefined();
    expect(state.message).not.toContain("SQLITE_CONSTRAINT");
    expect(state.message).not.toContain("insertStudent");
  });

  it("never attaches a detail to a non-VALIDATION state", () => {
    for (const input of ["AUTH_REQUIRED: session expired", "CONFLICT: duplicate student"]) {
      expect(toAppErrorState(input).detail, input).toBeUndefined();
    }
  });
});

describe("GW-TAXONOMY-08 — codes the gateway emits must be classifiable", () => {
  // Two codes the product genuinely emits were absent from APP_ERROR_CODES, so
  // `toAppErrorState` fell through to UNKNOWN — whose only affordance is
  // "contact support". Both were recoverable conditions:
  //
  //   UNAUTHENTICATED          an expired session  -> should re-login
  //   DASHBOARD_GATEWAY_FAILED a gateway blip       -> should retry
  //
  // Sending a tutor to support for either is a defect in its own right, and it is
  // the same failure mode the raw-error work addressed: the error path that cannot
  // classify itself is an error path that cannot be acted on.
  it("classifies an expired session as re-login, not contact-support", () => {
    const state = toAppErrorState(new Error("UNAUTHENTICATED: signature verification failed"));
    expect(state.code).toBe("UNAUTHENTICATED");
    expect(state.action).toBe("re-login");
    expect(state.message).not.toMatch(/contact support/i);
  });

it("classifies a refused dashboard gateway read as retry, not contact-support", () => {
    // The client throws `res.code`, not the prose `res.error` (dashboard-client.tsx
    // queryFn), so the code reaches the mapper intact. It resolves to UPSTREAM —
    // same retry affordance — because the widening pattern also matches "gateway".
    // Asserting the AFFORDANCE rather than the exact code is the honest assertion:
    // what a tutor gets is "check your connection and retry", not "contact support".
    const state = toAppErrorState(new Error("DASHBOARD_GATEWAY_FAILED"));
    expect(state.action).toBe("retry");
    expect(state.code).not.toBe("UNKNOWN");
    expect(state.message).not.toMatch(/contact support/i);
  });

  it("every code this app can raise classifies to something other than UNKNOWN", () => {
    // A guard for the family, not just the two instances: any code the server
    // emits must map to a real affordance.
    const raised = [
      "AUTH_REQUIRED",
      "UNAUTHENTICATED",
      "DB_NOT_PROVISIONED",
      "CREDENTIALS_EXPIRED",
      "NEEDS_PROVISION",
      "VALIDATION",
      "CONFLICT",
      "UPSTREAM",
      "DASHBOARD_GATEWAY_FAILED",
      "NOT_FOUND",
    ];
    for (const code of raised) {
      const state = toAppErrorState(new Error(`${code}: something happened`));
      expect(state.code, `${code} degraded to UNKNOWN`).not.toBe("UNKNOWN");
    }
  });

  it("still degrades an unrecognised code to UNKNOWN", () => {
    // The guard above must not make the mapper accept everything.
    const state = toAppErrorState(new Error("SOMETHING_ELSE: mystery"));
    expect(state.code).toBe("UNKNOWN");
    expect(state.action).toBe("contact");
  });
});
