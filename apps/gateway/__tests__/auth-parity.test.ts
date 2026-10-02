// Implements: RFC-003 workstream E §1 (auth parity — expiry-aware typed 401s) +
// 17_API_Gateway_System.md §8 (typed error contract) + G-ERR taxonomy.
//
// Scope note: lib/auth.ts and index.ts import Supabase/Deno entrypoints that
// vitest cannot load (see __tests__/auth.test.ts), so the 401-code matrix is
// asserted at the seam index.ts relays — lib/errors.ts (`fail`,
// `failZod`, `isTursoAuthFailure`) — plus the AuthError code contract shape.
// The middleware wiring (missing creds → DB_NOT_PROVISIONED, Turso rejection
// → CREDENTIALS_EXPIRED) is reviewed against index.ts in the status audit.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fail, failZod, isTursoAuthFailure } from "../lib/errors.ts";

interface FailBody {
  success: boolean;
  error: string;
  details?: string;
}

async function failBody(res: Response): Promise<FailBody> {
  return (await res.json()) as FailBody;
}

describe("auth parity — typed 401 code matrix (RFC-003 G-AUTH/G-ERR)", () => {
  it("missing credentials relay as 401 DB_NOT_PROVISIONED (was 400 bad request)", async () => {
    const res = fail("DB_NOT_PROVISIONED: tenant database not provisioned", 401);
    expect(res.status).toBe(401);
    const body = await failBody(res);
    expect(body.success).toBe(false);
    expect(body.error.startsWith("DB_NOT_PROVISIONED")).toBe(true);
  });

  it("invalid signature relays as 401 UNAUTHENTICATED", async () => {
    const res = fail("UNAUTHENTICATED: signature verification failed", 401);
    expect(res.status).toBe(401);
    expect((await failBody(res)).error.startsWith("UNAUTHENTICATED")).toBe(true);
  });

  it("expired session relays as 401 UNAUTHENTICATED (web → re-login state)", async () => {
    const res = fail("UNAUTHENTICATED: session expired or invalid; sign in again", 401);
    expect(res.status).toBe(401);
    expect((await failBody(res)).error.startsWith("UNAUTHENTICATED")).toBe(true);
  });

  it("tenant DB token rejection relays as 401 CREDENTIALS_EXPIRED naming re-provision", async () => {
    const res = fail(
      "CREDENTIALS_EXPIRED: tenant database credential rejected; re-provision required",
      401,
    );
    expect(res.status).toBe(401);
    const body = await failBody(res);
    // The `credential` redaction must not eat the code prefix itself.
    expect(body.error.startsWith("CREDENTIALS_EXPIRED")).toBe(true);
    expect(body.error).toContain("re-provision");
  });

  it("rate limiting relays as 429 RATE_LIMITED", async () => {
    const res = fail("RATE_LIMITED: too many requests", 429);
    expect(res.status).toBe(429);
    expect((await failBody(res)).error.startsWith("RATE_LIMITED")).toBe(true);
  });
});

describe("isTursoAuthFailure — expired/invalid tenant DB token → 401, never 500", () => {
  it("maps Turso pipeline HTTP 401/403 to auth failure", () => {
    expect(isTursoAuthFailure(new Error("Turso pipeline HTTP 401: unauthorized"))).toBe(true);
    expect(isTursoAuthFailure(new Error("Turso pipeline HTTP 403: forbidden"))).toBe(true);
  });

  it("maps libSQL auth-failure message shapes to auth failure", () => {
    expect(isTursoAuthFailure(new Error("invalid auth token"))).toBe(true);
    expect(isTursoAuthFailure(new Error("Token expired"))).toBe(true);
    expect(isTursoAuthFailure(new Error("authentication failed"))).toBe(true);
    expect(isTursoAuthFailure(new Error("jwt expired"))).toBe(true);
  });

  it("does NOT map statement or constraint errors to auth failure", () => {
    expect(isTursoAuthFailure(new Error("no such table: ledger_entries"))).toBe(false);
    expect(isTursoAuthFailure(new Error("UNIQUE constraint failed: invoices.number"))).toBe(false);
    expect(isTursoAuthFailure(new Error("Turso pipeline HTTP 500: internal"))).toBe(false);
    expect(isTursoAuthFailure(new Error("statement failed: syntax error"))).toBe(false);
  });
});

describe("failZod — typed 400 VALIDATION with field details (Rule 9)", () => {
  it("returns VALIDATION with the failing path in details", async () => {
    const schema = z.object({ amount: z.number().int().positive() });
    const parsed = schema.safeParse({ amount: 12.99 });
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error("unreachable");
    const res = failZod(parsed.error);
    expect(res.status).toBe(400);
    const body = await failBody(res);
    expect(body.success).toBe(false);
    expect(body.error).toBe("VALIDATION");
    expect(body.details).toContain("amount");
  });
});

describe("no secret echo in typed errors (10_Security.md §8)", () => {
  it("redacts bearer tokens and db credentials from the detail, keeps the code", async () => {
    const res = fail(
      "UNAUTHENTICATED: rejected x-db-token=abc123 and Authorization: Bearer xyz",
      401,
    );
    const body = await failBody(res);
    expect(body.error.startsWith("UNAUTHENTICATED")).toBe(true);
    // Secret VALUES and credential PAIRS never survive; the scheme word may
    // remain with a redacted credential (no key material to replay).
    expect(body.error).not.toContain("abc123");
    expect(body.error).not.toContain("xyz");
    expect(body.error).toContain("Bearer [REDACTED]");
    expect(body.error).not.toMatch(/x-db-token\s*=\s*\S+/i);
  });

  it("never emits stacks or SQL in the client body", async () => {
    const res = fail("VALIDATION: bad input", 400);
    const raw = await res.text();
    expect(raw).not.toMatch(/at\s+\w+\s*\(/);
    expect(raw).not.toMatch(/SELECT|INSERT|sqlite/i);
  });
});
