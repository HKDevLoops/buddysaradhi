import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateRequestSize,
  validateUrl,
  validateHeaders,
  validatePath,
  validateRequestBody,
  checkIpRateLimit,
  validateNonce,
  validateTimestamp,
  trackFailedAuth,
  clearFailedAuth,
  getSecurityHeaders,
  getClientIp,
  runSecurityChecks,
  generateRequestId,
} from "../lib/security.ts";

function makeRequest(url: string, opts: RequestInit & { method?: string } = {}): Request {
  return new Request(url, {
    method: opts.method ?? "GET",
    headers: opts.headers ?? {},
    body: opts.body,
  });
}

describe("validateRequestSize", () => {
  it("allows requests with no content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students");
    expect(validateRequestSize(req).allowed).toBe(true);
  });

  it("allows requests under 1MB", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "500000" },
    });
    expect(validateRequestSize(req).allowed).toBe(true);
  });

  it("rejects requests over 1MB", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "2000000" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(413);
  });

  it("rejects invalid content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "abc" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects negative content-length", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "-1" },
    });
    const result = validateRequestSize(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("validateUrl", () => {
  it("allows normal URLs", () => {
    const req = makeRequest("https://example.com/api/v1/students?page=1");
    expect(validateUrl(req).allowed).toBe(true);
  });

  it("rejects URLs with too many query params", () => {
    const params = Array.from({ length: 60 }, (_, i) => `p${i}=v${i}`).join("&");
    const req = makeRequest(`https://example.com/api/v1/students?${params}`);
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects SQL injection in query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?search=1%20OR%201%3D1");
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects XSS in query params", () => {
    const req = makeRequest(
      "https://example.com/api/v1/students?name=%3Cscript%3Ealert(1)%3C/script%3E",
    );
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects path traversal in query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?file=../../etc/passwd");
    const result = validateUrl(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows normal query params", () => {
    const req = makeRequest("https://example.com/api/v1/students?search=alice&status=active");
    expect(validateUrl(req).allowed).toBe(true);
  });
});

describe("validateHeaders", () => {
  it("allows normal headers for GET", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { authorization: "Bearer test-token" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("rejects POST without content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects unsupported content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "text/xml" },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(415);
  });

  it("allows application/json content-type", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("allows application/x-www-form-urlencoded", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(validateHeaders(req).allowed).toBe(true);
  });

  it("removes dangerous headers", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: {
        "x-forwarded-host": "evil.com",
        "x-real-ip": "1.2.3.4",
      },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(true);
    expect(req.headers.has("x-forwarded-host")).toBe(false);
    expect(req.headers.has("x-real-ip")).toBe(false);
  });

  it("rejects headers exceeding max length", () => {
    const longValue = "a".repeat(5000);
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { "x-custom": longValue },
    });
    const result = validateHeaders(req);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });
});

describe("validatePath", () => {
  it("allows normal paths", () => {
    expect(validatePath("/api/v1/students").allowed).toBe(true);
    expect(validatePath("/api/v1/students/123").allowed).toBe(true);
    expect(validatePath("/api/v1/analytics/dashboard").allowed).toBe(true);
  });

  it("rejects path traversal", () => {
    expect(validatePath("/api/v1/../../../etc/passwd").allowed).toBe(false);
    expect(validatePath("/api/v1/%2e%2e%2f").allowed).toBe(false);
  });

  it("rejects command injection", () => {
    expect(validatePath("/api/v1/students;ls").allowed).toBe(false);
    expect(validatePath("/api/v1/students|cat").allowed).toBe(false);
    expect(validatePath("/api/v1/students`whoami`").allowed).toBe(false);
    expect(validatePath("/api/v1/students$(cmd)").allowed).toBe(false);
  });

  it("normalizes double slashes", () => {
    const result = validatePath("/api//v1//students");
    expect(result.allowed).toBe(true);
  });
});

describe("validateRequestBody", () => {
  it("allows empty body", () => {
    expect(validateRequestBody("").allowed).toBe(true);
  });

  it("allows normal JSON body", () => {
    const body = JSON.stringify({ first_name: "Alice", grade: "10" });
    expect(validateRequestBody(body).allowed).toBe(true);
  });

  it("rejects SQL injection in body", () => {
    expect(validateRequestBody("1 OR 1=1").allowed).toBe(false);
    expect(validateRequestBody("'; DROP TABLE students; --").allowed).toBe(false);
  });

  it("rejects XSS in body", () => {
    expect(validateRequestBody("<script>alert(1)</script>").allowed).toBe(false);
    expect(validateRequestBody("<img src=x onerror=alert(1)>").allowed).toBe(false);
  });

  it("sanitizes null bytes", () => {
    const body = "hello\x00world";
    const result = validateRequestBody(body);
    expect(result.allowed).toBe(true);
  });
});

describe("checkIpRateLimit", () => {
  beforeEach(() => {
    // Rate limit state is module-level, so we use unique IPs per test
  });

  it("allows first request from new IP", () => {
    const result = checkIpRateLimit("1.2.3.4-new");
    expect(result.allowed).toBe(true);
  });

  it("allows requests under limit", () => {
    const ip = "5.6.7.8-under";
    for (let i = 0; i < 50; i++) {
      checkIpRateLimit(ip);
    }
    const result = checkIpRateLimit(ip);
    expect(result.allowed).toBe(true);
  });

  it("rejects requests over limit", () => {
    const ip = "9.10.11.12-over";
    for (let i = 0; i < 110; i++) {
      checkIpRateLimit(ip);
    }
    const result = checkIpRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(429);
  });
});

describe("validateNonce", () => {
  it("rejects empty nonce", () => {
    const result = validateNonce("", "tenant-1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects short nonce", () => {
    const result = validateNonce("abc", "tenant-1");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows valid nonce", () => {
    const nonce = crypto.randomUUID().replace(/-/g, "").padEnd(32, "0");
    const result = validateNonce(nonce, "tenant-1");
    expect(result.allowed).toBe(true);
  });

  it("rejects replayed nonce", () => {
    const nonce = crypto.randomUUID().replace(/-/g, "").padEnd(32, "0");
    validateNonce(nonce, "tenant-replay");
    const result = validateNonce(nonce, "tenant-replay");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(409);
  });
});

describe("validateTimestamp", () => {
  it("rejects null timestamp", () => {
    const result = validateTimestamp(null);
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("rejects non-numeric timestamp", () => {
    const result = validateTimestamp("not-a-number");
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(400);
  });

  it("allows current timestamp", () => {
    const result = validateTimestamp(String(Date.now()));
    expect(result.allowed).toBe(true);
  });

  it("rejects expired timestamp (>120s skew)", () => {
    const old = Date.now() - 200_000;
    const result = validateTimestamp(String(old));
    expect(result.allowed).toBe(false);
    expect(result.status).toBe(401);
  });
});

describe("trackFailedAuth", () => {
  beforeEach(() => {
    clearFailedAuth("lockout-tenant");
  });

  it("returns locked: false for first attempt", () => {
    const result = trackFailedAuth("lockout-tenant");
    expect(result.locked).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it("increments attempts", () => {
    trackFailedAuth("lockout-tenant");
    trackFailedAuth("lockout-tenant");
    const result = trackFailedAuth("lockout-tenant");
    expect(result.attempts).toBe(3);
    expect(result.locked).toBe(false);
  });

  it("locks after 15 attempts", () => {
    for (let i = 0; i < 14; i++) {
      trackFailedAuth("lockout-tenant");
    }
    const result = trackFailedAuth("lockout-tenant");
    expect(result.locked).toBe(true);
    expect(result.attempts).toBe(15);
  });

  it("clears failed auth", () => {
    trackFailedAuth("lockout-tenant");
    trackFailedAuth("lockout-tenant");
    clearFailedAuth("lockout-tenant");
    const result = trackFailedAuth("lockout-tenant");
    expect(result.attempts).toBe(1);
    expect(result.locked).toBe(false);
  });
});

describe("getSecurityHeaders", () => {
  it("returns all required security headers", () => {
    const headers = getSecurityHeaders();
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-XSS-Protection"]).toBe("0");
    expect(headers["Strict-Transport-Security"]).toContain("max-age");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["Cache-Control"]).toContain("no-store");
  });
});

describe("runSecurityChecks", () => {
  it("passes for a normal GET request", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      headers: { authorization: "Bearer test" },
    });
    const result = runSecurityChecks(req);
    expect(result.allowed).toBe(true);
  });

  it("fails for oversized request", () => {
    const req = makeRequest("https://example.com/api/v1/students", {
      method: "POST",
      headers: { "content-length": "99999999" },
    });
    const result = runSecurityChecks(req);
    expect(result.allowed).toBe(false);
  });
});

describe("generateRequestId", () => {
  it("returns a 32-char hex string", () => {
    const id = generateRequestId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("generates unique IDs", () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).not.toBe(id2);
  });
});

describe("F-05b / client IP resolution with transport peer + trusted proxies", () => {
  // The defect: `getClientIp` trusted `x-forwarded-for` unconditionally, so any
  // caller rotated rate-limit identities per request by sending
  // `X-Forwarded-For: <random>`. The fix anchors on the transport peer (a fact,
  // not a claim) plus an operator-declared proxy set. Default (no env, no peer)
  // is byte-for-byte the old chain — every test below that omits both asserts
  // the legacy behavior did not move.
  const saved = process.env.TRUSTED_PROXY_CIDRS;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRUSTED_PROXY_CIDRS;
    else process.env.TRUSTED_PROXY_CIDRS = saved;
  });

  function ipReq(headers: Record<string, string>): Request {
    return makeRequest("https://example.com/api/v1/students", { headers });
  }

  it("cf-connecting-ip wins over everything when the peer is a DECLARED proxy", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const req = ipReq({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "198.51.100.7",
    });
    // The peer (10.1.2.3) is inside the declared 10/8, so the edge that
    // asserted cf-connecting-ip is one we trust.
    expect(getClientIp(req, "10.1.2.3")).toBe("203.0.113.9");
  });

  // ── AUD-004 — the regression this pins ────────────────────────────────────
  // `cf-connecting-ip` used to be read FIRST, before the peer check. That
  // short-circuited the entire strict-mode design: an operator who declared
  // their proxies and saw the peer fall OUTSIDE the declared set still got an
  // attacker-chosen identity — and because `index.ts` also keys the 15-attempt
  // credential lockout on this value, rotating the header rotated the lockout
  // bucket too. The brute-force lockout was defeated by one header.
  it("AUD-004: strict + UNTRUSTED peer: a spoofed cf-connecting-ip is IGNORED", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const req = ipReq({
      "cf-connecting-ip": "9.9.9.9",
      "x-forwarded-for": "198.51.100.7",
    });
    // The peer (192.0.2.44) is NOT inside 10/8 — a direct connection. Every
    // header is caller-supplied, so the peer is the client.
    expect(getClientIp(req, "192.0.2.44")).toBe("192.0.2.44");
  });

  it("AUD-004: the spoofed cf-connecting-ip cannot rotate the lockout identity", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    // Two requests from the SAME real peer, each claiming a different client
    // IP. Before the fix these resolved to two different identities (two
    // limiter buckets, two lockout buckets). Now they resolve to one.
    const a = ipReq({ "cf-connecting-ip": "9.9.9.9" });
    const b = ipReq({ "cf-connecting-ip": "8.8.8.8" });
    expect(getClientIp(a, "192.0.2.44")).toBe(getClientIp(b, "192.0.2.44"));
    expect(getClientIp(a, "192.0.2.44")).toBe("192.0.2.44");
  });

  it("AUD-004: a spoofed cf-connecting-ip is STRIPPED on a strict direct connection", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const direct = ipReq({ "cf-connecting-ip": "9.9.9.9" });
    validateHeaders(direct, "192.0.2.44");
    expect(direct.headers.has("cf-connecting-ip")).toBe(false);

    // Kept when the peer IS a declared proxy — that is who wrote it.
    const viaProxy = ipReq({ "cf-connecting-ip": "203.0.113.9" });
    validateHeaders(viaProxy, "10.1.2.3");
    expect(viaProxy.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
  });

  it("AUD-004: legacy mode still honours cf-connecting-ip (byte-for-byte default)", () => {
    // No env, no peer: the pre-strict-mode chain is unchanged, because there
    // is no peer to check a header against. Operators who need a spoof-proof
    // identity must declare TRUSTED_PROXY_CIDRS.
    delete process.env.TRUSTED_PROXY_CIDRS;
    expect(getClientIp(ipReq({ "cf-connecting-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("legacy default: first XFF entry, peer ignored when strict mode is off", () => {
    delete process.env.TRUSTED_PROXY_CIDRS;
    const req = ipReq({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
    // No peer, no env: exactly the old chain.
    expect(getClientIp(req)).toBe("198.51.100.7");
    // Even WITH a peer, strict mode off means the legacy chain (zero behavior
    // change for deployments that do not opt in).
    expect(getClientIp(req, "192.0.2.44")).toBe("198.51.100.7");
  });

  it("strict + trusted peer: client is the LAST XFF entry (the one our proxy appended)", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const req = ipReq({ "x-forwarded-for": "spoofed, 203.0.113.7" });
    // Left entries are caller-supplied noise; the rightmost is what OUR proxy
    // saw. Taking the first here would hand the attacker their chosen identity.
    expect(getClientIp(req, "10.1.2.3")).toBe("203.0.113.7");
  });

  it("strict + trusted peer without XFF: the peer itself", () => {
    process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
    expect(getClientIp(ipReq({}), "127.0.0.1")).toBe("127.0.0.1");
  });

  it("strict + UNTRUSTED peer: spoofed XFF is ignored, peer is the client", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const req = ipReq({ "x-forwarded-for": "attacker-chosen" });
    // The connection is direct (peer not declared) so the header is noise.
    expect(getClientIp(req, "192.0.2.44")).toBe("192.0.2.44");
  });

  it("CIDR matching: /8, /24, /32, exact IPv6, and invalid entries dropped", () => {
    process.env.TRUSTED_PROXY_CIDRS =
      "10.0.0.0/8, 192.168.1.0/24, 127.0.0.1/32, ::1, not-a-cidr, 999.1.1.1/99";
    const req = ipReq({ "x-forwarded-for": "a, b" });
    expect(getClientIp(req, "10.9.9.9")).toBe("b");
    expect(getClientIp(req, "192.168.1.200")).toBe("b");
    expect(getClientIp(req, "127.0.0.1")).toBe("b");
    expect(getClientIp(req, "::1")).toBe("b");
    // 11.0.0.0 is outside 10/8: direct connection, XFF ignored.
    expect(getClientIp(req, "11.0.0.1")).toBe("11.0.0.1");
    // The garbage entries match nothing but do not break parsing.
    expect(getClientIp(req, "not-an-ip")).toBe("not-an-ip");
  });

  it("validateHeaders strips XFF on a strict direct connection, keeps it via a declared proxy", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const direct = ipReq({ "x-forwarded-for": "attacker-chosen" });
    validateHeaders(direct, "192.0.2.44");
    expect(direct.headers.has("x-forwarded-for")).toBe(false);
    const viaProxy = ipReq({ "x-forwarded-for": "spoofed, 203.0.113.7" });
    validateHeaders(viaProxy, "10.1.2.3");
    // Kept: getClientIp reads the proxy-appended last entry from it.
    expect(viaProxy.headers.get("x-forwarded-for")).toBe("spoofed, 203.0.113.7");
  });

  it("runSecurityChecks reports the peer-derived clientIp", () => {
    process.env.TRUSTED_PROXY_CIDRS = "10.0.0.0/8";
    const req = ipReq({ "x-forwarded-for": "attacker-chosen" });
    const res = runSecurityChecks(req, "192.0.2.44");
    expect(res.allowed).toBe(true);
    expect(res.clientIp).toBe("192.0.2.44");
  });
});
