// GW-JWTCLAIMS-11 (F-15) — the REAL `@supabase/supabase-js` verification path,
// exercised end to end, offline.
//
// WHY A SECOND FILE. `jwt-verification.test.ts` replaces the Supabase module with
// `vi.mock`, which is the right way to assert the CLAIM POLICY (`lib/auth.ts`
// `assertTenantClaims`) and the call shape, but it means nothing in the suite
// ever ran real signature verification, `exp` rejection or `alg` pinning. That
// is how the missing claim assertions survived review: a mocked verifier cannot
// fail, so a suite built on one proves nothing about a forged token.
//
// This file closes that. Nothing in the Supabase module is stubbed. A real
// RSA-2048 keypair is generated with WebCrypto, the project JWKS is served from
// a stubbed `fetch` (the ONLY network call `getClaims` can make), and every
// token below is genuinely signed with `crypto.subtle.sign`. `authenticateRequest`
// is the real one: real `crypto.subtle.verify`, real `validateExp`, real
// `getAlgorithm`, real claim policy, real HMAC binding.
//
// OFFLINE, BY CONSTRUCTION:
//   - `getClaims` reaches the network only for `${SUPABASE_URL}/auth/v1/.well-known/
//     jwks.json` (cache miss) or, for a token with no usable `kid`/`alg`, for
//     `${SUPABASE_URL}/auth/v1/user` (the remote `getUser` fallback). Both are
//     answered by the stub router below; ANY other URL throws, so an accidental
//     outbound call fails the test instead of leaking.
//
// WHAT IS STILL NOT TESTABLE HERE — STATED, NOT STUBBED AWAY:
//   - Real GoTrue behaviour. The `getUser` fallback is answered with a
//     synthetic 401, which is what GoTrue returns for an `alg: none` token, but
//     it is the stub's answer, not GoTrue's. What is proven is that the gateway
//     REJECTS whenever that fallback fails — the property that matters.
//   - Key ROTATION across a JWKS refresh (auth-js caches for 10 minutes).
//   - Sign-out revocation: `getClaims` is purely offline and never asks GoTrue
//     whether the session is live, so no offline test can cover it. It is a real
//     gap, documented in the `lib/auth.ts` claim-policy block, and closing it is
//     a product decision (per-request `getUser` = the cost the move to
//     `getClaims` was made to avoid), not a line to add.
//
// 10_Security.md §1 (trust model), §2.2 (service-role isolation), §3 (AUTH-1).
// AGENTS.md §2 Rules 3, 9.

import { describe, it, expect, beforeAll, afterAll } from "vitest";

// crypto.ts reads GATEWAY_SHARED_SECRET / DATA_ENCRYPTION_KEY into module
// constants at LOAD time, so these must be in process.env BEFORE the import.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.GATEWAY_SHARED_SECRET = "a".repeat(48);
process.env.DATA_ENCRYPTION_KEY = "b".repeat(48);
delete process.env.ALLOW_DEV_AUTH;
delete process.env.DENO_DEPLOYMENT_ID;
delete process.env.DENO_ENV;
delete process.env.SUPABASE_JWT_AUDIENCE;
delete process.env.SUPABASE_JWT_ISSUER;
delete process.env.SUPABASE_JWT_ALLOWED_ROLES;

const { authenticateRequest, AuthError } = await import("../lib/auth.ts");
const { hmacSign } = await import("../lib/crypto.ts");

// ── The project's GoTrue, as `SUPABASE_URL` describes it ─────────────────────
const PROJECT_ISSUER = "https://example.supabase.co/auth/v1";
const JWKS_URL = `${PROJECT_ISSUER}/.well-known/jwks.json`;
const USER_URL = `${PROJECT_ISSUER}/user`;
const KID = "gateway-test-key-1";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Every outbound URL the Supabase client attempted, in order. */
const fetched: string[] = [];

let signingKey: CryptoKey;
let publicJwk: JsonWebKey;

// ── base64url (RFC 4648 §5, no padding) ─────────────────────────────────────
function b64u(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64uJson(value: unknown): string {
  return b64u(new TextEncoder().encode(JSON.stringify(value)));
}

/** A genuinely RS256-signed JWT. `key` defaults to the project's key; passing a
 *  different one models a token signed by something the JWKS does not publish. */
async function mintJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  key: CryptoKey = signingKey,
): Promise<string> {
  const head = b64uJson(header);
  const body = b64uJson(payload);
  const signature = await globalThis.crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64u(new Uint8Array(signature))}`;
}

const RS256_HEADER = { alg: "RS256", typ: "JWT", kid: KID };

/** A real tutor access token, shaped per supabase.com/docs/guides/auth/jwt-fields. */
function tutorPayload(
  over: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    sub: TENANT,
    aud: "authenticated",
    iss: PROJECT_ISSUER,
    role: "authenticated",
    session_id: "b3f1c2d4-0000-4000-8000-000000000001",
    aal: "aal1",
    is_anonymous: false,
    iat: nowSec - 60,
    exp: nowSec + 3600,
    ...over,
  };
}

/** A request bound to `sub` with a genuine HMAC, so only the JWT is under test. */
async function signedRequest(jwt: string, tenant: string): Promise<Request> {
  const timestamp = String(Date.now());
  const nonce = "nonce-" + Math.random().toString(36).slice(2);
  const signature = await hmacSign(`${tenant}:::${timestamp}:${nonce}`);
  return new Request("https://gateway.test/api/v1/students", {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "X-Signature": signature,
      "X-Timestamp": timestamp,
      "X-Nonce": nonce,
      "X-Tutor-Id": tenant,
    },
  });
}

/** Run one request and return the AuthError it threw, or null if it succeeded. */
async function rejectReason(jwt: string, tenant: string): Promise<AuthError | null> {
  return authenticateRequest(await signedRequest(jwt, tenant)).then(
    () => null,
    (e: unknown) => e as AuthError,
  );
}

beforeAll(async () => {
  const pair = (await globalThis.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  signingKey = pair.privateKey;
  publicJwk = await globalThis.crypto.subtle.exportKey("jwk", pair.publicKey);

  const { vi } = await import("vitest");
  // Not `async`: the router never awaits, and deno lint (require-await) is right
  // about that. Returns a promise so the shape still matches `fetch`.
  vi.stubGlobal("fetch", (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : String(input);
    fetched.push(url);
    if (url === JWKS_URL) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            keys: [{ ...publicJwk, kid: KID, alg: "RS256", use: "sig", key_ops: ["verify"] }],
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url === USER_URL) {
      // What GoTrue answers for a token it will not accept. It is reached only
      // by the `getUser` fallback, i.e. when the JWT has no usable `kid`/`alg`.
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: 401, msg: "invalid claim: missing sub claim" }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
      );
    }
    // No other network call is legitimate here. Failing loudly is the point: a
    // test that quietly reaches the internet is not an offline test.
    return Promise.reject(
      new Error(`unexpected outbound request in jwt-claims-verification: ${url}`),
    );
  });
});

afterAll(async () => {
  const { vi } = await import("vitest");
  vi.unstubAllGlobals();
});

describe("the real verifier accepts a well-formed tutor token", () => {
  it("establishes the tenant from a genuinely RS256-signed access token", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload());
    const res = await authenticateRequest(await signedRequest(jwt, TENANT));
    expect(res.tenantId).toBe(TENANT);
  });

  it("really did verify a signature against the project JWKS", () => {
    // If the JWKS had not been consulted, the "accepted" result above would
    // prove nothing — `getClaims` would have taken the remote fallback instead.
    expect(fetched).toContain(JWKS_URL);
  });

  it("accepts a token minted 30 seconds ago and valid for an hour", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ iat: nowSec - 30, exp: nowSec + 3600 }),
    );
    const res = await authenticateRequest(await signedRequest(jwt, TENANT));
    expect(res.tenantId).toBe(TENANT);
  });
});

describe("the real verifier refuses an expired token", () => {
  it("rejects an expired RS256 token", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ iat: nowSec - 7200, exp: nowSec - 60 }),
    );
    const err = await rejectReason(jwt, TENANT);
    expect(err).toBeInstanceOf(AuthError);
    // `validateExp` fires inside `getClaims`, so the gateway never sees claims.
    expect(err?.message).toMatch(/expired or invalid/i);
  });

  it("rejects a token expiring one second ago — no grace window on `exp`", async () => {
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ exp: Math.floor(Date.now() / 1000) - 1 }),
    );
    expect(await rejectReason(jwt, TENANT)).toBeInstanceOf(AuthError);
  });
});

describe("the real verifier refuses a token for another audience", () => {
  it("rejects a correctly signed `aud: \"anon\"` token", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload({ aud: "anon" }));
    const err = await rejectReason(jwt, TENANT);
    expect(err?.message).toMatch(/audience mismatch/i);
  });

  it("rejects a correctly signed token with no `aud`", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload({ aud: undefined }));
    expect((await rejectReason(jwt, TENANT))?.message).toMatch(/audience mismatch/i);
  });
});

describe("the real verifier refuses a token from another issuer", () => {
  it("rejects a correctly signed token minted by a different project", async () => {
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ iss: "https://attacker-project.supabase.co/auth/v1" }),
    );
    const err = await rejectReason(jwt, TENANT);
    expect(err?.message).toMatch(/issuer mismatch/i);
  });

  it("rejects the legacy `iss: \"supabase\"` of a project-level key", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload({ iss: "supabase" }));
    expect((await rejectReason(jwt, TENANT))?.message).toMatch(/issuer mismatch/i);
  });
});

describe("the real verifier refuses a privileged role", () => {
  it("rejects a correctly signed `service_role` token carrying a `sub`", async () => {
    // THE CONCRETE EXPLOIT F-15 NAMES. A project credential and a tutor's
    // session are both signed by this project's key; only `role`/`aud`/`iss`
    // separate them, and the gateway used to read none of them.
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ role: "service_role", aud: "authenticated" }),
    );
    const err = await rejectReason(jwt, TENANT);
    expect(err?.message).toMatch(/role is not an end-user role/i);
  });

  it("rejects a correctly signed `anon` token carrying a `sub`", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload({ role: "anon" }));
    expect((await rejectReason(jwt, TENANT))?.message).toMatch(/role is not an end-user role/i);
  });

  it("rejects a service_role-shaped token whose `aud` is the project key", async () => {
    const jwt = await mintJwt(
      RS256_HEADER,
      tutorPayload({ role: "service_role", aud: "service_role", iss: "supabase" }),
    );
    const err = await rejectReason(jwt, TENANT);
    // Two independent assertions catch this one; the first to fire is the issuer.
    expect(err?.message).toMatch(/issuer mismatch|audience mismatch|role is not an end-user role/i);
  });
});

describe("the real verifier refuses `alg` confusion and unknown keys", () => {
  it("rejects `alg: \"none\"` (falls back to GoTrue, which refuses it)", async () => {
    const jwt = await mintJwt({ alg: "none", typ: "JWT" }, tutorPayload());
    const err = await rejectReason(jwt, TENANT);
    expect(err).toBeInstanceOf(AuthError);
    expect(err?.message).toMatch(/expired or invalid/i);
  });

  it("rejects an HMAC (`HS256`) token", async () => {
    // Symmetric algs are never verified locally — auth-js falls back to GoTrue.
    const jwt = await mintJwt({ alg: "HS256", typ: "JWT", kid: KID }, tutorPayload());
    expect(await rejectReason(jwt, TENANT)).toBeInstanceOf(AuthError);
  });

  it("rejects a token with no `kid`", async () => {
    const jwt = await mintJwt({ alg: "RS256", typ: "JWT" }, tutorPayload());
    expect(await rejectReason(jwt, TENANT)).toBeInstanceOf(AuthError);
  });

  it("rejects a token whose `kid` is not published by this project", async () => {
    const jwt = await mintJwt(
      { alg: "RS256", typ: "JWT", kid: "some-other-projects-key" },
      tutorPayload(),
    );
    expect(await rejectReason(jwt, TENANT)).toBeInstanceOf(AuthError);
  });

  it("rejects a token signed by a key the JWKS does not publish", async () => {
    // Attacker-chosen `kid` cannot help them: the JWKS decides which key is
    // trusted, and this signature was made with one it does not contain.
    const other = (await globalThis.crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const jwt = await mintJwt(RS256_HEADER, tutorPayload(), other.privateKey);
    const err = await rejectReason(jwt, TENANT);
    expect(err?.message).toMatch(/expired or invalid/i);
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const jwt = await mintJwt(RS256_HEADER, tutorPayload());
    const [head, , sig] = jwt.split(".");
    // Re-point `sub` at a different tutor, keeping the original signature.
    const forged = `${head}.${b64uJson(tutorPayload({ sub: OTHER_TENANT }))}.${sig}`;
    const err = await rejectReason(forged, OTHER_TENANT);
    expect(err?.message).toMatch(/expired or invalid/i);
  });

  it("rejects a three-segment string that is not a JWT, with the TYPED 401", async () => {
    // `getClaims` THROWS a bare SyntaxError here (JSON.parse on the segments),
    // so unwrapped this escaped as an untyped 500 and the web's
    // `extractServerCode` dispatch saw no code at all. Rule 9 / RFC-003 G-AUTH.
    const err = await rejectReason(
      `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}`,
      TENANT,
    );
    expect(err).toBeInstanceOf(AuthError);
    expect(err?.status).toBe(401);
    expect(err?.code).toBe("UNAUTHENTICATED");
    expect(err?.message).toMatch(/expired or invalid/i);
  });

  it("rejects an `alg` outside the RS256/ES256 allowlist, with the TYPED 401", async () => {
    // `getAlgorithm` throws a bare Error for PS256 & friends; same path.
    const jwt = await mintJwt(
      { alg: "PS256", typ: "JWT", kid: KID },
      tutorPayload(),
    );
    const err = await rejectReason(jwt, TENANT);
    expect(err).toBeInstanceOf(AuthError);
    expect(err?.status).toBe(401);
    expect(err?.message).toMatch(/expired or invalid/i);
  });
});

describe("the offline verification has a documented boundary", () => {
  it("never asks GoTrue whether the session is live for a well-formed token", async () => {
    // Records the KNOWN LIMIT, so it cannot be quietly forgotten: `getClaims`
    // is offline, so signing out does not revoke a stolen token before its
    // `exp`. Only the `alg`/`kid` fallback reaches `/auth/v1/user`.
    fetched.length = 0;
    const jwt = await mintJwt(RS256_HEADER, tutorPayload());
    await authenticateRequest(await signedRequest(jwt, TENANT));
    expect(fetched).not.toContain(USER_URL);
  });

  it("uses the remote fallback only when the token has no usable kid/alg", async () => {
    fetched.length = 0;
    const jwt = await mintJwt({ alg: "none", typ: "JWT" }, tutorPayload());
    await rejectReason(jwt, TENANT);
    expect(fetched).toContain(USER_URL);
  });
});

const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";