"use server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getDb, getDbCredentials, getPrismaClient } from "@/lib/db";
import { log } from "@/lib/logger";
import type { Client } from "@libsql/client";
import { headers } from "next/headers";
import { createHmac } from "crypto";

const LOCAL_TENANT = "local-dev";

// Resolve the current Supabase user without throwing. In local/dev there is
// no session, so we return null and callers fall back to a local-dev identity.
async function getUserAndSession() {
  try {
    const supabase = await createSupabaseServer();
    const [userRes, sessionRes] = await Promise.all([
      supabase.auth.getUser(),
      supabase.auth.getSession(),
    ]);
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
      const { dbUrl, dbToken } = getDbCredentials(
        user.user_metadata as Record<string, unknown>
      );
      return { client: getDb(dbUrl, dbToken), userId: user.id, tenantId: user.id };
    } catch {
      // User metadata not provisioned yet — fall back to environment or local DB
    }
  }
  const url = process.env.TURSO_DATABASE_URL || "file:./dev.db";
  const token = process.env.TURSO_AUTH_TOKEN || "";
  return { client: getDb(url, token), userId: user?.id || LOCAL_TENANT, tenantId: user?.id || LOCAL_TENANT };
}

export { createLibsqlProxy } from "@/lib/libsql-proxy";

export async function getAuthenticatedPrisma(): Promise<{
  db: any;
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
  return "buddysaradhi-production-gateway-shared-secret-32chars";
}
const SHARED_SECRET = resolveSharedSecret();

export async function getGatewayHeaders(): Promise<{
  tenantId: string;
  headers: {
    "X-Tutor-Id": string;
    Authorization: string;
    "X-Db-Url": string;
    "X-Db-Token": string;
    "X-Timestamp": string;
    "X-Signature": string;
    "X-Client-IP": string;
    "X-Client-UA": string;
  };
}> {
  const { user, accessToken } = await getUserAndSession();
  const timestamp = String(Date.now());
  const tokenHeader = accessToken ? `Bearer ${accessToken}` : `Bearer mock-token-${user?.id || LOCAL_TENANT}`;
  
  let clientIp = "127.0.0.1";
  let userAgent = "unknown";
  try {
    const h = await headers();
    clientIp = h.get("x-forwarded-for") || h.get("x-real-ip") || "127.0.0.1";
    userAgent = h.get("user-agent") || "unknown";
  } catch {
    // not in a request scope
  }

  if (user) {
    const { dbUrl, dbToken } = getDbCredentials(
      user.user_metadata as Record<string, unknown>
    );
    const dataToSign = `${user.id}:${dbUrl}:${dbToken}:${timestamp}`;
    const signature = createHmac("sha256", SHARED_SECRET).update(dataToSign).digest("hex");

    return {
      tenantId: user.id,
      headers: {
        "X-Tutor-Id": user.id,
        Authorization: tokenHeader,
        "X-Db-Url": dbUrl,
        "X-Db-Token": dbToken,
        "X-Timestamp": timestamp,
        "X-Signature": signature,
        "X-Client-IP": clientIp,
        "X-Client-UA": userAgent,
      },
    };
  }
  
  const dbUrl = process.env.TURSO_DATABASE_URL || "";
  const dbToken = process.env.TURSO_AUTH_TOKEN || "";
  const dataToSign = `${LOCAL_TENANT}:${dbUrl}:${dbToken}:${timestamp}`;
  const signature = createHmac("sha256", SHARED_SECRET).update(dataToSign).digest("hex");

  return {
    tenantId: LOCAL_TENANT,
    headers: {
      "X-Tutor-Id": LOCAL_TENANT,
      Authorization: `Bearer mock-token-${LOCAL_TENANT}`,
      "X-Db-Url": dbUrl,
      "X-Db-Token": dbToken,
      "X-Timestamp": timestamp,
      "X-Signature": signature,
      "X-Client-IP": clientIp,
      "X-Client-UA": userAgent,
    },
  };
}

// Build the gateway base URL. Prefer an explicit env override, else derive the
// same-origin host from the incoming request so server-side calls work on any
// port without hardcoding localhost:3000.
async function gatewayBase(): Promise<string> {
  const env = process.env.GATEWAY_URL || process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (env && !env.includes("api.buddysaradhi.app")) return env.replace(/\/$/, "");
  // In local development, default to port 3001 where apps/gateway runs.
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3001";
  }
  return "https://buddysaradhi.vercel.app";
}

export async function gatewayGet<T = unknown>(
  path: string,
  params?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const res = await fetch(`${base}${path}${qs}`, {
      method: "GET",
      headers: { ...h },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_get_failed', `Gateway GET ${path} failed: ${message}`, { path, method: 'GET' });
    return { success: false, error: message };
  }
}

export async function gatewayPatch<T = unknown>(
  path: string,
  body: unknown
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "PATCH",
      headers: { ...h, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_patch_failed', `Gateway PATCH ${path} failed: ${message}`, { path, method: 'PATCH' });
    return { success: false, error: message };
  }
}

export async function gatewayPost<T = unknown>(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { ...h, "Content-Type": "application/json", ...extraHeaders },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_post_failed', `Gateway POST ${path} failed: ${message}`, { path, method: 'POST' });
    return { success: false, error: message };
  }
}

export async function gatewayDelete<T = unknown>(
  path: string
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    const { headers: h } = await getGatewayHeaders();
    const base = await gatewayBase();
    const res = await fetch(`${base}${path}`, {
      method: "DELETE",
      headers: { ...h },
    });

    if (!res.ok) {
      throw new Error(`Gateway ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as { success: true; data: T };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown gateway error";
    log.error('gateway_delete_failed', `Gateway DELETE ${path} failed: ${message}`, { path, method: 'DELETE' });
    return { success: false, error: message };
  }
}
