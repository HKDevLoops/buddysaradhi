// Implements: the one-owner rule for this site's own origin.
//
// `app/layout.tsx` used to own this string by itself, and `sitemap.ts` needs
// the same value. Two spellings of one host is how a canonical, an Open Graph
// URL and a sitemap end up pointing at three different places (the failure the
// layout's own comment describes), so the resolver lives here and BOTH
// consumers read it.
//
// AGENTS.md §15 FM-06: the origin is read from the environment, never a
// literal in a metadata block, and a malformed value THROWS at module
// evaluation - a red build is recoverable, a silently wrong canonical is not.

const SITE_ORIGIN_FALLBACK = "https://buddysaradhi.app";

/**
 * Resolves the site origin from the environment.
 *
 * `NEXT_PUBLIC_SITE_URL` is the configured production origin. When it is
 * absent the committed apex fallback is used. A malformed value throws,
 * naming the variable rather than degrading to a guess.
 */
export function resolveSiteOrigin(): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return new URL(SITE_ORIGIN_FALLBACK);
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch (cause) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL is not an absolute URL (received ${JSON.stringify(configured)}). ` +
        `Fix the variable, or unset it to use ${SITE_ORIGIN_FALLBACK}.`,
      { cause },
    );
  }
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error(
      `NEXT_PUBLIC_SITE_URL must be an https origin (received ${JSON.stringify(configured)}).`,
    );
  }
  return parsed;
}

/** The origin as a plain string, e.g. for a sitemap's `loc` entries. */
export function siteOriginString(): string {
  return resolveSiteOrigin().toString().replace(/\/+$/, "");
}
