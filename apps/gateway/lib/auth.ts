// Implements: 17_API_Gateway_System.md §5 (one Supabase-JWT auth model) +
// RFC-003 G-AUTH/G-ERR (expiry-aware typed 401s the web dispatches on via
// apps/web/src/lib/app-errors.ts `extractServerCode`) + 10_Security.md §3.
// Every throw carries a leading `CODE: detail` message so index.ts can relay
// `{ success: false, error: CODE }` with the matching HTTP status (F-1 audit).
import { createClient as createSb } from "@supabase/supabase-js";
import { hmacVerify, checkRateLimit } from "./crypto.ts";
import { logWarn, logError } from "./log.ts";

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

  // mock-token bypass is DEV-ONLY. Supabase Edge sets DENO_DEPLOYMENT_ID on all
  // real deployments. If that var is present, the mock path is forbidden.
  // Ref: 10_Security.md §3 (AUTH-1), Rule 9 (no silent failures).
  if (jwt.startsWith("mock-token-")) {
    const isDeployed = typeof Deno !== "undefined" && !!Deno.env.get("DENO_DEPLOYMENT_ID");
    if (isDeployed) {
      throw new AuthError(
        "UNAUTHENTICATED: development tokens not permitted in production",
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

  const { data: ud, error: ue } = await (sb.auth as any).getUser(jwt);
  if (ue || !ud.user) {
    // Expired, revoked, or otherwise rejected Supabase JWT — the web maps this
    // to its re-login state (RFC-003 G-AUTH; apps/web/src/lib/app-errors.ts).
    throw new AuthError(
      "UNAUTHENTICATED: session expired or invalid; sign in again",
      401,
      "UNAUTHENTICATED",
    );
  }

  if (!tenantId) {
    tenantId = ud.user.id;
  }

  if (!tenantId) {
    throw new AuthError(
      "UNAUTHENTICATED: tenant identification failed",
      401,
      "UNAUTHENTICATED",
    );
  }

  if (ud.user.id !== tenantId) {
    logError("auth.tenant_mismatch", {
      tokenUserId: ud.user.id,
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

  if (isMutation) {
    if (!signature || !timestamp || !nonce) {
      throw new AuthError(
        "UNAUTHENTICATED: signature, timestamp, and nonce required for mutations",
        401,
        "UNAUTHENTICATED",
      );
    }
  }

  if (signature && timestamp) {
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
