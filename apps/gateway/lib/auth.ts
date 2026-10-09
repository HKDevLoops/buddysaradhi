// Implements: 17_API_Gateway_System.md §5 (one Supabase-JWT auth model) +
// RFC-003 G-AUTH/G-ERR (expiry-aware typed 401s the web dispatches on via
// apps/web/src/lib/app-errors.ts `extractServerCode`) + 10_Security.md §3.
// Every throw carries a leading `CODE: detail` message so index.ts can relay
// `{ success: false, error: CODE }` with the matching HTTP status (F-1 audit).
import { createClient as createSb } from "@supabase/supabase-js";
import { hmacVerify, checkRateLimit } from "./crypto.ts";
import { logWarn, logError } from "./log.ts";
import { isDeployed, isDevAuthEnabled } from "./env.ts";

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
  const { data: claimData, error: claimErr } = await (sb.auth as any).getClaims(jwt);
  const claims = claimErr ? null : (claimData?.claims ?? null);
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
