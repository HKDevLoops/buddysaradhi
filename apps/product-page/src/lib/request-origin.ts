// Implements: 10_Security.md §6 (XSS-1 / CSRF) + 23_Security_Harness_Plan.md §7,
// applied to the one PUBLIC WRITE endpoint in this app.
//
// THE CONTRACT. A state-changing request must carry a same-origin signal:
// `Origin` if present must be the origin the request was addressed to (or a
// configured extra); otherwise `Referer` must be; with neither, the request
// is REFUSED.
//
// WHY IT IS HOST-RELATIVE. Next.js's built-in Origin check covers Server
// Actions only ("x-forwarded-host header ... does not match origin header ...
// Aborting the action" - proven live), so a route handler gets no protection
// for free. The host-derived comparison is the same technique, and it is
// correct on every deployment origin (this app is reachable at a Vercel
// deployment origin, at the apex and at every preview origin); an allowlist
// that missed one of them would silently break the form for real tutors.
//
// Rule 9: the refusal is a typed 403 with a stable shape - never a silent
// success and never a silent drop.

export interface OriginHeaders {
  get(name: string): string | null;
}

export type OriginVerdict =
  | { readonly allowed: true; readonly source: "origin" | "referer" }
  | { readonly allowed: false; readonly reason: "no-origin" | "not-allowed" };

/**
 * Normalises an absolute URL to its `scheme://host[:port]` form. Returns null
 * for anything that is not an absolute http(s) URL, so a malformed or
 * relative value can never accidentally compare equal to a real origin.
 */
export function normaliseOrigin(raw: string | null): string | null {
  if (raw === null) return null;
  const value = raw.trim();
  if (value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return parsed.origin;
}

/**
 * The origins this request may legitimately come from.
 *
 * `host` is the host the request was addressed to (`Host` / `x-forwarded-host`).
 * It is matched as BOTH https and http, because a local dev server is http and
 * a production server is https, and the scheme is not the thing being
 * authenticated — the host is.
 */
export function allowedOriginsFor(host: string | null, extra: readonly string[] = []): readonly string[] {
  const out: string[] = [];
  const clean = host === null ? "" : host.trim().toLowerCase();
  if (clean.length > 0) {
    out.push(`https://${clean}`);
    out.push(`http://${clean}`);
  }
  for (const candidate of extra) {
    const normalised = normaliseOrigin(candidate);
    if (normalised !== null && !out.includes(normalised)) out.push(normalised);
  }
  return out;
}

/**
 * Decides whether a state-changing request is same-origin.
 *
 * `extraAllowed` is for the site's own configured origin
 * (`NEXT_PUBLIC_SITE_URL`), which is a redirect target rather than the origin
 * the request is addressed to; it is additive and never replaces the
 * host-derived check.
 */
export function resolveOriginVerdict(
  headers: OriginHeaders,
  host: string | null,
  extraAllowed: readonly string[] = [],
): OriginVerdict {
  const allowed = allowedOriginsFor(host, extraAllowed);

  const origin = normaliseOrigin(headers.get("origin"));
  if (origin !== null) {
    return allowed.includes(origin) ? { allowed: true, source: "origin" } : { allowed: false, reason: "not-allowed" };
  }

  const referer = headers.get("referer");
  if (referer !== null && referer.trim().length > 0) {
    const refererOrigin = normaliseOrigin(referer);
    if (refererOrigin === null) return { allowed: false, reason: "not-allowed" };
    return allowed.includes(refererOrigin)
      ? { allowed: true, source: "referer" }
      : { allowed: false, reason: "not-allowed" };
  }

  return { allowed: false, reason: "no-origin" };
}
