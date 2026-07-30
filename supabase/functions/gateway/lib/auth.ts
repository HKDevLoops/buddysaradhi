import { createClient as createSb } from "https://esm.sh/@supabase/supabase-js@2";
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
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !supabaseKey) {
    throw new AuthError("server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500);
  }
  const sb = createSb(supabaseUrl, supabaseKey);

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!jwt) {
    throw new AuthError("unauthorized: missing authorization header", 401);
  }

  if (jwt.length < JWT_MIN_LENGTH || jwt.length > JWT_MAX_LENGTH) {
    throw new AuthError("unauthorized: invalid token format", 401);
  }

  const jwtParts = jwt.split(".");
  if (jwtParts.length !== 3) {
    throw new AuthError("unauthorized: malformed token", 401);
  }

  for (const part of jwtParts) {
    if (!part || part.length === 0) {
      throw new AuthError("unauthorized: malformed token", 401);
    }
  }

  let tenantId = req.headers.get("x-tutor-id") || req.headers.get("X-Tutor-Id") || "";

  const { data: ud, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !ud.user) {
    throw new AuthError("unauthorized: invalid or expired token", 401);
  }

  if (!tenantId) {
    tenantId = ud.user.id;
  }

  if (!tenantId) {
    throw new AuthError("unauthorized: tenant identification failed", 401);
  }

  if (ud.user.id !== tenantId) {
    logError("auth.tenant_mismatch", {
      tokenUserId: ud.user.id,
      headerTenantId: tenantId,
    });
    throw new AuthError("unauthorized: tenant mismatch", 401);
  }

  const signature = req.headers.get("x-signature") || req.headers.get("X-Signature");
  const timestamp = req.headers.get("x-timestamp") || req.headers.get("X-Timestamp");
  const nonce = req.headers.get("x-nonce") || req.headers.get("X-Nonce");

  const method = req.method;
  const isMutation = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";

  if (isMutation) {
    if (!signature || !timestamp || !nonce) {
      throw new AuthError("unauthorized: signature, timestamp, and nonce required for mutations", 401);
    }
  }

  if (signature && timestamp) {
    if (signature.length < HMAC_MIN_LENGTH || signature.length > HMAC_MAX_LENGTH) {
      throw new AuthError("unauthorized: invalid signature format", 401);
    }

    if (!/^[a-f0-9]+$/i.test(signature)) {
      throw new AuthError("unauthorized: invalid signature format", 401);
    }

    const tsNum = parseInt(timestamp, 10);
    if (isNaN(tsNum)) {
      throw new AuthError("unauthorized: invalid timestamp", 401);
    }

    const skew = Math.abs(Date.now() - tsNum);
    if (skew > 120_000) {
      logWarn("auth.timestamp_skew", { tenantId, skew, maxAllowed: 120_000 });
      throw new AuthError("unauthorized: request expired", 401);
    }

    const dbUrl = req.headers.get("x-db-url") || req.headers.get("X-Db-Url") || "";
    const dbToken = req.headers.get("x-db-token") || req.headers.get("X-Db-Token") || "";
    const dataToSign = `${tenantId}:${dbUrl}:${dbToken}:${timestamp}:${nonce || ""}`;
    const valid = await hmacVerify(dataToSign, signature);
    if (!valid) {
      logError("auth.hmac_failure", { tenantId });
      throw new AuthError("unauthorized: signature verification failed", 401);
    }
  }

  if (isMutation) {
    if (!checkRateLimit(`tenant:${tenantId}:mutation`, MUTATION_RATE_LIMIT_MAX, MUTATION_RATE_LIMIT_WINDOW_MS)) {
      logWarn("auth.mutation_rate_limited", { tenantId });
      throw new AuthError("rate limited: too many mutations", 429);
    }
  }

  if (!checkRateLimit(`tenant:${tenantId}`, TENANT_RATE_LIMIT_MAX, TENANT_RATE_LIMIT_WINDOW_MS)) {
    logWarn("auth.tenant_rate_limited", { tenantId });
    throw new AuthError("rate limited: too many requests", 429);
  }

  return { tenantId };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
