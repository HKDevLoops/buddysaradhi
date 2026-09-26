// Implements: 20_3D_Product_Page.md §1.1.3 (live marketing facts, R-17).
// Public, unauthenticated, DB-free. Every field is a verifiable product fact:
// counts come from the spec (5 screens P2, 7 engines 02_Core_Logic), pricing
// from 04_Pricing (₹0 while infra free). No ratings, no tutor counts, no
// claims without a source — those fields do not exist until a real source does.

import { fail, okCached } from "../lib/errors.ts";
import { logInfo } from "../lib/log.ts";

const STATS_BODY = JSON.stringify({
  success: true,
  data: {
    screens: 5,
    engines: 7,
    pricing: { inrPaisePerMonth: 0, note: "Free while our infra stays free" },
    guarantees: ["offline-first", "no-telemetry", "single-tenant-sqlite", "append-only-ledger"],
    platforms: ["web", "android", "windows", "macos", "ios"],
    specVersion: "v1.4",
  },
});

const CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=600";

export function handleMarketingPublic(
  path: string,
  method: string,
  logCtx: Record<string, unknown>,
): Response | null {
  if (path !== "/api/v1/marketing/stats") return null;
  if (method !== "GET") return fail("method not allowed", 405);
  logInfo("gateway.marketing_stats", { ...logCtx, status: 200 });
  return okCached(STATS_BODY, CACHE_CONTROL);
}
