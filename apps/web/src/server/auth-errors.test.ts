// Implements: RFC-003 §1 G-ERR (typed error taxonomy); 10_Security.md §11
// (no open redirect); web/03_Auth_and_Provisioning.md §8.

import { describe, it, expect } from "vitest";
import {
  AuthError,
  authError,
  assertSafeRedirectPath,
  buildProvisionUrl,
  classifyCredentialProbeError,
  parseAuthErrorCode,
} from "./auth-errors";
import { APP_ERROR_CODES } from "@/lib/app-errors";

describe("auth-errors", () => {
  it("emits G-ERR codes the UI mapper knows (A↔D contract)", () => {
    for (const code of ["AUTH_REQUIRED", "DB_NOT_PROVISIONED", "CREDENTIALS_EXPIRED", "NEEDS_PROVISION"] as const) {
      expect(APP_ERROR_CODES).toContain(code);
      expect(authError(code).message.startsWith(`${code}:`)).toBe(true);
    }
  });

  it("AuthError carries code and never a bare string", () => {
    const err = new AuthError("CREDENTIALS_EXPIRED");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("CREDENTIALS_EXPIRED");
    expect(parseAuthErrorCode(err)).toBe("CREDENTIALS_EXPIRED");
  });

  it("parses codes from envelopes and prefixed strings", () => {
    expect(parseAuthErrorCode("DB_NOT_PROVISIONED: User database is not yet provisioned.")).toBe(
      "DB_NOT_PROVISIONED",
    );
    expect(parseAuthErrorCode({ success: false, error: "NEEDS_PROVISION: setup required" })).toBe(
      "NEEDS_PROVISION",
    );
    expect(parseAuthErrorCode({ success: false, code: "PIN_LOCKED" })).toBe("PIN_LOCKED");
    expect(parseAuthErrorCode("something entirely different")).toBeNull();
    expect(parseAuthErrorCode(null)).toBeNull();
  });

  it("accepts same-origin paths, rejects open redirects", () => {
    expect(assertSafeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(assertSafeRedirectPath("/fees?tab=due#row")).toBe("/fees?tab=due#row");
    expect(assertSafeRedirectPath("/signup/provision?next=%2Ffees")).toBe("/signup/provision?next=%2Ffees");
    expect(assertSafeRedirectPath("https://evil.example/x", "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath("//evil.example/x", "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath("javascript:alert(1)", "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath("/\\evil.example", "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath("", "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath(null, "/fallback")).toBe("/fallback");
    expect(assertSafeRedirectPath("/white space", "/fallback")).toBe("/fallback");
  });

  it("builds provision URLs preserving redirect-back intent", () => {
    expect(buildProvisionUrl("/fees")).toBe("/signup/provision?next=%2Ffees");
    expect(buildProvisionUrl("https://evil.example")).toBe("/signup/provision");
    expect(buildProvisionUrl("/signup/provision")).toBe("/signup/provision");
    expect(buildProvisionUrl(undefined)).toBe("/signup/provision");
  });

  it("classifies probe failures: auth-like vs transient", () => {
    expect(classifyCredentialProbeError(new Error("401 Unauthorized"))).toBe("expired-invalid");
    expect(classifyCredentialProbeError(new Error("invalid token: signature expired"))).toBe("expired-invalid");
    expect(classifyCredentialProbeError(new Error("JWT expired"))).toBe("expired-invalid");
    expect(classifyCredentialProbeError(new Error("CREDENTIAL_PROBE_TIMEOUT: Turso probe timed out"))).toBe(
      "transient",
    );
    expect(classifyCredentialProbeError(new Error("fetch failed: ECONNREFUSED"))).toBe("transient");
  });
});
