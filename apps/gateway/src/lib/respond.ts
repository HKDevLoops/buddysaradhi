import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { PrismaClient } from "../prisma-client";
import { getPrismaClient } from "../db";
import { createHmac } from "crypto";

export interface ReqContext {
  db: PrismaClient;
  tenantId: string;
}

const SHARED_SECRET = process.env.GATEWAY_SHARED_SECRET || "buddysaradhi-dev-secret-key-128bits";

function validateDbUrl(dbUrl: string): boolean {
  // Allow Turso databases starting with libsql: or https:
  if (dbUrl.startsWith("libsql://") || dbUrl.startsWith("https://")) {
    return true;
  }
  // Allow safe local relative paths
  if (
    dbUrl.startsWith("file:./") ||
    dbUrl.startsWith("file:../") ||
    dbUrl === "file:dev.db" ||
    dbUrl.startsWith("file:prisma/") ||
    dbUrl.includes("dev.db")
  ) {
    return true;
  }
  return false;
}

/**
 * Resolves the per-request tenant + Prisma client, performing security audits.
 */
export function getContext(c: Context): ReqContext {
  const dbUrl = c.req.header("X-Db-Url") || process.env.DATABASE_URL || "file:./dev.db";
  const dbToken = c.req.header("X-Db-Token") || "";
  const tenantId = c.req.header("X-Tutor-Id") || "local-dev";
  const timestamp = c.req.header("X-Timestamp") || "";
  const signature = c.req.header("X-Signature") || "";

  // 1. Database URL injection protection
  if (!validateDbUrl(dbUrl)) {
    throw new Error("SECURITY_VIOLATION: Untrusted database URL configuration.");
  }

  // 2. Tenant UUID/String check
  if (!tenantId || tenantId.length < 5) {
    throw new Error("SECURITY_VIOLATION: Invalid tenant ID.");
  }

  // 3. Signature verification (mandatory if headers are present in production/dev)
  if (c.req.header("X-Db-Url") && c.req.header("X-Tutor-Id")) {
    const data = `${tenantId}:${dbUrl}:${dbToken}:${timestamp}`;
    const computed = createHmac("sha256", SHARED_SECRET).update(data).digest("hex");
    if (computed !== signature) {
      throw new Error("SECURITY_VIOLATION: Header signature verification failed.");
    }
  }

  const db = getPrismaClient(dbUrl, dbToken);
  return { db, tenantId };
}

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data } as const, status);
}

export function fail(c: Context, error: string, status: ContentfulStatusCode = 400) {
  return c.json({ success: false, error } as const, status);
}
