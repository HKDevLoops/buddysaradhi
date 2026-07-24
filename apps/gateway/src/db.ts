import { createClient, type Client } from "@libsql/client";
import { createLibsqlProxy } from "./libsql-proxy";
import { resolve } from "path";

const clientCache = new Map<string, Client>();
const prismaCache = new Map<string, any>();
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

import { createLibsqlProxy } from "./libsql-proxy";

export function getPrismaClient(dbUrl: string, dbToken: string): any {
  const key = `${dbUrl}::${dbToken}`;
  const existing = prismaCache.get(key);
  if (existing) return existing;

  const libsql = getDbClient(dbUrl, dbToken);
  const proxy = createLibsqlProxy(libsql);
  prismaCache.set(key, proxy);
  return proxy;
}
