import { logWarn } from "./log.ts";

/** Minimum entropy floor for a shared secret. 32 chars of a random string is
 *  the point below which an HMAC secret stops being a secret (10_Security.md
 *  §4 anti-tamper; BR-SEC-03 fail-closed). */
const MIN_SECRET_LENGTH = 32;

/** Deployment is a POSITIVE signal. The previous check inferred production from
 *  the ABSENCE of `SUPABASE_URL` (`if (env !== "local")`), so any misconfigured
 *  or partially-migrated environment skipped secret validation entirely — the
 *  fail-open direction. Shared with lib/auth.ts, lib/errors.ts and index.ts so
 *  the four can never drift apart again (see lib/env.ts). */
import { isDeployed } from "./env.ts";

function isProduction(): boolean {
  return isDeployed();
}

function readSecret(name: string): string {
  if (typeof Deno === "undefined") return "";
  return Deno.env.get(name) || "";
}

const HMAC_SECRET = readSecret("GATEWAY_SHARED_SECRET");
const DATA_KEY = readSecret("DATA_ENCRYPTION_KEY") || HMAC_SECRET;

/**
 * BR-SEC-07 — the PIN pepper, resolved with EXACTLY the precedence the web app
 * uses (`apps/web/src/lib/crypto.ts resolvePepper`):
 *
 *     PIN_PEPPER || GATEWAY_SHARED_SECRET
 *
 * WHY THIS MUST MATCH THE WEB PRECEDENCE, PRECISELY. `pinProof` is computed by
 * the web app and verified by the edge, so the two sides must key off the same
 * bytes. They originally did not: the gateway keyed off `HMAC_SECRET` alone while
 * the web keyed off `PIN_PEPPER || GATEWAY_SHARED_SECRET`. In any deployment that
 * configures `PIN_PEPPER` — a first-class variable in this repo, read by
 * `hashPin`, by the TOTP pepper path, and documented in the security audit — the
 * two derived different keys, every proof mismatched, and the destructive erase
 * endpoint returned 401 for every tutor, permanently and silently. No test caught
 * it, because both sides computed their own proof from their own secret.
 *
 * Reading `PIN_PEPPER` here is what makes the fallback chain total on BOTH sides.
 * It is also the correct key for the job: `pinProof` is a PIN verifier, and
 * `BR-SEC-07` already binds the PIN pepper to the argon2id `pin_hash`, so this
 * keeps one PIN-derived credential bound to one secret.
 */
const PIN_PEPPER = readSecret("PIN_PEPPER") || HMAC_SECRET;

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
// Checked independently rather than inherited: `PIN_PEPPER` defaults to
// `HMAC_SECRET`, but an explicitly-configured short pepper must fail loudly rather
// than pass on the HMAC secret's strength — it keys the PIN verifier.
assertSecretStrength("PIN_PEPPER", PIN_PEPPER);

export function getHmacSecret(): string {
  return HMAC_SECRET;
}

/**
 * REQUEST-SIGN domain. Keyed DIRECTLY off the raw shared secret — this wire
 * value is load-bearing: the web signer (`signHmacSha256(getSharedSecret(), …)`
 * in apps/web/src/server/get-db.ts) and every issued `X-Signature` in the wild
 * use it, so it cannot be re-keyed without a coordinated change there.
 * Cross-use separation against the PIN proof below therefore rests on the proof
 * side using a DERIVED subkey that never equals this raw key (see `pinProof`).
 */
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

/**
 * Length-safe, branch-free string comparison. Exported because the secure-erase
 * PIN-proof gate (routes/security.ts) must compare two attacker-supplied strings
 * without leaking how many leading characters matched through timing.
 *
 * Note it compares UTF-16 code UNITS, so for a proof string (hex, therefore
 * ASCII) that is identical to byte comparison. It is deliberately not used on
 * arbitrary user text, where code-unit vs byte length could differ.
 */
export function constantTimeCompare(a: string, b: string): boolean {
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

/**
 * BR-SEC-04 — the edge-verifiable PIN PROOF.
 *
 * `settings.pin_hash` is argon2id(m=64MiB, t=3, p=2) + pepper, which the Deno
 * edge cannot evaluate. That is why the destructive-erase gate used to check only
 * that a PIN EXISTED — a check that proves nothing about the caller, so a stolen
 * session could erase a tutor's data.
 *
 * This closes it without argon2. The proof is
 *
 *     HMAC-SHA256(HMAC(PIN_PEPPER, "buddysaradhi:pin-proof:subkey:v1"),
 *                 "buddysaradhi:pin-proof:v1" || ":" || tenantId || ":" || pin)
 *
 * i.e. the signing key is a use-specific SUBKEY derived from the PIN pepper via
 * one HMAC-SHA256 key-derivation step — never the pepper itself.
 *
 * Properties that matter:
 *   - The edge can compute and compare it with WebCrypto.
 *   - STRUCTURALLY DOMAIN SEPARATED: the proof key is
 *     `HMAC(PIN_PEPPER, subkey-info)` while request signatures (`hmacSign`
 *     above) are keyed directly off the raw shared secret, so the two keys
 *     differ EVEN when `PIN_PEPPER` is unset and falls back to
 *     `GATEWAY_SHARED_SECRET` — the default deployment. The `info` PREFIX ALONE
 *     does not separate the two uses: with coincident keys, `HMAC(S, M)` equals
 *     `HMAC(S, M)` for identical material no matter what prefix sits inside M,
 *     so a proof used to be interchangeable with a request signature for the
 *     same material whenever the pepper fell back. Separation here comes from
 *     different KEYS, not different messages; the prefix remains as material
 *     binding (tenant scope) and defence-in-depth.
 *   - TENANT-BOUND: the tenantId is inside the signed material, so tenant A's
 *     proof is not valid for tenant B.
 *   - It is NOT an offline attack surface: the key never leaves the server, so
 *     holding a stored proof gives no more than holding `pin_hash`.
 *
 * MIGRATION — deliberate and loud (Rule 9: no silent breakage). Deriving the
 * subkey changes every proof value, so proofs stored under the previous
 * direct-HMAC construction NO LONGER MATCH. Proofs are re-derived on the next
 * PIN change (`setPinAction` writes `pinProof` in the same transaction as the
 * hash), and the nullable-proof design means a tenant with NO proof is told to
 * re-confirm rather than silently locked out (routes/security.ts
 * `erase_pin_proof_unset`). A proof-holding tenant whose stored proof predates
 * this change fails CLOSED (401 mismatch) on the erase gate until they
 * re-confirm/change their PIN — the safe direction. Do not "fix" that by
 * weakening the comparison or by falling back to the old direct-HMAC value.
 *
 * The web app computes the identical string (`pinProof` in
 * apps/web/src/lib/crypto.ts, same subkey info, same HMAC-only derivation) and
 * stores it in `settings.pin_proof`. Both sides MUST keep (a) the `info`
 * prefix, (b) the SUBKEY info, and (c) the KEY RESOLUTION byte-identical —
 * `PIN_PEPPER || GATEWAY_SHARED_SECRET` on both, then the derivation.
 * `__tests__/pin-proof-vector.test.ts` asserts both implementations reproduce
 * each other byte-for-byte AND that proof != signature under coincident keys,
 * so a divergence in format, key, or derivation is a failing test rather than
 * a tutor silently locked out of their own account.
 */
export const PIN_PROOF_INFO = "buddysaradhi:pin-proof:v1";

/**
 * Use-specific info for the PIN-proof subkey derivation. MUST differ from
 * `PIN_PROOF_INFO` (the message prefix) and from any request-signing material:
 * reusing one string for key-derivation and for a signed message would entangle
 * the two domains this constant exists to keep apart.
 */
export const PIN_PROOF_SUBKEY_INFO = "buddysaradhi:pin-proof:subkey:v1";

/**
 * Derive the PIN-proof signing subkey: `HMAC-SHA256(pepper, subkey-info)`,
 * imported as the HMAC key. HMAC-only (no new algorithms): the construction is
 * a single PRF step, and it is implemented identically in
 * apps/web/src/lib/crypto.ts so the two runtimes stay byte-identical.
 */
async function derivePinProofKey(pepper: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const master = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const subkeyBytes = await crypto.subtle.sign(
    "HMAC",
    master,
    encoder.encode(PIN_PROOF_SUBKEY_INFO),
  );
  return crypto.subtle.importKey(
    "raw",
    subkeyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function pinProof(tenantId: string, pin: string): Promise<string> {
  if (!PIN_PEPPER) throw new Error("PIN_PEPPER (or GATEWAY_SHARED_SECRET) not configured");
  const encoder = new TextEncoder();
  const key = await derivePinProofKey(PIN_PEPPER);
  const material = `${PIN_PROOF_INFO}:${tenantId}:${pin}`;
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(material));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
