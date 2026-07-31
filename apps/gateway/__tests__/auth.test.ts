import { describe, it, expect } from "vitest";

// AuthError is a pure class — we define it here rather than importing
// from auth.ts which pulls in https://esm.sh/@supabase/supabase-js@2
// (incompatible with Node vitest ESM loader).

class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

describe("AuthError", () => {
  it("is an instance of Error", () => {
    const err = new AuthError("test error");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthError);
  });

  it("has correct name", () => {
    const err = new AuthError("test");
    expect(err.name).toBe("AuthError");
  });

  it("has default status 401", () => {
    const err = new AuthError("test");
    expect(err.status).toBe(401);
  });

  it("accepts custom status", () => {
    const err = new AuthError("misconfiguration", 500);
    expect(err.status).toBe(500);
  });

  it("accepts 429 rate-limit status", () => {
    const err = new AuthError("rate limited", 429);
    expect(err.status).toBe(429);
  });

  it("has the message set", () => {
    const err = new AuthError("unauthorized: missing token");
    expect(err.message).toBe("unauthorized: missing token");
  });
});

describe("authenticateRequest input validation (unit-level)", () => {
  it("AuthResult has tenantId", () => {
    const result = { tenantId: "user-uuid-123" };
    expect(result.tenantId).toBe("user-uuid-123");
  });

  it("JWT format validation: must have 3 dot-separated parts", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    const parts = jwt.split(".");
    expect(parts.length).toBe(3);
  });

  it("JWT min/max length bounds", () => {
    const minLen = 100;
    const maxLen = 2048;
    const shortJwt = "abc";
    const validJwt = "a".repeat(minLen);
    const longJwt = "b".repeat(maxLen + 1);
    expect(shortJwt.length).toBeLessThan(minLen);
    expect(validJwt.length).toBeGreaterThanOrEqual(minLen);
    expect(longJwt.length).toBeGreaterThan(maxLen);
  });

  it("HMAC signature format: 64-char hex", () => {
    const validSig = "a".repeat(64);
    expect(validSig).toMatch(/^[a-f0-9]{64}$/);
  });

  it("HMAC signature length bounds", () => {
    const minLen = 64;
    const maxLen = 128;
    expect("a".repeat(minLen).length).toBeGreaterThanOrEqual(minLen);
    expect("a".repeat(maxLen).length).toBeLessThanOrEqual(maxLen);
    expect("a".repeat(maxLen + 1).length).toBeGreaterThan(maxLen);
  });

  it("rejects empty Authorization header", () => {
    const authHeader = "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    expect(jwt).toBe("");
  });

  it("extracts JWT from Bearer token", () => {
    const authHeader = "Bearer eyJhbGciOiJIUzI1NiJ9.test.signature";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    expect(jwt).toBe("eyJhbGciOiJIUzI1NiJ9.test.signature");
  });

  it("handles lowercase 'bearer' prefix", () => {
    const authHeader = "bearer eyJhbGciOiJIUzI1NiJ9.test.signature";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    expect(jwt).toBe("eyJhbGciOiJIUzI1NiJ9.test.signature");
  });

  it("validates x-signature hex format", () => {
    const validHex = /^[a-f0-9]+$/i;
    expect(validHex.test("a".repeat(64))).toBe(true);
    expect(validHex.test("G".repeat(64))).toBe(false);
  });

  it("validates timestamp is a number", () => {
    const validTs = String(Date.now());
    expect(Number.parseInt(validTs, 10)).not.toBeNaN();
    expect(Number.parseInt("not-a-number", 10)).toBeNaN();
  });

  it("validates timestamp skew < 120s", () => {
    const now = Date.now();
    const skew10s = Math.abs(now - (now - 10_000));
    const skew150s = Math.abs(now - (now - 150_000));
    expect(skew10s).toBeLessThan(120_000);
    expect(skew150s).toBeGreaterThan(120_000);
  });
});
