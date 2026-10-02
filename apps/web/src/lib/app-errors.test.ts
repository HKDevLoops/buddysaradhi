// Implements: RFC-003 §1 G-ERR — app-errors mapper cases (incl. digest-input safety)
import { describe, expect, it } from "vitest";
import { extractServerCode, toAppErrorState } from "./app-errors";

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
