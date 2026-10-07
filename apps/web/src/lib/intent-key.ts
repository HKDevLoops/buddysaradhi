// Implements: docs/rfc/004-multi-device-network-contract.md §1 C1 (Idempotency-Key —
// minted ONCE per user intent, replayed byte-identically on duplicate) + K1/K2
// (double-click + mid-POST retry collapse to one effect via the same key).
// AGENTS.md §2 Rule 9 (typed, never silent — validation is a boolean, entropy
// source is queryable, non-serializable input throws a typed TypeError).
//
// FORMAT (mintIntentKey) — UUIDv7-shaped, lexicographically time-sortable:
//   `xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx`
//   - bits 0..47 : big-endian unix-epoch millis (12 hex chars, zero-padded)
//   - 4 bits     : version `0111` ("7")
//   - 62 bits    : randomness, variant `10xx` (leading hex of `89ab`)
//   Randomness prefers `crypto.getRandomValues`; falls back to
//   `crypto.randomUUID`, then `Math.random`. The active source is surfaced via
//   `getIntentKeyEntropy()` — never silent.
// FORMAT (intentKeyFrom) — deterministic stable key for ONE intent resubmitted
// with an identical payload (double-click K1): `stk_<16 lowercase hex>`, the
// 64-bit dual-lane FNV-1a of the canonical (key-sorted) JSON form.
// WARNING: identical payloads yield identical stable keys. Two DISTINCT
// real-world intents that happen to share field values (e.g. two separate
// ₹500 cash payments to the same student) MUST use `mintIntentKey()` fresh per
// submit, or the second will replay the first. Use `intentKeyFrom` only to
// collapse accidental resubmits of a single intent — ideally with a per-form
// nonce (sheet-open id, `createdAt`) inside the payload.

export type KeyEntropy = "webcrypto" | "uuid-fallback" | "math-fallback";

export const STABLE_KEY_PREFIX = "stk";

/**
 * WHY THIS MODULE-LEVEL `let` IS PER-PROCESS-SAFE (TABS-HARDEN-01 Phase 2
 * flagged it as cross-request mutable state in a module that server actions
 * import — `server/actions/students.ts` calls `mintIntentKey` — so it was
 * audited rather than assumed). Three properties, together, make it safe to
 * keep:
 *
 * 1. IT IS NOT AN INPUT TO ANYTHING. `mintIntentKey` derives the returned key
 *    entirely from `tsHex` and the local `drawn` (hex + source) produced by
 *    `drawRandomHex`. The assignment below happens after the key string is
 *    fully determined and is never read back into it. Two concurrent server
 *    requests may interleave these writes and neither can observe the other's,
 *    so no minted key can be corrupted by another request. The minted key stays
 *    a pure function of (`nowMs`, crypto state).
 *
 * 2. ITS ONLY READER IS DIAGNOSTIC AND HAS NO PRODUCTION CALL SITE.
 *    `getIntentKeyEntropy()` is the sole reader; a repo-wide search finds it
 *    referenced only by this module's own doc comments and `intent-key.test.ts`.
 *    No money path, no idempotency check, no ledger read consumes it.
 *
 * 3. IT CANNOT ACCUMULATE. The state is one string from a three-value union, so
 *    there is no growth, no collection and nothing to bound — unlike the
 *    `Map`s in `lib/db.ts` and `lib/offline-queue.ts`, which hold one entry per
 *    tenant and DID need a ceiling.
 *
 * WHAT CROSSES A REQUEST BOUNDARY: only the reported entropy SOURCE, when two
 * requests mint concurrently and a later reader asks which source was used.
 * That is a diagnostics string about the last call, not state that any
 * behaviour depends on.
 *
 * KNOWN GAP (not fixable in this module): the Rule 9 promise in the file header
 * — that a WebCrypto failure is surfaced rather than silent — currently has no
 * production reader, so the surfacing exists in code and is asserted by tests
 * but is not yet shown to a tutor. Wiring it is a component concern.
 */
let lastEntropy: KeyEntropy = "webcrypto";

/** Which randomness source the most recent `mintIntentKey()` used. */
export function getIntentKeyEntropy(): KeyEntropy {
  return lastEntropy;
}

function drawRandomHex(charCount: number): { hex: string; source: KeyEntropy } {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    let bytes: Uint8Array | null = null;
    try {
      bytes = webCrypto.getRandomValues(new Uint8Array(Math.ceil(charCount / 2)));
    } catch {
      // WebCrypto threw at runtime — UUID fallback below (surfaced via
      // getIntentKeyEntropy, never silent).
      bytes = null;
    }
    if (bytes !== null) {
      let hex = "";
      for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
      return { hex: hex.slice(0, charCount), source: "webcrypto" };
    }
  }
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    let uuid = "";
    try {
      uuid = webCrypto.randomUUID();
    } catch {
      // randomUUID threw — Math fallback below (surfaced, never silent).
      uuid = "";
    }
    if (uuid.length > 0) {
      return {
        hex: uuid.replace(/-/g, "").slice(0, charCount).padEnd(charCount, "0"),
        source: "uuid-fallback",
      };
    }
  }
  let out = "";
  while (out.length < charCount) {
    out += Math.floor(Math.random() * 0xffff)
      .toString(16)
      .padStart(4, "0");
  }
  return { hex: out.slice(0, charCount), source: "math-fallback" };
}

/**
 * Mints one UUIDv7-shaped intent key. Call ONCE per user intent (form-submit
 * handler, stored in a ref) — NEVER per attempt. Retries and queue drains
 * reuse the same key (RFC-004 C1/C2, K2). Pure except randomness + clock;
 * `nowMs` is injectable for tests.
 */
export function mintIntentKey(nowMs: number = Date.now()): string {
  const ts48 = Math.max(0, Math.floor(nowMs)) % 281474976710656;
  const tsHex = ts48.toString(16).padStart(12, "0");
  const drawn = drawRandomHex(20);
  lastEntropy = drawn.source;
  const rand = drawn.hex;
  const variantNibble = "89ab".charAt(parseInt(rand.charAt(3), 16) % 4);
  return (
    `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}` +
    `-7${rand.slice(0, 3)}-${variantNibble}${rand.slice(4, 7)}-${rand.slice(7, 19)}`
  );
}

function stableStringify(value: unknown): string | undefined {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value) ?? "null";
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "bigint":
      return JSON.stringify(`bigint:${value.toString()}`);
    case "boolean":
      return value ? "true" : "false";
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    case "object": {
      if (value instanceof Date) return JSON.stringify(value.toISOString());
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const item of value) parts.push(stableStringify(item) ?? "null");
        return `[${parts.join(",")}]`;
      }
      // SAFETY: typeof-narrowed to non-null non-array object; keys/values read
      // via Object.keys + unknown (no prototype access, no method calls).
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const item = stableStringify(record[key]);
        if (item !== undefined) parts.push(`${JSON.stringify(key)}:${item}`);
      }
      return `{${parts.join(",")}}`;
    }
  }
}

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 64-bit dual-lane FNV-1a as 16 lowercase hex chars (zero-dep). */
export function hash64Hex(input: string): string {
  const lo = fnv1a32(input, 0x811c9dc5);
  const hi = fnv1a32(input, 0x243f6a88);
  return lo.toString(16).padStart(8, "0") + hi.toString(16).padStart(8, "0");
}

/**
 * Deterministic key for collapsing accidental resubmits of ONE intent with an
 * identical payload (field order-insensitive). See the header WARNING before
 * using this for distinct intents. Throws a typed TypeError for
 * non-JSON-serializable top-level input (fail-closed, never silent).
 */
export function intentKeyFrom(data: unknown): string {
  const canonical = stableStringify(data);
  if (canonical === undefined) {
    throw new TypeError(
      "intentKeyFrom: payload is not JSON-serializable (undefined/function/symbol at top level)",
    );
  }
  return `${STABLE_KEY_PREFIX}_${hash64Hex(canonical)}`;
}

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STABLE_RE = /^stk_[0-9a-f]{16}$/;

/** Accepts both `mintIntentKey` (v7) and `intentKeyFrom` (stable) shapes. */
export function isIntentKey(value: unknown): value is string {
  return typeof value === "string" && (V7_RE.test(value) || STABLE_RE.test(value));
}
