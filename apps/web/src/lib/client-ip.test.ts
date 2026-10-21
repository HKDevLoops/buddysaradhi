// Implements: web/04_API_Routes.md §2 (the `/api/v1/*` token bucket is keyed by
// client IP) + 10_Security.md §11.
//
// Regression guard for docs/audit/DYNAMIC-WEB.md F-2: the bucket was keyed on
// the FIRST entry of `x-forwarded-for`, which the client chooses on any
// deployment that does not overwrite it. Measured: every distinct value minted
// a FRESH 60-token bucket, so the limiter was a no-op.
//
// Two things are pinned: a platform-overwritten header wins over
// `x-forwarded-for` (Vercel / Cloudflare), and a value that is not
// address-shaped cannot mint a bucket.

import { describe, it, expect } from "vitest";
import {
  clientIpFromRequest,
  isIpLike,
  platformIpHeaders,
  UNKNOWN_CLIENT_IP,
} from "./client-ip";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

describe("isIpLike", () => {
  it("accepts IPv4 and IPv6", () => {
    expect(isIpLike("203.0.113.5")).toBe(true);
    expect(isIpLike("10.0.0.1:44321")).toBe(true);
    expect(isIpLike("2001:db8::1")).toBe(true);
  });

  it("rejects a non-address", () => {
    expect(isIpLike("not-an-ip")).toBe(false);
    expect(isIpLike("999.1.1.1")).toBe(false);
    expect(isIpLike("")).toBe(false);
    expect(isIpLike("x".repeat(200))).toBe(false);
  });
});

describe("platformIpHeaders", () => {
  it("trusts Vercel's own header on Vercel", () => {
    expect(platformIpHeaders({ VERCEL: "1" })).toContain("x-vercel-forwarded-for");
  });

  it("trusts Cloudflare's own header on Cloudflare", () => {
    expect(platformIpHeaders({ CF_PAGES: "1" })).toContain("cf-connecting-ip");
  });

  it("trusts NO header on an unknown platform (a client can send any header name)", () => {
    expect(platformIpHeaders({})).toEqual([]);
  });
});

describe("clientIpFromRequest", () => {
  it("prefers the platform-overwritten header over a spoofed x-forwarded-for", () => {
    const ip = clientIpFromRequest(
      headers({ "x-vercel-forwarded-for": "198.51.100.7", "x-forwarded-for": "10.0.0.1" }),
      { VERCEL: "1" },
    );
    expect(ip).toBe("198.51.100.7");
  });

  it("prefers Cloudflare's header on Cloudflare", () => {
    const ip = clientIpFromRequest(
      headers({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "10.0.0.1" }),
      { CF_PAGES: "1" },
    );
    expect(ip).toBe("198.51.100.9");
  });

  it("falls back to x-forwarded-for on an unknown platform (unchanged contract)", () => {
    const ip = clientIpFromRequest(headers({ "x-forwarded-for": "203.0.113.5" }), {});
    expect(ip).toBe("203.0.113.5");
  });

  it("does not let a non-address mint a bucket", () => {
    const ip = clientIpFromRequest(headers({ "x-forwarded-for": "not-an-ip-at-all" }), {});
    expect(ip).toBe(UNKNOWN_CLIENT_IP);
  });

  it("falls back to the shared bucket when there is no address at all", () => {
    expect(clientIpFromRequest(headers({}), {})).toBe(UNKNOWN_CLIENT_IP);
  });
});
