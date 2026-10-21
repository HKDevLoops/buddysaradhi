// Implements: 10_Security.md §6 (XSS-1 / CSRF) for the one PUBLIC WRITE
// endpoint in this app.
//
// The rule is small, so it is small here too: a state-changing request must
// carry a same-origin signal, and the host-relative comparison is what makes
// it correct on every deployment origin without an allowlist to maintain.

import { describe, expect, it } from "vitest";
import {
  allowedOriginsFor,
  normaliseOrigin,
  resolveOriginVerdict,
} from "../src/lib/request-origin";

function headers(map: Record<string, string>): { get(name: string): string | null } {
  return { get: (name: string) => map[name.toLowerCase()] ?? null };
}

describe("normaliseOrigin", () => {
  it("reduces an absolute URL to scheme://host:port", () => {
    expect(normaliseOrigin("https://buddysaradhi-product.vercel.app")).toBe(
      "https://buddysaradhi-product.vercel.app",
    );
    expect(normaliseOrigin("https://example.com:8443/some/path?q=1")).toBe(
      "https://example.com:8443",
    );
  });

  it("refuses anything that is not an absolute http(s) URL", () => {
    expect(normaliseOrigin(null)).toBeNull();
    expect(normaliseOrigin("")).toBeNull();
    expect(normaliseOrigin("   ")).toBeNull();
    expect(normaliseOrigin("/relative/path")).toBeNull();
    expect(normaliseOrigin("javascript:alert(1)")).toBeNull();
    expect(normaliseOrigin("data:text/html,<script>")).toBeNull();
  });
});

describe("allowedOriginsFor", () => {
  it("accepts the request's own host over both schemes", () => {
    const allowed = allowedOriginsFor("buddysaradhi-product.vercel.app");
    expect(allowed).toContain("https://buddysaradhi-product.vercel.app");
    expect(allowed).toContain("http://buddysaradhi-product.vercel.app");
  });

  it("adds an explicitly configured origin without dropping the host", () => {
    const allowed = allowedOriginsFor("example.com", ["https://buddysaradhi.app"]);
    expect(allowed).toContain("https://example.com");
    expect(allowed).toContain("https://buddysaradhi.app");
  });
});

describe("resolveOriginVerdict (the CSRF gate)", () => {
  it("allows a same-origin request", () => {
    const verdict = resolveOriginVerdict(
      headers({ origin: "https://buddysaradhi-product.vercel.app" }),
      "buddysaradhi-product.vercel.app",
    );
    expect(verdict).toEqual({ allowed: true, source: "origin" });
  });

  it("REFUSES a cross-origin request - the CSRF case", () => {
    const verdict = resolveOriginVerdict(
      headers({ origin: "https://evil.example", referer: "https://evil.example/pwn" }),
      "buddysaradhi-product.vercel.app",
    );
    expect(verdict).toEqual({ allowed: false, reason: "not-allowed" });
  });

  it("REFUSES a request with no same-origin signal at all", () => {
    const verdict = resolveOriginVerdict(headers({}), "buddysaradhi-product.vercel.app");
    expect(verdict).toEqual({ allowed: false, reason: "no-origin" });
  });

  it("falls back to the Referer when there is no Origin header", () => {
    const sameSite = resolveOriginVerdict(
      headers({ referer: "https://buddysaradhi-product.vercel.app/request-access" }),
      "buddysaradhi-product.vercel.app",
    );
    expect(sameSite).toEqual({ allowed: true, source: "referer" });

    const otherSite = resolveOriginVerdict(
      headers({ referer: "https://evil.example/pwn" }),
      "buddysaradhi-product.vercel.app",
    );
    expect(otherSite).toEqual({ allowed: false, reason: "not-allowed" });
  });

  it("does not let a malformed Origin slip through as the host", () => {
    const verdict = resolveOriginVerdict(
      headers({ origin: "buddysaradhi-product.vercel.app" }),
      "buddysaradhi-product.vercel.app",
    );
    expect(verdict.allowed).toBe(false);
  });

  it("accepts the configured site origin as an extra, not as a replacement", () => {
    const verdict = resolveOriginVerdict(
      headers({ origin: "https://buddysaradhi.app" }),
      "buddysaradhi-product.vercel.app",
      ["https://buddysaradhi.app"],
    );
    expect(verdict).toEqual({ allowed: true, source: "origin" });
  });

  it("still refuses a third party even when the site origin is allowed", () => {
    const verdict = resolveOriginVerdict(
      headers({ origin: "https://evil.example" }),
      "buddysaradhi-product.vercel.app",
      ["https://buddysaradhi.app"],
    );
    expect(verdict.allowed).toBe(false);
  });
});
