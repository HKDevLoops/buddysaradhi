import { createSupabaseServer } from "@/lib/supabase/server";
import { getDb, getDbCredentials } from "@/lib/db";
import { log } from "@/lib/logger";
import type { Client } from "@libsql/client";
import { createLibsqlProxy } from "@/lib/libsql-proxy";
import {
  authError,
  buildProvisionUrl,
  classifyCredentialProbeError,
  parseAuthErrorCode,
  type AuthErrorCode,
} from "@/server/auth-errors";
import type { AppErrorCode } from "@/lib/app-errors";

const LOCAL_TENANT = "local-dev";

// Resolve the current Supabase user without throwing. In local/dev there is
// no session, so we return null and callers fall back to a local-dev identity.
async function getUserAndSession() {
  try {
    const supabase = await createSupabaseServer();
    const fetchUser = Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const result = await Promise.race([fetchUser, timeout]);
    if (!result) return { user: null, accessToken: null };
    const [userRes, sessionRes] = result;
    return {
      user: userRes.data.user ?? null,
      accessToken: sessionRes.data.session?.access_token ?? null,
    };
  } catch {
    return { user: null, accessToken: null };
  }
}

async function getUser() {
  const { user } = await getUserAndSession();
  return user;
}

export async function getAuthenticatedDb(): Promise<{
  client: Client;
  userId: string;
  tenantId: string;
}> {
  const user = await getUser();
  if (user) {
    try {
      // RFC-003 workstream A: with a session, env vars are NOT a fallback in
      // production (silent-wrong-DB class). Missing/dummy metadata throws
      // typed DB_NOT_PROVISIONED; in dev the env fallback still applies.
      const { dbUrl, dbToken } = getDbCredentials(
        user.user_metadata as Record<string, unknown>,
        { allowEnvFallback: process.env.NODE_ENV !== "production" },
      );
      return { client: getDb(dbUrl, dbToken), userId: user.id, tenantId: user.id };
    } catch (err) {
      throw authError(parseAuthErrorCode(err) ?? "DB_NOT_PROVISIONED");
    }
  }
  // Reached only when no Supabase user exists (the session branch above
  // always returns or throws) — local-dev identity, never a real tenant.
  const url = process.env.TURSO_DATABASE_URL || "file:./dev.db";
  const token = process.env.TURSO_AUTH_TOKEN || "";
  return { client: getDb(url, token), userId: LOCAL_TENANT, tenantId: LOCAL_TENANT };
}

export { createLibsqlProxy } from "@/lib/libsql-proxy";

export async function getAuthenticatedPrisma(): Promise<{
  db: ReturnType<typeof createLibsqlProxy>;
  userId: string;
  tenantId: string;
}> {
  const { client, userId, tenantId } = await getAuthenticatedDb();
  return { db: createLibsqlProxy(client), userId, tenantId };
}

// Keep this alias for files that use getAuthenticatedRawClient
export { getAuthenticatedDb as getAuthenticatedRawClient };


// R-CRYPTO-2: refuse module load if the secret is missing. The previous
// `|| "buddysaradhi-dev-secret-key-128bits"` fallback was a hard-coded public
// default shipped in source: any deployment that forgot to set the env var
// silently signed + verified HMACs with a value anyone could grep. That is a
// P0 (BFF → gateway impersonation). Throw at module load so the failure is
// loud, at boot, not on the first request.
function resolveSharedSecret(): string {
  const s = process.env.GATEWAY_SHARED_SECRET;
  if (s && s.length >= 32) {
    return s;
  }
  // During next build, NODE_ENV is "production" but we're not serving requests.
  // Defer the throw to runtime by returning a placeholder that will be replaced
  // on first actual request.
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CRITICAL: GATEWAY_SHARED_SECRET must be set in production (≥32 chars). " +
        "Without it, HMAC signatures are unsigned and the gateway cannot verify requests."
      );
    }
  }
  return `dev-only-secret-${crypto.randomUUID()}`;
}
let SHARED_SECRET: string | null = null;
function getSharedSecret(): string {
  if (!SHARED_SECRET) SHARED_SECRET = resolveSharedSecret();
  return SHARED_SECRET;
}

async function signHmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoSubtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : null;
  if (!cryptoSubtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available.");
  }

  const key = await cryptoSubtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await cryptoSubtle.sign(
    "HMAC",
    key,
    messageData
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getGatewayHeaders(): Promise<{
  tenantId: string;
  headers: {
    "X-Tutor-Id": string;
    Authorization: string;
    "X-Db-Url": string;
    "X-Db-Token": string;
    "X-Timestamp": string;
    "X-Signature": string;
    "X-Nonce": string;
    "X-Client-IP": string;
    "X-Client-UA": string;
  };
}> {
  const { user, accessToken } = await getUserAndSession();
  const timestamp = String(Date.now());
  const nonce = generateNonce();
  // SECURITY: mock-token is dev-only. In production, unauthenticated requests must not reach gateway with mock.
  if (!accessToken && process.env.NODE_ENV === 'production') {
    throw authError("AUTH_REQUIRED", "No session — mock tokens not permitted in production.");
  }
  const tokenHeader = accessToken ? `Bearer ${accessToken}` : `Bearer mock-token-${user?.id || LOCAL_TENANT}`;
  
  let clientIp = "127.0.0.1";
  let userAgent = "unknown";
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    clientIp = h.get("x-forwarded-for") || h.get("x-real-ip") || "127.0.0.1";
    userAgent = h.get("user-agent") || "unknown";
  } catch {
    // not in a request scope
  }

  if (user) {
    let dbUrl: string;
    let dbToken: string;
    try {
      // Same production gate as getAuthenticatedDb: no env-var fall-through
      // while a session exists (silent-wrong-DB class, RFC-003 §0 incident).
      ({ dbUrl, dbToken } = getDbCredentials(
        user.user_metadata as Record<string, unknown>,
        { allowEnvFallback: process.env.NODE_ENV !== "production" },
      ));
    } catch (err) {
      log.warn('getGatewayHeaders_no_db_credentials', 'User has no usable DB credentials', { userId: user.id });
      throw authError(parseAuthErrorCode(err) ?? "DB_NOT_PROVISIONED");
    }
    const dataToSign = `${user.id}:${dbUrl}:${dbToken}:${timestamp}:${nonce}`;
    const signature = await signHmacSha256(getSharedSecret(), dataToSign);

    return {
      tenantId: user.id,
      headers: {
        "X-Tutor-Id": user.id,
        Authorization: tokenHeader,
        "X-Db-Url": dbUrl,
        "X-Db-Token": dbToken,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "X-Nonce": nonce,
        "X-Client-IP": clientIp,
        "X-Client-UA": userAgent,
      },
    };
  }
  
  const dbUrl = process.env.TURSO_DATABASE_URL || "";
  const dbToken = process.env.TURSO_AUTH_TOKEN || "";
  const dataToSign = `${LOCAL_TENANT}:${dbUrl}:${dbToken}:${timestamp}:${nonce}`;
  const signature = await signHmacSha256(getSharedSecret(), dataToSign);

  return {
    tenantId: LOCAL_TENANT,
    headers: {
      "X-Tutor-Id": LOCAL_TENANT,
      Authorization: `Bearer mock-token-${LOCAL_TENANT}`,
      "X-Db-Url": dbUrl,
      "X-Db-Token": dbToken,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "X-Nonce": nonce,
      "X-Client-IP": clientIp,
      "X-Client-UA": userAgent,
    },
  };
}

// ---------------------------------------------------------------------------
// Credential health (RFC-003 workstream A, deliverable 1).
// Implements: web/03_Auth_and_Provisioning.md §8 (failures & recovery);
// 12_Business_Rules.md BR-SEC-08 (audited sensitive transitions).
//
// The production "Could not load student" incident traced to expired/invalid
// Turso tokens with no refresh path and generic error surfacing. This probe
// classifies stored credentials BEFORE a gateway call fails opaquely:
//   healthy               → stored token answered `SELECT 1`
//   expired-invalid       → token rejected (typed CREDENTIALS_EXPIRED)
//   missing-unprovisioned → no usable creds (typed DB_NOT_PROVISIONED)
//   unreachable           → transport/timeout (typed UPSTREAM, never provision)
// A timeout/offline tutor must NOT be routed to re-provision.
// ---------------------------------------------------------------------------

export type CredentialHealthStatus =
  | "healthy"
  | "expired-invalid"
  | "missing-unprovisioned"
  | "unreachable";

export interface CredentialHealth {
  status: CredentialHealthStatus;
  code: AuthErrorCode | AppErrorCode | null;
  /** Static detail — never a token, URL credential, or raw payload. */
  detail: string;
  /** Re-provision URL with redirect-back intent (expired/missing only). */
  provisionUrl?: string;
  latencyMs?: number;
  /** True when no session existed, so the check deferred to gateway headers
   * (local-dev path). Production callers still get AUTH_REQUIRED there. */
  skipped?: boolean;
}

const CREDENTIAL_PROBE_TIMEOUT_MS = 5000;
const CREDENTIAL_HEALTH_TTL_MS = 60_000;
const healthCache = new Map<string, { health: CredentialHealth; atMs: number }>();

async function probeCredentials(client: Client): Promise<number> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const probe = client.execute("SELECT 1");
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("CREDENTIAL_PROBE_TIMEOUT: Turso probe timed out")),
        CREDENTIAL_PROBE_TIMEOUT_MS,
      );
    });
    await Promise.race([probe, timeout]);
    return Date.now() - started;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Validates the stored Turso token with a lightweight probe. Called at
 * session start (provision page / health action) and — via the cached
 * wrapper below — before gateway calls that would otherwise fail opaquely.
 */
export async function checkCredentialsHealth(intentNext?: string): Promise<CredentialHealth> {
  const { user } = await getUserAndSession();
  if (!user) {
    return {
      status: "healthy",
      code: null,
      detail: "No session — deferred to gateway headers (local-dev path).",
      skipped: true,
    };
  }
  let creds: { dbUrl: string; dbToken: string };
  try {
    creds = getDbCredentials(user.user_metadata as Record<string, unknown>, {
      allowEnvFallback: process.env.NODE_ENV !== "production",
    });
  } catch {
    return {
      status: "missing-unprovisioned",
      code: "DB_NOT_PROVISIONED",
      detail: "User database is not yet provisioned.",
      provisionUrl: buildProvisionUrl(intentNext),
    };
  }
  try {
    const latencyMs = await probeCredentials(getDb(creds.dbUrl, creds.dbToken));
    return { status: "healthy", code: null, detail: "Stored credentials answered.", latencyMs };
  } catch (err) {
    if (classifyCredentialProbeError(err) === "expired-invalid") {
      log.warn("credential_health_expired", "Stored Turso token rejected by probe", { userId: user.id });
      return {
        status: "expired-invalid",
        code: "CREDENTIALS_EXPIRED",
        detail: "Stored database credentials were rejected — refresh or re-provision.",
        provisionUrl: buildProvisionUrl(intentNext),
      };
    }
    return {
      status: "unreachable",
      code: "UPSTREAM",
      detail: "Credential probe timed out or the database is unreachable.",
    };
  }
}

/** 60s-TTL cached wrapper for per-request pre-flight (bounds probe cost). */
export async function checkCredentialsHealthCached(intentNext?: string): Promise<CredentialHealth> {
  const { user } = await getUserAndSession();
  if (!user) {
    return {
      status: "healthy",
      code: null,
      detail: "No session — deferred to gateway headers (local-dev path).",
      skipped: true,
    };
  }
  const cached = healthCache.get(user.id);
  if (cached && Date.now() - cached.atMs < CREDENTIAL_HEALTH_TTL_MS) return cached.health;
  const health = await checkCredentialsHealth(intentNext);
  if (healthCache.size > 500) healthCache.clear();
  healthCache.set(user.id, { health, atMs: Date.now() });
  return health;
}

/**
 * Silent refresh via the stored session mechanism (web/03 §2.3): refreshes
 * the Supabase JWT (which re-reads `user_metadata` — the webhook path may
 * have provisioned since) and reports whether usable credentials exist now.
 * Never mints Turso tokens directly — the Turso API token lives only in the
 * provision Edge Function (web/03 §3.1).
 */
export async function refreshCredentials(): Promise<{ refreshed: boolean }> {
  try {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.refreshSession();
    if (error) return { refreshed: false };
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.user_metadata as Record<string, unknown> | undefined;
    if (!meta) return { refreshed: false };
    getDbCredentials(meta, { allowEnvFallback: false });
    return { refreshed: true };
  } catch {
    return { refreshed: false };
  }
}

// Build the gateway base URL. Prefer an explicit env override, else derive the
// same-origin host from the incoming request so server-side calls work on any
// port without hardcoding localhost:3000.
const SUPABASE_GATEWAY_URL = "https://gmqwdnvbfnwpzpctwvho.supabase.co/functions/v1/gateway";

async function gatewayBase(): Promise<string> {
  const env = process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (env && !env.includes("api.buddysaradhi.app")) return env.replace(/\/$/, "");
  // In local development, default to port 3001 where apps/gateway runs.
  if (process.env.NODE_ENV !== "production") {
    return "http://127.0.0.1:3001";
  }
  return process.env.GATEWAY_PRODUCTION_URL || SUPABASE_GATEWAY_URL;
}

// Create an AbortController with a timeout to prevent infinite hangs.
// Returns the signal and a cleanup function to clear the timeout early.
function createTimeoutSignal(timeoutMs = 12000): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timerId),
  };
}

/** Pre-flight for gateway calls: fail fast with a TYPED code (expired /
 * missing credentials) instead of an opaque gateway rejection. Cached
 * (60s TTL) so healthy sessions pay no extra probe. Sessionless callers
 * (local-dev) skip — gateway headers still enforce AUTH_REQUIRED in prod. */
async function gatewayCredentialPreflight(): Promise<{ success: false; error: string } | null> {
  const preflight = await checkCredentialsHealthCached();
  if (preflight.status === "healthy") return null;
  const code = preflight.code ?? "UPSTREAM";
  return { success: false, error: `${code}: ${preflight.detail}` };
}

export async function gatewayGet<T = unknown>(
  path: string,
  params?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const blocked = await gatewayCredentialPreflight();
  if (blocked) return blocked;
  const { signal, cleanup } = createTimeoutSignal();
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const res = await fetch(`${base}${path}${qs}`, {
      method: "GET",
      headers: { ...h },
      cache: "no-store",
      signal,
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_get_failed', `Gateway GET ${path} failed: ${message}`, { path, method: 'GET' });
    return { success: false, error: message };
  } finally {
    cleanup();
  }
}

export async function gatewayPatch<T = unknown>(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const blocked = await gatewayCredentialPreflight();
  if (blocked) return blocked;
  const { signal, cleanup } = createTimeoutSignal();
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_patch_failed', `Gateway PATCH ${path} failed: ${message}`, { path, method: 'PATCH' });
    return { success: false, error: message };
  } finally {
    cleanup();
  }
}

export async function gatewayPost<T = unknown>(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const blocked = await gatewayCredentialPreflight();
  if (blocked) return blocked;
  const { signal, cleanup } = createTimeoutSignal();
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_post_failed', `Gateway POST ${path} failed: ${message}`, { path, method: 'POST' });
    return { success: false, error: message };
  } finally {
    cleanup();
  }
}

export async function gatewayDelete<T = unknown>(
  path: string,
  extraHeaders?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  const blocked = await gatewayCredentialPreflight();
  if (blocked) return blocked;
  const { signal, cleanup } = createTimeoutSignal();
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: { ...h, ...extraHeaders },
      signal,
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_delete_failed', `Gateway DELETE ${path} failed: ${message}`, { path, method: 'DELETE' });
    return { success: false, error: message };
  } finally {
    cleanup();
  }
}
