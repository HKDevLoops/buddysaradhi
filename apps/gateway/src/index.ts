import { Hono } from "hono";
import { cors } from "hono/cors";
import { ok, fail, getContext } from "./lib/respond";
import { secureErase } from "./lib/security/secureErase";
import { cacheGet, cacheSet } from "./cache";
import { createHash } from "crypto";
import { registerSettings } from "./routes/settings";
import { registerStudents } from "./routes/students";
import { registerAttendance } from "./routes/attendance";
import { registerLedger } from "./routes/ledger";
import { registerReports } from "./routes/reports";
import { registerGraphQL } from "./routes/graphql";
import { provisionTutorDb } from "./provisionTutorDb";
import { log } from "./lib/logger";

const app = new Hono();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3010",
  "http://localhost:8081",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://buddysaradhi.app",
  "https://api.buddysaradhi.app"
];
if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(",").forEach((o) => allowedOrigins.push(o.trim()));
}

app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return "";
      const isAllowed = allowedOrigins.some((allowed) => {
        if (allowed === origin) return true;
        // Support subnet/host matches for Expo development IPs
        if (allowed.includes("localhost") && origin.includes("127.0.0.1")) return true;
        return false;
      });
      return isAllowed ? origin : "";
    },
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["*"],
  })
);

// 1. IP-based Rate Limiter Middleware
const ipHits = new Map<string, { count: number; windowStart: number }>();
app.use("*", async (c, next) => {
  const ip = c.req.header("X-Forwarded-For") || "127.0.0.1";
  const now = Date.now();
  const windowMs = 60_000;
  const maxHits = 200; // 200 requests/minute per IP

  let record = ipHits.get(ip);
  if (!record || now - record.windowStart > windowMs) {
    record = { count: 1, windowStart: now };
    ipHits.set(ip, record);
  } else {
    record.count++;
    if (record.count > maxHits) {
      return c.json({ success: false, error: "Too many requests. Rate limit exceeded." } as const, 429);
    }
  }
  await next();
});

// 1.5 Session Hijacking Protection (Fingerprint Pinning) Middleware
app.use("*", async (c, next) => {
  const tenantId = c.req.header("X-Tutor-Id");
  const clientIp = c.req.header("X-Client-IP");
  const userAgent = c.req.header("X-Client-UA");

  if (tenantId && clientIp && userAgent && tenantId !== "local-dev") {
    try {
      const currentSignature = createHash("sha256")
        .update(`${tenantId}:${clientIp}:${userAgent}`)
        .digest("hex");

      const cacheKey = `fingerprint:${tenantId}`;
      const storedSignature = await cacheGet(cacheKey);

      if (storedSignature) {
        if (storedSignature !== currentSignature) {
          log.warn("session_hijacking_attempt", `tenant=${tenantId}`, { tenantId });
          return c.json({ success: false, error: "SECURITY_VIOLATION: Session hijacking detected." } as const, 401);
        }
      } else {
        await cacheSet(cacheKey, currentSignature);
      }
    } catch (err) {
      log.error("fingerprint_verification_failed", err instanceof Error ? err.message : String(err));
    }
  }
  await next();
});

// 2. State-Changing Replay Protection Middleware
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method) && !c.req.path.includes("/dev/provision")) {
    const timestampHeader = c.req.header("X-Timestamp");
    if (!timestampHeader) {
      return c.json({ success: false, error: "SECURITY_VIOLATION: Missing timestamp header." } as const, 400);
    }
    const requestTime = parseInt(timestampHeader, 10);
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    if (Number.isNaN(requestTime) || Math.abs(now - requestTime) > fiveMinutes) {
      return c.json({ success: false, error: "SECURITY_VIOLATION: Request timestamp expired." } as const, 400);
    }
  }
  await next();
});

// 3. Cache Invalidation Middleware for Mutations
import { cacheInvalidate } from "./cache";
app.use("*", async (c, next) => {
  await next();
  const method = c.req.method;
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method) && c.res.status < 400) {
    const tenantId = c.req.header("X-Tutor-Id") || "local-dev";
    cacheInvalidate(`graphql:${tenantId}`).catch(() => {});
  }
});

app.get("/health", (c) => ok(c, { ok: true }));

// POST /api/v1/security/erase — wipe every data table in the tutor's DB.
// DESTRUCTIVE: requires X-Admin-Token matching GATEWAY_ADMIN_TOKEN. The web
// BFF must forward this token on the internal call; it must never be exposed
// to the browser. Implementation follows 10_Security.md §18.1: empty-filter
// deleteMany inside a single transaction + audit_log(erase_initiated) witness
// + VACUUM. Works for all tables including pure join tables (e.g. studentTag)
// that carry no tenantId column.
// Tiny in-memory rate limit on the destructive erase endpoint (sliding 1min).
const eraseHits = new Map<string, number[]>();
function eraseRateLimited(key: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const hits = (eraseHits.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  eraseHits.set(key, hits);
  return hits.length > 5; // max 5 erase attempts / minute / key
}

app.post("/api/v1/security/erase", async (c) => {
  const adminToken = c.req.header("X-Admin-Token");
  const expected = process.env.GATEWAY_ADMIN_TOKEN;
  if (!expected || adminToken !== expected) {
    return c.json({ success: false, error: "Unauthorized" } as const, 401);
  }
  const clientKey = c.req.header("X-Forwarded-For") || "erase";
  if (eraseRateLimited(clientKey)) {
    return c.json({ success: false, error: "Too many requests" } as const, 429);
  }
  const { db, tenantId } = getContext(c);
  const result = await secureErase(db, tenantId);
  return ok(c, result);
});

app.onError((err, c) => {
  const isProd = process.env.NODE_ENV === "production";
  const message = isProd
    ? "Internal server error"
    : err instanceof Error
      ? err.message
      : "Internal error";
  return c.json({ success: false, error: message } as const, 500);
});

app.notFound((c) => fail(c, `Not implemented: ${c.req.method} ${c.req.path}`, 501));

// Dev-only tutor provisioning. Never exposed in production (AGENTS.md §8 / §2).
// In real deployment this would mint a dedicated Turso DB per tutor
// (17_API_Gateway_System.md); locally it creates a tenant namespace.
if (process.env.NODE_ENV !== "production") {
  app.post("/api/v1/dev/provision", async (c) => {
    try {
      const { tenantId, tenantSecret, dbUrl, dbToken } = await provisionTutorDb(
        process.env.DATABASE_URL || "file:./dev.db",
        process.env.DB_TOKEN || ""
      );
      return ok(c, { tenantId, tenantSecret, dbUrl, dbToken });
    } catch (e) {
      return fail(c, e instanceof Error ? e.message : String(e), 500);
    }
  });
}

registerSettings(app);
registerStudents(app);
registerAttendance(app);
registerLedger(app);
registerReports(app);
registerGraphQL(app);

const port = Number(process.env.PORT) || 3001;
log.info("gateway_boot", `TutorOS API Gateway listening on :${port}`, { port });

Bun.serve({ port, fetch: app.fetch });
