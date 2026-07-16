import Redis from "ioredis";

// Redis is OPTIONAL. When REDIS_URL is unset (local/always-online sandbox)
// or the server is unreachable, caching degrades silently to a no-op so the
// gateway never fails because of a missing cache.
const REDIS_URL = process.env.REDIS_URL;

let client: Redis | null = null;
if (REDIS_URL) {
  client = new Redis(REDIS_URL);
  client.on("error", (err: unknown) =>
    console.error("[Redis Error]", err instanceof Error ? err.message : err)
  );
}

export const isRedisReady = () => !!client && client.status === "ready";

export async function cacheGet(key: string): Promise<string | null> {
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string): Promise<void> {
  if (!client) return;
  try {
    await client.set(key, value, "EX", 300);
  } catch {
    /* no-op */
  }
}

export async function cacheInvalidate(prefix: string): Promise<void> {
  if (!client) return;
  try {
    const keys = await client.keys(`${prefix}*`);
    if (keys.length > 0) await client.del(...keys);
  } catch {
    /* no-op */
  }
}
