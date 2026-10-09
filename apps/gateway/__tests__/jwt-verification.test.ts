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
// 10_Security.md §3 (AUTH-1). AGENTS.md §2 Rule 9.

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
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

function claimsOk(sub: string, extra: Record<string, unknown> = {}) {
  getClaims.mockResolvedValue({
    data: { claims: { sub, exp: Math.floor(Date.now() / 1000) + 3600, ...extra }, headers: {} },
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