import { createClient, Client } from "@libsql/client";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Per-user cloud DB client cache
// Each tutor has their own Turso DB. Credentials come from Supabase
// user_metadata (db_url + db_token) set by the /api/provision API route.
// Clients are cached in-process by db_url to avoid re-connecting each call.
// ---------------------------------------------------------------------------
const clientCache = new Map<string, Client>();
const prismaCache = new Map<string, any>();

function normalizeLocalDbUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  let filePath = url.slice("file:".length);
  if (!filePath.startsWith("/") && !filePath.startsWith("\\") && !/^[a-zA-Z]:/.test(filePath)) {
    filePath = resolve(filePath);
  }
  const cleanPath = filePath.replace(/^\/+/, "").replace(/\\/g, "/");
  return `file:///${cleanPath}`;
}

/**
 * Returns a raw @libsql/client connected to the user's personal Turso cloud DB.
 * Uses the libsql:// URL and auth token from user_metadata.
 */
export function getDb(dbUrl: string, dbToken: string): Client {
  const normalized = normalizeLocalDbUrl(dbUrl);
  const existing = clientCache.get(normalized);
  if (existing) return existing;

  const client = createClient({ url: normalized, authToken: dbToken });
  clientCache.set(normalized, client);
  return client;
}

/**
 * Returns a PrismaClient connected to the user's personal Turso cloud DB.
 */
import { createLibsqlProxy } from "@/lib/libsql-proxy";

export async function getPrismaClientAsync(dbUrl: string, dbToken: string): Promise<any> {
  const existing = prismaCache.get(dbUrl);
  if (existing) return existing;

  const libsql = getDb(dbUrl, dbToken);
  const proxy = createLibsqlProxy(libsql);
  prismaCache.set(dbUrl, proxy);
  return proxy;
}

export function getPrismaClient(dbUrl: string, dbToken: string): any {
  const existing = prismaCache.get(dbUrl);
  if (existing) return existing;

  const libsql = getDb(dbUrl, dbToken);
  const proxy = createLibsqlProxy(libsql);
  prismaCache.set(dbUrl, proxy);
  return proxy;
}

/**
 * Sentinel value placed in user_metadata when a real DB has not yet been
 * provisioned (legacy/dummy value from the old provision page).
 */
const DUMMY_SENTINELS = ["dummy-local-dev-url", "file:", "dummy"];

function isDummyUrl(url: string): boolean {
  return DUMMY_SENTINELS.some((s) => url.includes(s));
}

/**
 * Extracts db_url + db_token from a Supabase user object.
 *
 * Resolution order:
 *   1. user_metadata.db_url + db_token (real Turso DB, not a dummy placeholder)
 *   2. TURSO_DATABASE_URL + TURSO_AUTH_TOKEN environment variables
 *      (shared DB for dev, staging, or Vercel preview deployments)
 *
 * Throws a typed DB_NOT_PROVISIONED error if no valid credentials are found.
 */
export function getDbCredentials(
  userMetadata: Record<string, unknown> | undefined
): { dbUrl: string; dbToken: string } {
  const metaUrl = userMetadata?.db_url as string | undefined;
  const metaToken = userMetadata?.db_token as string | undefined;

  // Use user's real Turso DB credentials if they look valid
  if (metaUrl && metaToken && !isDummyUrl(metaUrl)) {
    return { dbUrl: metaUrl, dbToken: metaToken };
  }

  // Fall back to the shared/environment database
  // This covers:
  //   - Local development (file: SQLite)
  //   - Vercel Preview deployments with a shared Turso DB
  //   - Users whose provision webhook failed (dummy credentials stored)
  const envUrl = process.env.TURSO_DATABASE_URL;
  const envToken = process.env.TURSO_AUTH_TOKEN;

  if (envUrl && envToken) {
    return { dbUrl: envUrl, dbToken: envToken };
  }

  // No valid credentials at all — user has not been provisioned
  throw new Error(
    "DB_NOT_PROVISIONED: User database is not yet provisioned. " +
      "Please wait on the provisioning screen or contact support."
  );
}
