import { logWarn } from "./log.ts";

/** Minimum entropy floor for a shared secret. 32 chars of a random string is
 *  the point below which an HMAC secret stops being a secret (10_Security.md
 *  §4 anti-tamper; BR-SEC-03 fail-closed). */
const MIN_SECRET_LENGTH = 32;

/** Deployment is a POSITIVE signal. The previous check inferred production from
 * the ABSENCE of `SUPABASE_URL` (`if (env !== "local")`), so any misconfigured
 * or partially-migrated environment skipped secret validation entirely — the
 * fail-open direction. `DENO_DEPLOYMENT_ID` is set by the Supabase/Deno Deploy
 * edge; `DENO_ENV=production` is the explicit manual override. */
function isProduction(): boolean {
  if (typeof Deno === "undefined") return false;
  return Boolean(Deno.env.get("DENO_DEPLOYMENT_ID")) ||
    Deno.env.get("DENO_ENV") === "production";
}

function readSecret(name: string): string {
  if (typeof Deno === "undefined") return "";
  return Deno.env.get(name) || "";
}

const HMAC_SECRET = readSecret("GATEWAY_SHARED_SECRET");
const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET;

/**
 * Startup gate. Every secret the gateway signs, verifies or encrypts with is
 * checked ONCE, at module load, before a single request is served — a gateway
 * that boots with a weak or missing shared secret has already failed open, and
 * no per-request check can undo that.
 *
 * Production: THROW. The edge fails to boot, which is a loud, correct outcome.
 * Development: warn and continue, so `deno task dev` and the vitest suite work
 * without a secret store — but the warning is emitted, not swallowed.
 */
function assertSecretStrength(name: string, value: string): void {
  if (value.length >= MIN_SECRET_LENGTH) return;
  const problem = `${name} is ${value.length === 0 ? "not set" : `only ${value.length} chars`}` +
    ` (minimum ${MIN_SECRET_LENGTH})`;
  if (isProduction()) {
    throw new Error(
      `CRITICAL: ${problem}. A gateway that boots without it fails OPEN: ` +
        "request signatures are forgeable and encrypted responses are readable. " +
        "Set it in your Supabase Edge Function secrets and redeploy.",
    );
  }
  logWarn("crypto.weak_secret", { name, length: value.length, minimum: MIN_SECRET_LENGTH });
}

assertSecretStrength("GATEWAY_SHARED_SECRET", HMAC_SECRET);
// `DATA_KEY` falls back to `HMAC_SECRET`, so it inherits the HMAC secret's
// strength when unset — but it is checked independently so that an explicitly
// configured but short data key cannot slip through on the HMAC's coattails.
assertSecretStrength("DATA_ENCRYPTION_KEY", DATA_KEY);

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

export async function hmacVerify(
  data: string,
  signature: string,
): Promise<boolean> {
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
    // Returning plaintext from a function whose contract says "encrypted" is a
    // fail-open: the caller cannot tell the difference, so a missing key turns
    // every response body into cleartext in production while the type still says
    // otherwise. Production throws (Rule 9 — no silent failures); development
    // warns and degrades so local work is not blocked.
    if (isProduction()) {
      throw new Error(
        "CRITICAL: DATA_ENCRYPTION_KEY is not set; refusing to return plaintext for an " +
          "encrypted response (10_Security.md §8).",
      );
    }
    logWarn("crypto.encrypt_no_key", {
      message: "DATA_ENCRYPTION_KEY not set; returning plaintext (development only)",
    });
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
  const combined = new Uint8Array(
    salt.length + iv.length + encrypted.byteLength,
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptRequest(ciphertextB64: string): Promise<string> {
  if (!DATA_KEY) {
    // Symmetric with encryptResponse: silently handing back the ciphertext as
    // "decrypted" would push the raw envelope into the caller's JSON as if it
    // were plaintext. Production throws; development degrades loudly.
    if (isProduction()) {
      throw new Error(
        "CRITICAL: DATA_ENCRYPTION_KEY is not set; cannot decrypt a request body.",
      );
    }
    logWarn("crypto.decrypt_no_key", {
      message: "DATA_ENCRYPTION_KEY not set; returning body unchanged (development only)",
    });
    return ciphertextB64;
  }
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
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data,
  );
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
    const entries = [...rateLimitMap.entries()]
      .sort((a, b) => a[1].resetAt - b[1].resetAt);
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
    rateLimitMap.set(tenantId, {
      count: 1,
      resetAt: now + windowMs,
      penaltyUntil: 0,
    });
    return true;
  }

  if (entry.penaltyUntil > 0 && now < entry.penaltyUntil) {
    logWarn("rate_limit.penalty", {
      tenantId,
      penaltyUntil: entry.penaltyUntil,
    });
    return false;
  }

  if (entry.count >= maxRequests) {
    const penaltyMs = 30_000 *
      Math.pow(2, Math.min(Math.floor((entry.count - maxRequests) / 10), 8));
    entry.penaltyUntil = now + penaltyMs;
    logWarn("rate_limit.exceeded", { tenantId, count: entry.count, penaltyMs });
    return false;
  }

  entry.count++;
  return true;
}
