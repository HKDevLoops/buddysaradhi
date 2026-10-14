// Implements: 17_API_Gateway_System.md §5 (one Supabase-JWT auth model) +
// RFC-003 G-AUTH/G-ERR (expiry-aware typed 401s the web dispatches on via
// apps/web/src/lib/app-errors.ts `extractServerCode`) + 10_Security.md §3.
// Every throw carries a leading `CODE: detail` message so index.ts can relay
// `{ success: false, error: CODE }` with the matching HTTP status (F-1 audit).
import { createClient as createSb } from "@supabase/supabase-js";
import { hmacVerify, checkRateLimit } from "./crypto.ts";
import { logWarn, logError } from "./log.ts";
import { isDevAuthEnabled } from "./env.ts";

const JWT_MIN_LENGTH = 100;
const JWT_MAX_LENGTH = 2048;
const HMAC_MIN_LENGTH = 64;
const HMAC_MAX_LENGTH = 128;
const TENANT_RATE_LIMIT_MAX = 150;
const TENANT_RATE_LIMIT_WINDOW_MS = 60_000;
const MUTATION_RATE_LIMIT_MAX = 20;
const MUTATION_RATE_LIMIT_WINDOW_MS = 60_000;

export interface AuthResult {
  tenantId: string;
}

// ── Claim policy (F-15) ──────────────────────────────────────────────────────
// Implements: 10_Security.md §1 (trust model) + §2.2 (service-role isolation) +
// 17_API_Gateway_System.md §5 (one Supabase-JWT auth model). Fail-closed, Rule 9.
//
// WHAT `getClaims` ALREADY DOES — do not re-implement it here. Verified against
// @supabase/auth-js 2.110.8: `fetchJwk` pulls the project JWKS by the header's
// `kid`, `crypto.subtle.importKey('jwk', …)` + `crypto.subtle.verify(...)` do
// REAL signature verification (this is not a decode); `getAlgorithm` allowlists
// RS256/ES256 only and throws otherwise; `validateExp` enforces `exp`. So there
// is no "JWT is not verified" bug to fix.
//
// WHAT IT DOES NOT DO — and that is what this block adds. `getClaims` validates
// `exp` and nothing else. It never looks at `aud`, `iss`, `role` or `nbf`. A
// valid signature proves "this project minted this token", NOT "this token names
// a tutor of THIS deployment". Supabase issues `anon` and `service_role` JWTs
// for the same project, and a Custom Access Token Hook can rewrite any claim, so
// unless the gateway asserts those claims a privileged project credential and a
// tutor's session are the same object here. The gateway checked nothing but
// `sub` before this.
//
// KNOWN LIMIT, DELIBERATELY NOT "FIXED" HERE. `getClaims` is a purely OFFLINE
// check: it never asks GoTrue whether the session is still live, so signing out
// does NOT revoke a stolen access token until its `exp`. Closing that means a
// per-request (or session-cache) `getUser` round trip — the exact cost the move
// from `getUser` to `getClaims` was made to avoid (see the comment at the call
// site: ~20 Auth round trips per dashboard load). `apps/web/src/server/get-db.ts`
// `invalidateCredentialHealth` is a LOCAL cache eviction and does not change
// this. That is a product trade-off to decide, not a line to quietly add.

/** Audience a tutor's Supabase access token must name. */
const JWT_AUDIENCE_DEFAULT = "authenticated";

/**
 * Roles that may establish a TENANT. 10_Security.md §2.2: `anon` and
 * `service_role` are project-level credentials, not a tutor, and §2.2 is exactly
 * the rule that says they live only in the Edge Function env.
 */
const JWT_ROLES_DEFAULT: ReadonlySet<string> = new Set(["authenticated"]);

/**
 * Refused whatever `SUPABASE_JWT_ALLOWED_ROLES` says. A configuration knob must
 * never be the thing that re-opens the service-role bypass; an operator who
 * adds `service_role` to the allowlist gets a loud 401, not a silent grant.
 */
const JWT_ROLES_NEVER: ReadonlySet<string> = new Set(["anon", "service_role"]);

/**
 * RFC 7519 §4.1.5 clock-skew allowance for `nbf` only. A device whose clock runs
 * a few seconds fast must not be locked out of its own books. It cannot extend a
 * token's useful life: `exp` is still enforced exactly.
 */
const JWT_NBF_LEEWAY_MS = 60_000;

function jwtEnv(name: string): string {
  return Deno.env.get(name) || "";
}

/** A trailing slash is the only difference a sloppy `SUPABASE_URL` carries, and a
 *  mismatch here is a hard 401 — so normalise before comparing. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * The issuer a tutor's token must name: GoTrue's URL for THIS project. Derived
 * from the same `SUPABASE_URL` the client is built with, so the two cannot drift.
 * `SUPABASE_JWT_ISSUER` exists only for a deployment whose GoTrue sits somewhere
 * else (e.g. a custom domain) — not as a way to loosen the check.
 */
function expectedIssuer(supabaseUrl: string): string {
  const override = jwtEnv("SUPABASE_JWT_ISSUER").trim();
  if (override) return trimTrailingSlash(override);
  return `${trimTrailingSlash(supabaseUrl)}/auth/v1`;
}

/** The audience a tutor's token must name. Empty config falls back to the
 *  Supabase default rather than to "accept anything" — fail closed. */
function expectedAudience(): string {
  return jwtEnv("SUPABASE_JWT_AUDIENCE").trim() || JWT_AUDIENCE_DEFAULT;
}

/** End-user roles this deployment accepts. Blank/garbage config falls back to the
 *  default rather than to an empty set (lockout) or to "accept everything"
 *  (bypass). */
function allowedTenantRoles(): ReadonlySet<string> {
  const raw = jwtEnv("SUPABASE_JWT_ALLOWED_ROLES");
  if (!raw.trim()) return JWT_ROLES_DEFAULT;
  const set = new Set<string>();
  for (const part of raw.split(",")) {
    const role = part.trim().toLowerCase();
    if (role) set.add(role);
  }
  return set.size > 0 ? set : JWT_ROLES_DEFAULT;
}

/** RFC 7519 §4.1.3 — `aud` is a string OR an array of strings. */
function audienceValues(claim: unknown): string[] {
  if (typeof claim === "string") return claim ? [claim.toLowerCase()] : [];
  if (Array.isArray(claim)) {
    return claim
      .filter((value): value is string => typeof value === "string" && value.length > 0)
      .map((value) => value.toLowerCase());
  }
  return [];
}

/**
 * Record WHICH claim refused the request and throw the typed 401. Never returns.
 *
 * Only the claim NAME is logged — never the presented value. The value is
 * attacker-controlled and the message crosses the wire (`lib/errors.ts`
 * `sanitizeError`), so this stays a diagnosis ("which assertion fired") without
 * becoming an injection point or a leak. The detail strings deliberately avoid
 * the words `token`/`key`/`secret`/`credential`, which `sanitizeError` would
 * otherwise redact into `[REDACTED]` and turn into an unreadable 401 body.
 */
function failClaim(claim: string, detail: string): never {
  logWarn("auth.claim_rejected", { claim });
  throw new AuthError(`UNAUTHENTICATED: ${detail}`, 401, "UNAUTHENTICATED");
}

/**
 * Failures that `getClaims` THROWS instead of returning as `{ data, error }`.
 *
 * `getClaims` is typed to return a result, but it re-throws anything that is not
 * an `AuthError` — and two of its own failure modes are not. `decodeJWT` parses
 * the header/payload with `JSON.parse`, so a string that is three dot-separated
 * segments but is not JSON throws a bare `SyntaxError` ("Invalid UTF-8
 * sequence"), and `getAlgorithm` throws a bare `Error` ("Invalid alg claim") for
 * an `alg` that is neither RS256, ES256 nor HS*. Both are properties of the
 * CALLER'S STRING, so the caller is what is wrong — but unwrapped they escaped
 * `authenticateRequest` as an untyped 500, and the web dispatches on the typed
 * code (RFC-003 G-AUTH, apps/web/src/lib/app-errors.ts). Rule 9.
 *
 * The allowlist is DELIBERATELY NARROW. Only these client-side failures become a
 * 401. A JWKS fetch failure, an Auth outage or a malformed JWKS response is
 * re-thrown untouched, because disguising an infrastructure failure as "your
 * session expired" signs every tutor out of a perfectly healthy app.
 */
const CLAIM_DECODE_FAILURES: readonly string[] = [
  "Invalid alg claim",
  "Invalid JWT structure",
  "JWT not in base64url format",
  "Invalid UTF-8 sequence",
  "Unexpected token",
  "Unexpected end of JSON input",
];

/**
 * The ONLY Supabase surface this module touches.
 *
 * Structural, deliberately not the generated `SupabaseClient` type: `createSb`
 * is generic, so `ReturnType<typeof createSb>` pins an instantiation that a
 * `createSb(url, key)` call does not actually produce (Deno rejects it). Naming
 * the one method we use is also what lets the compiler enforce the invariant
 * below — a second argument is not in the signature.
 */
interface ClaimsVerifier {
  auth: {
    getClaims(jwt: string): Promise<{
      data?: { claims?: unknown } | null;
      error?: unknown;
    }>;
  };
}

/**
 * `sb.auth.getClaims(jwt)`, with its one hole closed.
 *
 * Called with EXACTLY ONE ARGUMENT, and the type above makes a second one a
 * compile error: `allowExpired` must stay unset (RFC-003 G-AUTH — a revoked
 * session is not a 24h credential) and no static `jwks` may be pinned (that
 * would break key rotation).
 *
 * Returns the verifier's own `{ data, error }`. A malformed CALLER string — three
 * segments that are not JSON, an `alg` outside the allowlist — is reported as the
 * same typed 401 as a bad signature. Everything else propagates.
 */
function verifyClaims(
  sb: ClaimsVerifier,
  jwt: string,
): Promise<{ data?: { claims?: unknown } | null; error?: unknown }> {
  return sb.auth.getClaims(jwt).catch((thrown: unknown) => {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (!CLAIM_DECODE_FAILURES.some((needle) => message.includes(needle))) throw thrown;
    logWarn("auth.claim_rejected", { claim: "malformed" });
    return {
      data: null,
      error: new AuthError(
        "UNAUTHENTICATED: session expired or invalid; sign in again",
        401,
        "UNAUTHENTICATED",
      ),
    };
  });
}

/**
 * Assert that verified claims describe a TUTOR of THIS deployment.
 *
 * `claims` has already had its SIGNATURE verified and its `exp` enforced by
 * `getClaims`; everything below is a claim assertion the gateway owns. Each
 * branch fails CLOSED with a typed `AuthError` naming what was wrong. There is no
 * permissive path and no fallback.
 */
function assertTenantClaims(claims: Record<string, unknown>, supabaseUrl: string): void {
  // `aud` — the deployment this token was minted FOR.
  if (!audienceValues(claims.aud).includes(expectedAudience().toLowerCase())) {
    failClaim("aud", "audience mismatch");
  }

  // `iss` — the deployment that minted it. Compared case-insensitively because a
  // URL HOST is case-insensitive and a hand-entered `SUPABASE_URL` must not lock
  // every tutor out over the casing of the same origin.
  const presentedIssuer = typeof claims.iss === "string" ? claims.iss : "";
  if (trimTrailingSlash(presentedIssuer).toLowerCase() !== expectedIssuer(supabaseUrl).toLowerCase()) {
    failClaim("iss", "issuer mismatch");
  }

  // `role` — a project credential is not a tutor. Two directions, never-list
  // first so no env override can re-open it, then the allowlist.
  const role = typeof claims.role === "string" ? claims.role.trim().toLowerCase() : "";
  if (JWT_ROLES_NEVER.has(role) || !allowedTenantRoles().has(role)) {
    failClaim("role", "role is not an end-user role");
  }

  // `nbf` — a signed, unexpired token that is not valid YET is refused. Only
  // checked when present: `nbf` is an optional claim, and a malformed one is
  // treated exactly like a future one rather than ignored.
  if (claims.nbf !== undefined && claims.nbf !== null) {
    const nbf = claims.nbf;
    if (typeof nbf !== "number" || !Number.isFinite(nbf)) {
      failClaim("nbf", "not valid before (nbf)");
    }
    if (nbf * 1000 > Date.now() + JWT_NBF_LEEWAY_MS) {
      failClaim("nbf", "not valid before (nbf)");
    }
  }

  // `exp` — `getClaims` already enforced this and `allowExpired` is not set.
  // Repeated so the gateway's contract does not depend on an option a future
  // edit could add to a call it does not make today. Same message as the
  // unverified-claims branch above, because it is the same tutor-facing state.
  const exp = claims.exp;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp * 1000 <= Date.now()) {
    failClaim("exp", "session expired or invalid; sign in again");
  }

  // `session_id` — present on every GoTrue access token and absent from the
  // project-level `anon`/`service_role` keys. Its presence proves this is a user
  // access token, NOT that the session is still live (see the block header).
  if (typeof claims.session_id !== "string" || claims.session_id.length === 0) {
    failClaim("session_id", "session id missing");
  }
}

export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const supabaseUrl =
    Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !supabaseKey) {
    throw new AuthError(
      "INTERNAL: gateway auth misconfigured",
      500,
      "INTERNAL",
    );
  }
  const sb = createSb(supabaseUrl, supabaseKey);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    throw new AuthError("AUTH_REQUIRED: missing authorization header", 401, "AUTH_REQUIRED");
  }

  // The dev-auth path is OPT-IN (see isDevAuthEnabled). It authenticates by
  // trusting an `x-tutor-id` header the CALLER supplies, so it must be closed
  // unless an operator deliberately opened it — not open unless the environment
  // happened to look like production. Previously that gate was `isDeployed()`,
  // which fails open on a real deployment with unset/misspelled env vars.
  // Ref: 10_Security.md §3 (AUTH-1), Rule 9.
  if (jwt.startsWith("mock-token-")) {
    if (!isDevAuthEnabled()) {
      throw new AuthError(
        "UNAUTHENTICATED: development tokens not permitted",
        401,
        "UNAUTHENTICATED",
      );
    }
    const tenantId =
      req.headers.get("x-tutor-id") ||
      req.headers.get("X-Tutor-Id") ||
      jwt.replace(/^mock-token-/i, "") ||
      "local-dev";
    return { tenantId };
  }

  if (jwt.length < JWT_MIN_LENGTH || jwt.length > JWT_MAX_LENGTH) {
    throw new AuthError("UNAUTHENTICATED: invalid token format", 401, "UNAUTHENTICATED");
  }

  const jwtParts = jwt.split(".");
  if (jwtParts.length !== 3) {
    throw new AuthError("UNAUTHENTICATED: malformed token", 401, "UNAUTHENTICATED");
  }

  for (const part of jwtParts) {
    if (!part || part.length === 0) {
      throw new AuthError("UNAUTHENTICATED: malformed token", 401, "UNAUTHENTICATED");
    }
  }

  let tenantId = req.headers.get("x-tutor-id") || req.headers.get("X-Tutor-Id") || "";

  // Identity is established by VERIFYING THE SIGNATURE of the token we were just
  // handed, against Supabase's JWKS, in-process. It used to be
  // `sb.auth.getUser(jwt)` — an outbound HTTPS round trip to the Auth server on
  // EVERY authenticated request, purely to read `user.id` out of a JWT the caller
  // already supplied. The 14-day attendance heatmap alone issues 14 gateway
  // calls, so one dashboard load cost roughly 20 Auth round trips before any
  // Turso query. `getClaims` does the same verification locally and caches the
  // JWKS, so the network is touched only on cache miss / key rotation.
  //
  // WHAT MUST NOT RELAX HERE. `getClaims` is signature verification, NOT a decode:
  //   - `allowExpired` is deliberately NOT set, so `exp` is still enforced.
  //   - a `claims` object is only trusted when `error` is null; there is no
  //     "decode anyway" path, because accepting unverified claims here would let
  //     a caller assert any `sub` — i.e. authenticate as any tenant.
  //   - the caller-supplied `x-tutor-id` is still checked for EQUALITY against
  //     `sub` below, exactly as before.
  //   - it validates `exp` and NOTHING else. `aud`/`iss`/`role`/`nbf`/`session_id`
  //     are asserted by `assertTenantClaims` immediately after — see the claim
  //     policy block above for why a signature is not an identity.
  //   - it is called through `verifyClaims`, which converts the two malformed
  //     inputs it THROWS rather than returns into the same typed 401, and
  //     re-throws everything else so an Auth outage is never disguised as an
  //     expired session.
  const { data: claimData, error: claimErr } = await verifyClaims(sb, jwt);
  const claims: Record<string, unknown> | null = claimErr
    ? null
    : ((claimData?.claims as Record<string, unknown> | undefined) ?? null);
  if (!claims || typeof claims.sub !== "string" || claims.sub.length === 0) {
    // Expired, revoked, malformed, or badly signed — the web maps this to its
    // re-login state (RFC-003 G-AUTH; apps/web/src/lib/app-errors.ts).
    throw new AuthError(
      "UNAUTHENTICATED: session expired or invalid; sign in again",
      401,
      "UNAUTHENTICATED",
    );
  }
  const verifiedUserId = claims.sub;

  // Signed, unexpired, non-empty `sub` — and only now: is it a TUTOR of this
  // deployment? Runs BEFORE the tenant is derived, so a privileged token is
  // refused before it can name anybody.
  assertTenantClaims(claims, supabaseUrl);

  if (!tenantId) {
    tenantId = verifiedUserId;
  }

  if (!tenantId) {
    throw new AuthError(
      "UNAUTHENTICATED: tenant identification failed",
      401,
      "UNAUTHENTICATED",
    );
  }

  if (verifiedUserId !== tenantId) {
    logError("auth.tenant_mismatch", {
      tokenUserId: verifiedUserId,
      headerTenantId: tenantId,
    });
    throw new AuthError("UNAUTHENTICATED: tenant mismatch", 401, "UNAUTHENTICATED");
  }

  const signature = req.headers.get("x-signature") || req.headers.get("X-Signature");
  const timestamp = req.headers.get("x-timestamp") || req.headers.get("X-Timestamp");
  const nonce = req.headers.get("x-nonce") || req.headers.get("X-Nonce");

  const method = req.method;
  const isMutation =
    method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";

  // Required on EVERY method, not only mutations. The binding is what ties the
  // caller-supplied `x-db-url`/`x-db-token` headers to this tenant; skipping it
  // on GET/HEAD meant a read could name any database in the fleet and the
  // gateway would connect to it. The web client already signs every request
  // (apps/web/src/server/get-db.ts:229-241), so this costs the honest caller
  // nothing. 10_Security.md §7 request binding, fail-closed.
  if (!signature || !timestamp || !nonce) {
    throw new AuthError(
      "UNAUTHENTICATED: signature, timestamp, and nonce are required",
      401,
      "UNAUTHENTICATED",
    );
  }

  // All three are guaranteed present by the gate above, so this is no longer a
  // conditional — a present-but-invalid header is now a hard failure rather than
  // being treated as absent and skipped.
  {
    if (signature.length < HMAC_MIN_LENGTH || signature.length > HMAC_MAX_LENGTH) {
      throw new AuthError(
        "UNAUTHENTICATED: invalid signature format",
        401,
        "UNAUTHENTICATED",
      );
    }

    if (!/^[a-f0-9]+$/i.test(signature)) {
      throw new AuthError(
        "UNAUTHENTICATED: invalid signature format",
        401,
        "UNAUTHENTICATED",
      );
    }

    const tsNum = parseInt(timestamp, 10);
    if (isNaN(tsNum)) {
      throw new AuthError("UNAUTHENTICATED: invalid timestamp", 401, "UNAUTHENTICATED");
    }

    const skew = Math.abs(Date.now() - tsNum);
    if (skew > 120_000) {
      logWarn("auth.timestamp_skew", { tenantId, skew, maxAllowed: 120_000 });
      throw new AuthError(
        "UNAUTHENTICATED: request expired; clock skew exceeds 120s",
        401,
        "UNAUTHENTICATED",
      );
    }

    const dbUrl = req.headers.get("x-db-url") || req.headers.get("X-Db-Url") || "";
    const dbToken = req.headers.get("x-db-token") || req.headers.get("X-Db-Token") || "";
    const dataToSign = `${tenantId}:${dbUrl}:${dbToken}:${timestamp}:${nonce || ""}`;
    const valid = await hmacVerify(dataToSign, signature);
    if (!valid) {
      logError("auth.hmac_failure", { tenantId });
      throw new AuthError(
        "UNAUTHENTICATED: signature verification failed",
        401,
        "UNAUTHENTICATED",
      );
    }
  }

  if (isMutation) {
    if (
      !checkRateLimit(
        `tenant:${tenantId}:mutation`,
        MUTATION_RATE_LIMIT_MAX,
        MUTATION_RATE_LIMIT_WINDOW_MS,
      )
    ) {
      logWarn("auth.mutation_rate_limited", { tenantId });
      throw new AuthError("RATE_LIMITED: too many mutations", 429, "RATE_LIMITED");
    }
  }

  if (!checkRateLimit(`tenant:${tenantId}`, TENANT_RATE_LIMIT_MAX, TENANT_RATE_LIMIT_WINDOW_MS)) {
    logWarn("auth.tenant_rate_limited", { tenantId });
    throw new AuthError("RATE_LIMITED: too many requests", 429, "RATE_LIMITED");
  }

  return { tenantId };
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 401, code = "UNAUTHENTICATED") {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}
