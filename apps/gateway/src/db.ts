import { createClient, type Client } from "@libsql/client";
import { PrismaClient } from "./prisma-client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

import { resolve } from "path";

// In-memory cache of PrismaClients keyed by db_url::token so we don't
// re-open a Turso connection on every request. Mirrors apps/web/src/lib/db.ts.
const clientCache = new Map<string, Client>();
const prismaCache = new Map<string, PrismaClient>();
const connectionKeys: string[] = [];
const MAX_CONNECTIONS = 50;

function normalizeLocalDbUrl(url: string): string {
  if (!url.startsWith("file:")) return url;
  let filePath = url.slice("file:".length);
  if (!filePath.startsWith("/") && !filePath.startsWith("\\") && !/^[a-zA-Z]:/.test(filePath)) {
    filePath = resolve(filePath);
  }
  const cleanPath = filePath.replace(/^\/+/, "").replace(/\\/g, "/");
  return `file:///${cleanPath}`;
}

export function getDbClient(dbUrl: string, dbToken: string): Client {
  const normalized = normalizeLocalDbUrl(dbUrl);
  const existing = clientCache.get(normalized);
  if (existing) return existing;
  const client = createClient({ url: normalized, authToken: dbToken });
  clientCache.set(normalized, client);
  return client;
}

export function getPrismaClient(dbUrl: string, dbToken: string): PrismaClient {
  const key = `${dbUrl}::${dbToken}`;
  const existing = prismaCache.get(key);
  if (existing) {
    const idx = connectionKeys.indexOf(key);
    if (idx !== -1) {
      connectionKeys.splice(idx, 1);
    }
    connectionKeys.push(key);
    return existing;
  }

  // Evict oldest if limit reached
  if (connectionKeys.length >= MAX_CONNECTIONS) {
    const oldestKey = connectionKeys.shift();
    if (oldestKey) {
      const oldestPrisma = prismaCache.get(oldestKey);
      if (oldestPrisma) {
        prismaCache.delete(oldestKey);
        oldestPrisma.$disconnect().catch(() => {});
      }
      const [oldestUrl] = oldestKey.split("::");
      const normalizedOldestUrl = normalizeLocalDbUrl(oldestUrl);
      const oldestLibsql = clientCache.get(normalizedOldestUrl);
      if (oldestLibsql) {
        clientCache.delete(normalizedOldestUrl);
        try {
          oldestLibsql.close();
        } catch (_) {}
      }
    }
  }

  const libsql = getDbClient(dbUrl, dbToken);
  const adapter = new PrismaLibSQL(libsql) as unknown as ConstructorParameters<
    typeof PrismaClient
  >[0] extends { adapter?: infer A } ? A : never;
  const prisma = new PrismaClient({ adapter } as unknown as ConstructorParameters<typeof PrismaClient>[0]);

  prismaCache.set(key, prisma);
  connectionKeys.push(key);
  return prisma;
}
