// Implements: 10_Security.md §8 (no SQL text, stack, file path or upstream
// payload ever reaches a client) + RFC-003 G-ERR (the typed `CODE: detail`
// contract apps/web parses) + AGENTS.md Rule 9 (every failure is typed; none is
// swallowed).
//
// THIS FILE REPLACES the previous `errors.test.ts`, which defined its OWN local
// `json`/`ok`/`fail` and then asserted against them — it never imported
// `lib/errors.ts`, so it proved nothing about the shipped module, and it
// recorded `Access-Control-Allow-Origin: *` as if it were the contract. A test
// that cannot fail is worse than no test. Everything below imports the real
// module. (The CORS allowlist itself is covered in `cors-allowlist.test.ts`.)
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { json, ok, fail, failZod, failValidation, securityFail, isTursoAuthFailure } from "../lib/errors.ts";

async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe("the response envelope", () => {
  it("ok() wraps the payload in { success, data }", async () => {
    const res = ok({ id: "s-1" });
    expect(res.status).toBe(200);
    expect(await body(res)).toEqual({ success: true, data: { id: "s-1" } });
  });

  it("ok() honours a custom status", () => {
    expect(ok({}, 201).status).toBe(201);
  });

  it("json() returns the raw body, unwrapped", async () => {
    const res = json({ key: "value" }, 202);
    expect(res.status).toBe(202);
    expect(await body(res)).toEqual({ key: "value" });
  });

  it("fail() is { success: false, error }", async () => {
    const res = fail("not_found", 404);
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ success: false, error: "not_found" });
  });

  it("every response is application/json", () => {
    for (const res of [ok({}), json({}), fail("x"), failValidation("x"), securityFail(403)]) {
      expect(res.headers.get("Content-Type")).toBe("application/json");
    }
  });

  it("securityFail carries only the generic message and the requestId", async () => {
    const res = securityFail(429, "req-7");
    expect(res.status).toBe(429);
    expect(await body(res)).toEqual({ success: false, error: "too many requests", requestId: "req-7" });
  });
});

describe("failZod / failValidation — the web's dispatch contract", () => {
  it("failZod emits the bare VALIDATION code the web switches on, plus a field detail", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse({ name: "" });
    expect(parsed.success).toBe(false);
    const res = failZod((parsed as { error: z.ZodError }).error);
    expect(res.status).toBe(400);
    const out = await body<{ error: string; details: string }>(res);
    // The code must be BARE — the web does `code === "VALIDATION"`.
    expect(out.error).toBe("VALIDATION");
    expect(out.details).toContain("name");
  });

  it("failValidation never echoes the offending value", async () => {
    const secretish = "eyJhbGciOiJIUzI1NiJ9.dontlogme";
    const res = failValidation(`Idempotency-Key ${secretish} is not a UUID`);
    const out = await body<{ error: string; details: string }>(res);
    expect(out.error).toBe("VALIDATION");
    expect(out.details).toContain("not a UUID");
  });
});

describe("sanitizeError — nothing internal ever reaches the client (10_Security.md §8)", () => {
  const FORBIDDEN: Array<[string, string]> = [
    ["SQL text", "no such column: balance_paise"],
    ["a SELECT statement", "SELECT * FROM students WHERE tenant_id = ?"],
    ["a stack frame", "at Object.postLedgerEntry (file:///apps/gateway/lib/ledger.ts:88:11)"],
    ["a file path", "Z:/Projects/buddysaradhi/apps/gateway/lib/sql.ts:412"],
    ["a db url", "libsql://tenant-abc.turso.io"],
    ["a db token", "eyJhbGciOiJIUzI1NiJ9.supersecret.signature"],
    ["a bearer credential", "Bearer eyJhbGciOiJIUzI1NiJ9.supersecret.signature"],
    ["a PIN hash", "pin_hash=$argon2id$v=19$m=65536"],
    ["a client IP", "forwarded for 203.0.113.42"],
    ["a tenant uuid", "tenant 018f0000-0000-7000-8000-000000000001 rejected"],
  ];

  for (const [label, payload] of FORBIDDEN) {
    it(`a 500 carrying ${label} is replaced by the generic message`, async () => {
      const res = fail(payload, 500);
      expect(res.status).toBe(500);
      const { error } = await body<{ error: string }>(res);
      expect(error).toBe("internal server error");
      expect(error).not.toContain("SELECT");
      expect(error).not.toContain("argon2");
      expect(error).not.toContain("203.0.113.42");
      expect(error).not.toContain("turso");
    });
  }

  it("a 5xx message is never longer than the generic string, whatever it carried", async () => {
    const res = fail("x".repeat(5000), 500);
    expect(String((await body<{ error: string }>(res)).error).length).toBeLessThan(40);
  });

  it("a 4xx keeps its typed CODE prefix — the web dispatches on it", async () => {
    const { error } = await body<{ error: string }>(fail("VALIDATION: page must be >= 1", 400));
    expect(error).toBe("VALIDATION: page must be >= 1");
  });

  it("a 4xx redacts a credential while PRESERVING the code prefix", async () => {
    const res = fail("CREDENTIALS_EXPIRED: token eyJhbGciOiJIUzI1NiJ9 rejected", 401);
    const { error } = await body<{ error: string }>(res);
    // The prefix is the dispatch key; only the human detail is redacted.
    expect(error.startsWith("CREDENTIALS_EXPIRED:")).toBe(true);
    expect(error).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("a 4xx does NOT redact the word 'credential' inside the code itself", async () => {
    // The redaction pattern includes `credential`, which matches inside
    // `CREDENTIALS_EXPIRED:` — a bug this assertion locks out.
    const { error } = await body<{ error: string }>(fail("CREDENTIALS_EXPIRED: re-provision required", 401));
    expect(error).toBe("CREDENTIALS_EXPIRED: re-provision required");
  });

  it("an over-long 4xx detail collapses to the generic bad request", async () => {
    const { error } = await body<{ error: string }>(fail("VALIDATION: " + "y".repeat(400), 400));
    expect(error).toBe("bad request");
  });
});

describe("isTursoAuthFailure — a credential problem is 401, never a 500 (RFC-003 G-AUTH)", () => {
  const AUTH: string[] = [
    "Turso pipeline HTTP 401",
    "Turso pipeline HTTP 403",
    "invalid auth token",
    "invalid api key",
    "unauthorized",
    "token expired",
    "jwt expired",
  ];

  for (const message of AUTH) {
    it(`recognises "${message}"`, () => {
      expect(isTursoAuthFailure(new Error(message))).toBe(true);
    });
  }

  it("does NOT mistake an ordinary failure for a credential failure", () => {
    for (const message of [
      "no such column: balance_paise",
      "FOREIGN KEY constraint failed",
      "disk I/O error",
      "network timeout",
    ]) {
      expect(isTursoAuthFailure(new Error(message)), message).toBe(false);
    }
  });

  it("handles a non-Error throwable without throwing itself", () => {
    expect(isTursoAuthFailure("unauthorized")).toBe(true);
    expect(isTursoAuthFailure(null)).toBe(false);
    expect(isTursoAuthFailure(undefined)).toBe(false);
  });
});

describe("no response emits a wildcard CORS origin (see cors-allowlist.test.ts)", () => {
  it("errors.ts leaves Access-Control-Allow-Origin to the request-aware resolver", () => {
    // `errors.ts` cannot resolve an origin: it has no Request. It therefore
    // emits none, and index.ts's `addSecurityHeaders` is the single writer.
    // Guessing one here is exactly the wildcard bug this replaced.
    for (const res of [ok({}), json({}), fail("x"), failValidation("x"), securityFail(403)]) {
      expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
      expect(res.headers.get("Vary")).toBe("Origin");
    }
  });
});
