// Client IP for the `/api/v1/*` rate-limit bucket (web/04_API_Routes.md §2).
//
// The bucket must not be keyed on a value the client can choose. Next's Node
// server only fills `x-forwarded-for` in when the client did not send one
// (base-server.js: `??=`), so a client-supplied value reaches us verbatim —
// measured on a self-hosted build: every distinct value minted a FRESH
// 60-token bucket, i.e. the limiter was a no-op (docs/audit/DYNAMIC-WEB.md F-2).
//
// So prefer a header the PLATFORM overwrites. Which one is trustworthy
// depends on the platform, so the choice comes from the platform's own env
// markers — a client can send any header name, but not set process.env.
//
// Edge-safe by construction: no imports, no Node APIs.

/** Bucket key for a request whose client address could not be determined. */
export const UNKNOWN_CLIENT_IP = "unknown";

/** IPv4 or IPv6, optionally with a port. A non-address must not mint a bucket. */
const IP_LIKE = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$|^[0-9A-Fa-f:]{2,45}(?::\d{1,5})?$/;

export function isIpLike(value: string): boolean {
  if (!value || value.length > 64 || !IP_LIKE.test(value)) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/.exec(value);
  if (v4) return v4.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(":");
}

/**
 * Headers the PLATFORM overwrites, per platform. Empty on an unknown
 * platform: there is then no header we can trust.
 */
export function platformIpHeaders(env: Record<string, string | undefined>): string[] {
  if (env.VERCEL === "1" || env.VERCEL) return ["x-vercel-forwarded-for", "x-real-ip"];
  if (env.CF_PAGES === "1" || env.CF_PAGES_URL) return ["cf-connecting-ip"];
  return [];
}

function firstEntry(raw: string): string {
  return (raw.split(",")[0] ?? "").trim();
}

/**
 * Platform header first, then `x-forwarded-for`, then `x-real-ip`, then the
 * shared `unknown` bucket. A value that is not address-shaped collapses onto
 * `unknown` — a random string must not be able to mint a bucket.
 */
export function clientIpFromRequest(
  headers: { get(name: string): string | null },
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  for (const name of platformIpHeaders(env)) {
    const raw = headers.get(name);
    if (!raw) continue;
    const value = firstEntry(raw);
    if (value && isIpLike(value)) return value;
  }

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const value = firstEntry(forwarded);
    if (value && isIpLike(value)) return value;
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const value = firstEntry(realIp);
    if (value && isIpLike(value)) return value;
  }

  return UNKNOWN_CLIENT_IP;
}
