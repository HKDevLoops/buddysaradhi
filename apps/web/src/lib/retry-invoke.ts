// Implements: docs/rfc/004-multi-device-network-contract.md §1 C2 (retry:
// transport/timeout → exponential backoff + jitter, max 3 attempts, SAME key;
// 4xx except 408/429 never retried; 429 honours Retry-After; 503/timeout always
// retried) + C6 (bounded attempts, small surface, no polling) + K2 (abort
// mid-POST, auto-retry with the same key → one effect).
// AGENTS.md §2 Rule 9 (typed Result, Zod-style fail-closed classification, no
// empty catch, zero console.*).
//
// ACTION-AUTHOR CONVENTION (required for server-side C1 dedup): every mutating
// server action accepts the intent key in its trailing options/payload bag as
// `{ ..., intentKey: string }` and forwards it to the gateway `idempotency_keys`
// store when that lands. Until actions adopt the field, wrap calls as:
//   invokeWithRetry((key) => recordPaymentAction(sid, paise, desc, date, {
//     ...opts, intentKey: key,
//   }), { key: mintIntentKey() })
// so the client half (same key on every attempt, K2) holds from day one.
// All waits are client-side `setTimeout` sleeps — a serverless invocation is
// never hung (Vercel Hobby constraint). Event-driven only; no polling.

export interface ActionOk<T> {
  success: true;
  data: T;
}

export interface ActionFail {
  success: false;
  error: string;
}

export type ActionResult<T> = ActionOk<T> | ActionFail;

export type FailureKind = "retryable" | "fatal";

export interface RetryOptions {
  /** Intent key minted ONCE per intent — forwarded unchanged on every attempt. */
  key: string;
  /** Max attempts incl. the first try. Default 3, clamped 1..5 (C6 bounded). */
  attempts?: number;
  /** Base backoff in ms. Default 400, clamped 0..5000. */
  baseMs?: number;
  /** Per-wait ceiling in ms (also caps parsed Retry-After). Default 5000. */
  maxDelayMs?: number;
  /** Cooperative cancellation between attempts (visibilitychange teardown). */
  signal?: AbortSignal;
  /** Injectable for tests (fake timers / sleep spy). Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable randomness for jitter. Defaults to Math.random. */
  rand?: () => number;
}

export type RetryOutcome<T> =
  | { success: true; data: T; attempts: number; intentKey: string }
  | {
      success: false;
      error: string;
      attempts: number;
      intentKey: string;
      retryable: boolean;
    };

export const DEFAULT_ATTEMPTS = 3;
export const DEFAULT_BASE_MS = 400;
export const DEFAULT_MAX_DELAY_MS = 5000;
export const MAX_ATTEMPTS = 5;
const MAX_KEY_LENGTH = 128;

export function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}

export function isValidIntentKeyRef(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= MAX_KEY_LENGTH;
}

// Fatal wins over retryable: auth/validation/conflict must NEVER be retried
// with the same key (a 409 needs user review + a NEW key per C4).
const FATAL_RE =
  /(valid|zod|bad request|\b400\b|\b401\b|\b403\b|\b404\b|\b409\b|\b422\b|unauthor|forbidden|auth_required|credentials_expired|no session|sign[ -]?in|log[ -]?in|conflict|locked|duplicate|already exists|version mismatch|stale|not found|invalid|pin|void)/i;
const RETRYABLE_RE =
  /(timeout|timed out|network|fetch failed|failed to fetch|offline|unreachable|temporar|econn|socket|gateway|turso|libsql|upstream|\b408\b|\b429\b|\b502\b|\b503\b|\b504\b|retry-after|rate.?limit|too many requests|service unavailable)/i;

/**
 * Classifies a RETURNED action failure (`{success:false, error}`). Unknown
 * text defaults to fatal (fail-closed: never burn free-tier attempts blindly).
 */
export function classifyResult(message: string): FailureKind {
  if (!message) return "fatal";
  if (FATAL_RE.test(message)) return "fatal";
  if (RETRYABLE_RE.test(message)) return "retryable";
  if (/^upstream\b/i.test(message.trim())) return "retryable";
  return "fatal";
}

/**
 * Classifies a THROWN transport exception (the action never returned).
 * Defaults to retryable unless it matches a fatal pattern — a throw means the
 * request never committed, so retrying with the same key is the safe side
 * (K2 handover abort).
 */
export function classifyThrown(message: string): FailureKind {
  if (!message) return "retryable";
  if (FATAL_RE.test(message)) return "fatal";
  return "retryable";
}

const RETRY_AFTER_RE = /retry[-_ ]after(?:[-_ ]?(ms))?\s*[:=]?\s*(\d+)\s*(ms|s|sec|secs|second|seconds)?/i;

/**
 * Parses `Retry-After` hints out of gateway error text, e.g.
 * `429: Retry-After 2` → 2000ms, `rate_limited retry_after_ms=1500` → 1500ms.
 * Returns null when absent/unparseable. Capped to `maxDelayMs` (C6 bounded).
 * SERVER CONVENTION (gap — see report): gateway/actions should embed
 * `Retry-After <seconds>` in 429 text; until then this is forward-compatible.
 */
export function extractRetryAfterMs(message: string, maxDelayMs: number): number | null {
  const match = RETRY_AFTER_RE.exec(message);
  if (!match || match[2] === undefined) return null;
  const amount = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  const unit = (match[3] ?? match[1] ?? "s").toLowerCase();
  const ms = unit === "ms" ? amount : amount * 1000;
  return Math.min(Math.max(0, ms), Math.max(1, maxDelayMs));
}

/**
 * Equal-jitter backoff: `temp = min(cap, base * 2^attemptIndex)`,
 * `wait = temp/2 + rand * temp/2`. `attemptIndex` is 0-based (0 = first wait).
 * Worst-case total ≈ attempts × maxDelayMs — bounded (C6).
 */
export function computeBackoffMs(
  attemptIndex: number,
  baseMs: number,
  maxDelayMs: number,
  rand: () => number,
): number {
  const capped = Math.min(Math.max(1, maxDelayMs), Math.max(0, baseMs) * 2 ** attemptIndex);
  const r = Math.min(0.999999, Math.max(0, rand()));
  return Math.round(capped / 2 + r * (capped / 2));
}

/**
 * Invokes a server-action closure with C2 retry. The SAME `key` is passed to
 * `fn` on every attempt. Returns the success, or the LAST typed error with
 * the attempt count (never throws for action-level failures; only returns).
 */
export async function invokeWithRetry<T>(
  fn: (intentKey: string) => Promise<ActionResult<T>>,
  options: RetryOptions,
): Promise<RetryOutcome<T>> {
  const key = options.key;
  if (!isValidIntentKeyRef(key)) {
    return {
      success: false,
      error: "invokeWithRetry: a non-empty intent key is required (mint once per intent via mintIntentKey)",
      attempts: 0,
      intentKey: "",
      retryable: false,
    };
  }
  const attempts = Math.min(
    MAX_ATTEMPTS,
    Math.max(1, Math.floor(options.attempts ?? DEFAULT_ATTEMPTS)),
  );
  const baseMs = Math.min(5000, Math.max(0, options.baseMs ?? DEFAULT_BASE_MS));
  const maxDelayMs = Math.max(1, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const sleep = options.sleep ?? defaultSleep;
  const rand = options.rand ?? Math.random;

  let lastError = "Unknown invocation failure";
  let lastKind: FailureKind = "fatal";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted === true) {
      return {
        success: false,
        error: `Invocation aborted before attempt ${attempt}`,
        attempts: attempt - 1,
        intentKey: key,
        retryable: false,
      };
    }
    let result: ActionResult<T>;
    try {
      result = await fn(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      lastKind = classifyThrown(message);
      if (lastKind === "fatal" || attempt === attempts) {
        return { success: false, error: lastError, attempts: attempt, intentKey: key, retryable: false };
      }
      await sleep(computeBackoffMs(attempt - 1, baseMs, maxDelayMs, rand));
      continue;
    }
    if (result.success) {
      return { success: true, data: result.data, attempts: attempt, intentKey: key };
    }
    lastError = result.error;
    lastKind = classifyResult(result.error);
    if (lastKind === "fatal" || attempt === attempts) {
      return {
        success: false,
        error: lastError,
        attempts: attempt,
        intentKey: key,
        retryable: lastKind === "retryable",
      };
    }
    const retryAfterMs = extractRetryAfterMs(result.error, maxDelayMs);
    const waitMs = retryAfterMs ?? computeBackoffMs(attempt - 1, baseMs, maxDelayMs, rand);
    await sleep(waitMs);
  }
  return { success: false, error: lastError, attempts, intentKey: key, retryable: false };
}
