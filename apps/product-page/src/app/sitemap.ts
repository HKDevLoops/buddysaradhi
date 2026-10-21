// Implements: the SEO contract for a marketing surface (product/09_SEO_and_Analytics.md).
//
// The site had NO sitemap: `/sitemap.xml` answered 404 on the live deployment.
// A marketing page that wants to be found lists its own pages; this file is
// the list, and it is generated from ONE source (the origin resolver) so a
// sitemap can never point at a host the canonical does not.
//
// The console and the API routes are absent on purpose: they are not
// documents, and `/robots.txt` already disallows them.

import type { MetadataRoute } from "next";
import { siteOriginString } from "@/lib/site-origin";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = siteOriginString();
  // A fixed timestamp keeps the sitemap byte-stable between builds. A changing
  // `lastModified` on every build tells crawlers the site changed when it did
  // not, which trains them to ignore the field.
  const lastModified = new Date("2026-10-21T00:00:00.000Z");
  return [
    { url: `${origin}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/platforms`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/tour`, lastModified, changeFrequency: "monthly", priority: 0.7 },
    { url: `${origin}/request-access`, lastModified, changeFrequency: "monthly", priority: 0.9 },
  ];
}
