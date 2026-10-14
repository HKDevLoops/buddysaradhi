// GW-JWTVERIFY-10 — identity comes from a VERIFIED signature, in-process.
//
// THE GAP THIS CLOSES. `authenticateRequest` established identity with
// `sb.auth.getUser(jwt)` — an outbound Auth round trip on every request, purely
// to read `user.id` from a JWT the caller had just supplied. It is now
// `sb.auth.getClaims(jwt)`, which verifies the RS256 signature against the cached
// JWKS locally. That branch had NO test at all: `auth.test.ts` only covered input
// validation, because the Supabase import could not load under vitest. So a
// security-critical rewrite could have removed signature verification entirely and
// every suite would still have passed. These tests are the net under that.
//
// F-15 ADDED A SECOND NET, NOT A REPLACEMENT. `getClaims` validates `exp` and
// NOTHING else — not `aud`, `iss`, `role`, `nbf` or `session_id` — so a valid
// signature proved only that THIS PROJECT minted the token, while the gateway
// read nothing but `sub`. `lib/auth.ts` `assertTenantClaims` now asserts those
// claims, and this file covers that policy directly: every claim that must fail
// closed, driven through the real `authenticateRequest` with only the VERIFIER
// stubbed (the HMAC binding, tenant equality and rate limits stay real).
//
// The real `@supabase/supabase-js` signature path — real RS256, real JWKS, real
// `crypto.subtle.verify` — is covered separately and offline in
// `jwt-claims-verification.test.ts`. It was NOT feasible in this file: the
// "getClaims was called with exactly one argument" assertions below can only be
// made against a spy, and the file-level `vi.mock` of the module has no
// per-test escape.
//
// 10_Security.md §3 (AUTH-1), §2.2 (service-role isolation). AGENTS.md §2 Rule 9.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// The Supabase client is mocked so the JWKS/claims step is observable and no
// network call is made. Everything else — the HMAC binding, the tenant equality
// check, the rate limits, the dev-auth gate — is the REAL implementation.
const getClaims = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { getClaims } }),
}));

// crypto.ts reads GATEWAY_SHARED_SECRET / DATA_ENCRYPTION_KEY into module
// constants at LOAD time (`const HMAC_SECRET = readSecret(...)`), so these must be
// in process.env BEFORE the import below — a beforeEach would run too late and
// every signature check would compare against "".
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.GATEWAY_SHARED_SECRET = "a".repeat(48);
process.env.DATA_ENCRYPTION_KEY = "b".repeat(48);
delete process.env.ALLOW_DEV_AUTH;
delete process.env.DENO_DEPLOYMENT_ID;
delete process.env.DENO_ENV;

const { authenticateRequest, AuthError } = await import("../lib/auth.ts");
const { hmacSign } = await import("../lib/crypto.ts");

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const JWT = `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`;

/** The `SUPABASE_URL` set above, and the GoTrue issuer a tutor's token must name. */
const PROJECT_URL = "https://example.supabase.co";
const PROJECT_ISSUER = `${PROJECT_URL}/auth/v1`;

/** A request carrying a correctly-signed binding, so only identity is under test. */
async function signedRequest(opts: {
  tenantHeader?: string;
  dbUrl?: string;
  dbToken?: string;
} = {}): Promise<Request> {
  const timestamp = String(Date.now());
  const nonce = "nonce-" + Math.random().toString(36).slice(2);
  const dbUrl = opts.dbUrl ?? "";
  const dbToken = opts.dbToken ?? "";
  // The signature always covers TENANT, because authenticateRequest derives
  // `tenantId` from the verified `sub` BEFORE the HMAC check — so with no header
  // the signed material is still the real tenant, not "".
  const signedTenant = TENANT;
  const signature = await hmacSign(`${signedTenant}:${dbUrl}:${dbToken}:${timestamp}:${nonce}`);
  // Only the header itself is optional; it is what the test varies.
  const sendHeader = opts.tenantHeader === undefined ? true : opts.tenantHeader !== "";
  return new Request("https://gateway.test/api/v1/students", {
    headers: {
      Authorization: `Bearer ${JWT}`,
      "X-Signature": signature,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      ...(sendHeader ? { "X-Tutor-Id": opts.tenantHeader ?? TENANT } : {}),
    },
  });
}

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GATEWAY_SHARED_SECRET",
  "DATA_ENCRYPTION_KEY",
  "ALLOW_DEV_AUTH",
  "DENO_DEPLOYMENT_ID",
  "DENO_ENV",
  // The claim-policy overrides under test. An unset value means "use the
  // fail-closed default", so every test below starts by deleting them.
  "SUPABASE_JWT_AUDIENCE",
  "SUPABASE_JWT_ISSUER",
  "SUPABASE_JWT_ALLOWED_ROLES",
] as const;
const saved = new Map<string, string | undefined>(
  ENV_KEYS.map((k) => [k, process.env[k]]),
);

beforeEach(() => {
  getClaims.mockReset();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  delete process.env.ALLOW_DEV_AUTH;
  delete process.env.DENO_DEPLOYMENT_ID;
  delete process.env.DENO_ENV;
  delete process.env.SUPABASE_JWT_AUDIENCE;
  delete process.env.SUPABASE_JWT_ISSUER;
  delete process.env.SUPABASE_JWT_ALLOWED_ROLES;
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

/**
 * A claim set shaped exactly like a real Supabase Auth access token, per the
 * documented contract (supabase.com/docs/guides/auth/jwt-fields): `aud`,
 * `iss`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `is_anonymous`.
 *
 * The previous fixture was `{ sub, exp }` — a claim set no Supabase token ever
 * has. It passed while the gateway asserted nothing beyond `sub`, which is
 * exactly how the missing `aud`/`iss`/`role` checks survived. A fixture that
 * matches the real thing cannot be satisfied by a partial implementation.
 */
function tutorClaims(sub: string, extra: Record<string, unknown> = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    sub,
    aud: "authenticated",
    iss: PROJECT_ISSUER,
    role: "authenticated",
    session_id: `session-${sub}`,
    aal: "aal1",
    is_anonymous: false,
    iat: nowSec - 60,
    exp: nowSec + 3600,
    ...extra,
  };
}

function claimsOk(sub: string, extra: Record<string, unknown> = {}) {
  getClaims.mockResolvedValue({
    data: { claims: tutorClaims(sub, extra), headers: {} },
    error: null,
  });
}

describe("a verified token establishes the tenant", () => {
  it("accepts a token whose verified sub matches the x-tutor-id header", async () => {
    claimsOk(TENANT);
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("derives the tenant from the verified sub when no header is sent", async () => {
    claimsOk(TENANT);
    const res = await authenticateRequest(await signedRequest({ tenantHeader: "" }));
    expect(res.tenantId).toBe(TENANT);
  });
});

describe("an UNVERIFIED or mismatched token never establishes a tenant", () => {
  it("rejects when the claims verifier returns an error", async () => {
    // A forged / expired / revoked token lands here.
    getClaims.mockResolvedValue({ data: null, error: { message: "invalid signature" } });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/expired or invalid/i);
  });

  it("rejects when the verifier succeeds but returns no claims", async () => {
    getClaims.mockResolvedValue({ data: { claims: null, headers: {} }, error: null });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/expired or invalid/i);
  });

  it("rejects a claims object with no sub", async () => {
    getClaims.mockResolvedValue({ data: { claims: { exp: 1 }, headers: {} }, error: null });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/expired or invalid/i);
  });

  it("rejects a non-string sub", async () => {
    // The decode-vs-verify line: a truthy non-string must not be coerced.
    getClaims.mockResolvedValue({
      data: { claims: { sub: { id: TENANT } }, headers: {} },
      error: null,
    });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/expired or invalid/i);
  });

  it("rejects a header naming a DIFFERENT tenant than the verified sub", async () => {
    // The cross-tenant read. The caller is authenticated; they just asked for
    // someone else's books.
    claimsOk(TENANT);
    const req = await signedRequest({ tenantHeader: OTHER_TENANT });
    await expect(authenticateRequest(req)).rejects.toThrow(/tenant mismatch/i);
  });
});

describe("the verification is not silently relaxed", () => {
  it("never asks the verifier to skip expiry checking", async () => {
    claimsOk(TENANT);
    await authenticateRequest(await signedRequest());
    expect(getClaims).toHaveBeenCalledTimes(1);
    const call = getClaims.mock.calls[0] as unknown[];
    // `allowExpired: true` would accept a revoked session indefinitely. No
    // options object is passed at all, so there is nothing to opt out with — and
    // no static `jwks` to pin, which would break key rotation.
    expect(call[1]).toBeUndefined();
    expect(call).toHaveLength(1);
  });

  it("passes the token verbatim, with NO options object at all", async () => {
    claimsOk(TENANT);
    await authenticateRequest(await signedRequest());
    expect(getClaims).toHaveBeenCalledWith(JWT);
    // Stronger than "allowExpired is undefined": no second argument exists, so
    // there is no code path by which expiry checking could be relaxed.
    expect(getClaims.mock.calls[0]).toHaveLength(1);
  });

  it("never falls back to decoding the token when verification fails", async () => {
    // There must be no second chance: no try/catch that decodes `jwt` directly.
    getClaims.mockRejectedValue(new Error("jwks fetch failed"));
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow();
  });

  it("does NOT disguise an infrastructure failure as an expired session", async () => {
    // `verifyClaims` maps only a MALFORMED CALLER STRING to the typed 401. A
    // JWKS/Auth outage must stay a 500: telling every tutor "sign in again"
    // because a fetch failed logs the whole fleet out of a healthy app.
    for (const message of ["jwks fetch failed", "network error", "AuthApiError 503"]) {
      getClaims.mockRejectedValue(new Error(message));
      const err = await authenticateRequest(await signedRequest()).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err, message).toBeInstanceOf(Error);
      expect(err, message).not.toBeInstanceOf(AuthError);
    }
  });

  it("maps a malformed CALLER string to the typed 401, never a bare Error", async () => {
    // `getClaims` THROWS (it only returns `{ data, error }` for AuthErrors), so a
    // three-segment string that is not JSON used to escape as an untyped 500 and
    // the web's `extractServerCode` dispatch saw no code at all. Rule 9.
    for (const message of [
      "Invalid UTF-8 sequence",
      "Unexpected token o in JSON at position 1",
      "Invalid alg claim",
    ]) {
      getClaims.mockRejectedValue(new SyntaxError(message));
      const err = await authenticateRequest(await signedRequest()).then(
        () => null,
        (e: unknown) => e as AuthError,
      );
      expect(err, message).toBeInstanceOf(AuthError);
      expect(err?.status, message).toBe(401);
      expect(err?.code, message).toBe("UNAUTHENTICATED");
      expect(err?.message, message).toMatch(/^UNAUTHENTICATED: /);
    }
  });
});

describe("the HMAC binding still applies after the identity change", () => {
  it("rejects a request whose signature is absent", async () => {
    claimsOk(TENANT);
    const req = new Request("https://gateway.test/api/v1/students", {
      headers: { Authorization: `Bearer ${JWT}` },
    });
    await expect(authenticateRequest(req)).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it("rejects a signature that does not match the signed material", async () => {
    claimsOk(TENANT);
    const req = new Request("https://gateway.test/api/v1/students", {
      headers: {
        Authorization: `Bearer ${JWT}`,
        "X-Signature": "f".repeat(64),
        "X-Timestamp": String(Date.now()),
        "X-Nonce": "n1",
      },
    });
    await expect(authenticateRequest(req)).rejects.toThrow(/signature/i);
  });
});

describe("the dev-auth gate still applies", () => {
  it("rejects a mock-token when dev auth is not enabled", async () => {
    const req = new Request("https://gateway.test/api/v1/students", {
      headers: { Authorization: "Bearer mock-token-someone" },
    });
    await expect(authenticateRequest(req)).rejects.toBeInstanceOf(AuthError);
    // The claims verifier must not even be consulted for a dev token.
    expect(getClaims).not.toHaveBeenCalled();
  });
});

// ── F-15: a verified signature is NOT an identity ────────────────────────────
// Every case below is a token `getClaims` ACCEPTS — correct signature, valid
// `exp` — and that the gateway must still refuse. Before F-15 the gateway read
// only `sub`, so every one of these established a tenant.
describe("a signature alone never establishes a tenant (F-15)", () => {
  it("rejects a token whose `aud` is the project anon key", async () => {
    claimsOk(TENANT, { aud: "anon" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/audience mismatch/i);
  });

  it("rejects a token with NO `aud` at all", async () => {
    // `getClaims` does not look at `aud`, so a Custom Access Token Hook that
    // strips it produced a token the gateway used to accept.
    claimsOk(TENANT, { aud: undefined });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/audience mismatch/i);
  });

  it("accepts an `aud` array that contains the audience (RFC 7519 §4.1.3)", async () => {
    claimsOk(TENANT, { aud: ["authenticated", "other"] });
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("rejects an `aud` array that does NOT contain the audience", async () => {
    claimsOk(TENANT, { aud: ["service_role", "other"] });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/audience mismatch/i);
  });

  it("rejects a token minted by ANOTHER deployment", async () => {
    claimsOk(TENANT, { iss: "https://attacker-project.supabase.co/auth/v1" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/issuer mismatch/i);
  });

  it("rejects the legacy `iss: \"supabase\"` of a project-level key", async () => {
    claimsOk(TENANT, { iss: "supabase" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/issuer mismatch/i);
  });

  it("rejects a token with NO `iss`", async () => {
    claimsOk(TENANT, { iss: undefined });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/issuer mismatch/i);
  });

  it("accepts an issuer that differs only by a trailing slash", async () => {
    // A hand-entered `SUPABASE_URL` with a trailing slash must not lock every
    // tutor out of their own books.
    claimsOk(TENANT, { iss: `${PROJECT_ISSUER}/` });
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("honours SUPABASE_JWT_ISSUER for a deployment on a custom domain", async () => {
    process.env.SUPABASE_JWT_ISSUER = "https://auth.buddysaradhi.app/v1";
    claimsOk(TENANT, { iss: "https://auth.buddysaradhi.app/v1" });
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("rejects a `service_role` token that DOES carry a `sub`", async () => {
    // THE CONCRETE EXPLOIT. A project-level credential and a tutor's session are
    // signed by the same project, so only the claim set distinguishes them — and
    // the gateway used to read none of it.
    claimsOk(TENANT, { role: "service_role" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /role is not an end-user role/i,
    );
  });

  it("rejects an `anon` token that DOES carry a `sub`", async () => {
    claimsOk(TENANT, { role: "anon" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /role is not an end-user role/i,
    );
  });

  it("rejects a token with NO `role`", async () => {
    claimsOk(TENANT, { role: undefined });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /role is not an end-user role/i,
    );
  });

  it("does not let SUPABASE_JWT_ALLOWED_ROLES re-open service_role", async () => {
    // A configuration knob must never be the thing that re-opens the bypass
    // (10_Security.md §2.2 — the service role lives ONLY in the edge env).
    process.env.SUPABASE_JWT_ALLOWED_ROLES = "authenticated, service_role, anon";
    claimsOk(TENANT, { role: "service_role" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /role is not an end-user role/i,
    );
  });

  it("accepts an operator-configured additional end-user role", async () => {
    process.env.SUPABASE_JWT_ALLOWED_ROLES = "authenticated, tutor";
    claimsOk(TENANT, { role: "tutor" });
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("falls back to the default roles when the allowlist is blank", async () => {
    // Fail closed: a typo'd override must not accept everything, and must not
    // lock the tutor out either.
    process.env.SUPABASE_JWT_ALLOWED_ROLES = " , , ";
    claimsOk(TENANT, { role: "service_role" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /role is not an end-user role/i,
    );
    claimsOk(TENANT);
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("rejects a token that is signed, unexpired, and NOT YET valid (nbf)", async () => {
    claimsOk(TENANT, { nbf: Math.floor(Date.now() / 1000) + 3600 });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /not valid before/i,
    );
  });

  it("accepts an `nbf` inside the clock-skew allowance", async () => {
    // A device whose clock runs slightly fast must not be locked out.
    claimsOk(TENANT, { nbf: Math.floor(Date.now() / 1000) + 30 });
    const res = await authenticateRequest(await signedRequest({ tenantHeader: TENANT }));
    expect(res.tenantId).toBe(TENANT);
  });

  it("rejects a MALFORMED `nbf` rather than ignoring it", async () => {
    // Fail closed: an unparseable optional claim is not a licence to skip it.
    claimsOk(TENANT, { nbf: "tomorrow" });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /not valid before/i,
    );
  });

  it("rejects a token with NO `session_id`", async () => {
    // Present on every GoTrue access token, absent from the project-level keys.
    claimsOk(TENANT, { session_id: undefined });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/session id missing/i);
  });

  it("rejects a non-string `session_id` rather than coercing it", async () => {
    claimsOk(TENANT, { session_id: { id: "s1" } });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(/session id missing/i);
  });

  it("rejects an expired claim set even if the verifier were to pass it", async () => {
    // `getClaims` already refuses this (`validateExp`, and `allowExpired` is not
    // set). The gateway repeats the check so its contract does not depend on an
    // option a future edit could add.
    claimsOk(TENANT, { exp: Math.floor(Date.now() / 1000) - 1 });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /expired or invalid/i,
    );
  });

  it("rejects a claim set with no `exp`", async () => {
    claimsOk(TENANT, { exp: undefined });
    await expect(authenticateRequest(await signedRequest())).rejects.toThrow(
      /expired or invalid/i,
    );
  });

  it("throws a typed AuthError with a 401 UNAUTHENTICATED code for every rejection", async () => {
    // Rule 9 + RFC-003 G-AUTH: the web dispatches on the code, so a bare string
    // throw here would break the tutor's re-login path.
    const cases: Record<string, unknown>[] = [
      { aud: "anon" },
      { iss: "https://other.supabase.co/auth/v1" },
      { role: "service_role" },
      { nbf: Math.floor(Date.now() / 1000) + 9999 },
      { session_id: undefined },
      { exp: 1 },
    ];
    for (const extra of cases) {
      claimsOk(TENANT, extra);
      const err = await authenticateRequest(await signedRequest()).then(
        () => null,
        (e: unknown) => e as AuthError,
      );
      expect(err, JSON.stringify(extra)).toBeInstanceOf(AuthError);
      expect(err?.status, JSON.stringify(extra)).toBe(401);
      expect(err?.code, JSON.stringify(extra)).toBe("UNAUTHENTICATED");
      expect(err?.message, JSON.stringify(extra)).toMatch(/^UNAUTHENTICATED: /);
    }
  });

  it("names the offending claim in the message so a 401 is diagnosable", async () => {
    // The message crosses the wire through lib/errors.ts `sanitizeError`, so the
    // detail must read as English AFTER redaction — none of these may contain a
    // word the redactor eats (`token`/`key`/`secret`/`credential`).
    const expected: Record<string, RegExp> = {
      aud: /audience mismatch/i,
      iss: /issuer mismatch/i,
      role: /role is not an end-user role/i,
      session_id: /session id missing/i,
    };
    for (const [claim, pattern] of Object.entries(expected)) {
      const extra: Record<string, unknown> =
        claim === "aud" ? { aud: "anon" }
        : claim === "iss" ? { iss: "supabase" }
        : claim === "role" ? { role: "service_role" }
        : { session_id: undefined };
      claimsOk(TENANT, extra);
      const err = await authenticateRequest(await signedRequest()).then(
        () => null,
        (e: unknown) => e as AuthError,
      );
      expect(err?.message, claim).toMatch(pattern);
      // Prove the redactor cannot mangle it: nothing here trips a redaction.
      const { fail } = await import("../lib/errors.ts");
      const body = (await fail(err?.message ?? "", 401).json()) as { error: string };
      expect(body.error, claim).toMatch(pattern);
      expect(body.error, claim).not.toContain("[REDACTED]");
    }
  });
});