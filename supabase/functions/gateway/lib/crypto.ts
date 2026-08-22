import { logWarn } from "./log.ts";

const HMAC_SECRET = Deno.env.get("GATEWAY_SHARED_SECRET") || "";
const DATA_KEY = Deno.env.get("DATA_ENCRYPTION_KEY") || HMAC_SECRET;

if (!HMAC_SECRET || HMAC_SECRET.length < 32) {
  const env = Deno.env.get("DENO_DEPLOYMENT_ID") || Deno.env.get("SUPABASE_URL") || "local";
  if (env !== "local") {
    throw new Error(
      `CRITICAL: GATEWAY_SHARED_SECRET must be >= 32 chars in production (got ${HMAC_SECRET.length}). Set it in your Supabase Edge Function secrets.`,
    );
  }
}

export function getHmacSecret(): string {
  return HMAC_SECRET;
}

export async function hmacSign(data: string): Promise<string> {
  if (!HMAC_SECRET) throw new Error("GATEWAY_SHARED_SECRET not configured");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacVerify(data: string, signature: string): Promise<boolean> {
  try {
    const expected = await hmacSign(data);
    return constantTimeCompare(expected, signature);
  } catch {
    return false;
  }
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    let result = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const aChar = i < a.length ? a.charCodeAt(i) : 0;
      const bChar = i < b.length ? b.charCodeAt(i) : 0;
      result |= aChar ^ bChar;
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function encryptResponse(plaintext: string): Promise<string> {
  if (!DATA_KEY) {
    logWarn("crypto.encrypt_no_key", { message: "DATA_ENCRYPTION_KEY not set; returning plaintext" });
    return plaintext;
  }
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(DATA_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptRequest(ciphertextB64: string): Promise<string> {
  if (!DATA_KEY) return ciphertextB64;
  const combined = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
  if (combined.length < 28) {
    throw new Error("invalid ciphertext: too short");
  }
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(DATA_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
  penaltyUntil: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 60_000;
const RATE_LIMIT_MAX_ENTRIES = 10_000;
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < RATE_LIMIT_CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt && now > entry.penaltyUntil) {
      rateLimitMap.delete(key);
    }
  }
  if (rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
    const entries = [...rateLimitMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const evictCount = Math.ceil(RATE_LIMIT_MAX_ENTRIES / 4);
    for (let i = 0; i < evictCount && i < entries.length; i++) {
      rateLimitMap.delete(entries[i][0]);
    }
  }
}

export function checkRateLimit(
  tenantId: string,
  maxRequests = 100,
  windowMs = 60000,
): boolean {
  cleanupExpiredEntries();
  const now = Date.now();
  const entry = rateLimitMap.get(tenantId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(tenantId, { count: 1, resetAt: now + windowMs, penaltyUntil: 0 });
    return true;
  }

  if (entry.penaltyUntil > 0 && now < entry.penaltyUntil) {
    logWarn("rate_limit.penalty", { tenantId, penaltyUntil: entry.penaltyUntil });
    return false;
  }

  if (entry.count >= maxRequests) {
    const penaltyMs = 30_000 * Math.pow(2, Math.min(Math.floor((entry.count - maxRequests) / 10), 8));
    entry.penaltyUntil = now + penaltyMs;
    logWarn("rate_limit.exceeded", { tenantId, count: entry.count, penaltyMs });
    return false;
  }

  entry.count++;
  return true;
}
