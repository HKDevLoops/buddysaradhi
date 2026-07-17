import { createClient, Client } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { resolve } from "path";

// ---------------------------------------------------------------------------
// Per-user cloud DB client cache
// Each tutor has their own Turso DB. Credentials come from Supabase
// user_metadata (db_url + db_token) set by the provision-db Edge Function.
// Clients are cached in-process by db_url to avoid re-connecting each call.
// ---------------------------------------------------------------------------
const clientCache = new Map<string, Client>();
const prismaCache = new Map<string, PrismaClient>();

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
 *
 * No local-file fallback — always online cloud DB only.
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
export function getPrismaClient(dbUrl: string, dbToken: string): PrismaClient {
  const existing = prismaCache.get(dbUrl);
  if (existing) return existing;

  const libsql = getDb(dbUrl, dbToken);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new PrismaLibSQL(libsql) as any;
  const prisma = new PrismaClient({ adapter });
  
  prismaCache.set(dbUrl, prisma);
  return prisma;
}

/**
 * Extracts db_url + db_token from a Supabase user object.
 * Throws a typed error if the user is not yet provisioned.
 */
export function getDbCredentials(
  userMetadata: Record<string, unknown> | undefined
): { dbUrl: string; dbToken: string } {
  let dbUrl = userMetadata?.db_url as string | undefined;
  let dbToken = userMetadata?.db_token as string | undefined;

  // Fallback for local development or users who clicked "Try Again" when webhooks were down
  if (!dbUrl || dbUrl.includes("dummy-local-dev-url")) {
    dbUrl = process.env.TURSO_DATABASE_URL;
    dbToken = process.env.TURSO_AUTH_TOKEN;
  }

  if (!dbUrl || !dbToken) {
    throw new Error(
      "DB_NOT_PROVISIONED: User database is not yet provisioned. " +
        "Please wait on the provisioning screen or contact support."
    );
  }

  return { dbUrl, dbToken };
}
