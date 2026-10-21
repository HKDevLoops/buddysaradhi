// Implements: 10_Security.md §6 (the console must not be indexed) and the
// SEO contract for a marketing surface.
//
// WHY THIS FILE EXISTS. `/admin` carries `robots: { index: false, follow: false }`
// (measured live: the served page emits `<meta name="robots" content="noindex,
// nofollow">`), but a meta tag is a REQUEST to a crawler, not a rule. There was
// NO `robots.txt` on the deployment at all - `/robots.txt` answered 404 - so
// the crawler was told nothing, and the console URL was a guessable
// `/admin`. A `robots.txt` is the one place a crawler reads FIRST, and it is
// where "do not index this" belongs.
//
// The API routes are disallowed for the same reason and one more: they are
// machine surfaces, not documents, and `/api/admin/reminders/evaluate` answers
// JSON that has no business in an index.
//
// Rule 2: this file adds no network call and no new origin. Rule 9: it fails
// loudly through the shared origin resolver rather than emitting a sitemap
// against a guessed host.

import type { MetadataRoute } from "next";
import { siteOriginString } from "@/lib/site-origin";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  const origin = siteOriginString();
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/platforms", "/request-access", "/tour"],
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
