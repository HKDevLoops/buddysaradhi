// Implements: 10_Security.md §11 (brute-force defence); RFC-003 §1 G-AUTH
// (reset/login hardening); 12_Business_Rules.md BR-SEC-03 (lockout ladder
// analogue for logged-out auth surfaces).
//
// In-memory per-IP+email throttle for logged-out auth mutations
// (password-reset requests). Supabase owns the OTP/session limits; this is
// the web tier's own abuse friction so a single client cannot fan out
// reset emails. Resets on cold start — the `reset_requested` audit row (see
// `server/actions/auth.ts`) is the persistent abuse signal.

export interface RateLimitWindow {
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAtMs: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 2000;

/** Normalised throttle key: client IP + lowercased/trimmed email. The email
 * is normalised so `Tutor@X.com` and `tutor@x.com ` share a bucket; raw
 * emails are never logged (Rule 9). */
export function authRateLimitKey(ip: string, email: string): string {
  return `${ip.trim() || "unknown"}|${email.trim().toLowerCase()}`;
}

function pruneExpired(nowMs: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAtMs <= nowMs) buckets.delete(key);
  }
}

/** Sliding-window counter. Pure in `nowMs` for tests (`Date.now()` default). */
export function checkAuthRateLimit(
  key: string,
  window: RateLimitWindow,
  nowMs: number = Date.now(),
): RateLimitDecision {
  pruneExpired(nowMs);
  const current = buckets.get(key);
  if (!current || current.resetAtMs <= nowMs) {
    buckets.set(key, { count: 1, resetAtMs: nowMs + window.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count < window.limit) {
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAtMs - nowMs) / 1000)),
  };
}

/** Test-only reset (buckets are module-private). */
export function resetAuthRateLimits(): void {
  buckets.clear();
}

/** Best-effort client IP from request headers (server actions / routes). */
export async function getClientIp(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "127.0.0.1";
    return h.get("x-real-ip")?.trim() || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

/** 5 reset emails per address per 15 minutes (mirrors the OTP 5-attempt
 * convention, 23_Security_Harness_Plan.md §OTP note). */
export const PASSWORD_RESET_WINDOW: RateLimitWindow = { limit: 5, windowMs: 15 * 60 * 1000 };
